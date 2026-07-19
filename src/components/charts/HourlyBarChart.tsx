import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCurrency } from '../../lib/format'

export interface HourlyPoint {
  hora: number
  faturamento: number
}

export function HourlyBarChart({ data, loading }: { data: HourlyPoint[]; loading?: boolean }) {
  const full = Array.from({ length: 24 }, (_, h) => {
    const found = data.find((d) => d.hora === h)
    return { hora: `${String(h).padStart(2, '0')}h`, faturamento: found?.faturamento ?? 0 }
  }).filter((_, h) => h >= 6 && h <= 22)

  const hasData = data.some((d) => d.faturamento > 0)

  return (
    <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-xl flex items-center justify-between">
        <h3 className="font-title-md text-title-md text-on-surface">Faturamento por hora (hoje)</h3>
        <div className="flex items-center gap-sm">
          <span className="h-3 w-3 rounded-full bg-primary"></span>
          <span className="font-label-md text-label-md text-on-surface-variant">Valor (R$)</span>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !hasData ? (
        <div className="flex h-64 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">bar_chart</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Nenhum faturamento registrado hoje ainda.</p>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={full} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#434655' }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ borderRadius: 8, border: '1px solid #c3c6d7', fontSize: 12 }}
              />
              <Bar dataKey="faturamento" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
