// Impostômetro: créditos e débitos de impostos, em tempo real, a partir dos XMLs das notas (Lucro Presumido).
//
//   GET  /api/impostometro?mes=AAAA-MM   lê os XMLs ainda não processados (até 150 por chamada) e devolve a apuração do mês
//   POST /api/impostometro               { acao: "regra", cfop, efeitoIcms, efeitoIpi } ajusta como um CFOP entra na conta
//
// Autenticação: token de sessão do usuário (Authorization: Bearer); só o diretor. Os valores são uma ESTIMATIVA para
// acompanhamento: a apuração oficial é da contabilidade. Guia: docs/IMPOSTOMETRO.md.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>

const PIS_CUMULATIVO = 0.0065
const COFINS_CUMULATIVO = 0.03
const EFEITOS = ['debito', 'credito', 'estorno_debito', 'estorno_credito', 'nenhum'] as const
type Efeito = (typeof EFEITOS)[number]
const LIMITE_PROCESSAR = 150

const arredonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const descreverErro = (e: unknown) => (e instanceof Error ? e.message : 'erro desconhecido')

async function lerTudo<T>(
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

// ---------- leitura do XML ----------

const bloco = (xml: string, nome: string): string => xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`))?.[1] ?? ''
const tag = (xml: string, nome: string): string | null => xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([^<]*)</${nome}>`))?.[1]?.trim() || null
const num = (v: string | null) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface ItemImposto {
  n_item: number
  cfop: string | null
  ncm: string | null
  v_prod: number
  v_bc_icms: number
  v_icms: number
  v_ipi: number
  v_pis: number
  v_cofins: number
  v_cbs: number
  v_ibs: number
}

// Imposto de cada item (det) do XML da NF-e: ICMS, IPI, PIS, COFINS e, quando o emissor informa, CBS e IBS.
export function itensDoXml(xml: string): ItemImposto[] {
  const itens: ItemImposto[] = []
  for (const m of xml.matchAll(/<det\b[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g)) {
    const det = m[2]
    const prod = bloco(det, 'prod')
    const imposto = bloco(det, 'imposto')
    const icms = bloco(imposto, 'ICMS')
    const ibscbs = bloco(imposto, 'IBSCBS')
    itens.push({
      n_item: Number(m[1]),
      cfop: tag(prod, 'CFOP'),
      ncm: tag(prod, 'NCM'),
      v_prod: arredonda2(num(tag(prod, 'vProd'))),
      v_bc_icms: arredonda2(num(tag(icms, 'vBC'))),
      v_icms: arredonda2(num(tag(icms, 'vICMS'))),
      v_ipi: arredonda2(num(tag(bloco(imposto, 'IPI'), 'vIPI'))),
      v_pis: arredonda2(num(tag(bloco(imposto, 'PIS'), 'vPIS'))),
      v_cofins: arredonda2(num(tag(bloco(imposto, 'COFINS'), 'vCOFINS'))),
      v_cbs: arredonda2(num(tag(ibscbs, 'vCBS'))),
      v_ibs: arredonda2(num(tag(ibscbs, 'vIBS'))),
    })
  }
  return itens
}

const diaBr = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)

// ---------- regras: como cada CFOP entra na conta ----------

// CFOPs sem regra: saída = débito (o imposto destacado é devido); entrada = fora da conta até alguém definir.
function efeitoPadrao(origem: 'saida' | 'entrada'): Efeito {
  return origem === 'saida' ? 'debito' : 'nenhum'
}

async function carregarRegras(supabase: SupabaseClient): Promise<Map<string, { icms: Efeito; ipi: Efeito; descricao: string | null }>> {
  const linhas = await lerTudo<Linha>((a, b) => supabase.from('impostometro_regras').select('cfop, efeito_icms, efeito_ipi, descricao').order('cfop').range(a, b))
  return new Map(linhas.map((r) => [r.cfop as string, { icms: r.efeito_icms as Efeito, ipi: r.efeito_ipi as Efeito, descricao: (r.descricao as string | null) ?? null }]))
}

// ---------- processamento dos XMLs ----------

