import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'

export interface EvolucaoPonto {
  ano: number
  mes: number
  faturamento: number
  nf_count: number
}

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function EvolucaoFaturamentoChart({ data, loading }: { data: EvolucaoPonto[]; loading?: boolean }) {
  const pontos = data.map((d) => ({
    label: `${MESES_ABREV[d.mes - 1]}/${String(d.ano).slice(2)}`,
    faturamento: d.faturamento,
    nf_count: d.nf_count,
  }))
  const temDado = pontos.some((p) => p.faturamento > 0)

  return (
    <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Evolução do Faturamento (12 meses)</h3>
      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : !temDado ? (
        <div className="flex h-72 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">show_chart</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Sem faturamento nesse período ainda.</p>
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bi-evolucao-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#e1e0d9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => formatCompactCurrency(v)}
                tick={{ fontSize: 11, fill: '#898781' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === 'faturamento' ? [formatCurrency(value), 'Faturamento'] : [value, 'Notas']
                }
                labelClassName="font-medium"
                contentStyle={{ borderRadius: 8, border: '1px solid #c3c6d7', fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="faturamento"
                stroke="#0d9488"
                strokeWidth={2}
                fill="url(#bi-evolucao-fill)"
                dot={{ r: 3, fill: '#0d9488', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
