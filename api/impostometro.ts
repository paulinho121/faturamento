// Impostômetro: créditos e débitos de impostos, em tempo real, a partir dos XMLs das notas (Lucro Presumido).
//
//   GET  /api/impostometro?de=&ate=&origem=saida|entrada&cfop=&q=&impostos=icms,ipi,...&pagina=&limite=&todas=1
//        lê os XMLs ainda não processados (até 150 por chamada) e devolve totais, apuração e lista de notas do filtro
//        (sem `de`/`ate`: o mês de `mes=AAAA-MM`, ou o mês atual). `impostos`: só itens com valor > 0 em algum dos impostos
//        escolhidos. `todas=1`: devolve a lista inteira de notas do filtro (até 5000), para exportar em Excel.
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
const IMPOSTOS = ['icms', 'ipi', 'pis', 'cofins', 'cbs', 'ibs'] as const
type Imposto = (typeof IMPOSTOS)[number]
const COLUNA_IMPOSTO: Record<Imposto, string> = { icms: 'v_icms', ipi: 'v_ipi', pis: 'v_pis', cofins: 'v_cofins', cbs: 'v_cbs', ibs: 'v_ibs' }
const LIMITE_EXPORTAR = 5000
const VERSAO_ATUAL = 2 // notas lidas com versão menor são relidas (ganham número, participante e valor)

const arredonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const descreverErro = (e: unknown) => (e instanceof Error ? e.message : 'erro desconhecido')
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

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

interface Meta {
  numero: string | null
  serie: string | null
  participante: string | null
  participanteCnpj: string | null
  valorNf: number
}

async function gravarNota(supabase: SupabaseClient, origem: 'saida' | 'entrada', chave: string, data: string, cancelada: boolean, xml: string, meta: Meta) {
  const itens = itensDoXml(xml)
  const { error } = await supabase.from('impostometro_notas').upsert(
    {
      origem,
      chave,
      data_emissao: data,
      cancelada,
      itens: itens.length,
      numero: meta.numero,
      serie: meta.serie,
      participante: meta.participante,
      participante_cnpj: meta.participanteCnpj,
      valor_nf: arredonda2(meta.valorNf),
      versao: VERSAO_ATUAL,
      processado_em: new Date().toISOString(),
    },
    { onConflict: 'origem,chave' }
  )
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
    supabase
      .from('invoices')
      .select('id, xml_chave_acesso, data_emissao, tipo_operacao, excluida, numero_nf, cliente, valor, clientes(cnpj_cpf)')
      .not('xml_raw', 'is', null)
      .order('data_emissao', { ascending: false })
      .order('id')
      .range(a, b)
  )
  const feitasSaida = await lerTudo<Linha>((a, b) => supabase.from('impostometro_notas').select('chave, cancelada, versao').eq('origem', 'saida').order('chave').range(a, b))
  const mapaSaida = new Map(feitasSaida.map((n) => [n.chave as string, n]))
  const chaveSaida = (n: Linha) => (n.xml_chave_acesso as string | null) ?? `inv-${n.id}`
  const canceladaSaida = (n: Linha) => !!n.excluida || String(n.tipo_operacao).toUpperCase() === 'CANCELADA'
  for (const n of saidas) {
    const antes = mapaSaida.get(chaveSaida(n))
    if (antes && antes.cancelada !== canceladaSaida(n)) await supabase.from('impostometro_notas').update({ cancelada: canceladaSaida(n) }).eq('origem', 'saida').eq('chave', chaveSaida(n))
  }
  const pendentesSaida = saidas.filter((n) => {
    const feita = mapaSaida.get(chaveSaida(n))
    return !feita || Number(feita.versao ?? 1) < VERSAO_ATUAL
  })

  // --- notas emitidas contra a empresa (XML completo capturado da SEFAZ)
  const entradas = await lerTudo<Linha>((a, b) =>
    supabase
      .from('nfe_entrada')
      .select('chave, data_emissao, situacao, numero, serie, emitente_nome, emitente_cnpj, valor')
      .eq('completa', true)
      .order('data_emissao', { ascending: false })
      .order('chave')
      .range(a, b)
  )
  const feitasEntrada = await lerTudo<Linha>((a, b) => supabase.from('impostometro_notas').select('chave, cancelada, versao').eq('origem', 'entrada').order('chave').range(a, b))
  const mapaEntrada = new Map(feitasEntrada.map((n) => [n.chave as string, n]))
  for (const n of entradas) {
    const antes = mapaEntrada.get(n.chave as string)
    const cancelada = n.situacao === 'cancelada'
    if (antes && antes.cancelada !== cancelada) await supabase.from('impostometro_notas').update({ cancelada }).eq('origem', 'entrada').eq('chave', n.chave)
  }
  const pendentesEntrada = entradas.filter((n) => {
    const feita = mapaEntrada.get(n.chave as string)
    return !feita || Number(feita.versao ?? 1) < VERSAO_ATUAL
  })

  let feitas = 0
  for (const n of pendentesSaida) {
    if (feitas >= limite || Date.now() > fim) break
    const { data } = await supabase.from('invoices').select('xml_raw').eq('id', n.id).maybeSingle()
    if (data?.xml_raw) {
      await gravarNota(supabase, 'saida', chaveSaida(n), String(n.data_emissao).slice(0, 10), canceladaSaida(n), data.xml_raw as string, {
        numero: (n.numero_nf as string | null) ?? null,
        serie: (data.xml_raw as string).match(/<serie>(\d+)<\/serie>/)?.[1] ?? null,
        participante: (n.cliente as string | null) ?? null,
        participanteCnpj: soDigitos(n.clientes?.cnpj_cpf) || null,
        valorNf: Number(n.valor ?? 0),
      })
    }
    feitas++
  }
  for (const n of pendentesEntrada) {
    if (feitas >= limite || Date.now() > fim) break
    const { data } = await supabase.from('nfe_entrada').select('xml').eq('chave', n.chave).maybeSingle()
    if (data?.xml) {
      await gravarNota(supabase, 'entrada', n.chave as string, diaBr(String(n.data_emissao)), n.situacao === 'cancelada', data.xml as string, {
        numero: (n.numero as string | null) ?? null,
        serie: (n.serie as string | null) ?? null,
        participante: (n.emitente_nome as string | null) ?? null,
        participanteCnpj: soDigitos(n.emitente_cnpj) || null,
        valorNf: Number(n.valor ?? 0),
      })
    }
    feitas++
  }
  return Math.max(pendentesSaida.length + pendentesEntrada.length - feitas, 0)
}

