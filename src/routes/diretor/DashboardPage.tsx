import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { FilterBar } from '../../components/filters/FilterBar'
import { KpiCard } from '../../components/kpi/KpiCard'
import { HourlyBarChart } from '../../components/charts/HourlyBarChart'
import { VendedorRanking } from '../../components/charts/VendedorRanking'
import { FilialDonut } from '../../components/charts/FilialDonut'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useLookups } from '../../hooks/useLookups'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatTime } from '../../lib/format'
import { downloadCsv, invoicesToCsv } from '../../lib/csv'

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
]

export function DashboardPage() {
  const { filters, setFilters, kpis, crescimentoPct, meta, ranking, participacao, hourly, feed, loading } =
    useDashboardData()
  const { vendedores, filiais, tiposOperacao, meiosPagamento } = useLookups()
  const { push } = useToast()

  const [pulse, setPulse] = useState(false)
  const prevFeedIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    const currentIds = new Set(feed.map((i) => i.id))
    const previous = prevFeedIds.current
    if (previous) {
      const newest = feed.find((i) => !previous.has(i.id))
      if (newest) {
        setPulse(true)
        push('success', `Nova NF #${newest.numero_nf} · ${formatCurrency(newest.valor)}`)
        const t = setTimeout(() => setPulse(false), 1200)
        prevFeedIds.current = currentIds
        return () => clearTimeout(t)
      }
    }
    prevFeedIds.current = currentIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed])

  const metaProgress = meta > 0 ? Math.min(100, Math.round((kpis.faturamento / meta) * 100)) : null
  const circumference = 2 * Math.PI * 32

  return (
    <AppShell title="Bom dia, Diretor" navItems={NAV_ITEMS}>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        filiais={filiais}
        vendedores={vendedores}
        tiposOperacao={tiposOperacao}
        meiosPagamento={meiosPagamento}
      />

      <div className="mb-lg grid grid-cols-1 gap-md md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Faturamento" value={formatCurrency(kpis.faturamento)} icon="payments" loading={loading}
          trend={crescimentoPct !== null ? `${crescimentoPct >= 0 ? '+' : ''}${crescimentoPct.toFixed(1)}% vs. ano anterior` : undefined}
          trendTone={crescimentoPct !== null ? (crescimentoPct >= 0 ? 'positive' : 'negative') : 'neutral'}
        />
        <KpiCard label="Quantidade de Notas" value={String(kpis.nf_count)} icon="receipt_long" loading={loading}
          trend="Sincronizado em tempo real" trendTone="positive"
        />
        <KpiCard label="Ticket Médio" value={formatCurrency(kpis.ticket_medio)} icon="leaderboard" loading={loading}
          trend={`${kpis.clientes} clientes no período`} trendTone="neutral"
        />

        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2 flex items-center justify-between">
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : metaProgress === null ? (
            <EmptyState icon="flag" title="Meta não definida" description="Cadastre uma meta em `metas` para este mês." />
          ) : (
            <>
              <div>
                <span className="mb-sm block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                  Meta do Mês
                </span>
                <div className="font-display text-display text-on-surface">{metaProgress}%</div>
                <span className="font-label-md text-label-md text-on-secondary-container">
                  {kpis.faturamento >= meta ? 'Meta atingida' : `Faltam ${formatCurrency(meta - kpis.faturamento)}`}
                </span>
              </div>
              <div className="relative h-20 w-20">
                <svg className="h-20 w-20 -rotate-90">
                  <circle className="text-surface-container-highest" cx="40" cy="40" fill="transparent" r="32" stroke="currentColor" strokeWidth="8" />
                  <circle
                    className="text-primary transition-[stroke-dashoffset] duration-500"
                    cx="40" cy="40" fill="transparent" r="32" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - (circumference * metaProgress) / 100}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-[24px]">flag</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
        <HourlyBarChart data={hourly} loading={loading} />
        <VendedorRanking data={ranking} loading={loading} />
        <FilialDonut data={participacao} loading={loading} />

        <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
          <div className="p-lg border-b border-outline-variant flex items-center justify-between">
            <div className="flex items-center gap-sm">
              <h3 className="font-title-md text-title-md text-on-surface">Feed em Tempo Real</h3>
              <span className={`material-symbols-outlined text-tertiary text-[18px] ${pulse ? 'sync-active' : ''}`}>sync</span>
            </div>
            <button
              onClick={() => {
                if (feed.length === 0) {
                  push('info', 'Nenhum lançamento para exportar.')
                  return
                }
                downloadCsv(`faturamento-${filters.ano ?? ''}-${filters.mes ?? ''}.csv`, invoicesToCsv(feed))
              }}
              className="text-primary font-label-md text-label-md flex items-center gap-xs hover:underline"
            >
              Exportar CSV
              <span className="material-symbols-outlined text-[16px]">download</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="space-y-sm p-lg">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : feed.length === 0 ? (
              <EmptyState icon="receipt_long" title="Nenhuma nota no período" description="Assim que o faturista lançar uma NF, ela aparece aqui." />
            ) : (
              <table className="w-full text-left">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Cliente</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Vendedor</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Valor</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Hora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {feed.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-lg py-md font-tabular-nums text-primary font-medium">#{inv.numero_nf}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface">{inv.cliente}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface-variant">{inv.filiais?.nome}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface">{inv.vendedores?.nome}</td>
                      <td className="px-lg py-md font-tabular-nums text-on-surface font-semibold">{formatCurrency(inv.valor)}</td>
                      <td className="px-lg py-md font-label-md text-label-md text-on-surface-variant">{formatTime(inv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
