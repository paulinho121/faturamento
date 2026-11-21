// Envio dos números do faturamento ao JARVIS (assistente executivo do diretor).
//
//   GET/POST /api/jarvis-sync                       envia notas, comissões e títulos (só o que mudou)
//   GET/POST /api/jarvis-sync?parte=indicadores     envia os indicadores calculados (cada envio substitui o anterior)
//   GET/POST /api/jarvis-sync?completo=1            reenvia tudo (rede de segurança diária)
//   opções: ?parte=notas,comissoes,titulos,indicadores  ·  ?desde=AAAA-MM-DD (janela de notas/comissões)
//
// Chamada por agendador (pg_cron + pg_net) com o header x-sync-secret. Contrato do JARVIS: docs/INTEGRACAO_JARVIS.md.
// Variáveis de ambiente (nunca no código): JARVIS_BASE_URL, JARVIS_INTEGRATION_TOKEN, JARVIS_SYNC_SECRET,
// VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. Sem as duas primeiras o envio fica desligado.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'

const PARTES = ['notas', 'comissoes', 'titulos', 'indicadores'] as const
type Parte = (typeof PARTES)[number]

const TIMEOUT_MS = 25000
export const PRAZO_DEMO_DIAS = 45

// ---------- utilitários ----------

export function segredoConfere(recebido: string | string[] | undefined, esperado: string): boolean {
  if (typeof recebido !== 'string') return false
  const a = new Uint8Array(createHash('sha256').update(recebido).digest())
  const b = new Uint8Array(createHash('sha256').update(esperado).digest())
  return timingSafeEqual(a, b)
}

export function descreverErro(e: unknown): string {
  if (!(e instanceof Error)) return 'erro desconhecido'
  const cause = (e as Error & { cause?: unknown }).cause
  return cause instanceof Error ? `${e.message} (${cause.message})` : e.message
}

export const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
export const arredonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Horário de Brasília (UTC-3, sem horário de verão): datas do dia e do mês seguem o relógio da empresa.
export function agoraBr(): Date {
  return new Date(Date.now() - 3 * 3600 * 1000)
}
export const dataBr = (d: Date) => d.toISOString().slice(0, 10)
function isoComFuso(): string {
  return `${agoraBr().toISOString().slice(0, 19)}-03:00`
}
export function somaDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((new Date(`${ate}T00:00:00Z`).getTime() - new Date(`${de}T00:00:00Z`).getTime()) / 86_400_000)
}
function inicioMesAnterior(hoje: string): string {
  const [ano, mes] = hoje.split('-').map(Number)
  return mes === 1 ? `${ano - 1}-12-01` : `${ano}-${String(mes - 1).padStart(2, '0')}-01`
}

// Lê uma consulta paginada (o Supabase corta em 1000 linhas por padrão).
export async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pagina = 1000
): Promise<T[]> {
  const todos: T[] = []
  for (let de = 0; ; de += pagina) {
    const { data, error } = await consulta(de, de + pagina - 1)
    if (error) throw new Error(error.message)
    todos.push(...(data ?? []))
    if (!data || data.length < pagina) return todos
  }
}

// ---------- chamadas ao JARVIS ----------

interface Resposta {
  status: number
  json: Record<string, unknown> | null
  texto: string
}

async function chamarJarvis(url: string, token: string, init: { body: BodyInit; contentType?: string }): Promise<Resposta> {
  const headers: Record<string, string> = { 'x-integration-token': token, Accept: 'application/json' }
  if (init.contentType) headers['Content-Type'] = init.contentType
  let ultimo: unknown
  // 5xx e falha de rede: uma segunda tentativa; o envio é idempotente, então repetir é seguro.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: init.body, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const texto = await res.text()
      if (res.status >= 500 && tentativa === 1) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(texto) as Record<string, unknown>
      } catch {
        /* resposta não-JSON */
      }
      return { status: res.status, json, texto: texto.slice(0, 400) }
    } catch (e) {
      ultimo = e
      if (tentativa === 1) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw new Error(`sem resposta do JARVIS: ${descreverErro(ultimo)}`)
}

// ---------- controle do que já foi enviado ----------

