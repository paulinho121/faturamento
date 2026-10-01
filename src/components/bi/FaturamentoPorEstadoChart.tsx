import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'
import { COR_OUTROS, PALETA_BI } from './paletaBi'

export interface EstadoLinha {
  estado: string
  faturamento: number
  nf_count: number
  clientes: number
}

const LIMITE_ESTADOS = PALETA_BI.length

export function FaturamentoPorEstadoChart({
  data,
  loading,
  estadoSelecionado,
  onSelecionarEstado,
  onVerOperacoes,
}: {
  data: EstadoLinha[]
  loading?: boolean
  estadoSelecionado: string | null
  onSelecionarEstado: (estado: string | null) => void
  onVerOperacoes?: (estado: string) => void
}) {
  const ordenado = [...data].filter((d) => d.estado).sort((a, b) => b.faturamento - a.faturamento)
  const principais = ordenado.slice(0, LIMITE_ESTADOS)
  const resto = ordenado.slice(LIMITE_ESTADOS)
  const outros = resto.reduce((acc, d) => acc + d.faturamento, 0)

  const barras = [
    ...principais.map((d, i) => ({ estado: d.estado, faturamento: d.faturamento, cor: PALETA_BI[i] })),
    ...(outros > 0 ? [{ estado: `Outros (${resto.length})`, faturamento: outros, cor: COR_OUTROS }] : []),
  ]
  const temDado = barras.some((b) => b.faturamento > 0)

  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <h3 className="font-title-md text-title-md text-on-surface">Faturamento por Estado</h3>
        {estadoSelecionado && (
          <div className="flex items-center gap-xs">
            {onVerOperacoes && (
              <button
                type="button"
                onClick={() => onVerOperacoes(estadoSelecionado)}
                className="flex items-center gap-xs rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary hover:bg-primary/20"
              >
                <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                Ver operações de {estadoSelecionado}
              </button>
            )}
            <button
              type="button"
              onClick={() => onSelecionarEstado(null)}
              className="flex items-center gap-xs rounded-full bg-surface-container-low px-sm py-0.5 font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
              aria-label="Limpar filtro de estado"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : !temDado ? (
        <div className="flex h-72 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">map</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Sem faturamento nesse período ainda.</p>
        </div>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barras} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="estado"
                  type="category"
                  width={70}
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
                  cursor="pointer"
                  onClick={(d: { estado?: string }) => {
                    if (!d?.estado || d.estado.startsWith('Outros')) return
                    onSelecionarEstado(d.estado === estadoSelecionado ? null : d.estado)
                  }}
                >
                  {barras.map((b) => (
                    <Cell
                      key={b.estado}
                      fill={b.cor}
                      opacity={estadoSelecionado && estadoSelecionado !== b.estado ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-sm font-label-md text-label-md text-on-surface-variant">
            Clique numa barra pra ver os maiores clientes daquele estado.
          </p>
        </>
      )}
    </div>
  )
}
