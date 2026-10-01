import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'
import { COR_OUTROS, PALETA_BI } from './paletaBi'

export interface TipoLinha {
  tipo_operacao: string
  faturamento: number
  nf_count: number
}

const LIMITE_TIPOS = PALETA_BI.length

export function MixTipoOperacaoChart({ data, loading }: { data: TipoLinha[]; loading?: boolean }) {
  const ordenado = [...data].sort((a, b) => b.faturamento - a.faturamento)
  const principais = ordenado.slice(0, LIMITE_TIPOS)
  const resto = ordenado.slice(LIMITE_TIPOS)
  const outros = resto.reduce((acc, d) => acc + d.faturamento, 0)

  const barras = [
    ...principais.map((d, i) => ({ tipo: d.tipo_operacao, faturamento: d.faturamento, cor: PALETA_BI[i] })),
    ...(outros > 0 ? [{ tipo: `Outros (${resto.length})`, faturamento: outros, cor: COR_OUTROS }] : []),
  ]
  const temDado = barras.some((b) => b.faturamento > 0)

  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Mix por Tipo de Operação</h3>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !temDado ? (
        <div className="flex h-64 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">donut_small</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Sem faturamento nesse período ainda.</p>
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barras} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                dataKey="tipo"
                type="category"
                width={110}
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
                {barras.map((b) => (
                  <Cell key={b.tipo} fill={b.cor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