type Tipo = 'nota' | 'comissao' | 'titulo' | 'indicadores'

async function hashesEnviados(supabase: SupabaseClient, tipo: Tipo): Promise<Map<string, string>> {
  const linhas = await lerTudo<{ chave: string; hash: string }>((de, ate) =>
    supabase.from('jarvis_envios').select('chave, hash').eq('tipo', tipo).order('chave').range(de, ate)
  )
  return new Map(linhas.map((l) => [l.chave, l.hash]))
}

async function registrarEnvios(supabase: SupabaseClient, tipo: Tipo, itens: { chave: string; hash: string }[]) {
  for (let i = 0; i < itens.length; i += 500) {
    const lote = itens.slice(i, i + 500).map((x) => ({ tipo, chave: x.chave, hash: x.hash, enviado_em: new Date().toISOString() }))
    const { error } = await supabase.from('jarvis_envios').upsert(lote, { onConflict: 'tipo,chave' })
    if (error) throw new Error(`erro ao registrar envios: ${error.message}`)
  }
}

interface Resumo {
  candidatos: number
  enviados: number
  criadas?: number
  atualizadas?: number
  erros: string[]
}

// ---------- 1) NF-e (XML) ----------

async function enviarNotas(supabase: SupabaseClient, base: string, token: string, desde: string, completo: boolean): Promise<Resumo> {
  const resumo: Resumo = { candidatos: 0, enviados: 0, criadas: 0, atualizadas: 0, erros: [] }
  const notas = await lerTudo<{ id: string; numero_nf: string; xml_raw: string; xml_chave_acesso: string | null }>(
    (de, ate) =>
      supabase
        .from('invoices')
        .select('id, numero_nf, xml_raw, xml_chave_acesso')
        .not('xml_raw', 'is', null)
        .eq('excluida', false)
        .gte('data_emissao', desde)
        .order('data_emissao')
        .order('id')
        .range(de, ate),
    200
  )
  const enviados = completo ? new Map<string, string>() : await hashesEnviados(supabase, 'nota')
  const pendentes = notas
    .map((n) => ({ nota: n, hash: sha(n.xml_raw) }))
    .filter((x) => enviados.get(x.nota.id) !== x.hash)
  resumo.candidatos = pendentes.length

  for (let i = 0; i < pendentes.length; i += 100) {
    const lote = pendentes.slice(i, i + 100)
    const form = new FormData()
    const nomes = new Map<string, string>() // nome do arquivo -> id da nota
    for (const { nota } of lote) {
      const nome = `${nota.xml_chave_acesso ?? `nf-${nota.numero_nf}-${nota.id.slice(0, 8)}`}-nfe.xml`
      nomes.set(nome, nota.id)
      form.append('files', new Blob([nota.xml_raw], { type: 'application/xml' }), nome)
    }
    const r = await chamarJarvis(`${base}/api/integrations/faturamento/invoices`, token, { body: form })
    if (r.status === 401 || r.status === 503) throw new Error(`JARVIS respondeu ${r.status}: ${r.texto}`)
    if (r.status !== 200 && r.status !== 422) {
      resumo.erros.push(`lote de notas: JARVIS respondeu ${r.status} ${r.texto}`)
      continue
    }
    const erros = Array.isArray(r.json?.erros) ? (r.json!.erros as unknown[]) : []
    const comErro = new Set<string>()
    for (const erro of erros) {
      const texto = typeof erro === 'string' ? erro : JSON.stringify(erro)
      resumo.erros.push(texto.slice(0, 300))
      for (const [nome, id] of nomes) if (texto.includes(nome)) comErro.add(id)
    }
    const ok = lote.filter(({ nota }) => !comErro.has(nota.id))
    await registrarEnvios(supabase, 'nota', ok.map(({ nota, hash }) => ({ chave: nota.id, hash })))
    resumo.enviados += ok.length
    resumo.criadas = (resumo.criadas ?? 0) + Number(r.json?.criadas ?? 0)
    resumo.atualizadas = (resumo.atualizadas ?? 0) + Number(r.json?.atualizadas ?? 0)
  }
  return resumo
}

