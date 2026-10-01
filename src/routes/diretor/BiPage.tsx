import { useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { KpiCard } from '../../components/kpi/KpiCard'
import { EvolucaoFaturamentoChart } from '../../components/bi/EvolucaoFaturamentoChart'
import { BrasilMapaChart } from '../../components/bi/BrasilMapaChart'
import { FaturamentoPorEstadoChart } from '../../components/bi/FaturamentoPorEstadoChart'
import { MaioresClientesCard } from '../../components/bi/MaioresClientesCard'
import { MixTipoOperacaoChart } from '../../components/bi/MixTipoOperacaoChart'
import { FaturamentoPorFilialChart } from '../../components/bi/FaturamentoPorFilialChart'
import { RankingVendedoresCard } from '../../components/bi/RankingVendedoresCard'
import { OperacoesModal } from '../../components/bi/OperacoesModal'
import { FiltrosGlobaisBi } from '../../components/bi/FiltrosGlobaisBi'
import { useAuth } from '../../auth/AuthContext'
import { useBiData, PERIODOS_BI } from '../../hooks/useBiData'
import { useLookups } from '../../hooks/useLookups'
import { formatCurrency } from '../../lib/format'
import { diretorNavItems } from './nav'

// BI estratégico: visão de negócio pro diretor além do mês corrente —
// evolução, geografia, concentração de clientes, mix de operação, filial e
// vendedor — tudo no mesmo recorte de período escolhido aqui (diferente do
// Dashboard operacional, que só corta por mês/ano e é focado no dia a dia).
export function BiPage() {
  const { profile } = useAuth()
  const { vendedores, filiais } = useLookups()
  const {
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
    refetch,
    dataInicio,
    dataFim,
  } = useBiData()
  const [estadoOperacoes, setEstadoOperacoes] = useState<string | null>(null)

  const estadosComDado = [...new Set(porEstado.filter((e) => e.estado).map((e) => e.estado))].sort()
  const tiposComDado = [...new Set(porTipo.filter((t) => t.tipo_operacao).map((t) => t.tipo_operacao))].sort()

  const nfTotalPeriodo = porEstado.reduce((acc, e) => acc + Number(e.nf_count), 0)
  const ticketMedioPeriodo = nfTotalPeriodo > 0 ? faturamentoTotalPeriodo / nfTotalPeriodo : 0

  return (
    <AppShell title="BI Estratégico" navItems={diretorNavItems(profile)} onRefresh={refetch}>
      <div className="mb-lg flex flex-wrap items-center gap-sm">
        {PERIODOS_BI.map(({ chave, label }) => (
          <button
            key={chave}
            type="button"
            onClick={() => setPeriodo(chave)}
            className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
              periodo === chave ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <FiltrosGlobaisBi
        estados={estadosComDado}
        filiais={filiais}
        vendedores={vendedores}
        tipos={tiposComDado}
        estadoFiltro={estadoFiltro}
        filialFiltro={filialFiltro}
        vendedorFiltro={vendedorFiltro}
        tipoFiltro={tipoFiltro}
        onEstadoChange={setEstadoFiltro}
        onFilialChange={setFilialFiltro}
        onVendedorChange={setVendedorFiltro}
        onTipoChange={setTipoFiltro}
      />

      <div className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-3">
        <KpiCard
          label="Faturamento no período"
          value={formatCurrency(faturamentoTotalPeriodo)}
          icon="payments"
          loading={loading}
        />
        <KpiCard label="Notas no período" value={String(nfTotalPeriodo)} icon="receipt_long" loading={loading} />
        <KpiCard
          label="Ticket médio no período"
          value={formatCurrency(ticketMedioPeriodo)}
          icon="sell"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
        <EvolucaoFaturamentoChart data={evolucao} loading={loading} />
        <BrasilMapaChart
          data={porEstado}
          loading={loading}
          estadoSelecionado={estadoFiltro}
          onSelecionarEstado={(estado) => {
            setEstadoFiltro(estado)
            setEstadoOperacoes(estado)
          }}
        />
        <FaturamentoPorEstadoChart
          data={porEstado}
          loading={loading}
          estadoSelecionado={estadoFiltro}
          onSelecionarEstado={setEstadoFiltro}
          onVerOperacoes={setEstadoOperacoes}
        />
        <MaioresClientesCard
          data={topClientes}
          loading={loading}
          estadoFiltro={estadoFiltro}
          faturamentoTotalPeriodo={faturamentoTotalPeriodo}
        />
        <MixTipoOperacaoChart data={porTipo} loading={loading} />
        <FaturamentoPorFilialChart data={porFilial} loading={loading} />
        <RankingVendedoresCard data={porVendedor} loading={loading} />
      </div>
      {estadoOperacoes && (
        <OperacoesModal
          estado={estadoOperacoes}
          dataInicio={dataInicio}
          dataFim={dataFim}
          filialFiltro={filialFiltro}
          vendedorFiltro={vendedorFiltro}
          tipoFiltro={tipoFiltro}
          onClose={() => setEstadoOperacoes(null)}
        />
      )}
    </AppShell>
  )
}
