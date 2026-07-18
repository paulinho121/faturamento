import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { formatCurrency } from '../../lib/format'

export interface FilialRow {
  filial_id: string
  filial_nome: string
  faturamento: number
}

const PALETTE = ['#004ac6', '#4edea3', '#bec6e0', '#737686', '#2563eb', '#006242']

export function FilialDonut({ data, loading }: { data: FilialRow[]; loading?: boolean }) {
  const rows = data.filter((d) => d.faturamento > 0)
  const total = rows.reduce((sum, r) => sum + r.faturamento, 0)

  return (
    <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-xl font-title-md text-title-md text-on-surface">Participação Filiais</h3>
      {loading ? (
        <Skeleton className="mx-auto mb-lg h-48 w-48 rounded-full" />
      ) : rows.length === 0 ? (
        <EmptyState icon="pie_chart" title="Sem dados no período" />
      ) : (
        <>
          <div className="relative mx-auto mb-lg h-48 w-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="faturamento"
                  nameKey="filial_nome"
                  innerRadius="65%"
                  outerRadius="100%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {rows.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-headline-lg text-headline-lg text-on-surface">{formatCurrency(total)}</span>
              <span className="font-label-md text-label-md text-on-surface-variant">Total</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-sm">
            {rows.map((r, i) => (
              <div key={r.filial_id} className="flex items-center gap-xs">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="font-label-md text-label-md text-on-surface-variant">
                  {r.filial_nome} ({total > 0 ? Math.round((r.faturamento / total) * 100) : 0}%)
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