// ---------- envio em lote de JSON (comissões e títulos) ----------

// Em 400 (item inválido) divide o lote ao meio até isolar o item ruim, para um item errado não travar os demais.
async function enviarJsonEmLotes<T extends { externalId: string }>(
  supabase: SupabaseClient,
  tipo: Tipo,
  url: string,
  token: string,
  itens: { item: T; hash: string }[],
  tamanho: number,
  resumo: Resumo
): Promise<void> {
  async function enviar(lote: { item: T; hash: string }[]): Promise<void> {
    if (lote.length === 0) return
    const r = await chamarJarvis(url, token, {
      body: JSON.stringify({ items: lote.map((x) => x.item) }),
      contentType: 'application/json',
    })
    if (r.status === 401 || r.status === 503) throw new Error(`JARVIS respondeu ${r.status}: ${r.texto}`)
    if (r.status === 200) {
      await registrarEnvios(supabase, tipo, lote.map((x) => ({ chave: x.item.externalId, hash: x.hash })))
      resumo.enviados += lote.length
      resumo.criadas = (resumo.criadas ?? 0) + Number(r.json?.criadas ?? 0)
      resumo.atualizadas = (resumo.atualizadas ?? 0) + Number(r.json?.atualizadas ?? 0)
      return
    }
    if ((r.status === 400 || r.status === 422) && lote.length > 1) {
      const meio = Math.ceil(lote.length / 2)
      await enviar(lote.slice(0, meio))
      await enviar(lote.slice(meio))
      return
    }
    resumo.erros.push(`${lote[0].item.externalId}: JARVIS respondeu ${r.status} ${r.texto}`)
  }
  for (let i = 0; i < itens.length; i += tamanho) await enviar(itens.slice(i, i + tamanho))
}

// ---------- 2) comissões ----------

export interface ItemComissao {
  externalId: string
  vendedor: string
  referencia: string
  chaveNfe: string | null
  valorBase: number
  percentual: number
  valorComissao: number
  status: 'calculada' | 'cancelada'
  pagoEm: null
}

