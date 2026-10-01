import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'
import { PALETA_BI } from './paletaBi'

export interface FilialLinha {
  filial_id: string
  filial_nome: string
  faturamento: number
  nf_count: number
}

export function FaturamentoPorFilialChart({ data, loading }: { data: FilialLinha[]; loading?: boolean }) {
  const ordenado = [...data].sort((a, b) => b.faturamento - a.faturamento)
  const temDado = ordenado.some((d) => d.faturamento > 0)

  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Faturamento por Filial</h3>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !temDado ? (
        <div className="flex h-64 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">store</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Sem faturamento nesse período ainda.</p>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ordenado} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                dataKey="filial_nome"
                type="category"
                width={90}
                tick={{ fontSize: 12, fill: '#434655' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ borderRadius: 8, border: '1px solid #c3c6d7', fontSize: 12 }}
              />
              <Bar
                dataKey="faturamento"
                radius={[0, 4, 4, 0]}
                label={{ position: 'right', formatter: (v: number) => formatCompactCurrency(v), fontSize: 11, fill: '#52514e' }}
              >
                {ordenado.map((f, i) => (
                  <Cell key={f.filial_id} fill={PALETA_BI[i % PALETA_BI.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
