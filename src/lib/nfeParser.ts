// Parses a Brazilian NFe (Nota Fiscal Eletrônica) XML file in the browser.
// NFe XML is namespaced (xmlns="http://www.portalfiscal.inf.br/nfe"), so we
// look up elements by local tag name instead of relying on the namespace URI.

export interface ParsedNFe {
  numeroNf: string
  dataEmissao: string // yyyy-mm-dd
  naturezaOperacao: string
  cliente: string
  uf: string
  valorTotal: number
  frete: number
  formaPagamento: string
  chaveAcesso: string | null
}

export class NFeParseError extends Error {}

const TPAG_LABELS: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '14': 'Duplicata Mercantil',
  '15': 'Boleto',
  '16': 'Depósito Bancário',
  '17': 'PIX',
  '18': 'Transferência Bancária',
  '19': 'Cashback',
  '90': 'Sem Pagamento',
  '99': 'Outros',
}

function firstByLocalName(root: Element | Document, name: string): Element | null {
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if (el.localName === name) return el
  }
  return null
}

function textOf(root: Element | Document, name: string): string {
  return firstByLocalName(root, name)?.textContent?.trim() ?? ''
}

export function parseNFeXml(xmlText: string): ParsedNFe {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')

  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) {
    throw new NFeParseError('Arquivo XML inválido ou corrompido.')
  }

  const infNFe = firstByLocalName(doc, 'infNFe')
  if (!infNFe) {
    throw new NFeParseError('Este arquivo não parece ser o XML de uma NF-e (elemento infNFe não encontrado).')
  }

  const numeroNf = textOf(infNFe, 'nNF')
  if (!numeroNf) {
    throw new NFeParseError('Número da NF (nNF) não encontrado no XML.')
  }

  const dhEmi = textOf(infNFe, 'dhEmi') || textOf(infNFe, 'dEmi')
  const dataEmissao = dhEmi ? dhEmi.slice(0, 10) : ''

  const naturezaOperacao = textOf(infNFe, 'natOp')

  const dest = firstByLocalName(infNFe, 'dest')
  const cliente = dest ? textOf(dest, 'xNome') : ''
  const uf = dest ? textOf(dest, 'UF') : ''

  const icmsTot = firstByLocalName(infNFe, 'ICMSTot')
  const valorTotal = icmsTot ? Number(textOf(icmsTot, 'vNF') || '0') : 0
  const frete = icmsTot ? Number(textOf(icmsTot, 'vFrete') || '0') : 0

  const detPag = firstByLocalName(infNFe, 'detPag')
  const tPag = detPag ? textOf(detPag, 'tPag') : ''
  const formaPagamento = TPAG_LABELS[tPag] ?? (tPag ? `Outros (${tPag})` : '')

  let chaveAcesso: string | null = null
  const idAttr = infNFe.getAttribute('Id')
  if (idAttr) {
    chaveAcesso = idAttr.replace(/^NFe/i, '')
  } else {
    const chNFe = firstByLocalName(doc, 'chNFe')
    if (chNFe?.textContent) chaveAcesso = chNFe.textContent.trim()
  }

  return {
    numeroNf,
    dataEmissao,
    naturezaOperacao,
    cliente,
    uf,
    valorTotal,
    frete,
    formaPagamento,
    chaveAcesso,
  }
}