// "Mês" de comissão = mês em que o ciclo de apuração (dia 21 ao dia 20) TERMINA: nota de 25/10 é de 2026-11.
export function referenciaDoCiclo(dataEmissao: string): string {
  const [ano, mes, dia] = dataEmissao.split('-').map(Number)
  if (dia < 21) return `${ano}-${String(mes).padStart(2, '0')}`
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`
}

// Comissões por NF no intervalo de emissão [de, ate]. Usado no envio ao JARVIS e na API de leitura, para os
// dois mostrarem exatamente os mesmos valores. `numeroNf`/`cliente` só servem à API de leitura.
export async function calcularComissoes(
  supabase: SupabaseClient,
  de: string,
  ate?: string
): Promise<{ item: ItemComissao; numeroNf: string; cliente: string }[]> {
  const { data: vendedores, error: vErr } = await supabase.from('vendedores').select('id, nome, percentual_comissao')
  if (vErr) throw new Error(vErr.message)
  const { data: parcerias, error: pErr } = await supabase.from('comissao_parcerias').select('vendedor_id, beneficiario_id, percentual')
  if (pErr) throw new Error(pErr.message)
  const vendedorPorId = new Map((vendedores ?? []).map((v) => [v.id as string, v]))
  const parceriasDe = new Map<string, { beneficiario_id: string; percentual: number }[]>()
  for (const p of parcerias ?? []) {
    parceriasDe.set(p.vendedor_id, [...(parceriasDe.get(p.vendedor_id) ?? []), p])
  }

  const notas = await lerTudo<{
    id: string
    numero_nf: string
    cliente: string
    valor: number
    data_emissao: string
    vendedor_id: string | null
    tipo_operacao: string
    afeta_faturamento: boolean
    excluida: boolean
    xml_chave_acesso: string | null
  }>((a, b) => {
    const q = supabase
      .from('invoices')
      .select('id, numero_nf, cliente, valor, data_emissao, vendedor_id, tipo_operacao, afeta_faturamento, excluida, xml_chave_acesso')
      .not('vendedor_id', 'is', null)
      .gte('data_emissao', de)
    return (ate ? q.lte('data_emissao', ate) : q).order('data_emissao').order('id').range(a, b)
  })

  const itens: { item: ItemComissao; numeroNf: string; cliente: string }[] = []
  for (const nota of notas) {
    const tipo = nota.tipo_operacao.toUpperCase()
    const transferencia = tipo === 'TRANSFERÊNCIA' || tipo === 'TRANSFERENCIA'
    if (!nota.afeta_faturamento || transferencia || !nota.vendedor_id) continue // não gera comissão
    const cancelada = nota.excluida || tipo === 'CANCELADA'
    const dono = vendedorPorId.get(nota.vendedor_id)
    if (!dono) continue
    // Vendedor "combo" (origem de parceria): a comissão sai dividida entre os beneficiários.
    const partes = parceriasDe.has(nota.vendedor_id)
      ? parceriasDe.get(nota.vendedor_id)!.map((p) => ({
          externalId: `COM-${nota.id}-${p.beneficiario_id}`,
          nome: vendedorPorId.get(p.beneficiario_id)?.nome as string | undefined,
          percentual: Number(p.percentual),
        }))
      : [{ externalId: `COM-${nota.id}`, nome: dono.nome as string, percentual: Number(dono.percentual_comissao) }]
    for (const parte of partes) {
      if (!parte.nome || parte.nome.trim().length < 2 || !(parte.percentual > 0) || parte.percentual > 100) continue
      const valorBase = arredonda2(Number(nota.valor))
      const item: ItemComissao = {
        externalId: parte.externalId,
        vendedor: parte.nome.trim(),
        referencia: referenciaDoCiclo(nota.data_emissao),
        chaveNfe: nota.xml_chave_acesso && /^\d{44}$/.test(nota.xml_chave_acesso) ? nota.xml_chave_acesso : null,
        valorBase,
        percentual: parte.percentual,
        valorComissao: arredonda2((valorBase * parte.percentual) / 100),
        status: cancelada ? 'cancelada' : 'calculada',
        pagoEm: null,
      }
      itens.push({ item, numeroNf: nota.numero_nf, cliente: nota.cliente })
    }
  }
  return itens
}

async function enviarComissoes(supabase: SupabaseClient, base: string, token: string, desde: string, completo: boolean): Promise<Resumo> {
  const resumo: Resumo = { candidatos: 0, enviados: 0, criadas: 0, atualizadas: 0, erros: [] }
  const itens = (await calcularComissoes(supabase, desde)).map(({ item }) => ({ item, hash: sha(JSON.stringify(item)) }))
  const enviados = completo ? new Map<string, string>() : await hashesEnviados(supabase, 'comissao')
  const pendentes = itens.filter((x) => enviados.get(x.item.externalId) !== x.hash)
  resumo.candidatos = pendentes.length
  await enviarJsonEmLotes(supabase, 'comissao', `${base}/api/integrations/faturamento/commissions`, token, pendentes, 500, resumo)
  return resumo
}

// ---------- 3) títulos a receber ----------

interface ItemTitulo {
  externalId: string
  cliente: string
  cnpj?: string
  nota?: string
  parcela: number
  valor: number
  juros: number
  valorPago: number
  vencimento: string
  dataPagamento: string | null
  status: 'pendente' | 'parcial' | 'pago'
}

interface BoletoLinha {
  id: string
  numero_parcela: number
  valor: number
  juros: number | null
  valor_pago: number | null
  vencimento: string
  data_pagamento: string | null
  status: 'pendente' | 'parcial' | 'pago'
  cliente_nome_importado: string | null
  invoices: { numero_nf: string; cliente: string; clientes: { cnpj_cpf: string | null } | null } | null
}

const SELECT_BOLETO =
  'id, numero_parcela, valor, juros, valor_pago, vencimento, data_pagamento, status, cliente_nome_importado, invoices!invoice_id(numero_nf, cliente, clientes(cnpj_cpf))'

async function enviarTitulos(supabase: SupabaseClient, base: string, token: string, completo: boolean): Promise<Resumo> {
  const resumo: Resumo = { candidatos: 0, enviados: 0, criadas: 0, atualizadas: 0, erros: [] }
  const hoje = dataBr(agoraBr())
  // Rotina normal: os em aberto + os pagos/criados recentemente. O resto (pagos antigos) só no reenvio completo.
  const recorte = `status.neq.pago,data_pagamento.gte.${somaDias(hoje, -90)},created_at.gte.${somaDias(hoje, -30)}T00:00:00Z`
  const boletos = await lerTudo<BoletoLinha>((de, ate) => {
    const q = supabase.from('boletos').select(SELECT_BOLETO).eq('excluido', false).eq('tipo', 'boleto')
    // O tipo inferido do Supabase trata a relação como lista; em runtime (muitos-para-um) vem um objeto.
    return (completo ? q : q.or(recorte)).order('id').range(de, ate) as unknown as PromiseLike<{
      data: BoletoLinha[] | null
      error: { message: string } | null
    }>
  })

  const itens: { item: ItemTitulo; hash: string }[] = boletos.map((b) => {
    const cnpj = (b.invoices?.clientes?.cnpj_cpf ?? '').replace(/\D/g, '')
    const item: ItemTitulo = {
      externalId: b.id,
      cliente: (b.invoices?.cliente ?? b.cliente_nome_importado ?? 'Cliente não identificado').trim() || 'Cliente não identificado',
      ...(cnpj ? { cnpj } : {}),
      ...(b.invoices?.numero_nf ? { nota: b.invoices.numero_nf } : {}),
      parcela: Number(b.numero_parcela),
      valor: arredonda2(Number(b.valor)),
      juros: arredonda2(Number(b.juros ?? 0)),
      valorPago: arredonda2(Number(b.valor_pago ?? 0)),
      vencimento: b.vencimento,
      dataPagamento: b.data_pagamento ?? null,
      status: b.status,
    }
    return { item, hash: sha(JSON.stringify(item)) }
  })

  const enviados = completo ? new Map<string, string>() : await hashesEnviados(supabase, 'titulo')
  const pendentes = itens.filter((x) => enviados.get(x.item.externalId) !== x.hash)
  resumo.candidatos = pendentes.length
  await enviarJsonEmLotes(supabase, 'titulo', `${base}/api/integrations/faturamento/receivables`, token, pendentes, 1000, resumo)
  return resumo
}

// ---------- 4) indicadores ----------

// Mesmas regras do painel do diretor: nota cancelada, transferência e o que não afeta o faturamento (demo,
// devolução, brinde...) não entram.
export async function somaFaturamento(supabase: SupabaseClient, de: string, ate: string, filtro?: { filialId?: string; vendedorId?: string }): Promise<{ total: number; notas: number }> {
  const linhas = await lerTudo<{ valor: number; tipo_operacao: string }>((a, b) => {
    let q = supabase
      .from('invoices')
      .select('valor, tipo_operacao')
      .eq('excluida', false)
      .eq('afeta_faturamento', true)
      .gte('data_emissao', de)
      .lte('data_emissao', ate)
    if (filtro?.filialId) q = q.eq('filial_id', filtro.filialId)
    if (filtro?.vendedorId) q = q.eq('vendedor_id', filtro.vendedorId)
    return q.order('id').range(a, b)
  })
  let total = 0
  let notas = 0
  for (const l of linhas) {
    const t = l.tipo_operacao.toUpperCase()
    if (t === 'CANCELADA' || t === 'TRANSFERÊNCIA' || t === 'TRANSFERENCIA') continue
    total += Number(l.valor)
    notas++
  }
  return { total: arredonda2(total), notas }
}

export async function metaDoMes(supabase: SupabaseClient, mes: number, ano: number): Promise<number> {
  const { data: global } = await supabase.from('metas').select('valor_meta').is('filial_id', null).eq('mes', mes).eq('ano', ano).maybeSingle()
  if (global) return Number(global.valor_meta)
  const { data: porFilial } = await supabase.from('metas').select('valor_meta').not('filial_id', 'is', null).eq('mes', mes).eq('ano', ano)
  return arredonda2((porFilial ?? []).reduce((acc, r) => acc + Number(r.valor_meta), 0))
}

// A receber e vencido hoje (saldo = valor + juros - pago, em centavos exatos). Usado nos indicadores e no resumo
// de títulos da API de leitura, para os dois baterem.
export async function posicaoRecebiveis(supabase: SupabaseClient): Promise<{
  aReceber: number
  vencido: number
  titulosVencidos: number
  faixas: { ate30: number; de31a60: number; de61a90: number; acima90: number }
}> {
  const hoje = dataBr(agoraBr())
  const abertos = await lerTudo<{ valor: number; juros: number | null; valor_pago: number | null; vencimento: string }>((a, b) =>
    supabase.from('boletos').select('valor, juros, valor_pago, vencimento').eq('excluido', false).eq('tipo', 'boleto').neq('status', 'pago').order('id').range(a, b)
  )
  let aReceber = 0
  let vencido = 0
  let titulosVencidos = 0
  const faixas = { ate30: 0, de31a60: 0, de61a90: 0, acima90: 0 }
  for (const t of abertos) {
    const saldo = Math.max(arredonda2(arredonda2(Number(t.valor) + Number(t.juros ?? 0)) - arredonda2(Number(t.valor_pago ?? 0))), 0)
    if (saldo <= 0) continue
    aReceber += saldo
    const atraso = diasEntre(t.vencimento, hoje)
    if (atraso > 0) {
      vencido += saldo
      titulosVencidos++
      if (atraso <= 30) faixas.ate30 += saldo
      else if (atraso <= 60) faixas.de31a60 += saldo
      else if (atraso <= 90) faixas.de61a90 += saldo
      else faixas.acima90 += saldo
    }
  }
  return { aReceber, vencido, titulosVencidos, faixas }
}

async function montarIndicadores(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const hoje = dataBr(agoraBr())
  const [ano, mes] = hoje.split('-').map(Number)
  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`

  const [dia, mesAtual, meta] = await Promise.all([
    somaFaturamento(supabase, hoje, hoje),
    somaFaturamento(supabase, inicioMes, hoje),
    metaDoMes(supabase, mes, ano),
  ])

  // Pedidos em andamento por etapa (mesma lógica da TV: parcial já faturado em parte tem coluna própria).
  const pedidos = await lerTudo<{ etapa: string; status: string; parcial_faturada_em: string | null }>((a, b) =>
    supabase.from('pedidos').select('etapa, status, parcial_faturada_em').in('status', ['pendente', 'devolvido']).order('id').range(a, b)
  )
  const porEtapa = { enviado: 0, emProcesso: 0, enviadoSanco: 0, emSeparacao: 0, preparandoEmbarque: 0, faturadosParcialmente: 0, devolvidos: 0 }
  for (const p of pedidos) {
    if (p.status === 'devolvido') porEtapa.devolvidos++
    else if (p.parcial_faturada_em) porEtapa.faturadosParcialmente++
    else if (p.etapa === 'enviado') porEtapa.enviado++
    else if (p.etapa === 'em_processo') porEtapa.emProcesso++
    else if (p.etapa === 'enviado_sanco') porEtapa.enviadoSanco++
    else if (p.etapa === 'em_separacao') porEtapa.emSeparacao++
    else if (p.etapa === 'preparando_embarque') porEtapa.preparandoEmbarque++
  }

  // Demos (45 dias da emissão) ainda sem NF de retorno.
  const demos = await lerTudo<{ id: string; data_emissao: string }>((a, b) =>
    supabase.from('invoices').select('id, data_emissao').ilike('tipo_operacao', 'demo%').eq('excluida', false).order('id').range(a, b)
  )
  const retornos = await lerTudo<{ invoice_id: string }>((a, b) => supabase.from('demo_retornos').select('invoice_id').order('invoice_id').range(a, b))
  const voltaram = new Set(retornos.map((r) => r.invoice_id))
  let demosAbertas = 0
  let demosAtrasadas = 0
  let demosVencendoEm7Dias = 0
  for (const d of demos) {
    if (voltaram.has(d.id)) continue
    demosAbertas++
    const restantes = diasEntre(hoje, somaDias(d.data_emissao.slice(0, 10), PRAZO_DEMO_DIAS))
    if (restantes < 0) demosAtrasadas++
    else if (restantes <= 7) demosVencendoEm7Dias++
  }

  const { aReceber, vencido, titulosVencidos, faixas } = await posicaoRecebiveis(supabase)

  return {
    geradoEm: isoComFuso(),
    faturamentoDia: dia.total,
    faturamentoMes: mesAtual.total,
    notasMes: mesAtual.notas,
    metaMes: meta,
    percentualMeta: meta > 0 ? arredonda2((mesAtual.total / meta) * 100) : null,
    pedidosPorEtapa: porEtapa,
    demosEmAberto: demosAbertas,
    demosAtrasadas,
    demosVencendoEm7Dias,
    aReceber: arredonda2(aReceber),
    vencidoTotal: arredonda2(vencido),
    titulosVencidos,
    vencidoPorFaixa: {
      ate30dias: arredonda2(faixas.ate30),
      de31a60dias: arredonda2(faixas.de31a60),
      de61a90dias: arredonda2(faixas.de61a90),
      acima90dias: arredonda2(faixas.acima90),
    },
  }
}

