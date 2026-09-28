import type { OfxTransacao } from './ofxParser'

export type CategoriaCredito = 'identificavel' | 'cartao' | 'boletos_lote' | 'outro'

// Raízes de CNPJ da própria empresa: transferência entre contas nossas não é
// pagamento de cliente.
const CNPJ_RAIZ_PROPRIOS = ['05502390']

const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/

export function extrairDocumento(memo: string): string | null {
  const achado = memo.match(CNPJ_RE)?.[0] ?? memo.match(CPF_RE)?.[0]
  return achado ? achado.replace(/\D/g, '') : null
}

export function apenasDigitos(valor: string | null | undefined): string | null {
  const d = valor?.replace(/\D/g, '')
  return d ? d : null
}

// null = lançamento que nunca é pagamento de cliente (saldo, aplicação,
// transferência entre contas próprias) e nem entra na conciliação.
export function classificar(t: OfxTransacao): { categoria: CategoriaCredito; documento: string | null } | null {
  const memo = t.memo.toUpperCase()
  if (
    /^SALDO/.test(memo) ||
    /RESGATE|APLIC|REND\.? PAGO|^RENDIMENTOS/.test(memo) ||
    /TRANSFER\S*\s+AUTOM/.test(memo)
  ) {
    return null
  }
  const documento = extrairDocumento(t.memo)
  if (documento && CNPJ_RAIZ_PROPRIOS.some((raiz) => documento.startsWith(raiz))) return null
  if (/RECEBIMENTO REDE|\bREDE (VISA|MAST|ELO)/.test(memo)) return { categoria: 'cartao', documento }
  if (/^BOLETOS RECEBIDOS/.test(memo)) return { categoria: 'boletos_lote', documento: null }
  if (documento) return { categoria: 'identificavel', documento }
  return { categoria: 'outro', documento: null }
}

export interface TituloAberto {
  id: string
  invoiceId: string
  documento: string | null
  saldo: number
  vencimento: string
  numeroNf: string
  cliente: string
}

export interface NotaSemComprovante {
  invoiceId: string
  documento: string | null
  saldo: number
  numeroNf: string
  cliente: string
  dataEmissao: string
}

export type ResultadoMatch =
  | { tipo: 'titulos'; titulos: TituloAberto[]; detalhe: string }
  | { tipo: 'nota'; nota: NotaSemComprovante; detalhe: string }
  | { tipo: 'nenhum'; motivo: string }

const iguais = (a: number, b: number) => Math.abs(a - b) < 0.005

// Combinações de até `max` títulos que somam exatamente o valor (cliente que
// pagou várias parcelas de uma vez).
function combinacoes(titulos: TituloAberto[], alvo: number, max: number): TituloAberto[][] {
  const achadas: TituloAberto[][] = []
  const pool = titulos.slice(0, 18)
  function busca(inicio: number, atual: TituloAberto[], soma: number) {
    if (atual.length > 0 && iguais(soma, alvo)) achadas.push([...atual])
    if (atual.length === max || achadas.length > 1) return
    for (let i = inicio; i < pool.length; i++) {
      if (soma + pool[i].saldo > alvo + 0.005) continue
      atual.push(pool[i])
      busca(i + 1, atual, soma + pool[i].saldo)
      atual.pop()
    }
  }
  busca(0, [], 0)
  return achadas
}

// Só casa quando dá pra ter certeza: CNPJ/CPF do pagador é o do cliente da
// nota e o valor bate exatamente. Na dúvida devolve 'nenhum' (revisão manual).
export function casar(
  t: OfxTransacao,
  documento: string,
  titulos: TituloAberto[],
  notas: NotaSemComprovante[]
): ResultadoMatch {
  const doDoc = titulos
    .filter((x) => x.documento === documento)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  const notasDoDoc = notas.filter((n) => n.documento === documento)

  const titulosExatos = doDoc.filter((x) => iguais(x.saldo, t.valor))
  const notasExatas = notasDoDoc.filter((n) => iguais(n.saldo, t.valor))

  if (titulosExatos.length === 0 && notasExatas.length === 1) {
    const nota = notasExatas[0]
    return { tipo: 'nota', nota, detalhe: `Comprovante na NF ${nota.numeroNf}` }
  }
  if (notasExatas.length === 0 && titulosExatos.length >= 1) {
    const escolhido = titulosExatos[0]
    const extra =
      titulosExatos.length > 1 ? ` (mais antigo entre ${titulosExatos.length} títulos de mesmo valor)` : ''
    return { tipo: 'titulos', titulos: [escolhido], detalhe: `Título da NF ${escolhido.numeroNf}${extra}` }
  }
  if (titulosExatos.length + notasExatas.length > 1) {
    return { tipo: 'nenhum', motivo: 'Mais de uma nota/título com esse valor pro mesmo cliente' }
  }

  const combos = combinacoes(doDoc, t.valor, 4)
  if (combos.length === 1) {
    const nfs = Array.from(new Set(combos[0].map((c) => c.numeroNf))).join(', ')
    return { tipo: 'titulos', titulos: combos[0], detalhe: `${combos[0].length} títulos somados (NF ${nfs})` }
  }
  if (combos.length > 1) return { tipo: 'nenhum', motivo: 'Mais de uma combinação de títulos soma esse valor' }

  if (doDoc.length === 0 && notasDoDoc.length === 0) {
    return { tipo: 'nenhum', motivo: 'Nenhum título/nota em aberto pra esse CNPJ/CPF' }
  }
  return { tipo: 'nenhum', motivo: 'Nenhum título/nota em aberto com esse valor (juros? pagamento parcial?)' }
}
