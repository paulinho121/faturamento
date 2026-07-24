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
  valorIcms: number
  valorIpi: number
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

// Prefixo (2 primeiros dígitos) do código IBGE do município → UF. Usado só
// pra NFS-e (padrão nacional), que traz o município como código IBGE em vez
// de sigla — a NF-e de produto já traz a UF pronta, não precisa disso.
const UF_POR_PREFIXO_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}

function ufFromCodigoIbge(cMun: string): string {
  return UF_POR_PREFIXO_IBGE[cMun.slice(0, 2)] ?? ''
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
    if (!infNFe) {
      const infNFSe = firstByLocalName(doc, 'infNFSe')
      return infNFSe ? parseNFSeDetalhes(infNFSe) : null
    }

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

// Espelho da NFS-e: não tem itens de produto, então mostra a descrição do
// serviço como se fosse um item único — reaproveita a mesma tabela/cartão do
// espelho sem precisar de um layout novo.
function parseNFSeDetalhes(infNFSe: Element): NFeDetalhes | null {
  const infDPS = firstByLocalName(infNFSe, 'infDPS')
  const emit = firstByLocalName(infNFSe, 'emit')
  const toma = infDPS ? firstByLocalName(infDPS, 'toma') : null
  const cServ = infDPS ? firstByLocalName(infDPS, 'cServ') : null
  const valoresNFSe = firstByLocalName(infNFSe, 'valores')
  const vServPrest = infDPS ? firstByLocalName(infDPS, 'vServPrest') : null

  const valorServico =
    (vServPrest ? Number(textOf(vServPrest, 'vServ') || '0') : 0) ||
    (valoresNFSe ? Number(textOf(valoresNFSe, 'vLiq') || '0') : 0)

  const emitEndNac = emit ? firstByLocalName(emit, 'enderNac') : null
  const emitEndereco = [
    emitEndNac ? [textOf(emitEndNac, 'xLgr'), textOf(emitEndNac, 'nro')].filter(Boolean).join(', ') : '',
    emitEndNac ? textOf(emitEndNac, 'xBairro') : '',
    textOf(infNFSe, 'xLocEmi'),
    emitEndNac ? textOf(emitEndNac, 'CEP') : '',
  ]
    .filter(Boolean)
    .join(' — ')

  const tomaEndNac = toma ? firstByLocalName(toma, 'endNac') : null
  const tomaUf = tomaEndNac ? ufFromCodigoIbge(textOf(tomaEndNac, 'cMun')) : ''
  const destEndereco = [
    toma ? [textOf(toma, 'xLgr'), textOf(toma, 'nro')].filter(Boolean).join(', ') : '',
    toma ? textOf(toma, 'xBairro') : '',
    tomaUf,
    tomaEndNac ? textOf(tomaEndNac, 'CEP') : '',
  ]
    .filter(Boolean)
    .join(' — ')

  let chaveAcesso: string | null = null
  const idAttr = infNFSe.getAttribute('Id')
  if (idAttr) chaveAcesso = idAttr.replace(/^NFS/i, '')

  const vISSQN = valoresNFSe ? Number(textOf(valoresNFSe, 'vISSQN') || '0') : 0
  const pAliqAplic = valoresNFSe ? textOf(valoresNFSe, 'pAliqAplic') : ''
  const informacoesComplementares =
    vISSQN > 0 ? `ISS: R$ ${vISSQN.toFixed(2).replace('.', ',')}${pAliqAplic ? ` (${pAliqAplic}%)` : ''}` : ''

  return {
    serie: infDPS ? textOf(infDPS, 'serie') : '',
    naturezaOperacao: textOf(infNFSe, 'xTribNac') || 'Serviço',
    chaveAcesso,
    protocolo: '',
    dataAutorizacao: textOf(infNFSe, 'dhProc').slice(0, 16).replace('T', ' '),
    emitNome: emit ? textOf(emit, 'xNome') : '',
    emitCnpj: emit ? textOf(emit, 'CNPJ') : '',
    emitEndereco,
    destNome: toma ? textOf(toma, 'xNome') : '',
    destCnpjCpf: toma ? textOf(toma, 'CNPJ') || textOf(toma, 'CPF') : '',
    destEndereco,
    itens: cServ
      ? [
          {
            codigo: textOf(cServ, 'cTribNac'),
            descricao: textOf(cServ, 'xDescServ'),
            ncm: '',
            cfop: '',
            unidade: '',
            quantidade: 1,
            valorUnitario: valorServico,
            valorTotal: valorServico,
          },
        ]
      : [],
    valorProdutos: valorServico,
    valorFrete: 0,
    valorDesconto: 0,
    valorIpi: 0,
    valorIcms: 0,
    informacoesComplementares,
  }
}

// NF-e "de produto" (a de sempre) e NFS-e (nota de serviço, padrão nacional
// unificado — xmlns sped.fazenda.gov.br/nfse, raiz <NFSe>/<infNFSe>) têm
// esquemas de XML completamente diferentes. Detecta qual é pela presença de
// <infNFe> (produto) ou <infNFSe> (serviço) e delega pro parser certo — os
// dois devolvem o mesmo formato ParsedNFe, então o resto do fluxo de upload
// (match de filial, formulário de revisão etc.) não precisa saber a diferença.
export function parseNFeXml(xmlText: string): ParsedNFe {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')

  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) {
    throw new NFeParseError('Arquivo XML inválido ou corrompido.')
  }

  const infNFe = firstByLocalName(doc, 'infNFe')
  if (infNFe) return parseNFeProdutoXml(doc, infNFe)

  const infNFSe = firstByLocalName(doc, 'infNFSe')
  if (infNFSe) return parseNFSeXml(infNFSe)

  throw new NFeParseError(
    'Este arquivo não parece ser o XML de uma NF-e ou NFS-e (elementos infNFe/infNFSe não encontrados).'
  )
}

