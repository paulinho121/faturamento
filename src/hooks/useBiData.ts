import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EvolucaoPonto } from '../components/bi/EvolucaoFaturamentoChart'
import type { EstadoLinha } from '../components/bi/FaturamentoPorEstadoChart'
import type { ClienteLinha } from '../components/bi/MaioresClientesCard'
import type { TipoLinha } from '../components/bi/MixTipoOperacaoChart'
import type { FilialLinha } from '../components/bi/FaturamentoPorFilialChart'
import type { VendedorLinha } from '../components/bi/RankingVendedoresCard'

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
  // "Últimos N meses" conta N meses FECHADOS (não inclui o mês corrente, que
  // já tem o botão "Mês atual" pra isso) — logo no início de um mês novo,
  // incluir o mês corrente quase vazio no lugar de um mês fechado fazia a
  // janela parecer bem menor do que o faturamento real do período.
  const fimMesAnterior = paraIso(new Date(ano, hoje.getMonth(), 0))
  switch (periodo) {
    case 'mes_atual':
      return { inicio: paraIso(new Date(ano, hoje.getMonth(), 1)), fim }
    case 'ultimos_3m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 3, 1)), fim: fimMesAnterior }
    case 'ultimos_6m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 6, 1)), fim: fimMesAnterior }
    case 'ultimos_12m':
      return { inicio: paraIso(new Date(ano, hoje.getMonth() - 12, 1)), fim: fimMesAnterior }
    case 'ano_atual':
      return { inicio: `${ano}-01-01`, fim }
    case 'ano_anterior':
      return { inicio: `${ano - 1}-01-01`, fim: `${ano - 1}-12-31` }
  }
}

// BI estratégico do diretor: evolução no tempo (sempre 12 meses, pra dar
// contexto de tendência independente do período escolhido pros outros
// cortes), faturamento por estado, maiores clientes, mix por tipo de
// operação, filial e vendedor — tudo recortável pelos filtros globais
// (estado/filial/vendedor/tipo). Cada painel que É o dono de uma dessas
// dimensões não recebe o próprio filtro na sua chamada (só os outros três),
// senão o gráfico colapsaria pra uma barra só ao selecionar aquela dimensão
// nele mesmo — ele só fica destacado/filtrado visualmente (estadoSelecionado
// etc.), não resumido a uma linha.
export function useBiData() {
  const [periodo, setPeriodoState] = useState<BiPeriodo>('ultimos_12m')
  // Sobrescritas manuais de data início/fim — permitem ao diretor refinar o
  // período além dos presets (ex: pegar "Últimos 3 meses" e encurtar só o
  // fim). Clicar num preset limpa as duas; editar uma data só sobrescreve
  // aquele lado, mantendo o outro vindo do preset ativo.
  const [inicioOverride, setInicioOverride] = useState<string | null>(null)
  const [fimOverride, setFimOverride] = useState<string | null>(null)
  const [estadoFiltro, setEstadoFiltro] = useState<string | null>(null)
  const [filialFiltro, setFilialFiltro] = useState<string | null>(null)
  const [vendedorFiltro, setVendedorFiltro] = useState<string | null>(null)
  const [tipoFiltro, setTipoFiltro] = useState<string | null>(null)
  const [evolucao, setEvolucao] = useState<EvolucaoPonto[]>([])
  const [porEstado, setPorEstado] = useState<EstadoLinha[]>([])
  const [topClientes, setTopClientes] = useState<ClienteLinha[]>([])
  const [porTipo, setPorTipo] = useState<TipoLinha[]>([])
  const [porFilial, setPorFilial] = useState<FilialLinha[]>([])
  const [porVendedor, setPorVendedor] = useState<VendedorLinha[]>([])
  const [loading, setLoading] = useState(true)

  const presetInterval = intervaloDe(periodo)
  const inicio = inicioOverride ?? presetInterval.inicio
  const fim = fimOverride ?? presetInterval.fim

  function setPeriodo(p: BiPeriodo) {
    setPeriodoState(p)
    setInicioOverride(null)
    setFimOverride(null)
  }

  async function load() {
    setLoading(true)
    const [evolucaoRes, estadoRes, clientesRes, tipoRes, filialRes, vendedorRes] = await Promise.all([
      supabase.rpc('bi_evolucao_mensal', {
        p_meses: 12,
        p_estado: estadoFiltro,
        p_filial_id: filialFiltro,
        p_vendedor_id: vendedorFiltro,
        p_tipo_operacao: tipoFiltro,
      }),
      supabase.rpc('bi_faturamento_por_estado', {
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_filial_id: filialFiltro,
        p_vendedor_id: vendedorFiltro,
        p_tipo_operacao: tipoFiltro,
      }),
      supabase.rpc('bi_top_clientes', {
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_estado: estadoFiltro,
        p_filial_id: filialFiltro,
        p_vendedor_id: vendedorFiltro,
        p_tipo_operacao: tipoFiltro,
        p_limit: 15,
      }),
      supabase.rpc('bi_faturamento_por_tipo', {
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_estado: estadoFiltro,
        p_filial_id: filialFiltro,
        p_vendedor_id: vendedorFiltro,
      }),
      supabase.rpc('bi_faturamento_por_filial', {
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_estado: estadoFiltro,
        p_vendedor_id: vendedorFiltro,
        p_tipo_operacao: tipoFiltro,
      }),
      supabase.rpc('bi_faturamento_por_vendedor', {
        p_data_inicio: inicio,
        p_data_fim: fim,
        p_estado: estadoFiltro,
        p_filial_id: filialFiltro,
        p_tipo_operacao: tipoFiltro,
        p_limit: 15,
      }),
    ])
    setEvolucao((evolucaoRes.data as EvolucaoPonto[]) ?? [])
    setPorEstado((estadoRes.data as EstadoLinha[]) ?? [])
    setTopClientes((clientesRes.data as ClienteLinha[]) ?? [])
    setPorTipo((tipoRes.data as TipoLinha[]) ?? [])
    setPorFilial((filialRes.data as FilialLinha[]) ?? [])
    setPorVendedor((vendedorRes.data as VendedorLinha[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fim, estadoFiltro, filialFiltro, vendedorFiltro, tipoFiltro])

  const faturamentoTotalPeriodo = porEstado.reduce((acc, e) => acc + Number(e.faturamento), 0)

  return {
    periodo,
    setPeriodo,
    estadoFiltro,
    setEstadoFiltro,
    filialFiltro,
    setFilialFiltro,
    vendedorFiltro,
    setVendedorFiltro,
    tipoFiltro,
    setTipoFiltro,
    evolucao,
    porEstado,
    topClientes,
    porTipo,
    porFilial,
    porVendedor,
    faturamentoTotalPeriodo,
    loading,
    refetch: load,
    dataInicio: inicio,
    dataFim: fim,
    setDataInicio: setInicioOverride,
    setDataFim: setFimOverride,
  }
}
