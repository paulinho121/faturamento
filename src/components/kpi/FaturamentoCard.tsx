import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Skeleton } from '../ui/Skeleton'
import { ACCENT_EMOJI, ACCENT_STYLES, type Accent } from './KpiCard'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'
import type { Filial } from '../../types/domain'
import type { TransferenciaPorFilial } from '../../hooks/useDashboardData'

export function FaturamentoCard({
  faturamento,
  crescimentoPct,
  dailyFaturamento,
  mes,
  ano,
  transferencias = 0,
  transferenciasCount = 0,
  transferenciasPorFilial = [],
  filiais = [],
  loading,
  accent,
  isCensored = false,
  onToggleCensor,
}: {
  faturamento: number
  crescimentoPct: number | null
  dailyFaturamento: Record<number, number>
  mes: number | null
  ano: number | null
  transferencias?: number
  transferenciasCount?: number
  transferenciasPorFilial?: TransferenciaPorFilial[]
  filiais?: Filial[]
  loading?: boolean
  accent?: Accent
  isCensored?: boolean
  onToggleCensor?: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const diasNoMes = mes && ano ? new Date(ano, mes, 0).getDate() : 30
  const sparklineData = Array.from({ length: diasNoMes }, (_, i) => ({
    dia: i + 1,
    valor: dailyFaturamento[i + 1] ?? 0,
  }))
  const temSparkline = sparklineData.some((d) => d.valor > 0)

  const trendPositive = crescimentoPct !== null && crescimentoPct >= 0

  return (
    <div
      className={`relative bg-surface-container-lowest border p-lg rounded-xl shadow-level2 ${
        accent ? ACCENT_STYLES[accent] : 'border-outline-variant'
      }`}
    >
      {accent && (
        <span className="absolute -right-2 -top-2 text-2xl drop-shadow" title="Top 3 do período">
          {ACCENT_EMOJI[accent]}
        </span>
      )}
      <div className="mb-md flex items-start justify-between gap-sm">
        <div className="flex items-center gap-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <span className="material-symbols-outlined text-primary text-[20px]">payments</span>
          </span>
          <div className="flex items-center gap-xs">
            <span className="font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Faturamento
            </span>
            {onToggleCensor && (
              <button
                type="button"
                onClick={onToggleCensor}
                className="flex items-center justify-center text-on-surface-variant transition-colors hover:text-primary"
                title={isCensored ? 'Mostrar valores' : 'Ocultar valores'}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isCensored ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            )}
          </div>
        </div>
        {!loading && crescimentoPct !== null && (
          <span
            className={`inline-flex shrink-0 items-center gap-xs rounded-full px-sm py-0.5 font-label-md text-label-md ${
              trendPositive ? 'bg-tertiary/10 text-tertiary' : 'bg-error/10 text-error'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{trendPositive ? 'trending_up' : 'trending_down'}</span>
            {trendPositive ? '+' : ''}
            {crescimentoPct.toFixed(1)}% vs ano anterior
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-9 w-48" />
      ) : (
        <div className="break-words font-display text-2xl text-on-surface tabular-nums sm:text-display">
          {isCensored ? 'R$ •••••••' : formatCurrency(faturamento)}
        </div>
      )}

      {!loading && temSparkline && (
        <div className="mt-sm h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="faturamentoSparkline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                labelFormatter={(dia) => `Dia ${dia}`}
                contentStyle={{ borderRadius: 8, border: '1px solid #c3c6d7', fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="valor"
                stroke="#0d9488"
                strokeWidth={2}
                fill="url(#faturamentoSparkline)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && transferencias > 0 && (
        <div className="mt-md border-t border-outline-variant pt-md">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-between gap-sm text-left"
          >
            <div className="flex items-center gap-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary-container/50">
                <span className="material-symbols-outlined text-on-secondary-container text-[16px]">swap_horiz</span>
              </span>
              <div>
                <span className="block font-label-md text-label-md text-on-surface-variant">Transferências</span>
                <span className="font-title-md text-title-md text-on-surface">
                  {isCensored ? 'R$ •••••' : formatCompactCurrency(transferencias)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">
                {transferenciasCount} {transferenciasCount === 1 ? 'operação' : 'operações'}
              </span>
              <span
                className={`material-symbols-outlined text-on-surface-variant text-[20px] transition-transform ${expanded ? 'rotate-90' : ''}`}
              >
                chevron_right
              </span>
            </div>
          </button>

          {expanded && (
            <div className="mt-sm space-y-xs pl-11">
              {transferenciasPorFilial.length > 0 ? (
                transferenciasPorFilial.map((t) => (
                  <div key={t.filialId} className="flex items-center justify-between font-label-md text-label-md">
                    <span className="text-on-surface-variant">{filiais.find((f) => f.id === t.filialId)?.nome ?? 'Filial'}</span>
                    <span className="font-medium text-on-surface">
                      {isCensored ? 'R$ •••••' : formatCurrency(t.valor)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between font-label-md text-label-md">
                  <span className="text-on-surface-variant">Total</span>
                  <span className="font-medium text-on-surface">
                    {isCensored ? 'R$ •••••' : formatCurrency(transferencias)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
