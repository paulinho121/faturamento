import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { formatCurrency } from '../../lib/format'

export interface ClienteLinha {
  cliente: string
  estado: string | null
  faturamento: number
  nf_count: number
  ticket_medio: number
}

export function MaioresClientesCard({
  data,
  loading,
  estadoFiltro,
  faturamentoTotalPeriodo,
}: {
  data: ClienteLinha[]
  loading?: boolean
  estadoFiltro: string | null
  faturamentoTotalPeriodo: number
}) {
  const top10 = data.slice(0, 10).reduce((acc, c) => acc + c.faturamento, 0)
  const concentracao = faturamentoTotalPeriodo > 0 ? (top10 / faturamentoTotalPeriodo) * 100 : 0

  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Maiores Clientes{estadoFiltro ? ` · ${estadoFiltro}` : ''}
          </h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {estadoFiltro ? `Somente clientes de ${estadoFiltro}` : 'Todos os estados'}
          </p>
        </div>
        {!estadoFiltro && data.length > 0 && (
          <span
            title="Soma do faturamento dos 10 maiores clientes dividida pelo faturamento total do período"
            className="rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-700"
          >
            Top 10 = {concentracao.toFixed(0)}% do faturamento
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-sm">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="groups" title="Nenhum cliente faturou nesse período" />
      ) : (
        <div className="max-h-72 divide-y divide-outline-variant overflow-y-auto">
          {data.map((c, i) => (
            <div key={c.cliente} className="flex items-center justify-between gap-sm py-sm">
              <div className="flex min-w-0 items-center gap-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-label-md text-label-md text-on-surface-variant">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-body-md text-body-md text-on-surface">{c.cliente}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {c.estado ?? '—'} · {c.nf_count} nota{c.nf_count === 1 ? '' : 's'} · ticket médio{' '}
                    {formatCurrency(c.ticket_medio)}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-body-md text-body-md font-medium text-on-surface">
                {formatCurrency(c.faturamento)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