async function gravarNota(supabase: SupabaseClient, origem: 'saida' | 'entrada', chave: string, data: string, cancelada: boolean, xml: string) {
  const itens = itensDoXml(xml)
  const { error } = await supabase.from('impostometro_notas').upsert({ origem, chave, data_emissao: data, cancelada, itens: itens.length, processado_em: new Date().toISOString() }, { onConflict: 'origem,chave' })
  if (error) throw new Error(`gravar nota: ${error.message}`)
  if (itens.length > 0) {
    const { error: erroItens } = await supabase.from('impostometro_itens').upsert(itens.map((i) => ({ origem, chave, ...i })), { onConflict: 'origem,chave,n_item' })
    if (erroItens) throw new Error(`gravar itens: ${erroItens.message}`)
  }
}

// Lê os XMLs ainda não processados (saídas e entradas) e mantém o "cancelada" em dia. Devolve quantos faltam.
async function processarPendentes(supabase: SupabaseClient, limite: number, fim: number): Promise<number> {
  // --- notas que a empresa emitiu (invoices com XML)
  const saidas = await lerTudo<Linha>((a, b) =>
    supabase.from('invoices').select('id, xml_chave_acesso, data_emissao, tipo_operacao, excluida').not('xml_raw', 'is', null).order('data_emissao', { ascending: false }).order('id').range(a, b)
  )
  const feitasSaida = await lerTudo<Linha>((a, b) => supabase.from('impostometro_notas').select('chave, cancelada').eq('origem', 'saida').order('chave').range(a, b))
  const mapaSaida = new Map(feitasSaida.map((n) => [n.chave as string, n.cancelada as boolean]))
  const chaveSaida = (n: Linha) => (n.xml_chave_acesso as string | null) ?? `inv-${n.id}`
  const canceladaSaida = (n: Linha) => !!n.excluida || String(n.tipo_operacao).toUpperCase() === 'CANCELADA'
  // mantém o flag cancelada em dia
  for (const n of saidas) {
    const antes = mapaSaida.get(chaveSaida(n))
    if (antes !== undefined && antes !== canceladaSaida(n)) await supabase.from('impostometro_notas').update({ cancelada: canceladaSaida(n) }).eq('origem', 'saida').eq('chave', chaveSaida(n))
  }
  const pendentesSaida = saidas.filter((n) => !mapaSaida.has(chaveSaida(n)))

  // --- notas emitidas contra a empresa (XML completo capturado da SEFAZ)
  const entradas = await lerTudo<Linha>((a, b) =>
    supabase.from('nfe_entrada').select('chave, data_emissao, situacao').eq('completa', true).order('data_emissao', { ascending: false }).order('chave').range(a, b)
  )
  const feitasEntrada = await lerTudo<Linha>((a, b) => supabase.from('impostometro_notas').select('chave, cancelada').eq('origem', 'entrada').order('chave').range(a, b))
  const mapaEntrada = new Map(feitasEntrada.map((n) => [n.chave as string, n.cancelada as boolean]))
  for (const n of entradas) {
    const antes = mapaEntrada.get(n.chave as string)
    const cancelada = n.situacao === 'cancelada'
    if (antes !== undefined && antes !== cancelada) await supabase.from('impostometro_notas').update({ cancelada }).eq('origem', 'entrada').eq('chave', n.chave)
  }
  const pendentesEntrada = entradas.filter((n) => !mapaEntrada.has(n.chave as string))

  let feitas = 0
  for (const n of pendentesSaida) {
    if (feitas >= limite || Date.now() > fim) break
    const { data } = await supabase.from('invoices').select('xml_raw').eq('id', n.id).maybeSingle()
    if (data?.xml_raw) await gravarNota(supabase, 'saida', chaveSaida(n), String(n.data_emissao).slice(0, 10), canceladaSaida(n), data.xml_raw as string)
    feitas++
  }
  for (const n of pendentesEntrada) {
    if (feitas >= limite || Date.now() > fim) break
    const { data } = await supabase.from('nfe_entrada').select('xml').eq('chave', n.chave).maybeSingle()
    if (data?.xml) await gravarNota(supabase, 'entrada', n.chave as string, diaBr(String(n.data_emissao)), n.situacao === 'cancelada', data.xml as string)
    feitas++
  }
  return Math.max(pendentesSaida.length + pendentesEntrada.length - feitas, 0)
}

// ---------- apuração do mês ----------

function limitesDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number)
  return { de: `${mes}-01`, ate: new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10) }
}

interface Totais {
  debito: number
  credito: number
  estornoDebito: number
  estornoCredito: number
}

