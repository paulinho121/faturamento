// Juros e multa de títulos vencidos, pedidos pelo financeiro para cobrança:
//  - multa de 2%, cobrada uma única vez sobre o saldo da parcela vencida;
//  - juros ao mês (padrão 6%), proporcionais aos dias de atraso (6% a.m. = 0,2% ao dia).
// A taxa de juros pode ser simulada na tela (por cliente) antes de gerar o demonstrativo.
// É só um cálculo de exibição (demonstrativo / lista de vencidos): não grava nada no título.
export const MULTA_ATRASO = 0.02
export const JUROS_MES_ATRASO = 0.06
export const JUROS_MES_PADRAO_PERCENTUAL = JUROS_MES_ATRASO * 100

export interface EncargosAtraso {
  dias: number
  juros: number
  multa: number
  total: number
}

function arredonda(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Dias corridos entre o vencimento e a data de referência (ambos AAAA-MM-DD).
export function diasDeAtraso(vencimento: string, ref: string): number {
  const venc = new Date(`${vencimento}T00:00:00Z`).getTime()
  const fim = new Date(`${ref}T00:00:00Z`).getTime()
  return Math.round((fim - venc) / 86_400_000)
}

// jurosMes é fração (0,06 = 6% ao mês). null quando a parcela não está vencida na data (ou sem saldo).
export function calcularEncargos(
  saldo: number,
  vencimento: string,
  ref: string,
  jurosMes: number = JUROS_MES_ATRASO
): EncargosAtraso | null {
  const dias = diasDeAtraso(vencimento, ref)
  if (dias <= 0 || saldo <= 0) return null
  const multa = arredonda(saldo * MULTA_ATRASO)
  const juros = arredonda(saldo * (jurosMes / 30) * dias)
  return { dias, juros, multa, total: arredonda(multa + juros) }
}

// Texto digitado no campo (ex.: "6", "6,5", "8.25") -> percentual. Vazio/inválido = padrão; limitado a 0–100.
export function percentualDigitado(texto: string | undefined): number {
  const limpo = (texto ?? '').trim().replace(',', '.')
  if (limpo === '') return JUROS_MES_PADRAO_PERCENTUAL
  const n = Number(limpo)
  if (!Number.isFinite(n)) return JUROS_MES_PADRAO_PERCENTUAL
  return Math.min(Math.max(n, 0), 100)
}

function formataPercentual(p: number): string {
  return p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// "6% a.m. de juros + 2% de multa" (com a taxa de juros usada).
export function rotuloEncargos(jurosMesPercentual: number = JUROS_MES_PADRAO_PERCENTUAL): string {
  return `${formataPercentual(jurosMesPercentual)}% a.m. de juros + ${formataPercentual(MULTA_ATRASO * 100)}% de multa`
}

export const ROTULO_ENCARGOS = rotuloEncargos()
