import { Skeleton } from '../ui/Skeleton'

export type Accent = 'gold' | 'silver' | 'bronze'

export const ACCENT_STYLES: Record<Accent, string> = {
  gold: 'border-amber-400 bg-gradient-to-br from-amber-50 to-surface-container-lowest ring-1 ring-amber-300/60',
  silver: 'border-slate-300 bg-gradient-to-br from-slate-100 to-surface-container-lowest ring-1 ring-slate-300/60',
  bronze: 'border-orange-700/50 bg-gradient-to-br from-orange-50 to-surface-container-lowest ring-1 ring-orange-300/60',
}

export const ACCENT_EMOJI: Record<Accent, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' }

export function KpiCard({
  label,
  value,
  subValue,
  icon,
  trend,
  trendTone = 'neutral',
  loading,
  accent,
}: {
  label: string
  value: string
  subValue?: React.ReactNode
  icon: string
  trend?: string
  trendTone?: 'positive' | 'negative' | 'neutral'
  loading?: boolean
  accent?: Accent
}) {
  const isDirectional = trendTone === 'positive' || trendTone === 'negative'
  const trendColor = trendTone === 'positive' ? 'text-tertiary' : trendTone === 'negative' ? 'text-error' : 'text-on-secondary-container'
  const trendBg = trendTone === 'positive' ? 'bg-tertiary/10' : 'bg-error/10'
  const trendIcon = trendTone === 'positive' ? 'trending_up' : trendTone === 'negative' ? 'trending_down' : 'info'

  return (
    <div
      className={`relative bg-surface-container-lowest border p-lg rounded-xl shadow-level2 hover:border-primary/30 transition-all duration-300 flex flex-col justify-between ${
        accent ? ACCENT_STYLES[accent] : 'border-outline-variant'
      }`}
    >
      {accent && (
        <span className="absolute -right-2 -top-2 text-2xl drop-shadow" title="Top 3 do período">
          {ACCENT_EMOJI[accent]}
        </span>
      )}
      <div className="mb-sm flex items-start justify-between gap-sm">
        <span className="font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <span className="material-symbols-outlined text-primary text-[18px]">{icon}</span>
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-32" />
      ) : (
        <div>
          <div className="font-display break-words text-xl text-on-surface tabular-nums sm:text-display">{value}</div>
          {subValue && <div className="mt-xs">{subValue}</div>}
        </div>
      )}
      <div className="mt-auto pt-sm">
        {trend && !loading && (
          isDirectional ? (
            <span className={`inline-flex items-center gap-xs rounded-full px-sm py-0.5 font-label-md text-label-md ${trendBg} ${trendColor}`}>
              <span className="material-symbols-outlined text-[14px]">{trendIcon}</span>
              {trend}
            </span>
          ) : (
            <div className={`flex items-center gap-xs font-label-md text-label-md ${trendColor}`}>
              <span className="material-symbols-outlined text-[14px]">{trendIcon}</span>
              <span>{trend}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}
