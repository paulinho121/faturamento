// Ponte CRM -> Faturamento: o CRM chama esse endpoint quando um pedido é
// fechado, e a gente cria o "pedido" aqui do jeito que um vendedor cadastra
// pela tela — mesma fila do faturista, mesmo histórico, mesma barra de
// progresso. Roda com a service role key (ignora RLS de propósito: quem
// chama aqui não é um usuário logado no nosso sistema).
//
//   POST  cria o pedido (JSON, ver docs/INTEGRACAO_CRM.md)
//   GET   teste de conexão: confere segredo, variáveis e conta de serviço
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'

const ORIGENS = ['SC', 'SP', 'CE'] as const
type Origem = (typeof ORIGENS)[number]

const LIMITES = { cliente: 200, observacao: 1000, arquivo_nome: 200, id_externo: 100 } as const

function isOrigemValida(valor: string): valor is Origem {
  return (ORIGENS as readonly string[]).includes(valor)
}

// Mesma lógica de src/lib/storage.ts — duplicada aqui porque essa função
// roda em Node (Vercel Function), fora do bundle do Vite.
function nomeArquivoSeguro(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const partes = semAcento.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()!.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}` : ''
  const base = partes.join('.').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'arquivo'
  return `${base}${extensao}`
}

// "João  Sousa" e "joao sousa" são o mesmo vendedor — o CRM não precisa
// acertar acento, caixa nem espaço duplo.
function chaveNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function segredoConfere(recebido: string | string[] | undefined, esperado: string): boolean {
  if (typeof recebido !== 'string') return false
  // Compara os hashes (tamanho fixo) pra timingSafeEqual não estourar com segredos de tamanhos diferentes.
  const a = new Uint8Array(createHash('sha256').update(recebido).digest())
  const b = new Uint8Array(createHash('sha256').update(esperado).digest())
  return timingSafeEqual(a, b)
}

function lerBody(req: VercelRequest): Record<string, unknown> {
  const bruto: unknown = req.body
  if (typeof bruto === 'string') {
    try {
      const parsed: unknown = JSON.parse(bruto)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {}
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Use POST (criar pedido) ou GET (testar a conexão).' })
    return
  }

  const secretEsperado = process.env.CRM_WEBHOOK_SECRET
  if (!secretEsperado || !segredoConfere(req.headers['x-webhook-secret'], secretEsperado)) {
    res.status(401).json({ error: 'Segredo do webhook ausente ou inválido (header x-webhook-secret).' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const servicoProfileId = process.env.CRM_SERVICE_PROFILE_ID
  if (!supabaseUrl || !serviceRoleKey || !servicoProfileId) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis de ambiente ausentes).' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  if (req.method === 'GET') {
    const { data: servico, error: servicoError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', servicoProfileId)
      .maybeSingle()
    if (servicoError || !servico) {
      res.status(500).json({ error: 'CRM_SERVICE_PROFILE_ID não corresponde a nenhum usuário do sistema.' })
      return
    }
    const { count, error: contagemError } = await supabase
      .from('vendedores')
      .select('id', { count: 'exact', head: true })
      .eq('ativo', true)
    if (contagemError) {
      res.status(500).json({ error: `Erro ao consultar o banco: ${contagemError.message}` })
      return
    }
    res.status(200).json({ ok: true, vendedores_ativos: count ?? 0 })
    return
  }

  const body = lerBody(req)
  const vendedorNome = texto(body.vendedor)
  const cliente = texto(body.cliente)
  const observacao = texto(body.observacao)
  const origemInput = texto(body.origem).toUpperCase()
  const arquivoNomeOriginal = texto(body.arquivo_nome)
  const idExterno = body.id_externo == null ? '' : String(body.id_externo).trim()
  const arquivoBase64Raw = typeof body.arquivo_base64 === 'string' ? body.arquivo_base64 : ''

  if (!vendedorNome) return void res.status(400).json({ error: 'Campo "vendedor" é obrigatório.' })
  if (!cliente) return void res.status(400).json({ error: 'Campo "cliente" é obrigatório.' })
  if (!arquivoNomeOriginal) return void res.status(400).json({ error: 'Campo "arquivo_nome" é obrigatório.' })
  if (!arquivoBase64Raw) return void res.status(400).json({ error: 'Campo "arquivo_base64" é obrigatório.' })
  if (origemInput && !isOrigemValida(origemInput)) {
    return void res.status(400).json({ error: 'Campo "origem" precisa ser "SC", "SP", "CE" ou vazio.' })
  }
  for (const [campo, valor] of [
    ['cliente', cliente],
    ['observacao', observacao],
    ['arquivo_nome', arquivoNomeOriginal],
    ['id_externo', idExterno],
  ] as const) {
    if (valor.length > LIMITES[campo]) {
      return void res.status(400).json({ error: `Campo "${campo}" passa do limite de ${LIMITES[campo]} caracteres.` })
    }
  }

  const base64Puro = arquivoBase64Raw.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Puro)) {
    return void res.status(400).json({ error: 'Campo "arquivo_base64" não é um base64 válido.' })
  }
  const arquivoBuffer = Buffer.from(base64Puro, 'base64')
  if (arquivoBuffer.length === 0 || arquivoBuffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    return void res.status(400).json({ error: 'O arquivo enviado não parece ser um PDF válido.' })
  }

  // Só vendedor ativo, comparando sem acento/caixa. Nome repetido entre dois
  // ativos não dá pra adivinhar: melhor recusar do que faturar pro errado.
  const { data: ativos, error: vendedorError } = await supabase.from('vendedores').select('id, nome').eq('ativo', true)
  if (vendedorError) {
    return void res.status(500).json({ error: `Erro ao buscar vendedor: ${vendedorError.message}` })
  }
  const chave = chaveNome(vendedorNome)
  const candidatos = (ativos ?? []).filter((v) => chaveNome(v.nome) === chave)
  if (candidatos.length === 0) {
    return void res.status(404).json({ error: `Nenhum vendedor ativo cadastrado com o nome "${vendedorNome}".` })
  }
  if (candidatos.length > 1) {
    return void res.status(400).json({ error: `Mais de um vendedor ativo com o nome "${vendedorNome}".` })
  }
  const vendedor = candidatos[0]

  const respostaDuplicado = async (campo: 'id_externo' | 'arquivo_hash', valor: string) => {
    const { data: existente } = await supabase
      .from('pedidos')
      .select('numero')
      .eq(campo, valor)
      .neq('status', 'cancelado')
      .maybeSingle()
    res.status(409).json({
      error:
        campo === 'id_externo'
          ? 'Este pedido do CRM já foi enviado antes.'
          : 'Este pedido (mesmo arquivo PDF) já foi enviado antes.',
      duplicado: true,
      numero: existente?.numero ?? null,
    })
  }

  // Reenvio do mesmo pedido do CRM: responde sem subir o arquivo de novo.
  if (idExterno) {
    const { data: jaEnviado } = await supabase
      .from('pedidos')
      .select('numero')
      .eq('id_externo', idExterno)
      .neq('status', 'cancelado')
      .maybeSingle()
    if (jaEnviado) {
      return void res.status(409).json({
        error: 'Este pedido do CRM já foi enviado antes.',
        duplicado: true,
        numero: jaEnviado.numero,
      })
    }
  }

  const hash = createHash('sha256').update(new Uint8Array(arquivoBuffer)).digest('hex')
  const path = `${vendedor.id}/${Date.now()}-${nomeArquivoSeguro(arquivoNomeOriginal)}`

  const { error: uploadError } = await supabase.storage
    .from('pedidos')
    .upload(path, arquivoBuffer, { contentType: 'application/pdf' })
  if (uploadError) {
    return void res.status(500).json({ error: `Erro ao enviar o arquivo: ${uploadError.message}` })
  }

  const observacaoFinal = [idExterno ? `Pedido CRM #${idExterno}` : '', observacao].filter(Boolean).join(' — ')

  const { data: pedido, error: insertError } = await supabase
    .from('pedidos')
    .insert({
      vendedor_id: vendedor.id,
      cliente,
      observacao: observacaoFinal || null,
      origem: origemInput || null,
      arquivo_path: path,
      arquivo_nome: arquivoNomeOriginal,
      arquivo_hash: hash,
      id_externo: idExterno || null,
      created_by: servicoProfileId,
    })
    .select('numero')
    .single()

  if (insertError) {
    await supabase.storage.from('pedidos').remove([path])
    if (insertError.code === '23505') {
      if (insertError.message.includes('pedidos_id_externo_uniq')) return void (await respostaDuplicado('id_externo', idExterno))
      if (insertError.message.includes('pedidos_arquivo_hash_uniq')) return void (await respostaDuplicado('arquivo_hash', hash))
    }
    return void res.status(500).json({ error: `Erro ao criar pedido: ${insertError.message}` })
  }

  res.status(201).json({ ok: true, numero: pedido.numero })
}