const somaEfeito = (t: Totais, efeito: Efeito, valor: number) => {
  if (efeito === 'debito') t.debito += valor
  else if (efeito === 'credito') t.credito += valor
  else if (efeito === 'estorno_debito') t.estornoDebito += valor
  else if (efeito === 'estorno_credito') t.estornoCredito += valor
}

const fechar = (t: Totais) => {
  const debito = arredonda2(t.debito - t.estornoDebito)
  const credito = arredonda2(t.credito - t.estornoCredito)
  return { debito, credito, saldo: arredonda2(debito - credito), estornoDebito: arredonda2(t.estornoDebito), estornoCredito: arredonda2(t.estornoCredito) }
}

async function apurar(supabase: SupabaseClient, mes: string) {
  const { de, ate } = limitesDoMes(mes)
  const regras = await carregarRegras(supabase)
  const itens = await lerTudo<Linha>((a, b) =>
    supabase
      .from('impostometro_itens')
      .select('origem, chave, cfop, v_prod, v_icms, v_ipi, v_pis, v_cofins, v_cbs, v_ibs, impostometro_notas!inner(data_emissao, cancelada)')
      .gte('impostometro_notas.data_emissao', de)
      .lte('impostometro_notas.data_emissao', ate)
      .eq('impostometro_notas.cancelada', false)
      .order('chave')
      .order('n_item')
      .range(a, b)
  )

  const icms: Totais = { debito: 0, credito: 0, estornoDebito: 0, estornoCredito: 0 }
  const ipi: Totais = { debito: 0, credito: 0, estornoDebito: 0, estornoCredito: 0 }
  const cbsIbs = { debitoCbs: 0, debitoIbs: 0, creditoCbs: 0, creditoIbs: 0, notasComGrupo: new Set<string>() }
  const porCfop = new Map<string, { origem: string; cfop: string; itens: number; icms: number; ipi: number; efeitoIcms: Efeito; efeitoIpi: Efeito; comRegra: boolean }>()

  for (const i of itens) {
    const origem = i.origem as 'saida' | 'entrada'
    const cfop = (i.cfop as string | null) ?? '----'
    const regra = regras.get(cfop)
    const efeitoIcms = regra?.icms ?? efeitoPadrao(origem)
    const efeitoIpi = regra?.ipi ?? efeitoPadrao(origem)
    somaEfeito(icms, efeitoIcms, Number(i.v_icms))
    somaEfeito(ipi, efeitoIpi, Number(i.v_ipi))
    if (Number(i.v_cbs) || Number(i.v_ibs)) {
      cbsIbs.notasComGrupo.add(`${origem}:${i.chave}`)
      if (origem === 'saida') {
        cbsIbs.debitoCbs += Number(i.v_cbs)
        cbsIbs.debitoIbs += Number(i.v_ibs)
      } else {
        cbsIbs.creditoCbs += Number(i.v_cbs)
        cbsIbs.creditoIbs += Number(i.v_ibs)
      }
    }
    const k = `${origem}:${cfop}`
    const atual = porCfop.get(k) ?? { origem, cfop, itens: 0, icms: 0, ipi: 0, efeitoIcms, efeitoIpi, comRegra: !!regra }
    atual.itens++
    atual.icms = arredonda2(atual.icms + Number(i.v_icms))
    atual.ipi = arredonda2(atual.ipi + Number(i.v_ipi))
    porCfop.set(k, atual)
  }

  // PIS e COFINS no Lucro Presumido são cumulativos (sem crédito): estimativa sobre a receita do mês, sem o ICMS.
  const notasMes = await lerTudo<Linha>((a, b) =>
    supabase
      .from('invoices')
      .select('valor, valor_icms, tipo_operacao')
      .eq('excluida', false)
      .eq('afeta_faturamento', true)
      .gte('data_emissao', de)
      .lte('data_emissao', ate)
      .order('id')
      .range(a, b)
  )
  let receita = 0
  let icmsDaReceita = 0
  for (const n of notasMes) {
    const t = String(n.tipo_operacao).toUpperCase()
    if (t === 'CANCELADA' || t === 'TRANSFERÊNCIA' || t === 'TRANSFERENCIA') continue
    receita += Number(n.valor)
    icmsDaReceita += Number(n.valor_icms ?? 0)
  }
  const baseCumulativa = Math.max(arredonda2(receita - icmsDaReceita), 0)

  const lista = Array.from(porCfop.values()).sort((a, b) => Math.abs(b.icms) + Math.abs(b.ipi) - (Math.abs(a.icms) + Math.abs(a.ipi)))
  return {
    mes,
    periodo: { de, ate },
    icms: fechar(icms),
    ipi: fechar(ipi),
    pisCofins: {
      receitaBruta: arredonda2(receita),
      icmsExcluido: arredonda2(icmsDaReceita),
      base: baseCumulativa,
      pis: arredonda2(baseCumulativa * PIS_CUMULATIVO),
      cofins: arredonda2(baseCumulativa * COFINS_CUMULATIVO),
      observacao: 'Lucro Presumido: PIS (0,65%) e COFINS (3%) cumulativos, sem crédito nas compras. Estimativa sobre a receita do mês, sem o ICMS.',
    },
    cbsIbs: {
      debitoCbs: arredonda2(cbsIbs.debitoCbs),
      debitoIbs: arredonda2(cbsIbs.debitoIbs),
      creditoCbs: arredonda2(cbsIbs.creditoCbs),
      creditoIbs: arredonda2(cbsIbs.creditoIbs),
      notasComGrupo: cbsIbs.notasComGrupo.size,
      observacao: '2026 é ano de teste da reforma: CBS e IBS aparecem só quando o XML da nota traz o grupo IBSCBS.',
    },
    porCfop: lista,
    // Só compras precisam de revisão: venda sem regra já entra como débito (o imposto destacado é devido).
    semRegra: lista.filter((c) => !c.comRegra && c.origem === 'entrada' && (c.icms !== 0 || c.ipi !== 0)),
    notasConsideradas: new Set(itens.map((i) => `${i.origem}:${i.chave}`)).size,
  }
}

