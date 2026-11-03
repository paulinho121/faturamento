// Ponte Loja Integrada (nosso site) -> Faturamento: busca os pedidos aprovados da
// loja e cria o "pedido" aqui do jeito que um vendedor cadastra pela tela — mesma
// fila do faturista, mesma logística, mesma barra de progresso. Como a loja não
// manda PDF, a gente gera um PDF-resumo do pedido (cliente, endereço, itens,
// pagamento, frete) pra ficar igual aos pedidos do CRM. Roda com a service role key.
//
//   GET/POST             sincroniza os pedidos aprovados dos últimos dias (LI_JANELA_HORAS)
//   GET ?pedido=1234     só consulta esse número na loja e mostra o resumo
//                        (não cria nada) — pra conferir credenciais e dados
//
// Chamada por um agendador (a cada ~5 min) com o header x-sync-secret. Exemplo com
// pg_cron + pg_net no Supabase (ver docs/INTEGRACAO_LOJA_INTEGRADA.md):
//   select cron.schedule('loja-integrada-sync', '*/5 * * * *', $$
//     select net.http_get('https://faturamentomcit.vercel.app/api/loja-integrada-sync',
//                         headers := '{"x-sync-secret": "<LI_SYNC_SECRET>"}'::jsonb) $$);
//
// Só entra pedido com situação aprovada e não cancelada. O pedido da loja vira
// id_externo "LI-<número>": rodar de novo não duplica, e pedido que o faturamento
// cancelou não volta.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'
import { jsPDF } from 'jspdf'

const BASE_API = 'https://api.awsli.com.br'
const ORIGENS = ['SC', 'SP', 'CE'] as const
const PAGINA = 50
const MAX_PAGINAS = 10
const MAX_IMPORTAR_POR_RODADA = 25

interface Situacao {
  id: number
  nome: string
  aprovado: boolean
  cancelado: boolean
}

interface ResumoPedido {
  numero: number
  situacao: Situacao
}

interface ItemLoja {
  sku: string | null
  nome: string
  quantidade: string
  preco_venda: string
  preco_subtotal: string
}

interface Endereco {
  nome?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
}

interface PedidoLoja {
  numero: number
  data_criacao: string
  situacao: Situacao
  cliente: {
    nome?: string | null
    razao_social?: string | null
    cpf?: string | null
    cnpj?: string | null
    email?: string | null
    telefone_celular?: string | null
    telefone_principal?: string | null
  }
  cliente_obs: string | null
  endereco_entrega: Endereco | null
  itens: ItemLoja[]
  envios: { forma_envio?: { nome?: string | null } | null; prazo?: number | null; valor?: string | null }[]
  pagamentos: { forma_pagamento?: { nome?: string | null } | null; parcelamento?: { numero_parcelas?: number | null } | null }[]
  valor_subtotal: string
  valor_desconto: string
  valor_envio: string
  valor_total: string
}

function segredoConfere(recebido: string | string[] | undefined, esperado: string): boolean {
  if (typeof recebido !== 'string') return false
  const a = new Uint8Array(createHash('sha256').update(recebido).digest())
  const b = new Uint8Array(createHash('sha256').update(esperado).digest())
  return timingSafeEqual(a, b)
}

function chaveNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Credencial da loja: o Personal Token do lojista (recomendado — o de integrador
// tem restrição por IP, e a Vercel não tem IP fixo) ou o par chave_api + aplicação.
function cabecalhoAutorizacao(): string | null {
  const pessoal = process.env.LI_PERSONAL_TOKEN
  if (pessoal) return `Basic ${pessoal}`
  const chaveApi = process.env.LI_CHAVE_API
  const aplicacao = process.env.LI_CHAVE_APLICACAO
  if (chaveApi && aplicacao) return `chave_api ${chaveApi} aplicacao ${aplicacao}`
  return null
}

class ErroLoja extends Error {}

async function chamarLoja<T>(autorizacao: string, caminho: string): Promise<T> {
  const res = await fetch(`${BASE_API}${caminho}`, { headers: { Authorization: autorizacao, Accept: 'application/json' } })
  const corpo = await res.text()
  if (!res.ok) {
    const dica = res.status === 401 || res.status === 403 ? ' (credencial recusada — confira o token e a restrição de IP)' : ''
    throw new ErroLoja(`Loja Integrada respondeu ${res.status}${dica}: ${corpo.slice(0, 200)}`)
  }
  try {
    return JSON.parse(corpo) as T
  } catch {
    throw new ErroLoja(`Resposta inesperada da Loja Integrada em ${caminho.split('?')[0]}.`)
  }
}

const dinheiro = (valor: string | null | undefined) => Number(valor ?? 0) || 0
const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const aparar = (valor: string, limite: number) => (valor.length > limite ? `${valor.slice(0, limite - 1)}…` : valor)

function nomeCliente(p: PedidoLoja): string {
  return (p.cliente.razao_social || p.cliente.nome || `Cliente do pedido ${p.numero}`).trim()
}

function documentoCliente(p: PedidoLoja): string {
  return p.cliente.cnpj || p.cliente.cpf || ''
}

function enderecoEmLinha(e: Endereco | null): string {
  if (!e) return 'não informado'
  const rua = [e.endereco, e.numero].filter(Boolean).join(', ')
  const cidade = [e.cidade, e.estado].filter(Boolean).join('/')
  return [rua, e.complemento, e.bairro, cidade, e.cep ? `CEP ${e.cep}` : ''].filter(Boolean).join(' · ')
}

function formaDeEnvio(p: PedidoLoja): string {
  return p.envios[0]?.forma_envio?.nome ?? ''
}

function formaDePagamento(p: PedidoLoja): string {
  const pg = p.pagamentos[0]
  const parcelas = pg?.parcelamento?.numero_parcelas
  return pg?.forma_pagamento?.nome ? `${pg.forma_pagamento.nome}${parcelas && parcelas > 1 ? ` em ${parcelas}x` : ''}` : ''
}

// PDF-resumo do pedido (o faturista abre pra emitir a NF; a logística baixa como orçamento).
function gerarPdf(p: PedidoLoja): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const MARGEM = 15
  const LARGURA = 210 - MARGEM * 2
  let y = 20

  const linha = (texto: string, opcoes: { negrito?: boolean; tamanho?: number; espaco?: number } = {}) => {
    doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal')
    doc.setFontSize(opcoes.tamanho ?? 10)
    for (const parte of doc.splitTextToSize(texto, LARGURA) as string[]) {
      if (y > 280) {
        doc.addPage()
        y = 20
      }
      doc.text(parte, MARGEM, y)
      y += (opcoes.tamanho ?? 10) * 0.45 + 1.2
    }
    y += opcoes.espaco ?? 0
  }

  linha(`Pedido do site nº ${p.numero}`, { negrito: true, tamanho: 16, espaco: 2 })
  linha(`Loja Integrada · ${new Date(p.data_criacao).toLocaleString('pt-BR')} · situação: ${p.situacao.nome}`, { espaco: 4 })

  linha('Cliente', { negrito: true, tamanho: 12 })
  linha(`${nomeCliente(p)}${documentoCliente(p) ? ` · ${documentoCliente(p)}` : ''}`)
  linha([p.cliente.email, p.cliente.telefone_celular || p.cliente.telefone_principal].filter(Boolean).join(' · ') || '—', { espaco: 3 })

  linha('Entrega', { negrito: true, tamanho: 12 })
  linha(enderecoEmLinha(p.endereco_entrega))
  linha(`Forma de envio: ${formaDeEnvio(p) || '—'}${p.envios[0]?.prazo ? ` · prazo ${p.envios[0].prazo} dia(s)` : ''}`, { espaco: 3 })

  linha('Itens', { negrito: true, tamanho: 12 })
  for (const item of p.itens) {
    const qtd = Number(item.quantidade) || 0
    linha(`${qtd}x ${item.nome}${item.sku ? ` (SKU ${item.sku})` : ''}`, { negrito: true })
    linha(`   ${moeda(dinheiro(item.preco_venda))} cada · subtotal ${moeda(dinheiro(item.preco_subtotal))}`)
  }
  y += 3

  linha('Valores', { negrito: true, tamanho: 12 })
  linha(`Subtotal: ${moeda(dinheiro(p.valor_subtotal))}`)
  if (dinheiro(p.valor_desconto) > 0) linha(`Desconto: -${moeda(dinheiro(p.valor_desconto))}`)
  linha(`Frete: ${moeda(dinheiro(p.valor_envio))}`)
  linha(`Total: ${moeda(dinheiro(p.valor_total))}`, { negrito: true, tamanho: 12, espaco: 3 })

  linha(`Pagamento: ${formaDePagamento(p) || '—'}`, { espaco: p.cliente_obs ? 3 : 0 })
  if (p.cliente_obs) linha(`Observação do cliente: ${p.cliente_obs}`)

  return Buffer.from(doc.output('arraybuffer'))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Use GET ou POST.' })
    return
  }

  const secretEsperado = process.env.LI_SYNC_SECRET
  if (!secretEsperado || !segredoConfere(req.headers['x-sync-secret'], secretEsperado)) {
    res.status(401).json({ error: 'Segredo ausente ou inválido (header x-sync-secret).' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const servicoProfileId = process.env.LI_SERVICE_PROFILE_ID || process.env.CRM_SERVICE_PROFILE_ID
  const autorizacao = cabecalhoAutorizacao()
  if (!supabaseUrl || !serviceRoleKey || !servicoProfileId || !autorizacao) {
    res.status(500).json({
      error: 'Integração não configurada no servidor (faltam variáveis: LI_PERSONAL_TOKEN ou LI_CHAVE_API + LI_CHAVE_APLICACAO, Supabase e conta de serviço).',
    })
    return
  }

  try {
    // Conferência: mostra um pedido da loja sem criar nada.
    const consulta = typeof req.query.pedido === 'string' ? Number(req.query.pedido) : NaN
    if (Number.isInteger(consulta) && consulta > 0) {
      const p = await chamarLoja<PedidoLoja>(autorizacao, `/v1/pedido/${consulta}`)
      res.status(200).json({
        numero: p.numero,
        situacao: p.situacao.nome,
        aprovado: p.situacao.aprovado,
        cancelado: p.situacao.cancelado,
        cliente: nomeCliente(p),
        itens: p.itens.length,
        total: dinheiro(p.valor_total),
        envio: formaDeEnvio(p),
        pagamento: formaDePagamento(p),
      })
      return
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // O pedido do site é de um vendedor "Site" (cadastrado em Vendedores).
    const vendedorNome = process.env.LI_VENDEDOR_NOME || 'Site'
    const { data: ativos, error: vendedorError } = await supabase.from('vendedores').select('id, nome').eq('ativo', true)
    if (vendedorError) throw new Error(`Erro ao buscar vendedor: ${vendedorError.message}`)
    const candidatos = (ativos ?? []).filter((v) => chaveNome(v.nome) === chaveNome(vendedorNome))
    if (candidatos.length !== 1) {
      res.status(500).json({
        error:
          candidatos.length === 0
            ? `Cadastre um vendedor ativo chamado "${vendedorNome}" (ou defina LI_VENDEDOR_NOME) para receber os pedidos do site.`
            : `Mais de um vendedor ativo com o nome "${vendedorNome}".`,
      })
      return
    }
    const vendedor = candidatos[0]
    // Todos os pedidos do site saem de Santa Catarina (Sanco); LI_ORIGEM só muda isso.
    const origemEnv = (process.env.LI_ORIGEM || 'SC').toUpperCase()
    const origem = (ORIGENS as readonly string[]).includes(origemEnv) ? origemEnv : 'SC'

    // Pedidos mexidos na janela; o aprovado de ontem que só agora foi pago entra também.
    const horas = Number(process.env.LI_JANELA_HORAS) || 72
    const desde = new Date(Date.now() - horas * 3_600_000).toISOString().slice(0, 19)
    const aprovados: ResumoPedido[] = []
    let lidos = 0
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const lote = await chamarLoja<{ meta: { total_count: number }; objects: ResumoPedido[] }>(
        autorizacao,
        `/v1/pedido/search?since_atualizado=${encodeURIComponent(desde)}&limit=${PAGINA}&offset=${pagina * PAGINA}`
      )
      lidos += lote.objects.length
      aprovados.push(...lote.objects.filter((o) => o.situacao.aprovado && !o.situacao.cancelado))
      if (lote.objects.length < PAGINA || lidos >= lote.meta.total_count) break
    }

    const ids = aprovados.map((o) => `LI-${o.numero}`)
    const { data: existentes, error: existentesError } = ids.length
      ? await supabase.from('pedidos').select('id_externo').in('id_externo', ids)
      : { data: [] as { id_externo: string }[], error: null }
    if (existentesError) throw new Error(`Erro ao consultar pedidos existentes: ${existentesError.message}`)
    const jaTem = new Set((existentes ?? []).map((e) => e.id_externo))
    const novos = aprovados.filter((o) => !jaTem.has(`LI-${o.numero}`)).sort((a, b) => a.numero - b.numero)

    const importados: number[] = []
    const erros: { numero: number; erro: string }[] = []
    for (const resumo of novos.slice(0, MAX_IMPORTAR_POR_RODADA)) {
      try {
        const p = await chamarLoja<PedidoLoja>(autorizacao, `/v1/pedido/${resumo.numero}`)
        const pdf = gerarPdf(p)
        const arquivoNome = `pedido-site-${p.numero}.pdf`
        const path = `${vendedor.id}/${Date.now()}-${arquivoNome}`
        const { error: uploadError } = await supabase.storage.from('pedidos').upload(path, pdf, { contentType: 'application/pdf' })
        if (uploadError) throw new Error(`Erro ao enviar o PDF: ${uploadError.message}`)

        const observacao = [
          `Pedido do site #${p.numero}`,
          formaDeEnvio(p) ? `Envio: ${formaDeEnvio(p)}` : '',
          formaDePagamento(p) ? `Pagamento: ${formaDePagamento(p)}` : '',
          p.cliente_obs ? `Obs. do cliente: ${p.cliente_obs}` : '',
        ]
          .filter(Boolean)
          .join(' — ')

        const { error: insertError } = await supabase.from('pedidos').insert({
          vendedor_id: vendedor.id,
          cliente: aparar(nomeCliente(p), 200),
          valor_estimado: dinheiro(p.valor_total),
          observacao: aparar(observacao, 1000),
          origem,
          arquivo_path: path,
          arquivo_nome: arquivoNome,
          arquivo_hash: createHash('sha256').update(new Uint8Array(pdf)).digest('hex'),
          id_externo: `LI-${p.numero}`,
          created_by: servicoProfileId,
        })
        if (insertError) {
          await supabase.storage.from('pedidos').remove([path])
          // Rodada paralela já criou: não é erro.
          if (insertError.code === '23505') continue
          throw new Error(`Erro ao criar pedido: ${insertError.message}`)
        }
        importados.push(p.numero)
      } catch (e) {
        erros.push({ numero: resumo.numero, erro: e instanceof Error ? e.message : String(e) })
      }
    }

    res.status(200).json({
      ok: erros.length === 0,
      lidos,
      aprovados: aprovados.length,
      ja_existiam: aprovados.length - novos.length,
      importados,
      pendentes_proxima_rodada: Math.max(novos.length - MAX_IMPORTAR_POR_RODADA, 0),
      erros,
    })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e)
    res.status(e instanceof ErroLoja ? 502 : 500).json({ error: mensagem })
  }
}
