// Ponte CRM -> Faturamento: o CRM chama esse endpoint quando um pedido é
// fechado, e a gente cria o "pedido" aqui do jeito que um vendedor cadastra
// pela tela — mesma fila do faturista, mesmo histórico, mesma barra de
// progresso. Roda com a service role key (ignora RLS de propósito: quem
// chama aqui não é um usuário logado no nosso sistema).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const ORIGENS = ['SC', 'SP', 'CE'] as const
type Origem = (typeof ORIGENS)[number]

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const secretEsperado = process.env.CRM_WEBHOOK_SECRET
  const secretRecebido = req.headers['x-webhook-secret']
  if (!secretEsperado || secretRecebido !== secretEsperado) {
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

  const body = (req.body ?? {}) as Record<string, unknown>
  const vendedorNome = typeof body.vendedor === 'string' ? body.vendedor.trim() : ''
  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : ''
  const observacao = typeof body.observacao === 'string' ? body.observacao.trim() : ''
  const origemInput = typeof body.origem === 'string' ? body.origem.trim().toUpperCase() : ''
  const arquivoNomeOriginal = typeof body.arquivo_nome === 'string' ? body.arquivo_nome.trim() : ''
  const arquivoBase64Raw = typeof body.arquivo_base64 === 'string' ? body.arquivo_base64 : ''

  if (!vendedorNome) return void res.status(400).json({ error: 'Campo "vendedor" é obrigatório.' })
  if (!cliente) return void res.status(400).json({ error: 'Campo "cliente" é obrigatório.' })
  if (!arquivoNomeOriginal) return void res.status(400).json({ error: 'Campo "arquivo_nome" é obrigatório.' })
  if (!arquivoBase64Raw) return void res.status(400).json({ error: 'Campo "arquivo_base64" é obrigatório.' })
  if (origemInput && !isOrigemValida(origemInput)) {
    return void res.status(400).json({ error: 'Campo "origem" precisa ser "SC", "SP", "CE" ou vazio.' })
  }

  const base64Puro = arquivoBase64Raw.replace(/^data:application\/pdf;base64,/, '')
  let arquivoBuffer: Buffer
  try {
    arquivoBuffer = Buffer.from(base64Puro, 'base64')
  } catch {
    return void res.status(400).json({ error: 'Campo "arquivo_base64" não é um base64 válido.' })
  }
  if (arquivoBuffer.length === 0 || arquivoBuffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    return void res.status(400).json({ error: 'O arquivo enviado não parece ser um PDF válido.' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: vendedor, error: vendedorError } = await supabase
    .from('vendedores')
    .select('id')
    .ilike('nome', vendedorNome)
    .maybeSingle()
  if (vendedorError) {
    return void res.status(500).json({ error: `Erro ao buscar vendedor: ${vendedorError.message}` })
  }
  if (!vendedor) {
    return void res.status(404).json({ error: `Nenhum vendedor cadastrado com o nome "${vendedorNome}".` })
  }

  const hash = createHash('sha256').update(new Uint8Array(arquivoBuffer)).digest('hex')
  const path = `${vendedor.id}/${Date.now()}-${nomeArquivoSeguro(arquivoNomeOriginal)}`

  const { error: uploadError } = await supabase.storage
    .from('pedidos')
    .upload(path, arquivoBuffer, { contentType: 'application/pdf' })
  if (uploadError) {
    return void res.status(500).json({ error: `Erro ao enviar o arquivo: ${uploadError.message}` })
  }

  const { data: pedido, error: insertError } = await supabase
    .from('pedidos')
    .insert({
      vendedor_id: vendedor.id,
      cliente,
      observacao: observacao || null,
      origem: origemInput || null,
      arquivo_path: path,
      arquivo_nome: arquivoNomeOriginal,
      arquivo_hash: hash,
      created_by: servicoProfileId,
    })
    .select('numero')
    .single()

  if (insertError) {
    await supabase.storage.from('pedidos').remove([path])
    if (insertError.code === '23505' && insertError.message.includes('pedidos_arquivo_hash_uniq')) {
      return void res.status(409).json({ error: 'Este pedido (mesmo arquivo PDF) já foi enviado antes.' })
    }
    return void res.status(500).json({ error: `Erro ao criar pedido: ${insertError.message}` })
  }

  res.status(201).json({ ok: true, numero: pedido.numero })
}