async function enviarIndicadores(supabase: SupabaseClient, base: string, token: string): Promise<Record<string, unknown>> {
  const corpo = await montarIndicadores(supabase)
  const r = await chamarJarvis(`${base}/api/integrations/faturamento/indicators`, token, {
    body: JSON.stringify(corpo),
    contentType: 'application/json',
  })
  if (r.status !== 200) throw new Error(`indicadores: JARVIS respondeu ${r.status} ${r.texto}`)
  await registrarEnvios(supabase, 'indicadores', [{ chave: 'ultimo', hash: sha(JSON.stringify(corpo)) }])
  return { enviados: 1, indicadores: corpo, resposta: r.json }
}

// ---------- handler ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await executar(req, res)
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: `Falha inesperada no envio ao JARVIS: ${descreverErro(e)}` })
  }
}

async function executar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Use GET ou POST.' })
    return
  }

  const secretEsperado = process.env.JARVIS_SYNC_SECRET
  if (!secretEsperado || !segredoConfere(req.headers['x-sync-secret'], secretEsperado)) {
    res.status(401).json({ error: 'Segredo ausente ou inválido (header x-sync-secret).' })
    return
  }

  const baseUrl = (process.env.JARVIS_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const token = process.env.JARVIS_INTEGRATION_TOKEN ?? ''
  if (!baseUrl || !token) {
    // Integração desligada: não é erro (o agendador pode já estar criado antes de o JARVIS liberar o acesso).
    res.status(200).json({ ok: true, desligado: true, motivo: 'JARVIS_BASE_URL e/ou JARVIS_INTEGRATION_TOKEN não configurados.' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis do Supabase ausentes).' })
    return
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const completo = req.query.completo === '1' || req.query.completo === 'true'
  const pedido = typeof req.query.parte === 'string' ? req.query.parte.split(',').map((p) => p.trim()) : []
  const partes: Parte[] = pedido.length > 0 ? PARTES.filter((p) => pedido.includes(p)) : completo ? [...PARTES] : ['notas', 'comissoes', 'titulos']
  const hoje = dataBr(agoraBr())
  const desde = typeof req.query.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde) ? req.query.desde : inicioMesAnterior(hoje)

  const resultado: Record<string, unknown> = {}
  const falhas: string[] = []
  for (const parte of partes) {
    try {
      if (parte === 'notas') resultado.notas = await enviarNotas(supabase, baseUrl, token, desde, completo)
      else if (parte === 'comissoes') resultado.comissoes = await enviarComissoes(supabase, baseUrl, token, desde, completo)
      else if (parte === 'titulos') resultado.titulos = await enviarTitulos(supabase, baseUrl, token, completo)
      else resultado.indicadores = await enviarIndicadores(supabase, baseUrl, token)
    } catch (e) {
      falhas.push(`${parte}: ${descreverErro(e)}`)
    }
  }

  res.status(falhas.length > 0 ? 502 : 200).json({ ok: falhas.length === 0, desde, completo, ...resultado, ...(falhas.length > 0 ? { falhas } : {}) })
}
