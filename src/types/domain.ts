export type UserRole = 'faturista' | 'diretor'

export type ModalidadePagamento = 'Simples' | 'Misto'

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
}

export interface Vendedor {
  id: string
  nome: string
  ativo: boolean
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
  afeta_faturamento: boolean
  xml_chave_acesso: string | null
  xml_raw: string | null
  created_by: string
  created_at: string
  // joined fields (from select with relations)
  filiais?: { nome: string }
  vendedores?: { nome: string }
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
