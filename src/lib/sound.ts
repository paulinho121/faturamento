let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = new Ctor()
  }
  return audioCtx
}

// "Cha-ching" sintetizado via Web Audio API — sem depender de arquivo de
// áudio externo (mesma filosofia do LiquidGauge, que também é só CSS/SVG).
// Arpejo maior ascendente (C6-E6-G6-C7), tipo "moedinha" de jogo.
export function playCashSound() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    const notas = [1046.5, 1318.5, 1568.0, 2093.0]

    notas.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const start = now + i * 0.07
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    })
  } catch {
    // Web Audio indisponível/bloqueado pelo navegador — falha silenciosa.
  }
}
