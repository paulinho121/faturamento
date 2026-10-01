import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EvolucaoPonto } from '../components/bi/EvolucaoFaturamentoChart'
import type { EstadoLinha } from '../components/bi/FaturamentoPorEstadoChart'
import type { ClienteLinha } from '../components/bi/MaioresClientesCard'
import type { TipoLinha } from '../components/bi/MixTipoOperacaoChart'

export type BiPeriodo = 'mes_atual' | 'ultimos_3m' | 'ultimos_6m' | 'ultimos_12m' | 'ano_atual' | 'ano_anterior'

export const PERIODOS_BI: { chave: BiPeriodo; label: string }[] = [
  { chave: 'mes_atual', label: 'Mês atual' },
  { chave: 'ultimos_3m', label: 'Últimos 3 meses' },
  { chave: 'ultimos_6m', label: 'Últimos 6 meses' },
  { chave: 'ultimos_12m', label: 'Últimos 12 meses' },
  { chave: 'ano_atual', label: 'Ano atual' },
  { chave: 'ano_anterior', label: 'Ano anterior' },
]

function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function intervaloDe(periodo: BiPeriodo): { inicio: string; fim: string } {
  const hoje = new Date()
  const fim = paraIso(hoje)
  const ano = hoje.getFullYear()
  switch (periodo) {
    case 'mes_atual':
      return { inicio: paraIso(new Date(ano, hoje.getMonth(), 1)), fim }
    case 'ultimos_3m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 2, 1)), fim }
    case 'ultimos_6m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 5, 1)), fim }
    case 'ultimos_12m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 11, 1)), fim }
    case 'ano_atual':
      return { inicio: `${ano}-01-01`, fim }
    case 'ano_anterior':
      return { inicio: `${ano - 1}-01-01`, fim: `${ano - 1}-12-31` }
  }
}

// BI estratégico do diretor: evolução no tempo (sempre 12 meses, pra dar
// contexto de tendência independente do período escolhido pros outros
// cortes), faturamento por estado, maiores clientes (opcionalmente filtrado
// pelo estado clicado) e mix por tipo de operação.
export function useBiData() {
  const [periodo, setPeriodo] = useState<BiPeriodo>('ultimos_12m')
  const [estadoFiltro, setEstadoFiltro] = useState<string | null>(null)
  const [evolucao, setEvolucao] = useState<EvolucaoPonto[]>([])
  const [porEstado, setPorEstado] = useState<EstadoLinha[]>([])
  const [topClientes, setTopClientes] = useState<ClienteLinha[]>([])
  const [porTipo, setPorTipo] = useState<TipoLinha[]>([])
  const [loading, setLoading] = useState(true)

  const { inicio, fim } = intervaloDe(periodo)

  async function load() {
    setLoading(true)
    const [evolucaoRes, estadoRes, clientesRes, tipoRes] = await Promise.all([
      supabase.rpc('bi_evolucao_mensal', { p_meses: 12 }),
      supabase.rpc('bi_faturamento_por_estado', { p_data_inicio: inicio, p_data_fim: fim }),
      supabase.rpc('bi_top_clientes', { p_data_inicio: inicio, p_data_fim: fim, p_estado: estadoFiltro, p_limit: 15 }),
      supabase.rpc('bi_faturamento_por_tipo', { p_data_inicio: inicio, p_data_fim: fim }),
    ])
    setEvolucao((evolucaoRes.data as EvolucaoPonto[]) ?? [])
    setPorEstado((estadoRes.data as EstadoLinha[]) ?? [])
    setTopClientes((clientesRes.data as ClienteLinha[]) ?? [])
    setPorTipo((tipoRes.data as TipoLinha[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, estadoFiltro])

  const faturamentoTotalPeriodo = porEstado.reduce((acc, e) => acc + Number(e.faturamento), 0)

  return {
    periodo,
    setPeriodo,
    estadoFiltro,
    setEstadoFiltro,
    evolucao,
    porEstado,
    topClientes,
    porTipo,
    faturamentoTotalPeriodo,
    loading,
    refetch: load,
    dataInicio: inicio,
    dataFim: fim,
  }
}
