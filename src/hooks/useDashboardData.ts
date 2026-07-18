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
}

const EMPTY_KPIS: Kpis = { faturamento: 0, nf_count: 0, clientes: 0, ticket_medio: 0, a_faturar: 0 }

const now = new Date()

export function useDashboardData() {
  const [filters, setFilters] = useState<DashboardFilters>({
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
  const [crescimentoPct, setCrescimentoPct] = useState<number | null>(null)
  const [meta, setMeta] = useState(0)
  const [ranking, setRanking] = useState<RankingRow[]>([])
  const [participacao, setParticipacao] = useState<FilialRow[]>([])
  const [hourly, setHourly] = useState<HourlyPoint[]>([])
  const [feed, setFeed] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  const rpcParams = useMemo(
    () => ({
      p_mes: filters.mes,
      p_ano: filters.ano,
      p_filial_id: filters.filialId,
      p_estado: filters.estado,
      p_tipo_operacao: filters.tipoOperacao,
      p_vendedor_id: filters.vendedorId,
      p_meio_pagamento: filters.meioPagamento,
      p_cliente: filters.clienteSearch,
    }),
    [filters]
  )

  const load = useCallback(async () => {
    setLoading(true)

    const [kpisRes, prevYearRes, rankingRes, participacaoRes, hourlyRes, metaRes, feedRes] = await Promise.all([
      supabase.rpc('dashboard_kpis', rpcParams),
      filters.ano
        ? supabase.rpc('dashboard_kpis', { ...rpcParams, p_ano: filters.ano - 1 })
        : Promise.resolve({ data: null, error: null }),
      supabase.rpc('dashboard_ranking_vendedores', { p_mes: filters.mes, p_ano: filters.ano }),
      supabase.rpc('dashboard_participacao_filiais', { p_mes: filters.mes, p_ano: filters.ano }),
      supabase.rpc('dashboard_faturamento_por_hora', { p_data: new Date().toISOString().slice(0, 10) }),
      loadMeta(filters.filialId, filters.mes, filters.ano),
      loadFeed(filters),
    ])

    const currentKpis = (kpisRes.data?.[0] as Kpis) ?? EMPTY_KPIS
    setKpis(currentKpis)

    const prevFaturamento = prevYearRes?.data?.[0]?.faturamento ?? 0
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  return { filters, setFilters, kpis, crescimentoPct, meta, ranking, participacao, hourly, feed, loading, refetch: load }
}

async function loadMeta(filialId: string | null, mes: number | null, ano: number | null): Promise<number> {
  let query = supabase.from('metas').select('valor_meta')
  if (filialId) query = query.eq('filial_id', filialId)
  if (mes) query = query.eq('mes', mes)
  if (ano) query = query.eq('ano', ano)
  const { data } = await query
  return (data ?? []).reduce((sum, r) => sum + Number(r.valor_meta), 0)
}

async function loadFeed(filters: DashboardFilters): Promise<Invoice[]> {
  let query = supabase
    .from('invoices')
    .select('*, filiais(nome), vendedores(nome)')
    .order('created_at', { ascending: false })
    .limit(50)

  const ano = filters.ano ?? now.getFullYear()
  if (filters.mes) {
    const start = `${ano}-${String(filters.mes).padStart(2, '0')}-01`
    const end = new Date(ano, filters.mes, 0).toISOString().slice(0, 10) // last day of month
    query = query.gte('data_emissao', start).lte('data_emissao', end)
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
  return (data as Invoice[]) ?? []
}
