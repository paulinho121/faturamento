import { directChildrenByLocalName, firstByLocalName, textOf } from './nfeParser'

export interface DanfePessoa {
  nome: string
  doc: string // CNPJ ou CPF, só dígitos
  ie: string
  logradouro: string
  bairro: string
  municipio: string
  uf: string
  cep: string
  fone: string
}

export interface DanfeItem {
  codigo: string
  descricao: string
  ncm: string
  cst: string // origem + CST (ou CSOSN), como no DANFE
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  baseIcms: number
  valorIcms: number
  valorIpi: number
  aliqIcms: number
  aliqIpi: number
}

export interface DanfeVolume {
  quantidade: string
  especie: string
  marca: string
  numeracao: string
  pesoBruto: string
  pesoLiquido: string
}

// Tudo que o DANFE da NF-e de produto mostra, lido do XML da nota.
export interface Danfe {
  numero: string
  serie: string
  naturezaOperacao: string
  tipo: string // 0 entrada, 1 saída
  emissao: string // yyyy-mm-dd
  saida: string // yyyy-mm-dd
  horaSaida: string
  chave: string
  protocolo: string
  dataProtocolo: string // dd/mm/aaaa hh:mm:ss
  refPedido: string // número do pedido do ERP (xPed), quando a nota traz
  emit: DanfePessoa & { iest: string }
  dest: DanfePessoa
  total: {
    baseIcms: number
    icms: number
    baseIcmsSt: number
    icmsSt: number
    produtos: number
    frete: number
    seguro: number
    desconto: number
    outras: number
    ipi: number
    nota: number
  }
  transp: {
    modalidade: string
    nome: string
    doc: string
    ie: string
    endereco: string
    municipio: string
    uf: string
    placa: string
    ufPlaca: string
    antt: string
    volumes: DanfeVolume[]
  }
  duplicatas: { numero: string; vencimento: string; valor: number }[]
  itens: DanfeItem[]
  infCpl: string
  infFisco: string
}

const num = (v: string) => Number(v || '0') || 0

function pessoa(el: Element | null, enderTag: string): DanfePessoa {
  const end = el ? firstByLocalName(el, enderTag) : null
  return {
    nome: el ? textOf(el, 'xNome') : '',
    doc: el ? textOf(el, 'CNPJ') || textOf(el, 'CPF') : '',
    ie: el ? textOf(el, 'IE') : '',
    logradouro: end ? [textOf(end, 'xLgr'), textOf(end, 'nro'), textOf(end, 'xCpl')].filter(Boolean).join(', ') : '',
    bairro: end ? textOf(end, 'xBairro') : '',
    municipio: end ? textOf(end, 'xMun') : '',
    uf: end ? textOf(end, 'UF') : '',
    cep: end ? textOf(end, 'CEP') : '',
    fone: end ? textOf(end, 'fone') : '',
  }
}

