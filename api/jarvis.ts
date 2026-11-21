// API de LEITURA do faturamento para o JARVIS (assistente executivo do diretor). Somente GET.
//
//   GET /api/jarvis/notas · /notas/{chave} · /notas/{chave}/xml
//   GET /api/jarvis/titulos · /titulos/vencidos · /titulos/resumo · /titulos/{id}/boleto
//   GET /api/jarvis/comissoes · /pedidos · /entregas · /demos · /metas
//
// Autenticação: header x-integration-token com o token de LEITURA (JARVIS_READ_TOKEN), separado do de envio.
// O vercel.json reescreve /api/jarvis/<rota> para esta função (?rota=<rota>). Contrato e exemplos:
// docs/API_LEITURA_JARVIS.md. Não acessa dados de login, senhas, cadastros bancários nem cartão.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  agoraBr,
  arredonda2,
  calcularComissoes,
  dataBr,
  descreverErro,
  diasEntre,
  lerTudo,
  metaDoMes,
  posicaoRecebiveis,
  PRAZO_DEMO_DIAS,
  referenciaDoCiclo,
  segredoConfere,
  somaDias,
  somaFaturamento,
} from './jarvis-sync.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>

const LIMITE_PADRAO = 50
const LIMITE_MAXIMO = 200
const LIMITE_POR_MINUTO_PADRAO = 120
const UUID_NULO = '00000000-0000-0000-0000-000000000000'

class ErroHttp extends Error {
  constructor(
    public status: number,
    mensagem: string,
    public detalhes?: { campo: string; motivo: string }[]
  ) {
    super(mensagem)
  }
}
const filtroInvalido = (campo: string, motivo: string) => new ErroHttp(400, 'Filtro inválido.', [{ campo, motivo }])

interface Saida {
  status: number
  json?: unknown
  binario?: { contentType: string; dados: Buffer | string; nome?: string }
  itens?: number
}

// ---------- leitura dos parâmetros ----------

type Params = Record<string, string | undefined>

function paramsDe(req: VercelRequest): Params {
  const p: Params = {}
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'rota') continue
    p[k] = Array.isArray(v) ? v[0] : v
  }
  return p
}

function dataParam(p: Params, campo: string): string | undefined {
  const v = p[campo]
  if (v === undefined || v === '') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw filtroInvalido(campo, 'use o formato AAAA-MM-DD')
  }
  return v
}

function mesParam(p: Params, campo: string): string | undefined {
  const v = p[campo]
  if (v === undefined || v === '') return undefined
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw filtroInvalido(campo, 'use o formato AAAA-MM')
  return v
}

function inteiroParam(p: Params, campo: string, minimo = 0): number | undefined {
  const v = p[campo]
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < minimo) throw filtroInvalido(campo, `use um número inteiro maior ou igual a ${minimo}`)
  return n
}

function boolParam(p: Params, campo: string): boolean | undefined {
  const v = p[campo]
  if (v === undefined || v === '') return undefined
  if (v !== 'true' && v !== 'false') throw filtroInvalido(campo, 'use true ou false')
  return v === 'true'
}

function enumParam<T extends string>(p: Params, campo: string, validos: readonly T[]): T | undefined {
  const v = p[campo]
  if (v === undefined || v === '') return undefined
  if (!(validos as readonly string[]).includes(v)) throw filtroInvalido(campo, `valores aceitos: ${validos.join(', ')}`)
  return v as T
}

