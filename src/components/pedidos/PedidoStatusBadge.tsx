import type { Pedido } from '../../types/domain'
import { passosDoPedido } from './pedidoUtils'

export function pedidoStatusInfo(pedido: Pick<Pedido, 'status' | 'aprovado_financeiro'>): {
  texto: string
  classe: string
} {
  switch (pedido.status) {
    case 'devolvido':
      return { texto: 'Devolvido para correção', classe: 'bg-error/10 text-error' }
    case 'faturado':
      return { texto: 'Faturado', classe: 'bg-tertiary/10 text-tertiary' }
    case 'cancelado':
      return { texto: 'Cancelado', classe: 'bg-surface-container-high text-on-surface-variant' }
    default:
      return pedido.aprovado_financeiro
        ? { texto: 'Aprovado pelo Financeiro', classe: 'bg-tertiary/10 text-tertiary' }
        : { texto: 'Aguardando aprovação', classe: 'bg-amber-100 text-amber-700' }
  }
}

export function PedidoStatusBadge({
  pedido,
}: {
  pedido: Pick<
    Pedido,
    'status' | 'aprovado_financeiro' | 'revisao' | 'etapa' | 'origem' | 'pre_venda' | 'nf_servico' | 'parcial' | 'parcial_faturada_em'
  >
}) {
  const { texto, classe } = pedidoStatusInfo(pedido)
  return (
    <span className="flex flex-wrap items-center gap-xs">
      <span className={`whitespace-nowrap rounded-full px-sm py-0.5 font-label-md text-label-md ${classe}`}>{texto}</span>
      {pedido.pre_venda && (
        <span
          title="Item sem estoque — aguardando chegada pra seguir com o pedido"
          className="whitespace-nowrap rounded-full bg-violet-100 px-sm py-0.5 font-label-md text-label-md text-violet-700"
        >
          Pré-venda
        </span>
      )}
      {pedido.parcial && pedido.status === 'pendente' && (
        <span
          title="Faturamento parcial: só parte dos itens foi faturada"
          className="whitespace-nowrap rounded-full bg-violet-100 px-sm py-0.5 font-label-md text-label-md text-violet-800"
        >
          {pedido.parcial_faturada_em ? 'Faturado parcial' : 'Parcial'}
        </span>
      )}
      {pedido.nf_servico && (
        <span
          title="Nota fiscal de serviço: vai direto para São Paulo, sem separação"
          className="whitespace-nowrap rounded-full bg-sky-100 px-sm py-0.5 font-label-md text-label-md text-sky-800"
        >
          NF de serviço
        </span>
      )}
      {pedido.status === 'pendente' && pedido.etapa !== 'enviado' && !pedido.nf_servico && (
        <span className="whitespace-nowrap rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary">
          {passosDoPedido(pedido.origem).find((p) => p.etapa === pedido.etapa)?.label}
        </span>
      )}
      {pedido.origem && pedido.status !== 'cancelado' && (
        <span className="whitespace-nowrap rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant">
          {pedido.origem}
        </span>
      )}
      {pedido.revisao > 0 && (
        <span
          title="Pedido corrigido e reenviado pelo vendedor"
          className="whitespace-nowrap rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary"
        >
          Rev. {pedido.revisao}
        </span>
      )}
    </span>
  )
}
