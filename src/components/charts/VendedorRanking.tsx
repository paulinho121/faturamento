import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { formatCurrency } from '../../lib/format'

export interface RankingRow {
  vendedor_id: string
  vendedor_nome: string
  faturamento: number
  qtd_vendas: number
}

const MEDALS = ['🥇', '🥈', '🥉']

export function VendedorRanking({ data, loading }: { data: RankingRow[]; loading?: boolean }) {
  const top = data.filter((d) => d.qtd_vendas > 0).slice(0, 5)

  return (
    <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-xl font-title-md text-title-md text-on-surface">Ranking de Vendedores</h3>
      {loading ? (
        <div className="space-y-md">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : top.length === 0 ? (
        <EmptyState icon="leaderboard" title="Sem vendas no período" description="Assim que houver lançamentos, o ranking aparece aqui." />
      ) : (
        <div className="space-y-md">
          {top.map((row, i) => (
            <div
              key={row.vendedor_id}
              className={`flex items-center justify-between p-md rounded-lg border border-transparent transition-all ${
                i === 0 ? 'bg-surface-container-low hover:border-primary/20' : 'bg-surface-container-low/50'
              }`}
            >
              <div className="flex items-center gap-md">
                <span className="text-2xl">{MEDALS[i] ?? '🎖️'}</span>
                <div>
                  <div className="font-title-md text-on-surface">{row.vendedor_nome}</div>
                  <div className="font-label-md text-label-md text-on-surface-variant">{row.qtd_vendas} vendas</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-tabular-nums text-on-surface">{formatCurrency(row.faturamento)}</div>
                {i === 0 && <div className="text-tertiary font-label-md text-label-md">Top vendedor</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
