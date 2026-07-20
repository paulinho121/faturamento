import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCurrency } from '../../lib/format'

export interface HourlyPoint {
  hora: number
  faturamento: number
  nf_count: number
}

type Metrica = 'valor' | 'quantidade'

export function HourlyBarChart({ data, loading }: { data: HourlyPoint[]; loading?: boolean }) {
  const [metrica, setMetrica] = useState<Metrica>('valor')

  const full = Array.from({ length: 24 }, (_, h) => {
    const found = data.find((d) => d.hora === h)
    return {
      hora: `${String(h).padStart(2, '0')}h`,
      faturamento: found?.faturamento ?? 0,
      nf_count: found?.nf_count ?? 0,
    }
  }).filter((_, h) => h >= 6 && h <= 22)

  const hasData =
    metrica === 'valor' ? data.some((d) => d.faturamento > 0) : data.some((d) => d.nf_count > 0)

  return (
    <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <h3 className="font-title-md text-title-md text-on-surface">Faturamento por hora (hoje)</h3>
        <div className="flex rounded-full bg-surface-container-low p-0.5">
          <button
            onClick={() => setMetrica('valor')}
            className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
              metrica === 'valor' ? 'bg-surface-container-lowest text-primary shadow-level1' : 'text-on-surface-variant'
            }`}
          >
            Valor
          </button>
          <button
            onClick={() => setMetrica('quantidade')}
            className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
              metrica === 'quantidade' ? 'bg-surface-container-lowest text-primary shadow-level1' : 'text-on-surface-variant'
            }`}
          >
            Quantidade
          </button>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !hasData ? (
        <div className="flex h-64 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">bar_chart</span>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {metrica === 'valor' ? 'Nenhum faturamento registrado hoje ainda.' : 'Nenhuma nota lançada hoje ainda.'}
          </p>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={full} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#434655' }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value: number) => (metrica === 'valor' ? formatCurrency(value) : `${value} nota${value === 1 ? '' : 's'}`)}
                contentStyle={{ borderRadius: 8, border: '1px solid #c3c6d7', fontSize: 12 }}
              />
              <Bar dataKey={metrica === 'valor' ? 'faturamento' : 'nf_count'} fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
