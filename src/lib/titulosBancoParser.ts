// Parser da lista de títulos em aberto que o banco manda em .txt (colunas:
// Pagador, Vencimento, Valor(R$), Carteira, Nosso Número, Seu Número,
// Observação, DDA). Serve pra guardar o Nosso Número em cada boleto —
// depois disso, o retorno CNAB 400 (.RET) consegue casar sozinho.

export interface TituloBanco {
  pagador: string
  vencimento: string // yyyy-mm-dd
  valor: number
  carteira: string
  nossoNumero: string
  seuNumero: string // bate (às vezes truncado) com numero_titulo
  dda: boolean
}

export class TitulosBancoParseError extends Error {}

// Nome + data + valor + carteira + nosso número + seu número + (observação
// opcional) + SIM/NÃO — cada campo é um token sem espaço, exceto o pagador.
const LINHA_RE = /^(.+?)\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*?)\s*(SIM|N.O)\s*$/

function parseValorBr(valor: string): number {
  return Number(valor.replace(/\./g, '').replace(',', '.')) || 0
}

export function parseTitulosBancoTxt(texto: string): TituloBanco[] {
  const linhas = texto.split(/\r\n|\r|\n/)
  const registros: TituloBanco[] = []
  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim()
    if (!linha || /^pagador\b/i.test(linha)) continue
    const m = linha.match(LINHA_RE)
    if (!m) continue
    const [, pagador, dd, mm, yyyy, valor, carteira, nossoNumero, seuNumero, , dda] = m
    registros.push({
      pagador: pagador.trim(),
      vencimento: `${yyyy}-${mm}-${dd}`,
      valor: parseValorBr(valor),
      carteira,
      nossoNumero,
      seuNumero,
      dda: dda.toUpperCase() === 'SIM',
    })
  }
  if (registros.length === 0) {
    throw new TitulosBancoParseError('Nenhum título reconhecido nesse arquivo — confira se é o modelo esperado.')
  }
  return registros
}
