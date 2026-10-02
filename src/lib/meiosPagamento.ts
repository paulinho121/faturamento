// Meios de pagamento que geram título (parcelas com vencimento) em vez de um
// comprovante único: Boleto e PIX Parcelado.
export function geraTitulo(meioPagamento: string | null | undefined): boolean {
  const meio = meioPagamento?.trim().toUpperCase() ?? ''
  return meio === 'BOLETO' || meio === 'PIX PARCELADO'
}