// ---------- apuração do filtro ----------

interface Filtros {
  de: string
  ate: string
  origem: 'saida' | 'entrada' | null
  cfop: string
  q: string
  impostos: Imposto[]
  pagina: number
  limite: number
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

// Quanto o valor pesa no saldo (a recolher): débito soma, crédito abate, e os estornos fazem o inverso.
const pesoNoSaldo = (efeito: Efeito, valor: number) =>
  efeito === 'debito' || efeito === 'estorno_credito' ? valor : efeito === 'credito' || efeito === 'estorno_debito' ? -valor : 0

const fechar = (t: Totais) => {
  const debito = arredonda2(t.debito - t.estornoDebito)
  const credito = arredonda2(t.credito - t.estornoCredito)
  return { debito, credito, saldo: arredonda2(debito - credito), estornoDebito: arredonda2(t.estornoDebito), estornoCredito: arredonda2(t.estornoCredito) }
}

interface TotaisOrigem {
  notas: number
  valorNf: number
  valorProdutos: number
  icms: number
  ipi: number
  pis: number
  cofins: number
  cbs: number
  ibs: number
}
const zeraOrigem = (): TotaisOrigem => ({ notas: 0, valorNf: 0, valorProdutos: 0, icms: 0, ipi: 0, pis: 0, cofins: 0, cbs: 0, ibs: 0 })
const fechaOrigem = (t: TotaisOrigem): TotaisOrigem => ({
  notas: t.notas,
  valorNf: arredonda2(t.valorNf),
  valorProdutos: arredonda2(t.valorProdutos),
  icms: arredonda2(t.icms),
  ipi: arredonda2(t.ipi),
  pis: arredonda2(t.pis),
  cofins: arredonda2(t.cofins),
  cbs: arredonda2(t.cbs),
  ibs: arredonda2(t.ibs),
})

async function apurar(supabase: SupabaseClient, f: Filtros) {
  const regras = await carregarRegras(supabase)
  const busca = f.q.replace(/[%*,()\\]/g, ' ').replace(/\s+/g, ' ').trim()
  const digitos = soDigitos(busca)
  const itens = await lerTudo<Linha>((a, b) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from('impostometro_itens')
      .select(
        'origem, chave, n_item, cfop, v_prod, v_icms, v_ipi, v_pis, v_cofins, v_cbs, v_ibs, impostometro_notas!inner(data_emissao, cancelada, numero, serie, participante, participante_cnpj, valor_nf)'
      )
      .gte('impostometro_notas.data_emissao', f.de)
      .lte('impostometro_notas.data_emissao', f.ate)
      .eq('impostometro_notas.cancelada', false)
    if (f.origem) q = q.eq('origem', f.origem)
    if (f.cfop) q = q.like('cfop', `${f.cfop}%`)
    // Filtro por imposto: só os itens que têm valor em algum dos impostos escolhidos.
    if (f.impostos.length > 0) q = q.or(f.impostos.map((i) => `${COLUNA_IMPOSTO[i]}.gt.0`).join(','))
    if (busca) {
      const partes = [`numero.ilike.%${busca}%`, `participante.ilike.%${busca}%`]
      if (digitos.length >= 3) partes.push(`participante_cnpj.ilike.%${digitos}%`)
      if (/^\d{44}$/.test(busca)) partes.push(`chave.eq.${busca}`)
      q = q.or(partes.join(','), { referencedTable: 'impostometro_notas' })
    }
    return q.order('chave').order('n_item').range(a, b)
  })

