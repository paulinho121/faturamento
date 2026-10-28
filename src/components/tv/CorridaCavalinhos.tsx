import { useMemo } from 'react'
import { useFotosVendedores } from '../../hooks/useFotosVendedores'
import type { PainelVendedor } from '../../hooks/usePainelTv'

// Quanto mais perto da meta, mais animado (a foto fica a mesma; o humor vem
// no emoji ao lado do nome).
function humor(pct: number): string {
  if (pct >= 1) return '🤩'
  if (pct >= 0.75) return '😄'
  if (pct >= 0.5) return '😀'
  if (pct >= 0.25) return '🙂'
  return '😐'
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

interface Corredor {
  vendedor: PainelVendedor
  meta: number
  pct: number
  metaPessoal: boolean
}

// Corre quem foi marcado "na corrida" (escolha em "Fotos da TV"), vendendo ou
// não. Cada um corre rumo à meta dele: a pessoal, se cadastrou; senão uma
// parte igual da meta da empresa entre os que estão na corrida.
function montarCorredores(vendedores: PainelVendedor[], metaEmpresa: number): Corredor[] {
  const naCorrida = vendedores.filter((v) => v.na_corrida)
  const parteIgual = naCorrida.length > 0 ? metaEmpresa / naCorrida.length : 0
  return naCorrida
    .map((v) => {
      const pessoal = (v.meta_pessoal ?? 0) > 0
      const meta = pessoal ? Number(v.meta_pessoal) : parteIgual
      return { vendedor: v, meta, pct: meta > 0 ? v.faturado_mes / meta : 0, metaPessoal: pessoal }
    })
    .filter((c) => c.meta > 0)
    .sort((a, b) => b.pct - a.pct)
}

function Rosto({ nome, url }: { nome: string; url?: string }) {
  return url ? (
    <img src={url} alt={nome} className="h-[34px] w-[34px] rounded-full border-2 border-white/85 object-cover shadow-md shadow-black/40" />
  ) : (
    <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-white/85 bg-slate-600 text-sm font-bold shadow-md shadow-black/40">
      {iniciais(nome)}
    </span>
  )
}

export function CorridaCavalinhos({ vendedores, metaEmpresa }: { vendedores: PainelVendedor[]; metaEmpresa: number }) {
  const corredores = useMemo(() => montarCorredores(vendedores, metaEmpresa), [vendedores, metaEmpresa])
  const fotos = useFotosVendedores(corredores.map((c) => c.vendedor.foto_path).filter((p): p is string => !!p))

  return (
    <section className="relative mb-3 shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold uppercase tracking-[0.18em] text-white/50">🏇 Corrida rumo à meta do mês</h2>
        <span className="text-sm text-white/40">🏁 = meta batida</span>
      </div>
      {corredores.length === 0 ? (
        <p className="py-3 text-center text-xl text-white/50">
          Marque os vendedores da corrida em "Fotos da TV" e defina a meta do mês no Dashboard.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-x-5 gap-y-0">
          {corredores.map((c) => {
            const pct = Math.min(Math.max(c.pct, 0), 1)
            const url = c.vendedor.foto_path ? fotos[c.vendedor.foto_path] : undefined
            return (
              <div key={c.vendedor.id} className="flex items-center gap-3">
                <div className="flex w-[156px] shrink-0 items-center justify-between gap-1">
                  <span className="truncate text-lg font-semibold">{c.vendedor.nome}</span>
                  <span className="text-xl">{humor(c.pct)}</span>
                </div>
                <div className="relative h-[64px] flex-1">
                  <div className="absolute inset-x-0 bottom-1 h-px border-b border-dashed border-white/25" />
                  <span className="absolute bottom-1 right-0 text-3xl leading-none">🏁</span>
                  <div
                    className="absolute bottom-0 transition-all duration-[1500ms] ease-out"
                    style={{ left: `${pct * 100}%`, transform: `translateX(-${pct * 100}%)` }}
                  >
                    <div className="relative">
                      <span className="block text-[50px] leading-none" style={{ transform: 'scaleX(-1)' }}>
                        🐎
                      </span>
                      <div className="absolute -top-[10px] left-[38%] -translate-x-1/2">
                        <Rosto nome={c.vendedor.nome} url={url} />
                      </div>
                    </div>
                  </div>
                </div>
                <span className="w-12 shrink-0 text-right text-lg font-bold tabular-nums text-[#a8e063]">
                  {Math.round(c.pct * 100)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
