import { useEffect, useRef } from 'react'

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function MonthTabs({
  mes,
  ano,
  onChange,
}: {
  mes: number
  ano: number
  onChange: (mes: number, ano: number) => void
}) {
  const now = new Date()
  const currentMes = now.getMonth() + 1
  const currentAno = now.getFullYear()
  const isCurrentPeriod = mes === currentMes && ano === currentAno

  const selectedRef = useRef<HTMLButtonElement>(null)

  // Rola a aba selecionada para o centro (importante no mobile, onde só
  // cabem ~4 meses por vez).
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [mes, ano])

  return (
    <div className="mb-lg rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-level1">
      <div className="mb-md flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <button
            onClick={() => onChange(mes, ano - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
            aria-label="Ano anterior"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <span className="min-w-[3.5rem] text-center font-title-md text-title-md text-on-surface">{ano}</span>
          <button
            onClick={() => onChange(mes, ano + 1)}
            disabled={ano >= currentAno}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-30"
            aria-label="Próximo ano"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>

        {!isCurrentPeriod && (
          <button
            onClick={() => onChange(currentMes, currentAno)}
            className="flex items-center gap-xs rounded-full bg-primary/10 px-md py-xs font-label-md text-label-md text-primary transition-colors hover:bg-primary/20"
          >
            <span className="material-symbols-outlined text-[16px]">today</span>
            Mês atual
          </button>
        )}
      </div>

      <div className="flex gap-xs overflow-x-auto pb-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MESES_CURTOS.map((label, i) => {
          const monthNum = i + 1
          const selected = monthNum === mes
          const isCurrent = monthNum === currentMes && ano === currentAno
          const isFuture = ano > currentAno || (ano === currentAno && monthNum > currentMes)

          return (
            <button
              key={label}
              ref={selected ? selectedRef : undefined}
              disabled={isFuture}
              onClick={() => onChange(monthNum, ano)}
              className={`relative min-w-[3.5rem] shrink-0 whitespace-nowrap rounded-lg px-md py-sm font-label-md text-label-md transition-all sm:flex-1 ${
                selected
                  ? 'bg-primary text-on-primary shadow-level1'
                  : isFuture
                    ? 'cursor-not-allowed text-on-surface-variant opacity-30'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
              {isCurrent && !selected && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-tertiary" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