function parseNFeProdutoXml(doc: Document, infNFe: Element): ParsedNFe {
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
  const valorIcms = icmsTot ? Number(textOf(icmsTot, 'vICMS') || '0') : 0
  const valorIpi = icmsTot ? Number(textOf(icmsTot, 'vIPI') || '0') : 0

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
    valorIcms,
    valorIpi,
    formaPagamento,
    chaveAcesso,
    emitCnpj,
    emitMunicipio,
    emitUf,
  }
}

// NFS-e — padrão nacional (DPS/ADN), usado por prestação de serviço (ex.:
// assistência técnica emitida pela filial SP). Não tem produtos, ICMS, frete
// nem forma de pagamento — só o valor do serviço; esses campos ficam 0/vazio
// e seguem editáveis na revisão, igual qualquer dado que falte no XML.
function parseNFSeXml(infNFSe: Element): ParsedNFe {
  const numeroNf = textOf(infNFSe, 'nNFSe')
  if (!numeroNf) {
    throw new NFeParseError('Número da NFS-e (nNFSe) não encontrado no XML.')
  }

  const infDPS = firstByLocalName(infNFSe, 'infDPS')
  const dhEmi = infDPS ? textOf(infDPS, 'dhEmi') : ''
  const dCompet = infDPS ? textOf(infDPS, 'dCompet') : ''
  const dataEmissao = (dhEmi || dCompet).slice(0, 10)

  const toma = infDPS ? firstByLocalName(infDPS, 'toma') : null
  const cliente = toma ? textOf(toma, 'xNome') : ''
  const clienteCnpjCpf = toma ? (textOf(toma, 'CNPJ') || textOf(toma, 'CPF')).replace(/\D/g, '') || null : null
  const enderTomaNac = toma ? firstByLocalName(toma, 'endNac') : null
  const clienteCidadeIbge = enderTomaNac ? textOf(enderTomaNac, 'cMun') : ''
  const uf = clienteCidadeIbge ? ufFromCodigoIbge(clienteCidadeIbge) : ''

  const emit = firstByLocalName(infNFSe, 'emit')
  const emitCnpj = emit ? textOf(emit, 'CNPJ').replace(/\D/g, '') || null : null
  const emitMunicipio = textOf(infNFSe, 'xLocEmi')
  const emitUf = ufFromCodigoIbge(textOf(infNFSe, 'cLocIncid'))

  // vLiq (nível infNFSe) é o valor total da nota; cai pro vServ da DPS se por
  // algum motivo vier vazio.
  const valoresNFSe = firstByLocalName(infNFSe, 'valores')
  const vServPrest = infDPS ? firstByLocalName(infDPS, 'vServPrest') : null
  const valorTotal =
    (valoresNFSe ? Number(textOf(valoresNFSe, 'vLiq') || '0') : 0) ||
    (vServPrest ? Number(textOf(vServPrest, 'vServ') || '0') : 0)

  let chaveAcesso: string | null = null
  const idAttr = infNFSe.getAttribute('Id')
  if (idAttr) chaveAcesso = idAttr.replace(/^NFS/i, '')

  return {
    numeroNf,
    dataEmissao,
    naturezaOperacao: 'Serviço', // NFS-e é sempre prestação de serviço, por definição
    tpNF: '1',
    cliente,
    clienteCnpjCpf,
    clienteCidade: '',
    uf,
    valorTotal,
    frete: 0,
    valorDifal: 0,
    valorFcp: 0,
    valorIcms: 0,
    valorIpi: 0,
    formaPagamento: '',
    chaveAcesso,
    emitCnpj,
    emitMunicipio,
    emitUf,
  }
}
