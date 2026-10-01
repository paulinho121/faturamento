import { useMemo, useState } from 'react'
import { Skeleton } from '../ui/Skeleton'
import { formatCompactCurrency, formatCurrency } from '../../lib/format'
import { BRASIL_ESTADOS, BRASIL_VIEWBOX } from './brasilMapaData'
import { COR_SEM_DADO, RAMPA_SEQUENCIAL_TEAL } from './paletaBi'
import type { EstadoLinha } from './FaturamentoPorEstadoChart'

// Classificação por quantil (não por intervalo igual): com um estado (SP)
// costumando concentrar boa parte do faturamento, intervalos iguais jogariam
// quase todo mundo no primeiro balde. Quantil distribui melhor a cor entre
// os estados que de fato têm nota fiscal no período.
function bucketDe(valor: number, cortes: number[]): number {
  for (let i = 0; i < cortes.length; i++) {
    if (valor <= cortes[i]) return i
  }
  return cortes.length
}

function calcularCortes(valores: number[]): number[] {
  const n = RAMPA_SEQUENCIAL_TEAL.length
  const ordenado = [...valores].sort((a, b) => a - b)
  const cortes: number[] = []
  for (let i = 1; i < n; i++) {
    const idx = Math.min(ordenado.length - 1, Math.floor((ordenado.length * i) / n))
    cortes.push(ordenado[idx])
  }
  return cortes
}

export function BrasilMapaChart({
  data,
  loading,
  estadoSelecionado,
  onSelecionarEstado,
}: {
  data: EstadoLinha[]
  loading?: boolean
  estadoSelecionado: string | null
  onSelecionarEstado: (estado: string) => void
}) {
  const [hover, setHover] = useState<{ uf: string; x: number; y: number } | null>(null)

  const porUf = useMemo(() => {
    const m = new Map<string, EstadoLinha>()
    for (const d of data) if (d.estado) m.set(d.estado, d)
    return m
  }, [data])

  const cortes = useMemo(() => {
    const valores = data.filter((d) => d.faturamento > 0).map((d) => d.faturamento)
    return valores.length > 0 ? calcularCortes(valores) : []
  }, [data])

  const temDado = data.some((d) => d.faturamento > 0)

  function corDoEstado(uf: string): string {
    const linha = porUf.get(uf)
    if (!linha || linha.faturamento <= 0) return COR_SEM_DADO
    return RAMPA_SEQUENCIAL_TEAL[bucketDe(linha.faturamento, cortes)]
  }

  const hoverLinha = hover ? porUf.get(hover.uf) : null
  const hoverNome = hover ? BRASIL_ESTADOS.find((e) => e.uf === hover.uf)?.nome : null

  return (
    <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Faturamento no Mapa</h3>
      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : !temDado ? (
        <div className="flex h-72 flex-col items-center justify-center gap-sm text-center">
          <span className="material-symbols-outlined text-on-surface-variant text-[32px]">map</span>
          <p className="font-body-md text-body-md text-on-surface-variant">Sem faturamento nesse período ainda.</p>
        </div>
      ) : (
        <>
          <div className="relative" onMouseLeave={() => setHover(null)}>
            <svg
              viewBox={BRASIL_VIEWBOX}
              className="h-72 w-full"
              onMouseMove={(e) => {
                if (!hover) return
                const rect = e.currentTarget.getBoundingClientRect()
                setHover((h) => (h ? { ...h, x: e.clientX - rect.left, y: e.clientY - rect.top } : h))
              }}
            >
              {BRASIL_ESTADOS.map((e) => {
                const selecionado = estadoSelecionado === e.uf
                const apagado = estadoSelecionado !== null && !selecionado
                return (
                  <path
                    key={e.uf}
                    d={e.path}
                    fill={corDoEstado(e.uf)}
                    stroke={selecionado ? '#0b4d45' : '#fcfcfb'}
                    strokeWidth={selecionado ? 2 : 0.75}
                    opacity={apagado ? 0.4 : 1}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={(ev) => {
                      const rect = ev.currentTarget.ownerSVGElement!.getBoundingClientRect()
                      setHover({ uf: e.uf, x: ev.clientX - rect.left, y: ev.clientY - rect.top })
                    }}
                    onClick={() => onSelecionarEstado(e.uf)}
                  >
                    <title>{e.nome}</title>
                  </path>
                )
              })}
            </svg>
            {hover && hoverLinha && hoverLinha.faturamento > 0 && (
              <div
                className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-outline-variant bg-surface-container-lowest p-sm shadow-level2"
                style={{ left: Math.min(hover.x + 12, 9999), top: Math.max(hover.y - 12, 0) }}
              >
                <p className="font-label-md text-label-md text-on-surface">{hoverNome}</p>
                <p className="font-title-sm text-title-sm text-primary tabular-nums">
                  {formatCurrency(hoverLinha.faturamento)}
                </p>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  {hoverLinha.nf_count} notas · {hoverLinha.clientes} clientes
                </p>
              </div>
            )}
            {hover && (!hoverLinha || hoverLinha.faturamento <= 0) && (
              <div
                className="pointer-events-none absolute z-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-sm py-xs shadow-level2"
                style={{ left: Math.min(hover.x + 12, 9999), top: Math.max(hover.y - 12, 0) }}
              >
                <p className="font-label-md text-label-md text-on-surface-variant">{hoverNome} — sem faturamento</p>
              </div>
            )}
          </div>
          <div className="mt-md flex flex-wrap items-center gap-sm">
            <span className="font-label-md text-label-md text-on-surface-variant">Menor</span>
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: COR_SEM_DADO }} />
            {RAMPA_SEQUENCIAL_TEAL.map((cor) => (
              <span key={cor} className="h-3 w-3 rounded-sm" style={{ backgroundColor: cor }} />
            ))}
            <span className="font-label-md text-label-md text-on-surface-variant">Maior</span>
            {cortes.length > 0 && (
              <span className="font-label-md text-label-md text-on-surface-variant">
                (até {formatCompactCurrency(cortes[0])} … acima de {formatCompactCurrency(cortes[cortes.length - 1])})
              </span>
            )}
          </div>
          <p className="mt-sm font-label-md text-label-md text-on-surface-variant">
            Clique num estado pra ver as operações por trás do número.
          </p>
        </>
      )}
    </div>
  )
}
