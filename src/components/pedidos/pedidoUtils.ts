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
export function passosDoPedido(origem: PedidoOrigem | null, nfServico = false): PassoPedido[] {
  // NF de serviço: sem Sanco nem separação, vai direto do envio para o faturamento (SP).
  if (nfServico) {
    return [
      { etapa: 'enviado', label: 'Pedido enviado', evento: 'enviado' },
      { etapa: 'faturado', label: 'Faturado (NF de serviço)', evento: 'faturado' },
    ]
  }
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
      { etapa: 'preparando_embarque', label: 'Preparando embarque', evento: 'preparando_embarque' },
      fim,
    ]
  }
  return [
    ...inicio,
    {
      etapa: 'em_separacao',
      label: origem === 'SP' ? 'Separação (logística)' : origem === 'CE' ? 'Separação (série e volumes)' : 'Em separação',
      evento: 'separacao_iniciada',
    },
    fim,
  ]
}

type PedidoSeparacao = Pick<Pedido, 'status' | 'etapa' | 'origem' | 'separacao_concluida_em' | 'nf_servico'>

// SP e CE: número de série e volumes precisam ser informados antes do faturamento (SP: a
// logística; CE: o próprio faturista). NF de serviço não tem mercadoria: dispensa a separação.
export function exigeSeparacaoLogistica(pedido: Pick<Pedido, 'origem' | 'nf_servico'>): boolean {
  return (pedido.origem === 'SP' || pedido.origem === 'CE') && !pedido.nf_servico
}

// CE: o faturista informa série e volumes (não passa pela logística).
export function separacaoPeloFaturista(pedido: Pick<Pedido, 'origem' | 'nf_servico'>): boolean {
  return pedido.origem === 'CE' && !pedido.nf_servico
}

// A NF de serviço só pode ser marcada/desmarcada antes de o pedido ir para separação.
export function podeMarcarNfServico(pedido: Pick<Pedido, 'status' | 'etapa'>): boolean {
  return pedido.status === 'pendente' && (pedido.etapa === 'enviado' || pedido.etapa === 'em_processo')
}

// Em separação e sem série/volumes ainda.
function emSeparacaoSemDados(pedido: PedidoSeparacao): boolean {
  return pedido.status === 'pendente' && pedido.etapa === 'em_separacao' && !pedido.separacao_concluida_em
}

// SP, liberado pelo faturista (etapa de separação), esperando a logística concluir.
export function aguardaSeparacaoLogistica(pedido: PedidoSeparacao): boolean {
  return pedido.origem === 'SP' && !pedido.nf_servico && emSeparacaoSemDados(pedido)
}

// CE, em separação: falta o próprio faturista informar série e volumes.
export function aguardaSeparacaoFaturista(pedido: PedidoSeparacao): boolean {
  return separacaoPeloFaturista(pedido) && emSeparacaoSemDados(pedido)
}

// Por que o pedido ainda não pode ser faturado (null = pode). Espelha a trava do banco (pedidos_guard).
export function motivoBloqueioFaturar(pedido: PedidoSeparacao): string | null {
  if (!exigeSeparacaoLogistica(pedido) || pedido.separacao_concluida_em) return null
  if (pedido.origem === 'CE') {
    return pedido.etapa === 'em_separacao'
      ? 'Informe o número de série e os volumes antes de faturar.'
      : 'Pedido de CE: inicie a separação e informe série e volumes antes de faturar.'
  }
  return pedido.etapa === 'em_separacao'
    ? 'Aguardando a logística informar número de série e volumes.'
    : 'Pedido de SP: inicie a separação para a logística informar série e volumes antes de faturar.'
}

// Próximo avanço do faturista; null quando só resta faturar (ou não se
// aplica) — inclui pedido em pré-venda, que fica parado até chegar estoque.
export function proximaAcao(
  pedido: Pick<Pedido, 'status' | 'etapa' | 'origem' | 'pre_venda' | 'nf_servico'>
): { etapa: PedidoEtapa; botao: string } | null {
  if (pedido.status !== 'pendente' || pedido.pre_venda || pedido.nf_servico) return null
  if (pedido.etapa === 'enviado') return { etapa: 'em_processo', botao: 'Iniciar processo' }
  if (pedido.etapa === 'em_processo') {
    return pedido.origem === 'SC'
      ? { etapa: 'enviado_sanco', botao: 'Enviar para a Sanco' }
      : { etapa: 'em_separacao', botao: 'Iniciar separação' }
  }
  if (pedido.etapa === 'enviado_sanco') return { etapa: 'em_separacao', botao: 'Sanco iniciou a separação' }
  if (pedido.etapa === 'em_separacao' && pedido.origem === 'SC') {
    return { etapa: 'preparando_embarque', botao: 'Preparando embarque' }
  }
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
