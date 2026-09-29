// Parser do arquivo de retorno bancário CNAB 400 (cobrança registrada,
// layout Itaú — posições confirmadas byte a byte contra o layout oficial
// e um arquivo .RET real). Sempre ISO-8859-1, largura fixa de 400 colunas
// por linha; só a linha tipo "1" (detalhe) interessa aqui.

export interface RetornoTitulo {
  nossoNumero: string // ex: "00003562" — número que o banco deu ao título
  usoDaEmpresa: string // identificador que nós demos ao gerar a remessa
  codigoOcorrencia: string
  ocorrenciaLabel: string
  liquidacao: boolean // true pra 06/15/17 — códigos que significam "pago"
  dataOcorrencia: string // yyyy-mm-dd
  vencimento: string | null // yyyy-mm-dd
  nomePagador: string
  valorTitulo: number
  tarifaCobranca: number
  valorIof: number
  valorAbatimento: number
  valorDesconto: number
  jurosMulta: number
  valorLiquido: number // valor principal — o que efetivamente caiu na conta (após tarifa)
  valorPago: number // valorTitulo - abatimento - desconto + juros/multa — o que o pagador quitou
  dataCredito: string | null // yyyy-mm-dd
}

export class RetornoParseError extends Error {}

const OCORRENCIAS: Record<string, string> = {
  '02': 'Confirmação de entrada',
  '03': 'Entrada rejeitada',
  '06': 'Liquidação normal',
  '09': 'Baixado',
  '10': 'Baixado conforme instruções',
  '11': 'Títulos em ser',
  '12': 'Confirmação de abatimento',
  '13': 'Confirmação de cancelamento de abatimento',
  '14': 'Confirmação de alteração de vencimento',
  '15': 'Liquidação em cartório',
  '17': 'Liquidação após baixa ou título não registrado',
  '19': 'Confirmação de instrução de protesto',
  '20': 'Confirmação de sustação de protesto',
  '23': 'Remessa a cartório',
  '24': 'Retirada de cartório',
  '25': 'Protestado',
  '27': 'Baixa de título protestado',
  '28': 'Débito de tarifas',
}

const CODIGOS_LIQUIDACAO = new Set(['06', '15', '17'])

// Campo com 11 dígitos inteiros + 2 decimais implícitos (9(11)V9(2)).
function valorDe(linha: string, inicio1: number, fim1: number): number {
  const bruto = linha.slice(inicio1 - 1, fim1)
  const n = Number(bruto)
  return Number.isFinite(n) ? n / 100 : 0
}

function dataDe(linha: string, inicio1: number, fim1: number): string | null {
  const bruto = linha.slice(inicio1 - 1, fim1)
  if (!/^\d{6}$/.test(bruto) || bruto === '000000') return null
  const dd = bruto.slice(0, 2)
  const mm = bruto.slice(2, 4)
  const aa = bruto.slice(4, 6)
  const ano = Number(aa) <= 79 ? `20${aa}` : `19${aa}`
  return `${ano}-${mm}-${dd}`
}

export function parseRetornoCnab400(texto: string): RetornoTitulo[] {
  const linhas = texto.split(/\r\n|\r|\n/).filter((l) => l.length >= 200)
  if (linhas.length === 0) throw new RetornoParseError('Arquivo vazio ou não reconhecido como CNAB 400.')

  const detalhes = linhas.filter((l) => l[0] === '1')
  if (detalhes.length === 0) {
    throw new RetornoParseError('Nenhum registro de detalhe (tipo 1) encontrado — confira se é um retorno CNAB 400.')
  }

  return detalhes.map((linha) => {
    const codigoOcorrencia = linha.slice(108, 110)
    const valorTitulo = valorDe(linha, 153, 165)
    const valorAbatimento = valorDe(linha, 228, 240)
    const valorDesconto = valorDe(linha, 241, 253)
    const jurosMulta = valorDe(linha, 267, 279)
    return {
      nossoNumero: linha.slice(62, 70).trim(),
      usoDaEmpresa: linha.slice(37, 62).trim(),
      codigoOcorrencia,
      ocorrenciaLabel: OCORRENCIAS[codigoOcorrencia] ?? `Código ${codigoOcorrencia}`,
      liquidacao: CODIGOS_LIQUIDACAO.has(codigoOcorrencia),
      dataOcorrencia: dataDe(linha, 111, 116) ?? '',
      vencimento: dataDe(linha, 147, 152),
      nomePagador: linha.slice(324, 354).trim(),
      valorTitulo,
      tarifaCobranca: valorDe(linha, 176, 188),
      valorIof: valorDe(linha, 215, 227),
      valorAbatimento,
      valorDesconto,
      jurosMulta,
      valorLiquido: valorDe(linha, 254, 266),
      valorPago: Math.max(valorTitulo - valorAbatimento - valorDesconto + jurosMulta, 0),
      dataCredito: dataDe(linha, 296, 301),
    }
  })
}
