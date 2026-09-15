// Parser do XML de "Títulos" exportado do sistema de contas a receber da
// empresa (formato <table><row>...</row></table>, um <row> por parcela).
// Sempre em ISO-8859-1 — precisa decodificar do ArrayBuffer, não usar
// File.text() (que assume UTF-8 e corrompe acentos).

export interface TituloImportado {
  numeroTitulo: string // <numero> bruto, ex: "000562545-1/2" — chave de reimportação
  chcriacao: string
  numeroNf: string | null // NF extraída de <numero>/<observacao>, ex: "562545"
  numeroParcela: number
  nomeCliente: string
  cnpjCpf: string | null
  carteira: string
  vencimento: string // yyyy-mm-dd
  valor: number
  pago: boolean // <bxparcial> preenchido = baixado/quitado no sistema de origem
}

export class TitulosParseError extends Error {}

function textOf(row: Element, tag: string): string {
  return row.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
}

function parseNumeroENf(numero: string, observacao: string): { numeroNf: string | null; parcela: number } {
  // "000562545-1/2" -> NF 562545, parcela 1 de 2
  const m = numero.match(/^0*(\d+)-(\d+)\/(\d+)$/)
  if (m) return { numeroNf: m[1], parcela: Number(m[2]) }
  // fallback: "NF562545-01" (observacao) -> NF 562545, parcela 1
  const m2 = observacao.match(/NF\s*0*(\d+)-?(\d+)?/i)
  if (m2) return { numeroNf: m2[1], parcela: m2[2] ? Number(m2[2]) : 1 }
  return { numeroNf: null, parcela: 1 }
}

function parsePessoa(pessoa: string): { nome: string; cnpjCpf: string | null } {
  // "Papaya Cinema Digital Ltd - Papaya Cinema Digital Ltda (08.400.956/0001-92)"
  const cnpjMatch = pessoa.match(/\(([\d./-]+)\)\s*$/)
  const cnpjCpf = cnpjMatch ? cnpjMatch[1].replace(/\D/g, '') || null : null
  const semDocumento = pessoa.replace(/\s*\([\d./-]+\)\s*$/, '').trim()
  const nome = semDocumento.split(' - ')[0].trim() || semDocumento
  return { nome, cnpjCpf }
}

function parseDataBr(dataBr: string): string {
  const [d, m, y] = dataBr.split('/')
  if (!d || !m || !y) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export async function parseTitulosXml(file: File): Promise<TituloImportado[]> {
  const buffer = await file.arrayBuffer()
  const xmlText = new TextDecoder('iso-8859-1').decode(buffer)

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror')[0]) {
    throw new TitulosParseError('Arquivo XML inválido ou corrompido.')
  }

  const rows = Array.from(doc.getElementsByTagName('row'))
  if (rows.length === 0) {
    throw new TitulosParseError('Nenhum título encontrado neste XML (esperado <table><row>...</row></table>).')
  }

  return rows.map((row) => {
    const numero = textOf(row, 'numero')
    const observacao = textOf(row, 'observacao')
    const pessoa = textOf(row, 'pessoa')
    const vencimento = textOf(row, 'vencimento')
    const valor = Number(textOf(row, 'valor').replace(',', '.')) || 0
    const carteira = textOf(row, 'carteira')
    const chcriacao = textOf(row, 'chcriacao')
    const bxparcial = textOf(row, 'bxparcial')

    const { numeroNf, parcela } = parseNumeroENf(numero, observacao)
    const { nome, cnpjCpf } = parsePessoa(pessoa)

    return {
      numeroTitulo: numero || chcriacao,
      chcriacao,
      numeroNf,
      numeroParcela: parcela,
      nomeCliente: nome,
      cnpjCpf,
      carteira,
      vencimento: parseDataBr(vencimento),
      valor,
      pago: bxparcial.length > 0,
    }
  })
}