  const icms: Totais = { debito: 0, credito: 0, estornoDebito: 0, estornoCredito: 0 }
  const ipi: Totais = { debito: 0, credito: 0, estornoDebito: 0, estornoCredito: 0 }
  const cbsIbs = { debitoCbs: 0, debitoIbs: 0, creditoCbs: 0, creditoIbs: 0, notasComGrupo: new Set<string>() }
  const tot = { saida: zeraOrigem(), entrada: zeraOrigem() }
  const vistas = new Set<string>()
  const porCfop = new Map<string, { origem: string; cfop: string; itens: number; icms: number; ipi: number; efeitoIcms: Efeito; efeitoIpi: Efeito; comRegra: boolean }>()
  const porNota = new Map<string, Linha>()

  for (const i of itens) {
    const origem = i.origem as 'saida' | 'entrada'
    const cfop = (i.cfop as string | null) ?? '----'
    const regra = regras.get(cfop)
    const efeitoIcms = regra?.icms ?? efeitoPadrao(origem)
    const efeitoIpi = regra?.ipi ?? efeitoPadrao(origem)
    const vIcms = Number(i.v_icms)
    const vIpi = Number(i.v_ipi)
    somaEfeito(icms, efeitoIcms, vIcms)
    somaEfeito(ipi, efeitoIpi, vIpi)

    const nota = i.impostometro_notas as Linha
    const kNota = `${origem}:${i.chave}`
    const t = tot[origem]
    if (!vistas.has(kNota)) {
      vistas.add(kNota)
      t.notas++
      t.valorNf += Number(nota.valor_nf ?? 0)
    }
    t.valorProdutos += Number(i.v_prod)
    t.icms += vIcms
    t.ipi += vIpi
    t.pis += Number(i.v_pis)
    t.cofins += Number(i.v_cofins)
    t.cbs += Number(i.v_cbs)
    t.ibs += Number(i.v_ibs)

    if (Number(i.v_cbs) || Number(i.v_ibs)) {
      cbsIbs.notasComGrupo.add(kNota)
      if (origem === 'saida') {
        cbsIbs.debitoCbs += Number(i.v_cbs)
        cbsIbs.debitoIbs += Number(i.v_ibs)
      } else {
        cbsIbs.creditoCbs += Number(i.v_cbs)
        cbsIbs.creditoIbs += Number(i.v_ibs)
      }
    }

    const kCfop = `${origem}:${cfop}`
    const linhaCfop = porCfop.get(kCfop) ?? { origem, cfop, itens: 0, icms: 0, ipi: 0, efeitoIcms, efeitoIpi, comRegra: !!regra }
    linhaCfop.itens++
    linhaCfop.icms = arredonda2(linhaCfop.icms + vIcms)
    linhaCfop.ipi = arredonda2(linhaCfop.ipi + vIpi)
    porCfop.set(kCfop, linhaCfop)

    const n = porNota.get(kNota) ?? {
      origem,
      chave: i.chave,
      numero: nota.numero ?? null,
      serie: nota.serie ?? null,
      dataEmissao: nota.data_emissao,
      participante: nota.participante ?? null,
      participanteCnpj: nota.participante_cnpj ?? null,
      valorNf: Number(nota.valor_nf ?? 0),
      cfops: new Set<string>(),
      icms: 0,
      ipi: 0,
      pis: 0,
      cofins: 0,
      cbs: 0,
      ibs: 0,
      icmsNaConta: 0,
      ipiNaConta: 0,
    }
    n.cfops.add(cfop)
    n.icms += vIcms
    n.ipi += vIpi
    n.pis += Number(i.v_pis)
    n.cofins += Number(i.v_cofins)
    n.cbs += Number(i.v_cbs)
    n.ibs += Number(i.v_ibs)
    n.icmsNaConta += pesoNoSaldo(efeitoIcms, vIcms)
    n.ipiNaConta += pesoNoSaldo(efeitoIpi, vIpi)
    porNota.set(kNota, n)
  }

