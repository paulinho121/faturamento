// Juros e multa de títulos vencidos, pedidos pelo financeiro para cobrança:
//  - multa de 2%, cobrada uma única vez sobre o saldo da parcela vencida;
//  - juros de 6% ao mês, proporcionais aos dias de atraso (0,2% ao dia).
// É só um cálculo de exibição (demonstrativo / lista de vencidos): não grava nada no título.
export const MULTA_ATRASO = 0.02
export const JUROS_MES_ATRASO = 0.06

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

// null quando a parcela não está vencida na data (ou não tem saldo).
export function calcularEncargos(saldo: number, vencimento: string, ref: string): EncargosAtraso | null {
  const dias = diasDeAtraso(vencimento, ref)
  if (dias <= 0 || saldo <= 0) return null
  const multa = arredonda(saldo * MULTA_ATRASO)
  const juros = arredonda(saldo * (JUROS_MES_ATRASO / 30) * dias)
  return { dias, juros, multa, total: arredonda(multa + juros) }
}

export const ROTULO_ENCARGOS = '6% a.m. de juros + 2% de multa'