// ---------- autenticação e handler ----------

async function usuarioDiretor(supabase: SupabaseClient, req: VercelRequest): Promise<{ id: string } | null> {
  const auth = req.headers.authorization
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const { data: usuario, error } = await supabase.auth.getUser(token)
  if (error || !usuario?.user) return null
  const { data: perfil } = await supabase.from('profiles').select('role').eq('id', usuario.user.id).maybeSingle()
  return perfil?.role === 'diretor' ? { id: usuario.user.id } : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      res.status(405).json({ erro: 'Método não permitido.' })
      return
    }
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      res.status(500).json({ erro: 'Servidor sem acesso ao banco (variáveis ausentes).' })
      return
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const usuario = await usuarioDiretor(supabase, req)
    if (!usuario) {
      res.status(401).json({ erro: 'Acesso restrito ao diretor. Entre novamente.' })
      return
    }

    if (req.method === 'POST') {
      const corpo = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as { acao?: unknown; cfop?: unknown; efeitoIcms?: unknown; efeitoIpi?: unknown }
      if (corpo.acao !== 'regra') {
        res.status(400).json({ erro: 'Ação desconhecida.' })
        return
      }
      const cfop = String(corpo.cfop ?? '')
      const ei = String(corpo.efeitoIcms ?? '') as Efeito
      const ep = String(corpo.efeitoIpi ?? '') as Efeito
      if (!/^\d{4}$/.test(cfop) || !EFEITOS.includes(ei) || !EFEITOS.includes(ep)) {
        res.status(400).json({ erro: 'CFOP (4 dígitos) ou efeito inválido.' })
        return
      }
      const { error } = await supabase.from('impostometro_regras').upsert({ cfop, efeito_icms: ei, efeito_ipi: ep, atualizado_em: new Date().toISOString(), atualizado_por: usuario.id }, { onConflict: 'cfop' })
      if (error) throw new Error(error.message)
      res.status(200).json({ ok: true })
      return
    }

    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)
    const mes = typeof req.query.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.mes) ? req.query.mes : hoje
    const pendentes = await processarPendentes(supabase, LIMITE_PROCESSAR, Date.now() + 20_000)
    const apuracao = await apurar(supabase, mes)
    const regras = await carregarRegras(supabase)
    res.status(200).json({
      ...apuracao,
      pendentes,
      regime: 'Lucro Presumido',
      geradoEm: new Date().toISOString(),
      regras: Array.from(regras.entries()).map(([cfop, r]) => ({ cfop, efeitoIcms: r.icms, efeitoIpi: r.ipi, descricao: r.descricao })),
    })
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ erro: `Falha no impostômetro: ${descreverErro(e)}` })
  }
}