// Texto livre usado em ilike: sem curingas nem caracteres que quebram o filtro .or() do PostgREST.
function textoBusca(p: Params, campo: string): string | undefined {
  const v = p[campo]
  if (v === undefined) return undefined
  const limpo = v.replace(/[%*,()\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return limpo.length >= 2 ? limpo : undefined
}

function paginacao(p: Params): { limite: number; offset: number } {
  const limite = inteiroParam(p, 'limit', 1) ?? LIMITE_PADRAO
  if (limite > LIMITE_MAXIMO) throw filtroInvalido('limit', `máximo de ${LIMITE_MAXIMO} itens por página`)
  let offset = 0
  if (p.cursor) {
    try {
      const o = (JSON.parse(Buffer.from(p.cursor, 'base64url').toString('utf-8')) as { o?: unknown }).o
      if (typeof o !== 'number' || !Number.isInteger(o) || o < 0) throw new Error('cursor')
      offset = o
    } catch {
      throw filtroInvalido('cursor', 'cursor inválido; use o valor de proximoCursor da resposta anterior')
    }
  }
  return { limite, offset }
}

const cursorDe = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url')

// Recorta uma lista já carregada em memória.
function paginaEmMemoria<T>(lista: T[], p: Params): { itens: T[]; proximoCursor: string | null } {
  const { limite, offset } = paginacao(p)
  const itens = lista.slice(offset, offset + limite)
  return { itens, proximoCursor: offset + limite < lista.length ? cursorDe(offset + limite) : null }
}

// ---------- utilidades de dados ----------

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const valorOuNull = <T>(v: T | undefined): T | null => (v === undefined || v === '' ? null : v)

function mascaraCnpj(d: string): string | null {
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return null
}

async function idsDeClientesPorCnpj(supabase: SupabaseClient, cnpj: string): Promise<string[]> {
  const d = soDigitos(cnpj)
  const candidatos = [d, mascaraCnpj(d)].filter((x): x is string => !!x)
  const { data } = await supabase.from('clientes').select('id').in('cnpj_cpf', candidatos).limit(50)
  return (data ?? []).map((c: Linha) => c.id as string)
}

// Ids das notas que combinam com número, cliente e/ou CNPJ (até 1000). null = nenhum desses filtros foi pedido.
async function idsDeNotas(
  supabase: SupabaseClient,
  f: { numero?: string; cliente?: string; cnpj?: string }
): Promise<string[] | null> {
  if (!f.numero && !f.cliente && !f.cnpj) return null
  let q = supabase.from('invoices').select('id').eq('excluida', false)
  if (f.numero) {
    const limpo = f.numero.replace(/^0+/, '')
    q = q.in('numero_nf', Array.from(new Set([f.numero, limpo])).filter(Boolean))
  }
  if (f.cliente) q = q.ilike('cliente', `%${f.cliente}%`)
  if (f.cnpj) {
    const clientes = await idsDeClientesPorCnpj(supabase, f.cnpj)
    q = q.in('cliente_id', clientes.length > 0 ? clientes : [UUID_NULO])
  }
  const { data, error } = await q.limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((n: Linha) => n.id as string)
}

// ---------- notas ----------

const SELECT_NOTA =
  'id, numero_nf, data_emissao, cliente, estado, valor, valor_icms, valor_ipi, valor_difal, valor_fcp, frete, tipo_operacao, afeta_faturamento, excluida, xml_chave_acesso, xml_raw, transportadora, meio_pagamento, parcelas, filiais!filial_id(nome), vendedores(nome), clientes(cnpj_cpf)'

function statusDaNota(n: Linha): 'autorizada' | 'cancelada' | 'sem_protocolo' | null {
  if (n.excluida || String(n.tipo_operacao).toUpperCase() === 'CANCELADA') return 'cancelada'
  const xml = n.xml_raw as string | null
  if (!xml) return null
  const cStat = xml.match(/<protNFe[\s\S]*?<cStat>(\d+)<\/cStat>/)?.[1]
  if (!cStat) return 'sem_protocolo'
  if (cStat === '100' || cStat === '150') return 'autorizada'
  if (cStat === '101' || cStat === '151' || cStat === '155') return 'cancelada'
  return 'sem_protocolo'
}

function itensDoXml(xml: string | null): Linha[] | null {
  if (!xml) return null
  const pega = (bloco: string, tag: string) => bloco.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null
  const num = (v: string | null) => (v === null || v === '' ? null : Number(v))
  const itens: Linha[] = []
  for (const m of xml.matchAll(/<det\b[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g)) {
    const b = m[2]
    itens.push({
      item: Number(m[1]),
      codigo: pega(b, 'cProd'),
      descricao: pega(b, 'xProd'),
      ncm: pega(b, 'NCM'),
      cfop: pega(b, 'CFOP'),
      unidade: pega(b, 'uCom'),
      quantidade: num(pega(b, 'qCom')),
      valorUnitario: num(pega(b, 'vUnCom')),
      valorTotal: num(pega(b, 'vProd')),
    })
  }
  return itens
}

function montarNota(n: Linha, comDetalhe = false): Linha {
  const xml = (n.xml_raw as string | null) ?? null
  const base: Linha = {
    chaveAcesso: valorOuNull(n.xml_chave_acesso) ?? xml?.match(/\bId="NFe(\d{44})"/)?.[1] ?? null,
    numero: n.numero_nf,
    serie: xml?.match(/<serie>(\d+)<\/serie>/)?.[1] ?? null,
    dataEmissao: String(n.data_emissao).slice(0, 10),
    cliente: n.cliente,
    cnpj: soDigitos(n.clientes?.cnpj_cpf) || null,
    uf: valorOuNull(n.estado),
    valorTotal: arredonda2(Number(n.valor)),
    valorIcms: arredonda2(Number(n.valor_icms ?? 0)),
    frete: arredonda2(Number(n.frete ?? 0)),
    tipoOperacao: n.tipo_operacao,
    afetaFaturamento: !!n.afeta_faturamento,
    filial: n.filiais?.nome ?? null,
    vendedor: n.vendedores?.nome ?? null,
    status: statusDaNota(n),
    temXml: !!xml,
  }
  if (!comDetalhe) return base
  return {
    ...base,
    valorIpi: arredonda2(Number(n.valor_ipi ?? 0)),
    valorDifal: arredonda2(Number(n.valor_difal ?? 0)),
    valorFcp: arredonda2(Number(n.valor_fcp ?? 0)),
    meioPagamento: valorOuNull(n.meio_pagamento),
    parcelas: n.parcelas ?? null,
    transportadora: valorOuNull(n.transportadora),
    itens: itensDoXml(xml),
  }
}

async function notaPorChave(supabase: SupabaseClient, chave: string): Promise<Linha> {
  let q = supabase.from('invoices').select(SELECT_NOTA)
  if (/^\d{44}$/.test(chave)) q = q.eq('xml_chave_acesso', chave)
  else if (/^[0-9a-f-]{36}$/i.test(chave)) q = q.eq('id', chave)
  else throw filtroInvalido('chave', 'informe a chave de acesso (44 dígitos)')
  const { data, error } = await q.eq('excluida', false).limit(1)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new ErroHttp(404, 'Nota não encontrada.')
  return data[0] as Linha
}

async function rotaNotas(supabase: SupabaseClient, partes: string[], p: Params): Promise<Saida> {
  if (partes.length >= 2) {
    const nota = await notaPorChave(supabase, partes[1])
    if (partes[2] === 'xml') {
      if (!nota.xml_raw) throw new ErroHttp(404, 'Esta nota não tem XML guardado.')
      return { status: 200, binario: { contentType: 'application/xml; charset=utf-8', dados: nota.xml_raw as string }, itens: 1 }
    }
    if (partes.length > 2) throw new ErroHttp(404, 'Rota não encontrada.')
    return { status: 200, json: montarNota(nota, true), itens: 1 }
  }

  const { limite, offset } = paginacao(p)
  const numero = textoBusca(p, 'numero')
  const chave = p.chave
  if (chave && !/^\d{44}$/.test(chave)) throw filtroInvalido('chave', 'a chave de acesso tem 44 dígitos')
  const de = dataParam(p, 'de')
  const ate = dataParam(p, 'ate')
  const afeta = boolParam(p, 'afetaFaturamento')
  const cliente = textoBusca(p, 'cliente')
  const tipo = textoBusca(p, 'tipo')
  const cnpj = p.cnpj ? soDigitos(p.cnpj) : undefined
  if (p.cnpj && ![11, 14].includes(cnpj!.length)) throw filtroInvalido('cnpj', 'informe um CNPJ (14 dígitos) ou CPF (11)')

  let q = supabase.from('invoices').select(SELECT_NOTA).eq('excluida', false)
  if (numero) q = q.in('numero_nf', Array.from(new Set([numero, numero.replace(/^0+/, '')])).filter(Boolean))
  if (chave) q = q.eq('xml_chave_acesso', chave)
  if (cliente) q = q.ilike('cliente', `%${cliente}%`)
  if (cnpj) {
    const ids = await idsDeClientesPorCnpj(supabase, cnpj)
    q = q.in('cliente_id', ids.length > 0 ? ids : [UUID_NULO])
  }
  if (de) q = q.gte('data_emissao', de)
  if (ate) q = q.lte('data_emissao', ate)
  if (tipo) q = q.ilike('tipo_operacao', `%${tipo}%`)
  if (afeta !== undefined) q = q.eq('afeta_faturamento', afeta)
  const { data, error } = await q.order('data_emissao', { ascending: false }).order('id').range(offset, offset + limite)
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as Linha[]
  const itens = linhas.slice(0, limite).map((n) => montarNota(n))
  return { status: 200, json: { itens, proximoCursor: linhas.length > limite ? cursorDe(offset + limite) : null }, itens: itens.length }
}

// ---------- títulos ----------

const SELECT_TITULO =
  'id, numero_parcela, valor, juros, valor_pago, vencimento, data_pagamento, status, arquivo_path, cliente_nome_importado, invoice_id, invoices!invoice_id(numero_nf, cliente, clientes(cnpj_cpf))'

function montarTitulo(b: Linha, hoje: string): Linha {
  const saldo = Math.max(arredonda2(arredonda2(Number(b.valor) + Number(b.juros ?? 0)) - arredonda2(Number(b.valor_pago ?? 0))), 0)
  // Em aberto: dias desde o vencimento. Quitado: quanto demorou para pagar (pagamento - vencimento).
  const diasAtraso =
    saldo > 0
      ? Math.max(diasEntre(b.vencimento, hoje), 0)
      : b.data_pagamento
        ? Math.max(diasEntre(b.vencimento, String(b.data_pagamento).slice(0, 10)), 0)
        : 0
  const inv = b.invoices as Linha | null
  return {
    id: b.id,
    cliente: inv?.cliente ?? b.cliente_nome_importado ?? null,
    cnpj: soDigitos(inv?.clientes?.cnpj_cpf) || null,
    nota: inv?.numero_nf ?? null,
    parcela: Number(b.numero_parcela),
    valor: arredonda2(Number(b.valor)),
    juros: arredonda2(Number(b.juros ?? 0)),
    valorPago: arredonda2(Number(b.valor_pago ?? 0)),
    saldo,
    vencimento: b.vencimento,
    dataPagamento: b.data_pagamento ?? null,
    status: b.status,
    diasAtraso,
  }
}

async function consultaTitulos(supabase: SupabaseClient, p: Params, extra: (q: Linha) => Linha) {
  const cliente = textoBusca(p, 'cliente')
  const nota = textoBusca(p, 'nota')
  const cnpj = p.cnpj ? soDigitos(p.cnpj) : undefined
  if (p.cnpj && ![11, 14].includes(cnpj!.length)) throw filtroInvalido('cnpj', 'informe um CNPJ (14 dígitos) ou CPF (11)')
  const status = enumParam(p, 'status', ['pendente', 'parcial', 'pago'] as const)
  const de = dataParam(p, 'vencimentoDe')
  const ate = dataParam(p, 'vencimentoAte')

  // Filtros por nota/CNPJ resolvem antes os ids das notas; cliente também casa o nome importado do ERP.
  const idsNota = await idsDeNotas(supabase, { numero: nota, cnpj })
  const idsCliente = cliente ? await idsDeNotas(supabase, { cliente }) : null

  return (de0: number, ate0: number) => {
    let q: Linha = supabase.from('boletos').select(SELECT_TITULO).eq('excluido', false).eq('tipo', 'boleto')
    if (idsNota) q = q.in('invoice_id', idsNota.length > 0 ? idsNota : [UUID_NULO])
    if (cliente) {
      const ids = (idsCliente ?? []).slice(0, 400)
      q = q.or(`cliente_nome_importado.ilike.%${cliente}%${ids.length > 0 ? `,invoice_id.in.(${ids.join(',')})` : ''}`)
    }
    if (status) q = q.eq('status', status)
    if (de) q = q.gte('vencimento', de)
    if (ate) q = q.lte('vencimento', ate)
    q = extra(q)
    return q.order('vencimento').order('id').range(de0, ate0) as PromiseLike<{ data: Linha[] | null; error: { message: string } | null }>
  }
}

function faixaDe(dias: number): string {
  return dias <= 30 ? '0-30' : dias <= 60 ? '31-60' : dias <= 90 ? '61-90' : '90+'
}

async function rotaTitulos(supabase: SupabaseClient, partes: string[], p: Params): Promise<Saida> {
  const hoje = dataBr(agoraBr())
  const segundo = partes[1]

  if (segundo === 'resumo') {
    const pos = await posicaoRecebiveis(supabase)
    const abertos = await lerTudo<Linha>((a, b) =>
      supabase
        .from('boletos')
        .select('valor, juros, valor_pago, vencimento, cliente_nome_importado, invoices!invoice_id(cliente, clientes(cnpj_cpf))')
        .eq('excluido', false)
        .eq('tipo', 'boleto')
        .neq('status', 'pago')
        .lt('vencimento', hoje)
        .order('id')
        .range(a, b)
    )
    const porCliente = new Map<string, { cliente: string; cnpj: string | null; titulos: number; saldoVencido: number; maiorAtraso: number }>()
    for (const t of abertos) {
      const saldo = Math.max(arredonda2(arredonda2(Number(t.valor) + Number(t.juros ?? 0)) - arredonda2(Number(t.valor_pago ?? 0))), 0)
      if (saldo <= 0) continue
      const nome = (t.invoices?.cliente ?? t.cliente_nome_importado ?? 'Cliente não identificado') as string
      const atual = porCliente.get(nome) ?? { cliente: nome, cnpj: soDigitos(t.invoices?.clientes?.cnpj_cpf) || null, titulos: 0, saldoVencido: 0, maiorAtraso: 0 }
      atual.titulos++
      atual.saldoVencido = arredonda2(atual.saldoVencido + saldo)
      atual.maiorAtraso = Math.max(atual.maiorAtraso, diasEntre(t.vencimento, hoje))
      porCliente.set(nome, atual)
    }
    const maiores = Array.from(porCliente.values()).sort((a, b) => b.saldoVencido - a.saldoVencido).slice(0, 10)
    return {
      status: 200,
      json: {
        geradoEm: `${agoraBr().toISOString().slice(0, 19)}-03:00`,
        totalEmAberto: arredonda2(pos.aReceber),
        totalVencido: arredonda2(pos.vencido),
        titulosVencidos: pos.titulosVencidos,
        porFaixa: {
          ate30dias: arredonda2(pos.faixas.ate30),
          de31a60dias: arredonda2(pos.faixas.de31a60),
          de61a90dias: arredonda2(pos.faixas.de61a90),
          acima90dias: arredonda2(pos.faixas.acima90),
        },
        maioresDevedores: maiores,
      },
      itens: 1,
    }
  }

  if (segundo && partes[2] === 'boleto') {
    const { data, error } = await supabase.from('boletos').select('id, arquivo_path, arquivo_nome').eq('id', segundo).eq('excluido', false).limit(1)
    if (error) throw new Error(error.message)
    const b = data?.[0] as Linha | undefined
    if (!b) throw new ErroHttp(404, 'Título não encontrado.')
    if (!b.arquivo_path) throw new ErroHttp(404, 'Este título não tem boleto (PDF) anexado.')
    const { data: arquivo, error: erroArq } = await supabase.storage.from('boletos').download(b.arquivo_path)
    if (erroArq || !arquivo) throw new ErroHttp(404, 'Arquivo do boleto não encontrado.')
    return { status: 200, binario: { contentType: 'application/pdf', dados: Buffer.from(await arquivo.arrayBuffer()), nome: b.arquivo_nome ?? 'boleto.pdf' }, itens: 1 }
  }

  if (segundo && segundo !== 'vencidos') {
    const { data, error } = await supabase.from('boletos').select(SELECT_TITULO).eq('id', segundo).eq('excluido', false).limit(1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new ErroHttp(404, 'Título não encontrado.')
    return { status: 200, json: montarTitulo(data[0] as Linha, hoje), itens: 1 }
  }

  if (segundo === 'vencidos') {
    const faixa = enumParam(p, 'faixa', ['0-30', '31-60', '61-90', '90+'] as const)
    const agrupar = enumParam(p, 'agrupar', ['cliente'] as const)
    const limites: Record<string, { de?: string; ate?: string }> = {
      '0-30': { de: somaDias(hoje, -30), ate: somaDias(hoje, -1) },
      '31-60': { de: somaDias(hoje, -60), ate: somaDias(hoje, -31) },
      '61-90': { de: somaDias(hoje, -90), ate: somaDias(hoje, -61) },
      '90+': { ate: somaDias(hoje, -91) },
    }
    const consulta = await consultaTitulos(supabase, p, (q) => {
      let r = q.in('status', ['pendente', 'parcial']).lt('vencimento', hoje)
      if (faixa) {
        if (limites[faixa].de) r = r.gte('vencimento', limites[faixa].de)
        if (limites[faixa].ate) r = r.lte('vencimento', limites[faixa].ate)
      }
      return r
    })
    if (agrupar === 'cliente') {
      const todos = (await lerTudo<Linha>(consulta)).map((b) => montarTitulo(b, hoje)).filter((t) => t.saldo > 0)
      const grupos = new Map<string, Linha>()
      for (const t of todos) {
        const nome = (t.cliente ?? 'Cliente não identificado') as string
        const g = grupos.get(nome) ?? { cliente: nome, cnpj: t.cnpj, titulos: 0, saldoVencido: 0, maiorAtraso: 0, faixaMaiorAtraso: '0-30' }
        g.titulos++
        g.saldoVencido = arredonda2(g.saldoVencido + t.saldo)
        g.maiorAtraso = Math.max(g.maiorAtraso, t.diasAtraso)
        g.faixaMaiorAtraso = faixaDe(g.maiorAtraso)
        grupos.set(nome, g)
      }
      const lista = Array.from(grupos.values()).sort((a, b) => b.saldoVencido - a.saldoVencido)
      const pagina = paginaEmMemoria(lista, p)
      return { status: 200, json: { ...pagina, totalClientes: lista.length }, itens: pagina.itens.length }
    }
    const { limite, offset } = paginacao(p)
    const { data, error } = await consulta(offset, offset + limite)
    if (error) throw new Error(error.message)
    const linhas = data ?? []
    const itens = linhas.slice(0, limite).map((b) => montarTitulo(b, hoje)).filter((t) => t.saldo > 0)
    return { status: 200, json: { itens, proximoCursor: linhas.length > limite ? cursorDe(offset + limite) : null }, itens: itens.length }
  }

  const consulta = await consultaTitulos(supabase, p, (q) => q)
  const { limite, offset } = paginacao(p)
  const { data, error } = await consulta(offset, offset + limite)
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  const itens = linhas.slice(0, limite).map((b) => montarTitulo(b, hoje))
  return { status: 200, json: { itens, proximoCursor: linhas.length > limite ? cursorDe(offset + limite) : null }, itens: itens.length }
}

// ---------- comissões ----------

// Ciclo de apuração do mês de referência: do dia 21 do mês anterior ao dia 20 do mês da referência.
function periodoDaReferencia(referencia: string): { de: string; ate: string } {
  const [ano, mes] = referencia.split('-').map(Number)
  const anterior = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`
  return { de: `${anterior}-21`, ate: `${referencia}-20` }
}

async function rotaComissoes(supabase: SupabaseClient, p: Params): Promise<Saida> {
  const referencia = mesParam(p, 'referencia') ?? referenciaDoCiclo(dataBr(agoraBr()))
  const status = enumParam(p, 'status', ['calculada', 'cancelada', 'aprovada', 'paga'] as const)
  const vendedor = textoBusca(p, 'vendedor')?.toLowerCase()
  const { de, ate } = periodoDaReferencia(referencia)
  let lista = (await calcularComissoes(supabase, de, ate)).filter((x) => x.item.referencia === referencia)
  if (vendedor) lista = lista.filter((x) => x.item.vendedor.toLowerCase().includes(vendedor))
  if (status) lista = lista.filter((x) => x.item.status === status)
  lista.sort((a, b) => a.item.vendedor.localeCompare(b.item.vendedor) || b.item.valorComissao - a.item.valorComissao)

  const validas = lista.filter((x) => x.item.status !== 'cancelada')
  const resumo = {
    referencia,
    periodoApuracao: { de, ate },
    comissoes: lista.length,
    totalVendido: arredonda2(validas.reduce((acc, x) => acc + x.item.valorBase, 0)),
    totalComissao: arredonda2(validas.reduce((acc, x) => acc + x.item.valorComissao, 0)),
  }
  const pagina = paginaEmMemoria(
    lista.map((x) => ({
      id: x.item.externalId,
      vendedor: x.item.vendedor,
      referencia: x.item.referencia,
      chaveNfe: x.item.chaveNfe,
      valorBase: x.item.valorBase,
      percentual: x.item.percentual,
      valorComissao: x.item.valorComissao,
      status: x.item.status,
      nota: x.numeroNf,
      cliente: x.cliente,
    })),
    p
  )
  return { status: 200, json: { ...pagina, resumo }, itens: pagina.itens.length }
}

// ---------- pedidos ----------

const ETAPAS = ['enviado', 'em_processo', 'enviado_sanco', 'em_separacao', 'preparando_embarque', 'faturado', 'faturado_parcial'] as const

async function ultimaMovimentacao(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 150) {
    const lote = ids.slice(i, i + 150)
    const eventos = await lerTudo<Linha>((a, b) =>
      supabase.from('pedido_eventos').select('pedido_id, created_at').in('pedido_id', lote).order('created_at', { ascending: false }).range(a, b)
    )
    for (const e of eventos) if (!mapa.has(e.pedido_id)) mapa.set(e.pedido_id, e.created_at)
  }
  return mapa
}

async function rotaPedidos(supabase: SupabaseClient, p: Params): Promise<Saida> {
  const hoje = dataBr(agoraBr())
  const etapa = enumParam(p, 'etapa', ETAPAS)
  const origem = enumParam(p, 'origem', ['SC', 'SP', 'CE'] as const)
  const status = enumParam(p, 'status', ['pendente', 'devolvido', 'faturado', 'cancelado'] as const)
  const parado = inteiroParam(p, 'paradoHaDiasMais', 0)
  const cliente = textoBusca(p, 'cliente')
  const vendedor = textoBusca(p, 'vendedor')

  let vendedorIds: string[] | null = null
  if (vendedor) {
    const { data } = await supabase.from('vendedores').select('id').ilike('nome', `%${vendedor}%`).limit(50)
    vendedorIds = (data ?? []).map((v: Linha) => v.id as string)
  }
  const consulta = (a: number, b: number) => {
    let q: Linha = supabase
      .from('pedidos')
      .select('id, numero, cliente, origem, etapa, status, created_at, numero_nf, numero_pedido_cd, id_externo, parcial, parcial_faturada_em, vendedores(nome)')
    q = status ? q.eq('status', status) : q.neq('status', 'cancelado')
    if (etapa === 'faturado_parcial') q = q.eq('status', 'pendente').not('parcial_faturada_em', 'is', null)
    else if (etapa) q = q.eq('etapa', etapa)
    if (origem) q = q.eq('origem', origem)
    if (cliente) q = q.ilike('cliente', `%${cliente}%`)
    if (vendedorIds) q = q.in('vendedor_id', vendedorIds.length > 0 ? vendedorIds : [UUID_NULO])
    return q.order('created_at', { ascending: false }).order('id').range(a, b) as PromiseLike<{ data: Linha[] | null; error: { message: string } | null }>
  }

  const montar = (n: Linha, movimentos: Map<string, string>): Linha => {
    const ultima = (movimentos.get(n.id) ?? n.created_at) as string
    const aberto = n.status === 'pendente' || n.status === 'devolvido'
    return {
      numero: `PED-${String(n.numero).padStart(4, '0')}`,
      cliente: n.cliente,
      vendedor: n.vendedores?.nome ?? null,
      origem: valorOuNull(n.origem),
      etapa: n.etapa,
      status: n.status,
      dataCriacao: n.created_at,
      dataUltimaMovimentacao: ultima,
      diasParado: aberto ? Math.max(diasEntre(ultima.slice(0, 10), hoje), 0) : null,
      numeroNf: valorOuNull(n.numero_nf),
      parcial: !!n.parcial || !!n.parcial_faturada_em,
      numeroPedidoErp: valorOuNull(n.numero_pedido_cd),
      idExterno: valorOuNull(n.id_externo),
    }
  }

  if (parado !== undefined) {
    // Parado há X dias depende da última movimentação (linha do tempo): carrega os pedidos em andamento e filtra.
    const todos = await lerTudo<Linha>(consulta)
    const abertos = todos.filter((n) => n.status === 'pendente' || n.status === 'devolvido')
    const mov = await ultimaMovimentacao(supabase, abertos.map((n) => n.id))
    const lista = abertos.map((n) => montar(n, mov)).filter((x) => (x.diasParado as number) > parado).sort((a, b) => b.diasParado - a.diasParado)
    const pagina = paginaEmMemoria(lista, p)
    return { status: 200, json: pagina, itens: pagina.itens.length }
  }

  const { limite, offset } = paginacao(p)
  const { data, error } = await consulta(offset, offset + limite)
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  const pagina = linhas.slice(0, limite)
  const mov = await ultimaMovimentacao(supabase, pagina.map((n) => n.id))
  const itens = pagina.map((n) => montar(n, mov))
  return { status: 200, json: { itens, proximoCursor: linhas.length > limite ? cursorDe(offset + limite) : null }, itens: itens.length }
}

// ---------- entregas ----------

async function rotaEntregas(supabase: SupabaseClient, p: Params): Promise<Saida> {
  const status = enumParam(p, 'status', ['aguardando_despacho', 'em_transito', 'entregue', 'finalizado'] as const)
  const transportadora = textoBusca(p, 'transportadora')
  const { limite, offset } = paginacao(p)

  let q = supabase
    .from('entregas')
    .select('id, status, transportadora, codigo_rastreio, previsao_chegada, ocorrencia, despachado_em, entregue_em, recebido_por, finalizado_em, created_at, pedidos(numero, cliente, numero_nf, origem, vendedores(nome))')
  // Sem filtro de status, não mostra as finalizadas (ciclo encerrado).
  q = status ? q.eq('status', status) : q.neq('status', 'finalizado')
  if (transportadora) q = q.ilike('transportadora', `%${transportadora}%`)
  const { data, error } = await q.order('created_at', { ascending: false }).order('id').range(offset, offset + limite)
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as Linha[]
  const pagina = linhas.slice(0, limite)

  const registros = pagina.length
    ? ((
        await supabase
          .from('entrega_registros')
          .select('entrega_id, tipo, texto, created_at')
          .in('entrega_id', pagina.map((e) => e.id))
          .in('tipo', ['ocorrencia', 'ocorrencia_resolvida'])
          .order('created_at', { ascending: false })
          .limit(1000)
      ).data ?? [])
    : []
  const itens = pagina.map((e) => ({
    id: e.id,
    notaFiscal: valorOuNull(e.pedidos?.numero_nf),
    pedido: e.pedidos ? `PED-${String(e.pedidos.numero).padStart(4, '0')}` : null,
    cliente: e.pedidos?.cliente ?? null,
    vendedor: e.pedidos?.vendedores?.nome ?? null,
    origem: valorOuNull(e.pedidos?.origem),
    status: e.status,
    transportadora: valorOuNull(e.transportadora),
    rastreio: valorOuNull(e.codigo_rastreio),
    previsao: e.previsao_chegada ?? null,
    despachadoEm: e.despachado_em ?? null,
    entregueEm: e.entregue_em ?? null,
    recebidoPor: valorOuNull(e.recebido_por),
    ocorrenciaAberta: !!e.ocorrencia,
    ocorrencias: (registros as Linha[])
      .filter((r) => r.entrega_id === e.id)
      .slice(0, 5)
      .map((r) => ({ tipo: r.tipo, texto: r.texto ?? null, em: r.created_at })),
  }))
  return { status: 200, json: { itens, proximoCursor: linhas.length > limite ? cursorDe(offset + limite) : null }, itens: itens.length }
}

// ---------- demos ----------

async function rotaDemos(supabase: SupabaseClient, p: Params): Promise<Saida> {
  const situacao = enumParam(p, 'situacao', ['emAberto', 'atrasada', 'vencendo7dias', 'devolvida'] as const)
  const hoje = dataBr(agoraBr())
  const notas = await lerTudo<Linha>((a, b) =>
    supabase
      .from('invoices')
      .select('id, numero_nf, cliente, data_emissao, valor, vendedores(nome)')
      .ilike('tipo_operacao', 'demo%')
      .eq('excluida', false)
      .order('id')
      .range(a, b)
  )
  const retornos = await lerTudo<Linha>((a, b) => supabase.from('demo_retornos').select('invoice_id, numero_nf_retorno, data_retorno').order('invoice_id').range(a, b))
  const retornoPorNota = new Map(retornos.map((r) => [r.invoice_id as string, r]))

  const lista = notas.map((n) => {
    const prazoFinal = somaDias(String(n.data_emissao).slice(0, 10), PRAZO_DEMO_DIAS)
    const retorno = retornoPorNota.get(n.id)
    const diasRestantes = diasEntre(hoje, prazoFinal)
    const situacaoAtual = retorno ? 'devolvida' : diasRestantes < 0 ? 'atrasada' : diasRestantes <= 7 ? 'vencendo7dias' : 'noPrazo'
    return {
      nota: n.numero_nf,
      cliente: n.cliente,
      vendedor: n.vendedores?.nome ?? null,
      dataEmissao: String(n.data_emissao).slice(0, 10),
      valor: arredonda2(Number(n.valor)),
      prazoFinal,
      diasRestantes: retorno ? null : diasRestantes,
      situacao: situacaoAtual,
      nfRetorno: retorno?.numero_nf_retorno ?? null,
      dataRetorno: retorno?.data_retorno ?? null,
    }
  })
  const filtrada = lista.filter((d) => {
    if (!situacao) return true
    if (situacao === 'emAberto') return d.situacao !== 'devolvida'
    return d.situacao === situacao
  })
  filtrada.sort((a, b) => (a.diasRestantes ?? 99999) - (b.diasRestantes ?? 99999))
  const pagina = paginaEmMemoria(filtrada, p)
  return { status: 200, json: pagina, itens: pagina.itens.length }
}

// ---------- metas ----------

async function rotaMetas(supabase: SupabaseClient, p: Params): Promise<Saida> {
  const hoje = dataBr(agoraBr())
  const mesRef = mesParam(p, 'mes') ?? hoje.slice(0, 7)
  const [ano, mes] = mesRef.split('-').map(Number)
  const inicio = `${mesRef}-01`
  const fim = dataBr(new Date(Date.UTC(ano, mes, 0)))
  const filialFiltro = textoBusca(p, 'filial')?.toLowerCase()
  const vendedorFiltro = textoBusca(p, 'vendedor')?.toLowerCase()
  const percentual = (real: number, meta: number) => (meta > 0 ? arredonda2((real / meta) * 100) : null)

  const itens: Linha[] = []
  if (!vendedorFiltro && !filialFiltro) {
    const [meta, real] = await Promise.all([metaDoMes(supabase, mes, ano), somaFaturamento(supabase, inicio, fim)])
    itens.push({ escopo: 'empresa', nome: 'Empresa', mes: mesRef, meta: arredonda2(meta), realizado: real.total, percentual: percentual(real.total, meta) })
  }
  if (!vendedorFiltro) {
    const { data } = await supabase.from('metas').select('filial_id, valor_meta, filiais(nome)').not('filial_id', 'is', null).eq('mes', mes).eq('ano', ano)
    const filiais = ((data ?? []) as Linha[]).filter((m) => !filialFiltro || String(m.filiais?.nome ?? '').toLowerCase().includes(filialFiltro))
    const reais = await Promise.all(filiais.map((m) => somaFaturamento(supabase, inicio, fim, { filialId: m.filial_id })))
    filiais.forEach((m, i) =>
      itens.push({ escopo: 'filial', nome: m.filiais?.nome ?? null, mes: mesRef, meta: arredonda2(Number(m.valor_meta)), realizado: reais[i].total, percentual: percentual(reais[i].total, Number(m.valor_meta)) })
    )
  }
  if (!filialFiltro) {
    const { data } = await supabase.from('metas_pessoais').select('vendedor_id, valor_meta, vendedores(nome)').eq('mes', mes).eq('ano', ano)
    const vendedores = ((data ?? []) as Linha[]).filter((m) => !vendedorFiltro || String(m.vendedores?.nome ?? '').toLowerCase().includes(vendedorFiltro))
    const reais = await Promise.all(vendedores.map((m) => somaFaturamento(supabase, inicio, fim, { vendedorId: m.vendedor_id })))
    vendedores.forEach((m, i) =>
      itens.push({ escopo: 'vendedor', nome: m.vendedores?.nome ?? null, mes: mesRef, meta: arredonda2(Number(m.valor_meta)), realizado: reais[i].total, percentual: percentual(reais[i].total, Number(m.valor_meta)) })
    )
  }
  return { status: 200, json: { itens, proximoCursor: null }, itens: itens.length }
}

// ---------- raiz, auditoria e handler ----------

const INDICE = {
  api: 'Faturamento MCI — leitura para o JARVIS',
  rotas: [
    'GET /notas · /notas/{chave} · /notas/{chave}/xml',
    'GET /titulos · /titulos/vencidos · /titulos/resumo · /titulos/{id} · /titulos/{id}/boleto',
    'GET /comissoes · /pedidos · /entregas · /demos · /metas',
  ],
}

function ipDe(req: VercelRequest): string | null {
  const xff = req.headers['x-forwarded-for']
  const v = Array.isArray(xff) ? xff[0] : xff
  return v ? v.split(',')[0].trim() : null
}

async function registrar(supabase: SupabaseClient | null, req: VercelRequest, endpoint: string, params: Params, status: number, itens: number | null, ms: number) {
  if (!supabase) return
  try {
    await supabase.from('jarvis_consultas').insert({ endpoint, parametros: params, status, itens, ms, ip: ipDe(req) })
  } catch {
    /* auditoria não pode derrubar a consulta */
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const inicio = Date.now()
  const params = paramsDe(req)
  const bruto =
    typeof req.query.rota === 'string'
      ? req.query.rota
      : Array.isArray(req.query.rota)
        ? req.query.rota.join('/')
        : (req.url ?? '').split('?')[0].replace(/^\/api\/jarvis\/?/, '')
  const partes = bruto.split('/').filter(Boolean).map((x) => {
    try {
      return decodeURIComponent(x)
    } catch {
      return x
    }
  })
  const endpoint = `/${partes.join('/')}`

  // Somente leitura: qualquer outro método é recusado antes de tudo.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ erro: 'API somente leitura: use GET.' })
    return
  }

  const tokenEsperado = process.env.JARVIS_READ_TOKEN
  if (!tokenEsperado) {
    res.status(503).json({ erro: 'API de leitura não configurada no servidor.' })
    return
  }
  if (!segredoConfere(req.headers['x-integration-token'], tokenEsperado)) {
    res.status(401).json({ erro: 'Token ausente ou inválido (header x-integration-token).' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(503).json({ erro: 'Servidor sem acesso ao banco (variáveis ausentes).' })
    return
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let saida: Saida
  try {
    // Limite de requisições por minuto (padrão 120; ajustável em JARVIS_LIMITE_POR_MINUTO).
    const limite = Number(process.env.JARVIS_LIMITE_POR_MINUTO) > 0 ? Number(process.env.JARVIS_LIMITE_POR_MINUTO) : LIMITE_POR_MINUTO_PADRAO
    const { count } = await supabase
      .from('jarvis_consultas')
      .select('id', { count: 'exact', head: true })
      .gte('em', new Date(Date.now() - 60_000).toISOString())
    if ((count ?? 0) >= limite) {
      res.setHeader('Retry-After', '30')
      await registrar(supabase, req, endpoint, params, 429, null, Date.now() - inicio)
      res.status(429).json({ erro: `Limite de ${limite} requisições por minuto excedido. Tente de novo em instantes.` })
      return
    }

    const raiz = partes[0]
    if (!raiz) saida = { status: 200, json: INDICE }
    else if (raiz === 'notas') saida = await rotaNotas(supabase, partes, params)
    else if (raiz === 'titulos') saida = await rotaTitulos(supabase, partes, params)
    else if (raiz === 'comissoes') saida = await rotaComissoes(supabase, params)
    else if (raiz === 'pedidos') saida = await rotaPedidos(supabase, params)
    else if (raiz === 'entregas') saida = await rotaEntregas(supabase, params)
    else if (raiz === 'demos') saida = await rotaDemos(supabase, params)
    else if (raiz === 'metas') saida = await rotaMetas(supabase, params)
    else throw new ErroHttp(404, 'Rota não encontrada.')
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500
    const corpo = e instanceof ErroHttp ? { erro: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) } : { erro: `Erro ao consultar: ${descreverErro(e)}` }
    await registrar(supabase, req, endpoint, params, status, null, Date.now() - inicio)
    res.status(status).json(corpo)
    return
  }

  await registrar(supabase, req, endpoint, params, saida.status, saida.itens ?? null, Date.now() - inicio)
  if (saida.binario) {
    res.setHeader('Content-Type', saida.binario.contentType)
    if (saida.binario.nome) res.setHeader('Content-Disposition', `inline; filename="${saida.binario.nome.replace(/[^\w.\- ]/g, '_')}"`)
    res.status(saida.status).send(saida.binario.dados)
    return
  }
  res.status(saida.status).json(saida.json)
}