  // PIS e COFINS no Lucro Presumido são cumulativos (sem crédito): estimativa sobre a receita do PERÍODO inteiro,
  // sem o ICMS. Só vale sem filtro de CFOP/busca e quando as vendas estão no filtro.
  const estimativaValida = !f.cfop && !busca && f.origem !== 'entrada' && (f.impostos.length === 0 || f.impostos.includes('pis') || f.impostos.includes('cofins'))
  let pisCofins: Linha
  if (estimativaValida) {
    const notasPeriodo = await lerTudo<Linha>((a, b) =>
      supabase.from('invoices').select('valor, valor_icms, tipo_operacao').eq('excluida', false).eq('afeta_faturamento', true).gte('data_emissao', f.de).lte('data_emissao', f.ate).order('id').range(a, b)
    )
    let receita = 0
    let icmsDaReceita = 0
    for (const n of notasPeriodo) {
      const t = String(n.tipo_operacao).toUpperCase()
      if (t === 'CANCELADA' || t === 'TRANSFERÊNCIA' || t === 'TRANSFERENCIA') continue
      receita += Number(n.valor)
      icmsDaReceita += Number(n.valor_icms ?? 0)
    }
    const base = Math.max(arredonda2(receita - icmsDaReceita), 0)
    pisCofins = {
      valido: true,
      receitaBruta: arredonda2(receita),
      icmsExcluido: arredonda2(icmsDaReceita),
      base,
      pis: arredonda2(base * PIS_CUMULATIVO),
      cofins: arredonda2(base * COFINS_CUMULATIVO),
    }
  } else {
    pisCofins = { valido: false, receitaBruta: 0, icmsExcluido: 0, base: 0, pis: 0, cofins: 0 }
  }

