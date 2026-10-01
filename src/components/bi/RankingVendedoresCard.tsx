import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { formatCurrency } from '../../lib/format'

export interface VendedorLinha {
  vendedor_id: string
  vendedor_nome: string
  faturamento: number
  nf_count: number
  ticket_medio: number
}

export function RankingVendedoresCard({ data, loading }: { data: VendedorLinha[]; loading?: boolean }) {
  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Ranking de Vendedores</h3>
      {loading ? (
        <div className="space-y-sm">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="person" title="Nenhum vendedor faturou nesse período" />
      ) : (
        <div className="max-h-72 divide-y divide-outline-variant overflow-y-auto">
          {data.map((v, i) => (
            <div key={v.vendedor_id} className="flex items-center justify-between gap-sm py-sm">
              <div className="flex min-w-0 items-center gap-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-label-md text-label-md text-on-surface-variant">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-body-md text-body-md text-on-surface">{v.vendedor_nome}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {v.nf_count} nota{v.nf_count === 1 ? '' : 's'} · ticket médio {formatCurrency(v.ticket_medio)}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-body-md text-body-md font-medium text-on-surface">
                {formatCurrency(v.faturamento)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
