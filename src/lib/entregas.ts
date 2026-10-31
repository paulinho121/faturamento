import { supabase } from './supabaseClient'

export type EntregaStatus = 'aguardando_despacho' | 'em_transito' | 'entregue' | 'finalizado'

// Linha da lista da logística (função logistica_entregas): a entrega + o pedido do
// CRM + a NF (número do faturamento; valor/emissão/UF quando a nota já foi anexada).
export interface Entrega {
  id: string
  status: EntregaStatus
  tipo_entrega: 'transportadora' | 'retirada' // retirada = o cliente buscou na MCI
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
  arquivo_path: string | null // orçamento do vendedor (PDF do pedido)
  arquivo_nome: string | null
  nf_valor: number | null
  nf_emissao: string | null
  nf_estado: string | null
  ultima_ocorrencia: string | null
  ultimo_registro_em: string | null
  cartas_correcao: number // cartas de correção (CC-e) anexadas
}

export interface EntregaHistorico {
  quando: string
  origem: 'pedido' | 'entrega'
  tipo: string
  texto: string | null
  previsao: string | null
  por: string | null
  arquivo_path: string | null // anexo do registro (foto/PDF)
  arquivo_nome: string | null
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

// Anexos da logística (foto do comprovante, da carga com problema…): bucket privado "entregas".
export const ACEITA_ANEXO = 'image/*,application/pdf,.xml,application/xml,text/xml'
const BUCKET_ANEXOS = 'entregas'
const LIMITE_ANEXO_BYTES = 15 * 1024 * 1024

export async function enviarAnexo(entregaId: string, arquivo: File): Promise<{ path: string; nome: string }> {
  if (arquivo.size > LIMITE_ANEXO_BYTES) throw new Error('O arquivo passa de 15 MB.')
  const seguro = arquivo.name.replace(/[^\w.-]+/g, '_')
  const path = `${entregaId}/${Date.now()}-${seguro}`
  const { error } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, arquivo, { contentType: arquivo.type || undefined })
  if (error) throw new Error(`Não consegui enviar o arquivo: ${error.message}`)
  return { path, nome: arquivo.name }
}

// Abre o anexo numa aba nova (link temporário). A aba abre antes da espera pra o
// navegador não bloquear como pop-up.
export async function abrirAnexo(path: string): Promise<void> {
  const aba = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(path, 300)
  if (error || !data) {
    aba?.close()
    throw new Error(`Não consegui abrir o anexo: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  if (aba) aba.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

// Orçamento do vendedor: o PDF do pedido (bucket "pedidos").
export async function baixarOrcamento(path: string, nome: string): Promise<void> {
  const { data, error } = await supabase.storage.from('pedidos').download(path)
  if (error || !data) throw new Error(`Não consegui baixar o orçamento: ${error?.message ?? 'arquivo não encontrado'}`)
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Uma cor por processo (nas colunas, cartões, selos e filtros). As classes ficam escritas
// por inteiro pra o Tailwind enxergar; o vermelho fica reservado pra problema/atraso.
export const ESTILO_STATUS: Record<
  EntregaStatus,
  { selo: string; cabecalho: string; bordaEsq: string; fundo: string; ponto: string; chipAtivo: string; chip: string }
> = {
  aguardando_despacho: {
    selo: 'bg-amber-100 text-amber-900',
    cabecalho: 'bg-amber-100 text-amber-900',
    bordaEsq: 'border-l-amber-500',
    fundo: 'bg-amber-50/60',
    ponto: 'bg-amber-500',
    chipAtivo: 'border-amber-600 bg-amber-500 text-white',
    chip: 'border-amber-300 text-amber-900 hover:bg-amber-50',
  },
  em_transito: {
    selo: 'bg-sky-100 text-sky-900',
    cabecalho: 'bg-sky-100 text-sky-900',
    bordaEsq: 'border-l-sky-500',
    fundo: 'bg-sky-50/60',
    ponto: 'bg-sky-500',
    chipAtivo: 'border-sky-600 bg-sky-500 text-white',
    chip: 'border-sky-300 text-sky-900 hover:bg-sky-50',
  },
  entregue: {
    selo: 'bg-emerald-100 text-emerald-900',
    cabecalho: 'bg-emerald-100 text-emerald-900',
    bordaEsq: 'border-l-emerald-500',
    fundo: 'bg-emerald-50/60',
    ponto: 'bg-emerald-500',
    chipAtivo: 'border-emerald-600 bg-emerald-500 text-white',
    chip: 'border-emerald-300 text-emerald-900 hover:bg-emerald-50',
  },
  finalizado: {
    selo: 'bg-slate-200 text-slate-700',
    cabecalho: 'bg-slate-200 text-slate-700',
    bordaEsq: 'border-l-slate-400',
    fundo: 'bg-slate-50',
    ponto: 'bg-slate-400',
    chipAtivo: 'border-slate-600 bg-slate-500 text-white',
    chip: 'border-slate-300 text-slate-700 hover:bg-slate-100',
  },
}

// "30/10" a partir de YYYY-MM-DD.
export function dataCurta(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''
}

// O que mostrar como "quem leva": a transportadora ou "Retirada na MCI".
export function rotuloTransporte(e: Pick<Entrega, 'tipo_entrega' | 'transportadora'>): string | null {
  return e.tipo_entrega === 'retirada' ? 'Retirada na MCI' : e.transportadora
}
