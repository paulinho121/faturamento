import type { Pedido, PedidoEvento } from '../../types/domain'
import { passosDoPedido } from './pedidoUtils'

function formatData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// Barra de progresso do pedido, do envio até o faturamento. Com `eventos`,
// mostra a data em que cada passo foi concluído.
export function PedidoProgresso({ pedido, eventos }: { pedido: Pedido; eventos?: PedidoEvento[] }) {
  const passos = passosDoPedido(pedido.origem)
  const faturado = pedido.status === 'faturado'
  const indiceAtual = faturado
    ? passos.length - 1
    : Math.max(
        passos.findIndex((p) => p.etapa === pedido.etapa),
        0
      )

  function dataDoPasso(evento: PedidoEvento['tipo']): string | null {
    const doTipo = (eventos ?? []).filter((e) => e.tipo === evento || (evento === 'enviado' && e.tipo === 'reenviado'))
    const ultimo = doTipo[doTipo.length - 1]
    return ultimo ? formatData(ultimo.created_at) : null
  }

  return (
    <ol className="flex items-start" aria-label="Andamento do pedido">
      {passos.map((passo, i) => {
        const concluido = faturado ? i <= indiceAtual : i < indiceAtual
        const atual = !faturado && i === indiceAtual
        const data = concluido || atual ? dataDoPasso(passo.evento) : null
        return (
          <li key={passo.etapa} className="relative flex flex-1 flex-col items-center text-center">
            {i < passos.length - 1 && (
              <span
                className={`absolute left-1/2 top-3 h-0.5 w-full ${
                  i < indiceAtual ? 'bg-tertiary' : 'bg-outline-variant'
                }`}
              />
            )}
            <span
              className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium ${
                concluido
                  ? 'bg-tertiary text-on-tertiary'
                  : atual
                    ? 'bg-primary text-on-primary ring-4 ring-primary/20'
                    : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              {concluido ? <span className="material-symbols-outlined text-[16px]">check</span> : i + 1}
            </span>
            <span
              className={`mt-xs px-0.5 text-[11px] leading-tight sm:text-[12px] ${
                atual ? 'font-medium text-on-surface' : concluido ? 'text-on-surface' : 'text-on-surface-variant'
              }`}
            >
              {passo.label}
            </span>
            {data && <span className="text-[10px] text-on-surface-variant">{data}</span>}
          </li>
        )
      })}
    </ol>
  )
}
