import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { DashboardFilters, Invoice } from '../types/domain'
import type { HourlyPoint } from '../components/charts/HourlyBarChart'
import type { RankingRow } from '../components/charts/VendedorRanking'
import type { FilialRow } from '../components/charts/FilialDonut'

interface Kpis {
  faturamento: number
  nf_count: number
  clientes: number
  ticket_medio: number
  a_faturar: number
  transferencias: number
}

export interface TransferenciaPorFilial {
  filialId: string
  valor: number
}

const EMPTY_KPIS: Kpis = { faturamento: 0, nf_count: 0, clientes: 0, ticket_medio: 0, a_faturar: 0, transferencias: 0 }

function isTransferenciaTipo(tipoOperacao: string | null | undefined): boolean {
  const upper = tipoOperacao?.toUpperCase() ?? ''
  return upper === 'TRANSFERÊNCIA' || upper === 'TRANSFERENCIA'
}

const now = new Date()

export function useDashboardData() {
  const [filters, setFilters] = useState<DashboardFilters>({
    dia: null,
    mes: now.getMonth() + 1,
    ano: now.getFullYear(),
    filialId: null,
    estado: null,
    tipoOperacao: null,
    vendedorId: null,
    meioPagamento: null,
    clienteSearch: null,
  })

  const [kpis, setKpis] = useState<Kpis>(EMPTY_KPIS)
  const [transferenciasPorFilial, setTransferenciasPorFilial] = useState<TransferenciaPorFilial[]>([])
  const [crescimentoPct, setCrescimentoPct] = useState<number | null>(null)
  const [meta, setMeta] = useState(0)
  const [ranking, setRanking] = useState<RankingRow[]>([])
  const [participacao, setParticipacao] = useState<FilialRow[]>([])
  const [hourly, setHourly] = useState<HourlyPoint[]>([])
  const [feed, setFeed] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [dailyFaturamento, setDailyFaturamento] = useState<Record<number, number>>({})

  const rpcParams = useMemo(() => {
    const params: Record<string, any> = {
      p_mes: filters.mes,
      p_ano: filters.ano,
    }
    if (filters.filialId) params.p_filial_id = filters.filialId
    if (filters.estado) params.p_estado = filters.estado
    if (filters.tipoOperacao) params.p_tipo_operacao = filters.tipoOperacao
    if (filters.vendedorId) params.p_vendedor_id = filters.vendedorId
    if (filters.meioPagamento) params.p_meio_pagamento = filters.meioPagamento
    if (filters.clienteSearch) params.p_cliente = filters.clienteSearch
    return params
  }, [filters])

  const load = useCallback(async () => {
    setLoading(true)

    // Construir query manual para buscar todas as notas do período e calcular os KPIs no frontend
    // Isso evita qualquer problema de overload ou tipagem no Supabase RPC
    // Não filtra por afeta_faturamento aqui: transferências têm afeta_faturamento
    // = false (não somam no faturamento) mas ainda precisam vir na consulta pra
    // alimentar o bucket "transferências" exibido embaixo do KPI de Faturamento.
    let kpisQuery = supabase
      .from('invoices')
      .select('valor, cliente, valor_a_faturar, tipo_operacao, filial_destino_id, afeta_faturamento')
      .neq('tipo_operacao', 'Cancelada')

    if (filters.ano) {
      if (filters.mes) {
        if (filters.dia) {
          const dayStr = `${filters.ano}-${String(filters.mes).padStart(2, '0')}-${String(filters.dia).padStart(2, '0')}`
          kpisQuery = kpisQuery.gte('data_emissao', dayStr).lte('data_emissao', dayStr)
        } else {
          const start = `${filters.ano}-${String(filters.mes).padStart(2, '0')}-01`
          const end = new Date(filters.ano, filters.mes, 0).toISOString().slice(0, 10)
          kpisQuery = kpisQuery.gte('data_emissao', start).lte('data_emissao', end)
        }
      } else {
        kpisQuery = kpisQuery.gte('data_emissao', `${filters.ano}-01-01`).lte('data_emissao', `${filters.ano}-12-31`)
      }
    }
    if (filters.filialId) kpisQuery = kpisQuery.eq('filial_id', filters.filialId)
    if (filters.estado) kpisQuery = kpisQuery.eq('estado', filters.estado)
    if (filters.tipoOperacao) kpisQuery = kpisQuery.eq('tipo_operacao', filters.tipoOperacao)
    if (filters.vendedorId) kpisQuery = kpisQuery.eq('vendedor_id', filters.vendedorId)
    if (filters.meioPagamento) kpisQuery = kpisQuery.eq('meio_pagamento', filters.meioPagamento)
    if (filters.clienteSearch) kpisQuery = kpisQuery.ilike('cliente', `%${filters.clienteSearch}%`)

    // Query para o ano anterior (se houver filtro de ano)
    let prevKpisQuery = null
    if (filters.ano) {
      prevKpisQuery = supabase.from('invoices').select('valor, tipo_operacao, afeta_faturamento')
        .neq('tipo_operacao', 'Cancelada')
      if (filters.mes) {
        if (filters.dia) {
          const dayStr = `${filters.ano - 1}-${String(filters.mes).padStart(2, '0')}-${String(filters.dia).padStart(2, '0')}`
          prevKpisQuery = prevKpisQuery.gte('data_emissao', dayStr).lte('data_emissao', dayStr)
        } else {
          const start = `${filters.ano - 1}-${String(filters.mes).padStart(2, '0')}-01`
          const end = new Date(filters.ano - 1, filters.mes, 0).toISOString().slice(0, 10)
          prevKpisQuery = prevKpisQuery.gte('data_emissao', start).lte('data_emissao', end)
        }
      } else {
        prevKpisQuery = prevKpisQuery.gte('data_emissao', `${filters.ano - 1}-01-01`).lte('data_emissao', `${filters.ano - 1}-12-31`)
      }
      if (filters.filialId) prevKpisQuery = prevKpisQuery.eq('filial_id', filters.filialId)
      if (filters.estado) prevKpisQuery = prevKpisQuery.eq('estado', filters.estado)
      if (filters.tipoOperacao) prevKpisQuery = prevKpisQuery.eq('tipo_operacao', filters.tipoOperacao)
      if (filters.vendedorId) prevKpisQuery = prevKpisQuery.eq('vendedor_id', filters.vendedorId)
      if (filters.meioPagamento) prevKpisQuery = prevKpisQuery.eq('meio_pagamento', filters.meioPagamento)
      if (filters.clienteSearch) prevKpisQuery = prevKpisQuery.ilike('cliente', `%${filters.clienteSearch}%`)
    }

    // Pegar a data de hoje no fuso horário local para o gráfico por hora
    const todayLocal = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

    // Faturamento por dia do mês inteiro, sempre — independente do filtro de
    // dia selecionado — para alimentar as barrinhas do seletor de dias.
    let dailyQuery = null
    if (filters.mes && filters.ano) {
      let q = supabase
        .from('invoices')
        .select('valor, data_emissao')
        .neq('tipo_operacao', 'Cancelada')
        .eq('afeta_faturamento', true)
        .gte('data_emissao', `${filters.ano}-${String(filters.mes).padStart(2, '0')}-01`)
        .lte('data_emissao', new Date(filters.ano, filters.mes, 0).toISOString().slice(0, 10))
      if (filters.filialId) q = q.eq('filial_id', filters.filialId)
      if (filters.estado) q = q.eq('estado', filters.estado)
      if (filters.tipoOperacao) q = q.eq('tipo_operacao', filters.tipoOperacao)
      if (filters.vendedorId) q = q.eq('vendedor_id', filters.vendedorId)
      if (filters.meioPagamento) q = q.eq('meio_pagamento', filters.meioPagamento)
      if (filters.clienteSearch) q = q.ilike('cliente', `%${filters.clienteSearch}%`)
      dailyQuery = q
    }

    const [kpisRes, prevYearRes, rankingRes, participacaoRes, hourlyRes, metaRes, feedRes, dailyRes] = await Promise.all([
      kpisQuery,
      prevKpisQuery ? prevKpisQuery : Promise.resolve({ data: null, error: null }),
      supabase.rpc('dashboard_ranking_vendedores', { p_mes: filters.mes, p_ano: filters.ano }),
      supabase.rpc('dashboard_participacao_filiais', { p_mes: filters.mes, p_ano: filters.ano }),
      supabase.rpc('dashboard_faturamento_por_hora', { p_data: todayLocal }),
      loadMeta(filters.filialId, filters.mes, filters.ano),
      loadFeed(filters),
      dailyQuery ? dailyQuery : Promise.resolve({ data: null, error: null }),
    ])

    // Calcular KPIs no frontend
    const invs = kpisRes.data || []
    const faturamento = invs.reduce((acc, i) => {
      if (!i.afeta_faturamento) return acc
      return acc + Number(i.valor)
    }, 0)
    const transferencias = invs.reduce((acc, i) => {
      if (isTransferenciaTipo(i.tipo_operacao)) return acc + Number(i.valor)
      return acc
    }, 0)
    const a_faturar = invs.reduce((acc, i) => acc + Number(i.valor_a_faturar), 0)
    const nf_count = invs.length
    const clientesSet = new Set(invs.map(i => i.cliente))
    const clientes = clientesSet.size
    const ticket_medio = nf_count > 0 ? faturamento / nf_count : 0

    const currentKpis: Kpis = { faturamento, nf_count, clientes, ticket_medio, a_faturar, transferencias }
    setKpis(currentKpis)

    // Transferências agrupadas pela filial de destino, para o resumo "por filial".
    const transferenciasMap = new Map<string, number>()
    for (const i of invs) {
      if (!isTransferenciaTipo(i.tipo_operacao)) continue
      const destino = i.filial_destino_id as string | null
      if (!destino) continue
      transferenciasMap.set(destino, (transferenciasMap.get(destino) ?? 0) + Number(i.valor))
    }
    setTransferenciasPorFilial(
      Array.from(transferenciasMap, ([filialId, valor]) => ({ filialId, valor })).sort((a, b) => b.valor - a.valor)
    )

    const prevInvs = prevYearRes?.data || []
    const prevFaturamento = prevInvs.reduce((acc, i) => {
      if (!i.afeta_faturamento) return acc
      return acc + Number(i.valor)
    }, 0)
    if (prevFaturamento > 0) {
      setCrescimentoPct(((currentKpis.faturamento - prevFaturamento) / prevFaturamento) * 100)
    } else {
      setCrescimentoPct(null)
    }

    setRanking((rankingRes.data as RankingRow[]) ?? [])
    setParticipacao((participacaoRes.data as FilialRow[]) ?? [])
    setHourly((hourlyRes.data as HourlyPoint[]) ?? [])
    setMeta(metaRes)
    setFeed(feedRes)

    const dailyMap: Record<number, number> = {}
    for (const r of (dailyRes?.data as { valor: number; data_emissao: string }[] | null) ?? []) {
      const dia = Number(r.data_emissao.slice(8, 10))
      dailyMap[dia] = (dailyMap[dia] ?? 0) + Number(r.valor)
    }
    setDailyFaturamento(dailyMap)

    setLoading(false)
  }, [filters, rpcParams])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('invoices-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoices' }, () => {
        load()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'invoices' }, () => {
        load()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  return {
    filters,
    setFilters,
    kpis,
    transferenciasPorFilial,
    crescimentoPct,
    meta,
    ranking,
    participacao,
    hourly,
    feed,
    loading,
    dailyFaturamento,
    refetch: load,
  }
}

async function loadMeta(filialId: string | null, mes: number | null, ano: number | null): Promise<number> {
  // Sem mês/ano definidos não há período de meta a comparar.
  if (!mes || !ano) return 0

  // Filial específica selecionada → usa a meta daquela filial.
  if (filialId) {
    const { data } = await supabase
      .from('metas')
      .select('valor_meta')
      .eq('filial_id', filialId)
      .eq('mes', mes)
      .eq('ano', ano)
      .maybeSingle()
    return data ? Number(data.valor_meta) : 0
  }

  // Sem filtro de filial → prefere a meta global (filial_id NULL); se não
  // existir, soma as metas por filial do período.
  const { data: global } = await supabase
    .from('metas')
    .select('valor_meta')
    .is('filial_id', null)
    .eq('mes', mes)
    .eq('ano', ano)
    .maybeSingle()
  if (global) return Number(global.valor_meta)

  const { data: porFilial } = await supabase
    .from('metas')
    .select('valor_meta')
    .not('filial_id', 'is', null)
    .eq('mes', mes)
    .eq('ano', ano)
  return (porFilial ?? []).reduce((sum, r) => sum + Number(r.valor_meta), 0)
}

async function loadFeed(filters: DashboardFilters): Promise<Invoice[]> {
  let query = supabase
    .from('invoices')
    // invoices tem 2 FKs pra filiais (filial_id e filial_destino_id) — sem o
    // "!filial_id" o PostgREST não sabe qual delas usar e a query inteira falha.
    .select('*, filiais!filial_id(nome), vendedores(nome)')
    .order('data_emissao', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000)

  const ano = filters.ano ?? now.getFullYear()
  if (filters.mes) {
    if (filters.dia) {
      const dayStr = `${ano}-${String(filters.mes).padStart(2, '0')}-${String(filters.dia).padStart(2, '0')}`
      query = query.gte('data_emissao', dayStr).lte('data_emissao', dayStr)
    } else {
      const start = `${ano}-${String(filters.mes).padStart(2, '0')}-01`
      const end = new Date(ano, filters.mes, 0).toISOString().slice(0, 10) // last day of month
      query = query.gte('data_emissao', start).lte('data_emissao', end)
    }
  } else if (filters.ano) {
    query = query.gte('data_emissao', `${ano}-01-01`).lte('data_emissao', `${ano}-12-31`)
  }
  if (filters.filialId) query = query.eq('filial_id', filters.filialId)
  if (filters.estado) query = query.eq('estado', filters.estado)
  if (filters.tipoOperacao) query = query.eq('tipo_operacao', filters.tipoOperacao)
  if (filters.vendedorId) query = query.eq('vendedor_id', filters.vendedorId)
  if (filters.meioPagamento) query = query.eq('meio_pagamento', filters.meioPagamento)
  if (filters.clienteSearch) query = query.ilike('cliente', `%${filters.clienteSearch}%`)

  const { data, error } = await query
  if (error) {
    console.error('Falha ao carregar feed de notas:', error.message)
    return []
  }

  // Ordena pelo número da NF (mais nova/maior no topo, mais antiga/menor
  // embaixo) — a data/hora de lançamento no app não garante a sequência real,
  // já que uma nota pode ser cadastrada fora de ordem.
  const rows = (data as Invoice[]) ?? []
  rows.sort((a, b) => {
    const na = Number(a.numero_nf)
    const nb = Number(b.numero_nf)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na
    return b.numero_nf.localeCompare(a.numero_nf)
  })
  return rows
}
