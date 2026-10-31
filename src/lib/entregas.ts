export type EntregaStatus = 'aguardando_despacho' | 'em_transito' | 'entregue' | 'finalizado'

// Linha da lista da logística (função logistica_entregas): a entrega + o pedido do
// CRM + a NF (número do faturamento; valor/emissão/UF quando a nota já foi anexada).
export interface Entrega {
  id: string
  status: EntregaStatus
  transportadora: string | null
  codigo_rastreio: string | null
  previsao_chegada: string | null // YYYY-MM-DD
  ocorrencia: boolean
  despachado_em: string | null
  entregue_em: string | null
  recebido_por: string | null
  finalizado_em: string | null
  created_at: string
  pedido_id: string
  pedido_numero: number
  cliente: string
  vendedor: string
  origem: string | null
  volumes: number | null
  numero_nf: string | null
  faturado_em: string | null
  id_externo: string | null // preenchido = o pedido veio do CRM
  observacao: string | null
  nf_valor: number | null
  nf_emissao: string | null
  nf_estado: string | null
  ultima_ocorrencia: string | null
  ultimo_registro_em: string | null
}

export interface EntregaHistorico {
  quando: string
  origem: 'pedido' | 'entrega'
  tipo: string
  texto: string | null
  previsao: string | null
  por: string | null
}

export const COLUNAS_ENTREGA: { status: EntregaStatus; titulo: string; icone: string; ajuda: string }[] = [
  { status: 'aguardando_despacho', titulo: 'Aguardando despacho', icone: 'inventory_2', ajuda: 'Faturados, ainda sem transportadora' },
  { status: 'em_transito', titulo: 'Em trânsito', icone: 'local_shipping', ajuda: 'A caminho do cliente' },
  { status: 'entregue', titulo: 'Entregues', icone: 'where_to_vote', ajuda: 'Chegaram — falta finalizar o ciclo' },
  { status: 'finalizado', titulo: 'Finalizados', icone: 'task_alt', ajuda: 'Ciclo encerrado (últimos 30 dias)' },
]

// Data de hoje no fuso do navegador, em YYYY-MM-DD (toISOString usaria UTC).
export function hojeIso(): string {
  return new Date().toLocaleDateString('sv-SE')
}

// Dias de atraso da previsão (0 = em dia ou sem previsão). Só conta enquanto a carga não chegou.
export function diasDeAtraso(e: Pick<Entrega, 'status' | 'previsao_chegada'>, hoje = hojeIso()): number {
  if (!e.previsao_chegada || (e.status !== 'em_transito' && e.status !== 'aguardando_despacho')) return 0
  if (e.previsao_chegada >= hoje) return 0
  const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  return Math.round((dia(hoje) - dia(e.previsao_chegada)) / 86_400_000)
}

// "há 3 dias", "há 5 h", "agora" — pra mostrar quanto tempo está parado.
export function haQuanto(iso: string | null, agora = Date.now()): string {
  if (!iso) return ''
  const horas = Math.max((agora - new Date(iso).getTime()) / 3_600_000, 0)
  if (horas < 1) return 'agora há pouco'
  if (horas < 24) return `há ${Math.floor(horas)} h`
  const dias = Math.floor(horas / 24)
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}
