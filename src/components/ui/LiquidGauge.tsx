// Tanque de líquido enchendo — usado pra visualizar progresso rumo a uma
// meta de um jeito mais "gamificado" que uma barra reta. A onda no topo do
// líquido é só CSS+SVG (ver .animate-liquid-wave em index.css), sem lib
// externa.
export function LiquidGauge({ percent, caption }: { percent: number; caption?: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const atingida = percent >= 100
  const textoClaro = clamped >= 50

  return (
    <div className="relative h-48 w-full overflow-hidden rounded-2xl border-2 border-outline-variant bg-surface-container-low">
      <div
        className="absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out"
        style={{ height: `${clamped}%` }}
      >
        <div
          className={`absolute inset-x-0 bottom-0 top-2 ${
            atingida ? 'bg-gradient-to-b from-emerald-400 to-tertiary' : 'bg-gradient-to-b from-tertiary to-primary'
          }`}
        />
        <svg className="absolute -top-3 left-0 h-4 w-[200%] animate-liquid-wave" viewBox="0 0 200 20" preserveAspectRatio="none">
          <path
            d="M0 10 C 25 0 25 20 50 10 C 75 0 75 20 100 10 C 125 0 125 20 150 10 C 175 0 175 20 200 10 V 20 H 0 Z"
            fill={atingida ? '#34d399' : '#0d9488'}
            fillOpacity="0.55"
          />
        </svg>
        <svg className="absolute -top-2 left-0 h-4 w-[200%] animate-liquid-wave-slow" viewBox="0 0 200 20" preserveAspectRatio="none">
          <path
            d="M0 10 C 25 0 25 20 50 10 C 75 0 75 20 100 10 C 125 0 125 20 150 10 C 175 0 175 20 200 10 V 20 H 0 Z"
            fill={atingida ? '#6ee7b7' : '#5eead4'}
            fillOpacity="0.45"
          />
        </svg>
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-display tabular-nums ${textoClaro ? 'text-white' : 'text-on-surface'}`}>
          {Math.round(percent)}%
        </span>
        {caption && (
          <span className={`font-label-md text-label-md ${textoClaro ? 'text-white/90' : 'text-on-surface-variant'}`}>
            {caption}
          </span>
        )}
      </div>

      {atingida && (
        <span className="absolute right-3 top-3 text-2xl" title="Meta batida!">
          🎉
        </span>
      )}
    </div>
  )
}
