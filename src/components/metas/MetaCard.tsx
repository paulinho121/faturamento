import { Skeleton } from '../ui/Skeleton'
import { formatCurrency } from '../../lib/format'

export function MetaCard({
  meta,
  faturamento,
  loading,
  onDefinir,
}: {
  meta: number
  faturamento: number
  loading?: boolean
  onDefinir: () => void
}) {
  const temMeta = meta > 0
  const progressoReal = temMeta ? (faturamento / meta) * 100 : 0
  const progresso = Math.min(100, Math.round(progressoReal))
  const atingida = faturamento >= meta && temMeta

  const circumference = 2 * Math.PI * 32
  const ringColor = atingida ? 'text-tertiary' : 'text-primary'

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (!temMeta) {
    return (
      <button
        onClick={onDefinir}
        className="group flex flex-col items-center justify-center gap-sm rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-lowest p-lg text-center transition-colors hover:border-primary hover:bg-primary/5"
      >
        <span className="material-symbols-outlined text-[32px] text-on-surface-variant transition-colors group-hover:text-primary">
          flag
        </span>
        <span className="font-title-md text-title-md text-on-surface">Definir meta do mês</span>
        <span className="font-label-md text-label-md text-on-secondary-container">
          Toque para cadastrar o objetivo de faturamento
        </span>
      </button>
    )
  }

  return (
    <div
      className={`relative flex items-center justify-between rounded-xl border bg-surface-container-lowest p-lg shadow-level2 transition-all ${
        atingida ? 'border-tertiary/40' : 'border-outline-variant'
      }`}
    >
      <button
        onClick={onDefinir}
        className="absolute right-md top-md rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
        aria-label="Editar meta"
        title="Editar meta"
      >
        <span className="material-symbols-outlined text-[18px]">edit</span>
      </button>

      <div>
        <span className="mb-sm block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
          Meta do Mês
        </span>
        <div className={`font-display text-display ${atingida ? 'text-tertiary' : 'text-on-surface'}`}>{progresso}%</div>
        <span className="font-label-md text-label-md text-on-secondary-container">
          {atingida ? '🎉 Meta atingida!' : `Faltam ${formatCurrency(meta - faturamento)}`}
        </span>
        <span className="mt-xs block font-label-md text-label-md text-on-surface-variant">
          {formatCurrency(faturamento)} de {formatCurrency(meta)}
        </span>
      </div>

      <div className="relative h-20 w-20 shrink-0">
        <svg className="h-20 w-20 -rotate-90">
          <circle
            className="text-surface-container-highest"
            cx="40"
            cy="40"
            fill="transparent"
            r="32"
            stroke="currentColor"
            strokeWidth="8"
          />
          <circle
            className={`${ringColor} transition-[stroke-dashoffset] duration-700 ease-out`}
            cx="40"
            cy="40"
            fill="transparent"
            r="32"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * progresso) / 100}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`material-symbols-outlined text-[24px] ${ringColor}`}>
            {atingida ? 'emoji_events' : 'flag'}
          </span>
        </div>
      </div>
    </div>
  )
}
