// Parses a Brazilian NFe (Nota Fiscal Eletrônica) XML file in the browser.
// NFe XML is namespaced (xmlns="http://www.portalfiscal.inf.br/nfe"), so we
// look up elements by local tag name instead of relying on the namespace URI.

export interface ParsedNFe {
  numeroNf: string
  dataEmissao: string // yyyy-mm-dd
  naturezaOperacao: string
  tpNF: string // '0' entrada, '1' saída — used as a fallback hint for Tipo de Operação
  cliente: string
  clienteCnpjCpf: string | null
  clienteCidade: string
  uf: string
  valorTotal: number
  frete: number
  valorDifal: number // ICMS de partilha destinado à UF do destinatário (vICMSUFDest)
  valorFcp: number // Fundo de Combate à Pobreza da UF de destino (vFCPUFDest)
  formaPagamento: string
  chaveAcesso: string | null
  emitCnpj: string | null
  emitMunicipio: string
  emitUf: string
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

// Only direct children with this local name — used for <det> (repeats once per
// item), where a plain "find anywhere in subtree" would also match nested tags
// with the same name inside <imposto> etc.
function directChildrenByLocalName(root: Element, name: string): Element[] {
  const out: Element[] = []
  for (const child of Array.from(root.children)) {
    if (child.localName === name) out.push(child)
  }
  return out
}

function textOf(root: Element | Document, name: string): string {
  return firstByLocalName(root, name)?.textContent?.trim() ?? ''
}

function enderecoDe(root: Element | null): string {
  if (!root) return ''
  const partes = [
    [textOf(root, 'xLgr'), textOf(root, 'nro')].filter(Boolean).join(', '),
    textOf(root, 'xBairro'),
    [textOf(root, 'xMun'), textOf(root, 'UF')].filter(Boolean).join('/'),
    textOf(root, 'CEP'),
  ].filter(Boolean)
  return partes.join(' — ')
}

export interface NFeItemDetalhe {
  codigo: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}

export interface NFeDetalhes {
  serie: string
  naturezaOperacao: string
  chaveAcesso: string | null
  protocolo: string
  dataAutorizacao: string
  emitNome: string
  emitCnpj: string
  emitEndereco: string
  destNome: string
  destCnpjCpf: string
  destEndereco: string
  itens: NFeItemDetalhe[]
  valorProdutos: number
  valorFrete: number
  valorDesconto: number
  valorIpi: number
  valorIcms: number
  informacoesComplementares: string
}

// Parse mais completo, usado só na tela de "espelho da nota" (leitura), não no
// fluxo de upload — nunca lança erro, retorna null se o XML estiver corrompido
// ou faltar algo essencial, e o modal mostra um aviso em vez de quebrar.
export function parseNFeDetalhes(xmlText: string): NFeDetalhes | null {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
    if (doc.getElementsByTagName('parsererror')[0]) return null

    const infNFe = firstByLocalName(doc, 'infNFe')
    if (!infNFe) return null

    const emit = firstByLocalName(infNFe, 'emit')
    const dest = firstByLocalName(infNFe, 'dest')
    const icmsTot = firstByLocalName(infNFe, 'ICMSTot')
    const infProt = firstByLocalName(doc, 'infProt')

    const itens: NFeItemDetalhe[] = directChildrenByLocalName(infNFe, 'det').map((det) => {
      const prod = firstByLocalName(det, 'prod')
      return {
        codigo: prod ? textOf(prod, 'cProd') : '',
        descricao: prod ? textOf(prod, 'xProd') : '',
        ncm: prod ? textOf(prod, 'NCM') : '',
        cfop: prod ? textOf(prod, 'CFOP') : '',
        unidade: prod ? textOf(prod, 'uCom') : '',
        quantidade: prod ? Number(textOf(prod, 'qCom') || '0') : 0,
        valorUnitario: prod ? Number(textOf(prod, 'vUnCom') || '0') : 0,
        valorTotal: prod ? Number(textOf(prod, 'vProd') || '0') : 0,
      }
    })

    let chaveAcesso: string | null = null
    const idAttr = infNFe.getAttribute('Id')
    if (idAttr) chaveAcesso = idAttr.replace(/^NFe/i, '')

    return {
      serie: textOf(infNFe, 'serie'),
      naturezaOperacao: textOf(infNFe, 'natOp'),
      chaveAcesso,
      protocolo: infProt ? textOf(infProt, 'nProt') : '',
      dataAutorizacao: infProt ? textOf(infProt, 'dhRecbto').slice(0, 16).replace('T', ' ') : '',
      emitNome: emit ? textOf(emit, 'xNome') : '',
      emitCnpj: emit ? textOf(emit, 'CNPJ') : '',
      emitEndereco: emit ? enderecoDe(firstByLocalName(emit, 'enderEmit')) : '',
      destNome: dest ? textOf(dest, 'xNome') : '',
      destCnpjCpf: dest ? textOf(dest, 'CNPJ') || textOf(dest, 'CPF') : '',
      destEndereco: dest ? enderecoDe(firstByLocalName(dest, 'enderDest')) : '',
      itens,
      valorProdutos: icmsTot ? Number(textOf(icmsTot, 'vProd') || '0') : 0,
      valorFrete: icmsTot ? Number(textOf(icmsTot, 'vFrete') || '0') : 0,
      valorDesconto: icmsTot ? Number(textOf(icmsTot, 'vDesc') || '0') : 0,
      valorIpi: icmsTot ? Number(textOf(icmsTot, 'vIPI') || '0') : 0,
      valorIcms: icmsTot ? Number(textOf(icmsTot, 'vICMS') || '0') : 0,
      informacoesComplementares: textOf(infNFe, 'infCpl'),
    }
  } catch {
    return null
  }
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
  const tpNF = textOf(infNFe, 'tpNF')

  const dest = firstByLocalName(infNFe, 'dest')
  const cliente = dest ? textOf(dest, 'xNome') : ''
  const clienteCnpjCpf = dest
    ? (textOf(dest, 'CNPJ') || textOf(dest, 'CPF')).replace(/\D/g, '') || null
    : null
  const enderDest = dest ? firstByLocalName(dest, 'enderDest') : null
  const clienteCidade = enderDest ? textOf(enderDest, 'xMun') : ''
  const uf = dest ? textOf(dest, 'UF') : ''

  const emit = firstByLocalName(infNFe, 'emit')
  const emitCnpj = emit ? textOf(emit, 'CNPJ').replace(/\D/g, '') || null : null
  const enderEmit = emit ? firstByLocalName(emit, 'enderEmit') : null
  const emitMunicipio = enderEmit ? textOf(enderEmit, 'xMun') : ''
  const emitUf = enderEmit ? textOf(enderEmit, 'UF') : ''

  const icmsTot = firstByLocalName(infNFe, 'ICMSTot')
  const valorTotal = icmsTot ? Number(textOf(icmsTot, 'vNF') || '0') : 0
  const frete = icmsTot ? Number(textOf(icmsTot, 'vFrete') || '0') : 0
  const valorDifal = icmsTot ? Number(textOf(icmsTot, 'vICMSUFDest') || '0') : 0
  const valorFcp = icmsTot ? Number(textOf(icmsTot, 'vFCPUFDest') || '0') : 0

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
    tpNF,
    cliente,
    clienteCnpjCpf,
    clienteCidade,
    uf,
    valorTotal,
    frete,
    valorDifal,
    valorFcp,
    formaPagamento,
    chaveAcesso,
    emitCnpj,
    emitMunicipio,
    emitUf,
  }
}