  const lista = Array.from(porCfop.values()).sort((a, b) => Math.abs(b.icms) + Math.abs(b.ipi) - (Math.abs(a.icms) + Math.abs(a.ipi)))
  const notasOrdenadas = Array.from(porNota.values())
    .map((n): Linha => ({
      ...n,
      cfops: Array.from(n.cfops as Set<string>).sort(),
      valorNf: arredonda2(n.valorNf),
      icms: arredonda2(n.icms),
      ipi: arredonda2(n.ipi),
      pis: arredonda2(n.pis),
      cofins: arredonda2(n.cofins),
      cbs: arredonda2(n.cbs),
      ibs: arredonda2(n.ibs),
      icmsNaConta: arredonda2(n.icmsNaConta),
      ipiNaConta: arredonda2(n.ipiNaConta),
    }))
    .sort((a, b) => String(b.dataEmissao).localeCompare(String(a.dataEmissao)) || String(b.numero ?? '').localeCompare(String(a.numero ?? ''), 'pt-BR', { numeric: true }))
  const totalNotas = notasOrdenadas.length
  const inicio = f.pagina * f.limite
  const saida = fechaOrigem(tot.saida)
  const entrada = fechaOrigem(tot.entrada)
  const geral = fechaOrigem({
    notas: tot.saida.notas + tot.entrada.notas,
    valorNf: tot.saida.valorNf + tot.entrada.valorNf,
    valorProdutos: tot.saida.valorProdutos + tot.entrada.valorProdutos,
    icms: tot.saida.icms + tot.entrada.icms,
    ipi: tot.saida.ipi + tot.entrada.ipi,
    pis: tot.saida.pis + tot.entrada.pis,
    cofins: tot.saida.cofins + tot.entrada.cofins,
    cbs: tot.saida.cbs + tot.entrada.cbs,
    ibs: tot.saida.ibs + tot.entrada.ibs,
  })
  return {
    filtros: { de: f.de, ate: f.ate, origem: f.origem, cfop: f.cfop, q: busca, impostos: f.impostos },
    icms: fechar(icms),
    ipi: fechar(ipi),
    totais: { vendas: saida, compras: entrada, geral },
    pisCofins: {
      ...pisCofins,
      observacao: estimativaValida
        ? 'Lucro Presumido: PIS (0,65%) e COFINS (3%) cumulativos, sem crédito nas compras. Estimativa sobre a receita do período, sem o ICMS.'
        : 'A estimativa de PIS e COFINS usa a receita do período inteiro; ela aparece quando não há filtro de CFOP, de busca, de imposto (exceto PIS/COFINS) nem só compras.',
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
    notas: {
      itens: notasOrdenadas.slice(inicio, inicio + f.limite),
      total: totalNotas,
      pagina: f.pagina,
      limite: f.limite,
      totalPaginas: Math.max(Math.ceil(totalNotas / f.limite), 1),
    },
    notasConsideradas: totalNotas,
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

const data = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : null)

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

    // Filtros: período (de/ate, ou o mês), venda/compra, CFOP (prefixo), busca de nota e paginação da lista.
    const um = (k: string) => (typeof req.query[k] === 'string' ? String(req.query[k]) : '')
    const hojeMes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(um('mes')) ? um('mes') : hojeMes
    const [ano, m] = mes.split('-').map(Number)
    const de = data(um('de')) ?? `${mes}-01`
    const ate = data(um('ate')) ?? new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10)
    if (de > ate) {
      res.status(400).json({ erro: 'A data inicial não pode ser depois da data final.' })
      return
    }
    const filtros: Filtros = {
      de,
      ate,
      origem: um('origem') === 'saida' || um('origem') === 'entrada' ? (um('origem') as 'saida' | 'entrada') : null,
      cfop: soDigitos(um('cfop')).slice(0, 4),
      q: um('q').slice(0, 80),
      impostos: um('impostos')
        .split(',')
        .map((i) => i.trim().toLowerCase())
        .filter((i): i is Imposto => (IMPOSTOS as readonly string[]).includes(i)),
      pagina: um('todas') === '1' ? 0 : Math.max(Number(um('pagina')) || 0, 0),
      limite: um('todas') === '1' ? LIMITE_EXPORTAR : Math.min(Math.max(Number(um('limite')) || 25, 1), 100),
    }
    const pendentes = await processarPendentes(supabase, LIMITE_PROCESSAR, Date.now() + 20_000)
    const apuracao = await apurar(supabase, filtros)
    const regras = await carregarRegras(supabase)
    res.status(200).json({
      ...apuracao,
      mes,
      periodo: { de, ate },
      pendentes,
      regime: 'Lucro Presumido',
      geradoEm: new Date().toISOString(),
      regras: Array.from(regras.entries()).map(([cfop, r]) => ({ cfop, efeitoIcms: r.icms, efeitoIpi: r.ipi, descricao: r.descricao })),
    })
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ erro: `Falha no impostômetro: ${descreverErro(e)}` })
  }
}
