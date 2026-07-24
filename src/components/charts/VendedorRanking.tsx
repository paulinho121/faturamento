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

export function VendedorRanking({
  data,
  loading,
  onSelectVendedor,
  onlineIds,
}: {
  data: RankingRow[]
  loading?: boolean
  onSelectVendedor?: (row: RankingRow, rank: number) => void
  onlineIds?: Set<string>
}) {
  const top = data.filter((d) => d.qtd_vendas > 0)
  const totalOnline = onlineIds?.size ?? 0

  return (
    <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-xl flex items-center justify-between">
        <h3 className="font-title-md text-title-md text-on-surface">Ranking de Vendedores</h3>
        <div className="flex items-center gap-sm">
          {totalOnline > 0 && (
            <span className="flex items-center gap-xs rounded-full bg-tertiary/10 px-sm py-0.5 font-label-md text-label-md text-tertiary" title="Vendedores com o app aberto agora">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse" />
              {totalOnline} online
            </span>
          )}
          {!loading && top.length > 0 && (
            <span className="font-label-md text-label-md text-on-surface-variant">{top.length} vendedores</span>
          )}
        </div>
      </div>
      {loading ? (
        <div className="space-y-md">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : top.length === 0 ? (
        <EmptyState icon="leaderboard" title="Sem vendas no período" description="Assim que houver lançamentos, o ranking aparece aqui." />
      ) : (
        <div className="max-h-[420px] space-y-md overflow-y-auto pr-xs">
          {top.map((row, i) => (
            <button
              key={row.vendedor_id}
              type="button"
              onClick={() => onSelectVendedor?.(row, i)}
              title="Ver extrato do vendedor"
              className={`flex w-full items-center justify-between p-md rounded-lg border border-transparent text-left transition-all hover:border-primary/30 hover:shadow-level1 ${
                i === 0 ? 'bg-surface-container-low' : 'bg-surface-container-low/50'
              }`}
            >
              <div className="flex items-center gap-md">
                <span className="text-2xl">{MEDALS[i] ?? '🎖️'}</span>
                <div>
                  <div className="flex items-center gap-xs">
                    <span className="font-title-md text-on-surface">{row.vendedor_nome}</span>
                    {onlineIds?.has(row.vendedor_id) && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-tertiary"
                        title="Online agora"
                      />
                    )}
                  </div>
                  <div className="font-label-md text-label-md text-on-surface-variant">{row.qtd_vendas} vendas</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-tabular-nums text-on-surface">{formatCurrency(row.faturamento)}</div>
                {i === 0 && <div className="text-tertiary font-label-md text-label-md">Top vendedor</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
