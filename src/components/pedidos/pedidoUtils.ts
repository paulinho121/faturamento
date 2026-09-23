import type { Pedido, PedidoEvento, PedidoEtapa, PedidoOrientacao, PedidoOrigem } from '../../types/domain'

export function formatNumeroPedido(numero: number): string {
  return `PED-${String(numero).padStart(4, '0')}`
}

// SHA-256 do conteúdo do PDF: mesma trava de duplicidade do banco, calculada
// no navegador pra avisar antes de subir o arquivo.
export async function hashArquivo(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Violação da unique index de hash (pedidos_arquivo_hash_uniq).
export function isPedidoDuplicadoError(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' && (error.message ?? '').includes('pedidos_arquivo_hash_uniq')
}

export const ORIGENS: { valor: PedidoOrigem; label: string; ajuda: string }[] = [
  { valor: 'SC', label: 'SC', ajuda: 'Separação feita pela Sanco' },
  { valor: 'SP', label: 'SP', ajuda: 'Separação feita pela MCI' },
  { valor: 'CE', label: 'CE', ajuda: 'Separação feita pela MCI' },
]

export interface PassoPedido {
  etapa: PedidoEtapa
  label: string
  evento: PedidoEvento['tipo']
}

// Passo a passo do pedido até o faturamento. SC passa pela Sanco (separação
// terceirizada); SP e CE são separados pela própria MCI.
export function passosDoPedido(origem: PedidoOrigem | null): PassoPedido[] {
  const inicio: PassoPedido[] = [
    { etapa: 'enviado', label: 'Pedido enviado', evento: 'enviado' },
    { etapa: 'em_processo', label: 'Processo iniciado', evento: 'processo_iniciado' },
  ]
  const fim: PassoPedido = { etapa: 'faturado', label: 'Faturado', evento: 'faturado' }
  if (origem === 'SC') {
    return [
      ...inicio,
      { etapa: 'enviado_sanco', label: 'Enviado para a Sanco', evento: 'enviado_sanco' },
      { etapa: 'em_separacao', label: 'Em separação (Sanco)', evento: 'separacao_iniciada' },
      fim,
    ]
  }
  return [
    ...inicio,
    {
      etapa: 'em_separacao',
      label: origem ? 'Em separação (MCI)' : 'Em separação',
      evento: 'separacao_iniciada',
    },
    fim,
  ]
}

// Próximo avanço do faturista; null quando só resta faturar (ou não se
// aplica) — inclui pedido em pré-venda, que fica parado até chegar estoque.
export function proximaAcao(
  pedido: Pick<Pedido, 'status' | 'etapa' | 'origem' | 'pre_venda'>
): { etapa: PedidoEtapa; botao: string } | null {
  if (pedido.status !== 'pendente' || pedido.pre_venda) return null
  if (pedido.etapa === 'enviado') return { etapa: 'em_processo', botao: 'Iniciar processo' }
  if (pedido.etapa === 'em_processo') {
    return pedido.origem === 'SC'
      ? { etapa: 'enviado_sanco', botao: 'Enviar para a Sanco' }
      : { etapa: 'em_separacao', botao: 'Iniciar separação' }
  }
  if (pedido.etapa === 'enviado_sanco') return { etapa: 'em_separacao', botao: 'Sanco iniciou a separação' }
  return null
}

// Depois que segue pra separação o pedido não volta mais pro vendedor.
export function podeDevolver(pedido: Pick<Pedido, 'status' | 'etapa'>): boolean {
  return pedido.status === 'pendente' && (pedido.etapa === 'enviado' || pedido.etapa === 'em_processo')
}

// Pré-venda (item sem estoque) só faz sentido pra pedido ainda em andamento
// — uma vez devolvido/faturado/cancelado, a marcação não tem mais efeito.
export function podeAlternarPreVenda(pedido: Pick<Pedido, 'status'>): boolean {
  return pedido.status === 'pendente'
}

// Situação da consulta ao diretor pra esse pedido: sem nenhuma, aguardando
// resposta da Bianca, ou já com orientação anexada.
export function statusOrientacao(orientacoes: PedidoOrientacao[] | undefined): 'nenhuma' | 'pendente' | 'respondida' {
  if (!orientacoes || orientacoes.length === 0) return 'nenhuma'
  return orientacoes.some((o) => !o.arquivo_path) ? 'pendente' : 'respondida'
}