function dataHora(iso: string): string {
  // 2026-10-30T10:48:00-03:00 -> 30/10/2026 10:48:00
  if (iso.length < 19) return iso
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`
}

// Lê o XML da NF-e de produto pra montar o DANFE. Nunca lança erro: null se o XML
// estiver corrompido ou não for NF-e de produto (NFS-e não tem DANFE).
export function parseDanfe(xmlText: string): Danfe | null {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
    if (doc.getElementsByTagName('parsererror')[0]) return null
    const infNFe = firstByLocalName(doc, 'infNFe')
    if (!infNFe) return null

    const ide = firstByLocalName(infNFe, 'ide')
    const emit = firstByLocalName(infNFe, 'emit')
    const dest = firstByLocalName(infNFe, 'dest')
    const tot = firstByLocalName(infNFe, 'ICMSTot')
    const transp = firstByLocalName(infNFe, 'transp')
    const transporta = transp ? firstByLocalName(transp, 'transporta') : null
    const veic = transp ? firstByLocalName(transp, 'veicTransp') : null
    const infProt = firstByLocalName(doc, 'infProt')
    const infAdic = firstByLocalName(infNFe, 'infAdic')

    const dhEmi = ide ? textOf(ide, 'dhEmi') || textOf(ide, 'dEmi') : ''
    const dhSai = ide ? textOf(ide, 'dhSaiEnt') || textOf(ide, 'dSaiEnt') : ''
    const t = (tag: string) => (tot ? num(textOf(tot, tag)) : 0)

    const itens: DanfeItem[] = directChildrenByLocalName(infNFe, 'det').map((det) => {
      const prod = firstByLocalName(det, 'prod')
      const imposto = firstByLocalName(det, 'imposto')
      const icmsGrupo = imposto ? firstByLocalName(imposto, 'ICMS') : null
      const icms = icmsGrupo ? (icmsGrupo.children[0] ?? null) : null
      const ipi = imposto ? firstByLocalName(imposto, 'IPITrib') : null
      return {
        codigo: prod ? textOf(prod, 'cProd') : '',
        descricao: prod ? textOf(prod, 'xProd') : '',
        ncm: prod ? textOf(prod, 'NCM') : '',
        cst: icms ? `${textOf(icms, 'orig')}${textOf(icms, 'CST') || textOf(icms, 'CSOSN')}` : '',
        cfop: prod ? textOf(prod, 'CFOP') : '',
        unidade: prod ? textOf(prod, 'uCom') : '',
        quantidade: prod ? num(textOf(prod, 'qCom')) : 0,
        valorUnitario: prod ? num(textOf(prod, 'vUnCom')) : 0,
        valorTotal: prod ? num(textOf(prod, 'vProd')) : 0,
        baseIcms: icms ? num(textOf(icms, 'vBC')) : 0,
        valorIcms: icms ? num(textOf(icms, 'vICMS')) : 0,
        valorIpi: ipi ? num(textOf(ipi, 'vIPI')) : 0,
        aliqIcms: icms ? num(textOf(icms, 'pICMS')) : 0,
        aliqIpi: ipi ? num(textOf(ipi, 'pIPI')) : 0,
      }
    })

    const volumes: DanfeVolume[] = transp
      ? directChildrenByLocalName(transp, 'vol').map((v) => ({
          quantidade: textOf(v, 'qVol'),
          especie: textOf(v, 'esp'),
          marca: textOf(v, 'marca'),
          numeracao: textOf(v, 'nVol'),
          pesoBruto: textOf(v, 'pesoB'),
          pesoLiquido: textOf(v, 'pesoL'),
        }))
      : []

    const duplicatas = Array.from(infNFe.getElementsByTagName('*'))
      .filter((el) => el.localName === 'dup')
      .map((d) => ({ numero: textOf(d, 'nDup'), vencimento: textOf(d, 'dVenc'), valor: num(textOf(d, 'vDup')) }))

    const idAttr = infNFe.getAttribute('Id')
    const emitPessoa = pessoa(emit, 'enderEmit')

    return {
      numero: ide ? textOf(ide, 'nNF') : '',
      serie: ide ? textOf(ide, 'serie') : '',
      naturezaOperacao: ide ? textOf(ide, 'natOp') : '',
      tipo: ide ? textOf(ide, 'tpNF') : '1',
      emissao: dhEmi.slice(0, 10),
      saida: (dhSai || dhEmi).slice(0, 10),
      horaSaida: (dhSai || dhEmi).slice(11, 19),
      chave: idAttr ? idAttr.replace(/^NFe/i, '') : '',
      protocolo: infProt ? textOf(infProt, 'nProt') : '',
      dataProtocolo: infProt ? dataHora(textOf(infProt, 'dhRecbto')) : '',
      refPedido: textOf(infNFe, 'xPed'),
      emit: { ...emitPessoa, iest: emit ? textOf(emit, 'IEST') : '' },
      dest: pessoa(dest, 'enderDest'),
      total: {
        baseIcms: t('vBC'),
        icms: t('vICMS'),
        baseIcmsSt: t('vBCST'),
        icmsSt: t('vST'),
        produtos: t('vProd'),
        frete: t('vFrete'),
        seguro: t('vSeg'),
        desconto: t('vDesc'),
        outras: t('vOutro'),
        ipi: t('vIPI'),
        nota: t('vNF'),
      },
      transp: {
        modalidade: transp ? textOf(transp, 'modFrete') : '',
        nome: transporta ? textOf(transporta, 'xNome') : '',
        doc: transporta ? textOf(transporta, 'CNPJ') || textOf(transporta, 'CPF') : '',
        ie: transporta ? textOf(transporta, 'IE') : '',
        endereco: transporta ? textOf(transporta, 'xEnder') : '',
        municipio: transporta ? textOf(transporta, 'xMun') : '',
        uf: transporta ? textOf(transporta, 'UF') : '',
        placa: veic ? textOf(veic, 'placa') : '',
        ufPlaca: veic ? textOf(veic, 'UF') : '',
        antt: veic ? textOf(veic, 'RNTC') : '',
        volumes,
      },
      duplicatas,
      itens,
      infCpl: infAdic ? textOf(infAdic, 'infCpl') : '',
      infFisco: infAdic ? textOf(infAdic, 'infAdFisco') : '',
    }
  } catch {
    return null
  }
}
