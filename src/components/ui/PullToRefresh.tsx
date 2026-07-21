import { useEffect, useRef, useState, type ReactNode } from 'react'

const THRESHOLD = 70
const MAX_PULL = 100
const MIN_SPINNER_MS = 500

// Puxar a tela pra baixo no topo da página recarrega os dados — o navegador
// nativo não faz isso quando o app roda instalado (modo standalone), então
// implementamos a gesture na mão. Escuta touchmove com { passive: false }
// via addEventListener nativo (não a prop onTouchMove do React) porque só
// assim o preventDefault() funciona de forma confiável pra travar o scroll
// elástico do navegador enquanto o usuário está puxando.
//
// O estado de arrasto (dragging/pull/refreshing) vive só em stateRef, escrito
// de forma síncrona dentro dos próprios handlers — nunca via useEffect
// espelhando o state, porque o touchend pode disparar antes do React
// commitar o re-render do touchmove anterior, e um espelho por efeito leria
// um valor velho (mesma causa do bug do MonthTabs).
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void> | void; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const [pull, setPullState] = useState(0)
  const [refreshing, setRefreshingState] = useState(false)
  const stateRef = useRef({ dragging: false, startX: 0, startY: 0, refreshing: false, pull: 0 })

  function setPull(value: number) {
    stateRef.current.pull = value
    setPullState(value)
  }
  function setRefreshing(value: boolean) {
    stateRef.current.refreshing = value
    setRefreshingState(value)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    async function doRefresh() {
      setRefreshing(true)
      const started = Date.now()
      try {
        await onRefreshRef.current()
      } finally {
        const elapsed = Date.now() - started
        if (elapsed < MIN_SPINNER_MS) await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed))
        setRefreshing(false)
        setPull(0)
      }
    }

    function onTouchStart(e: TouchEvent) {
      if (stateRef.current.refreshing || window.scrollY > 0) return
      const t = e.touches[0]
      stateRef.current.dragging = true
      stateRef.current.startX = t.clientX
      stateRef.current.startY = t.clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (!stateRef.current.dragging || stateRef.current.refreshing) return
      const t = e.touches[0]
      const dy = t.clientY - stateRef.current.startY
      const dx = t.clientX - stateRef.current.startX
      if (window.scrollY > 0 || dy <= 0 || Math.abs(dx) > dy) {
        stateRef.current.dragging = false
        setPull(0)
        return
      }
      e.preventDefault()
      setPull(Math.min(MAX_PULL, dy * 0.5))
    }

    function onTouchEnd() {
      if (!stateRef.current.dragging) return
      stateRef.current.dragging = false
      if (stateRef.current.pull >= THRESHOLD) {
        setPull(THRESHOLD)
        void doRefresh()
      } else {
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const height = refreshing ? THRESHOLD : pull
  const progress = Math.min(1, pull / THRESHOLD)

  return (
    <div ref={containerRef}>
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height }}
      >
        <span
          className={`material-symbols-outlined text-primary text-[22px] ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: progress }}
        >
          refresh
        </span>
      </div>
      {children}
    </div>
  )
}
