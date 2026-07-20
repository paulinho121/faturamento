export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)} mil`
  }
  return formatCurrency(value)
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function isCanceladaTipo(tipoOperacao: string | null | undefined): boolean {
  return (tipoOperacao?.toUpperCase() ?? '') === 'CANCELADA'
}

// Tipos de operação que, por padrão, não representam venda/receita real —
// o faturista pode sempre reverter marcando "Contar no faturamento" manualmente.
const NAO_CONTA_FATURAMENTO_PADRAO = new Set([
  'TRANSFERÊNCIA', 'TRANSFERENCIA',
  'COMODATO',
  'CANCELADA',
  'RETORNO LOCAÇÃO', 'RETORNO LOCACAO',
  'DEVOLUÇÃO', 'DEVOLUCAO',
  'DEVOLUÇÃO DE COMPRA', 'DEVOLUCAO DE COMPRA',
  'GARANTIA',
  'BRINDE',
  'DEMO',
  'DEMONSTRAÇÃO', 'DEMONSTRACAO',
  'ENTRADA PARA CONSERTO',
  'INUTILIZADA',
  'IMPORTAÇÃO', 'IMPORTACAO',
  'ARMAZÉM', 'ARMAZEM',
])

export function defaultAfetaFaturamento(tipoOperacao: string | null | undefined): boolean {
  return !NAO_CONTA_FATURAMENTO_PADRAO.has(tipoOperacao?.toUpperCase() ?? '')
}
