// Valores em reais no navegador são números de ponto flutuante: 358,92 + 4,04 dá 362,96000000000004.
// Comparar isso com o que foi pago (362,96) deixava uma sobra de 0,00000000000006 e o título ficava
// "parcial" / "vencido" mesmo quitado. Toda conta que decide saldo ou status passa por aqui.
export function arredonda2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Saldo em aberto de um título: nunca negativo, em centavos exatos.
export function saldoEmCentavos(devido: number, pago: number): number {
  return Math.max(arredonda2(arredonda2(devido) - arredonda2(pago)), 0)
}
