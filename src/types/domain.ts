export type UserRole = 'faturista' | 'diretor' | 'vendedor' | 'logistica' | 'cliente' | 'financeiro'

export type ModalidadePagamento = 'Simples' | 'Misto'

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
  modulos_extra: UserRole[]
  pode_orientar_pedidos: boolean
}

export interface Vendedor {
  id: string
  nome: string
  ativo: boolean
  percentual_comissao: number
}

export interface Filial {
  id: string
  nome: string
  ativo: boolean
  cnpj: string | null
}

export interface Meta {
  id: number
  filial_id: string | null
  mes: number
  ano: number
  valor_meta: number
}

export interface Cliente {
  id: string
  nome: string
  cnpj_cpf: string | null
  estado: string | null
  cidade: string | null
}

export interface Invoice {
  id: string
  filial_id: string
  filial_destino_id: string | null
  cliente_id: string | null
  estado: string
  numero_nf: string
  data_emissao: string
  tipo_operacao: string
  modalidade_pagamento: ModalidadePagamento
  meio_pagamento: string
  parcelas: number
  cliente: string
  valor: number
  vendedor_id: string | null
  valor_transferencia: number
  valor_a_faturar: number
  frete: number
  valor_difal: number
  valor_fcp: number
  valor_icms: number
  valor_ipi: number
  afeta_faturamento: boolean
  excluida: boolean
  transportadora: string | null
  xml_chave_acesso: string | null
  xml_raw: string | null
  created_by: string
  created_at: string
  // joined fields (from select with relations)
  filiais?: { nome: string }
  vendedores?: { nome: string }
  filial_destino?: { nome: string }
}

export interface Boleto {
  id: string
  invoice_id: string | null
  tipo: 'boleto' | 'comprovante'
  numero_titulo: string | null
  numero_parcela: number
  cliente_nome_importado: string | null
  carteira: string | null
  nosso_numero: string | null
  valor: number
  valor_pago: number
  juros: number
  data_pagamento: string | null
  vencimento: string
  status: 'pendente' | 'pago' | 'parcial'
  arquivo_path: string | null
  arquivo_nome: string | null
  created_by: string
  created_at: string
  // joined field (from select with relation)
  invoices?: {
    numero_nf: string
    cliente: string
    valor: number
    tipo_operacao: string
    clientes?: { cnpj_cpf: string | null } | null
    vendedores?: { nome: string } | null
  } | null
  // notas extras vinculadas ao título (ex: NF de compra + NFS de serviço da
  // assistência técnica num boleto só) — a principal continua em invoice_id
  boleto_notas_adicionais?: { invoices: { numero_nf: string; cliente: string } | null }[]
}

export interface ConciliacaoBancaria {
  id: string
  ofx_id: string
  data: string
  valor: number
  memo: string
  documento: string | null
  categoria: 'identificavel' | 'cartao' | 'boletos_lote' | 'outro'
  status: 'pendente' | 'conciliado' | 'ignorado'
  detalhe: string | null
  snapshot: {
    titulos: { id: string; status: Boleto['status']; valor_pago: number; data_pagamento: string | null }[]
    comprovantes: string[]
  } | null
  conciliado_em: string | null
  created_at: string
}

export type PedidoStatus = 'pendente' | 'devolvido' | 'faturado' | 'cancelado'
export type PedidoOrigem = 'SC' | 'SP' | 'CE'
export type PedidoEtapa = 'enviado' | 'em_processo' | 'enviado_sanco' | 'em_separacao' | 'faturado'

export interface PedidoEvento {
  id: string
  pedido_id: string
  tipo:
    | 'enviado'
    | 'aprovado'
    | 'devolvido'
    | 'reenviado'
    | 'faturado'
    | 'cancelado'
    | 'processo_iniciado'
    | 'enviado_sanco'
    | 'separacao_iniciada'
    | 'pre_venda_marcada'
    | 'pre_venda_desmarcada'
  motivo: string | null
  por: string | null
  revisao: number
  created_at: string
  profiles?: { full_name: string | null } | null
}

export interface NfeWatcherConfig {
  id: 1
  pasta: string | null
  data_corte: string
  atualizado_em: string | null
  atualizado_por: string | null
}

export interface NfeCaptura {
  id: string
  chave_acesso: string | null
  arquivo_nome: string
  xml_raw: string
  status: 'pendente' | 'lancada' | 'descartada'
  invoice_id: string | null
  created_at: string
}

export interface PedidoOrientacao {
  id: string
  pedido_id: string
  pergunta: string
  solicitado_por: string
  solicitado_em: string
  arquivo_path: string | null
  arquivo_nome: string | null
  resposta_texto: string | null
  respondido_por: string | null
  respondido_em: string | null
  // joined fields (from select with relations)
  profiles?: { full_name: string | null } | null
  pedidos?: { numero: number; cliente: string } | null
}

export interface Pedido {
  id: string
  vendedor_id: string
  cliente: string
  valor_estimado: number | null
  observacao: string | null
  arquivo_path: string
  arquivo_nome: string
  arquivo_hash: string | null
  numero: number
  revisao: number
  origem: PedidoOrigem | null
  etapa: PedidoEtapa
  status: PedidoStatus
  devolvido_motivo: string | null
  devolvido_em: string | null
  devolvido_por: string | null
  faturado_em: string | null
  faturado_por: string | null
  aprovado_financeiro: boolean
  aprovado_em: string | null
  aprovado_por: string | null
  pre_venda: boolean
  created_by: string
  created_at: string
  // joined field (from select with relation)
  vendedores?: { nome: string } | null
}

export interface DashboardFilters {
  dia: number | null
  mes: number | null
  ano: number | null
  filialId: string | null
  estado: string | null
  tipoOperacao: string | null
  vendedorId: string | null
  meioPagamento: string | null
  clienteSearch: string | null
}

export interface DashboardKpis {
  faturamento: number
  nf_count: number
  clientes: number
  ticket_medio: number
  a_faturar: number
  transferencias: number
  meta: number
  crescimento_pct: number
}
