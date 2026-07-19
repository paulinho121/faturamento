import { Skeleton } from '../ui/Skeleton'

export function KpiCard({
  label,
  value,
  subValue,
  icon,
  trend,
  trendTone = 'neutral',
  loading,
}: {
  label: string
  value: string
  subValue?: React.ReactNode
  icon: string
  trend?: string
  trendTone?: 'positive' | 'negative' | 'neutral'
  loading?: boolean
}) {
  const trendColor =
    trendTone === 'positive' ? 'text-tertiary' : trendTone === 'negative' ? 'text-error' : 'text-on-secondary-container'
  const trendIcon = trendTone === 'positive' ? 'trending_up' : trendTone === 'negative' ? 'trending_down' : 'info'

  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2 hover:border-primary/30 transition-all duration-300 flex flex-col justify-between">
      <div className="mb-sm flex items-start justify-between">
        <span className="font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">{label}</span>
        <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-32" />
      ) : (
        <div>
          <div className="font-display text-display text-on-surface tabular-nums">{value}</div>
          {subValue && <div className="mt-xs">{subValue}</div>}
        </div>
      )}
      <div className="mt-auto pt-sm">
        {trend && !loading && (
          <div className={`flex items-center gap-xs font-label-md text-label-md ${trendColor}`}>
            <span className="material-symbols-outlined text-[14px]">{trendIcon}</span>
            <span>{trend}</span>
          </div>
        )}
      </div>
    </div>
  )
}
