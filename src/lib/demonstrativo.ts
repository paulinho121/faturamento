import { calcularEncargos } from './encargosAtraso'
import type { Boleto } from '../types/domain'

export interface Linha {
  boleto: Boleto
  pago: number
  vencido: number
  aVencer: number
  atraso: number
  encargos: number // juros + multa sobre o vencido (0 se não vencido)
  vencidoJuros: number // vencido + juros + multa: o que o cliente vê na coluna "Vencido + juros"
}

// Posição do título numa data de referência: um pagamento só conta se já
// tinha acontecido até a data (sem data_pagamento — registros antigos —
// considera que já tinha), e o que sobra é "vencido" ou "à vencer" conforme
// o vencimento em relação à data.
export function posicaoEm(boleto: Boleto, ref: string, jurosMes?: number): Linha {
  const total = Number(boleto.valor) + Number(boleto.juros ?? 0)
  const pagamentoConta = boleto.status !== 'pendente' && (!boleto.data_pagamento || boleto.data_pagamento <= ref)
  const pago = pagamentoConta ? Number(boleto.valor_pago ?? 0) : 0
  const saldo = Math.max(total - pago, 0)
  const vencido = boleto.vencimento < ref
  const dias = Math.round(
    (new Date(`${ref}T00:00:00Z`).getTime() - new Date(`${boleto.vencimento}T00:00:00Z`).getTime()) / 86_400_000
  )
  const encargos = vencido ? (calcularEncargos(saldo, boleto.vencimento, ref, jurosMes)?.total ?? 0) : 0
  return {
    boleto,
    pago,
    vencido: vencido ? saldo : 0,
    aVencer: vencido ? 0 : saldo,
    atraso: vencido && saldo > 0 ? dias : 0,
    encargos,
    vencidoJuros: (vencido ? saldo : 0) + encargos,
  }
}

export interface BlocoNota {
  key: string
  titulo: string
  linhas: Linha[]
}

export function montarBlocos(boletos: Boleto[], ref: string, jurosMes?: number): BlocoNota[] {
  const porNota = new Map<string, Boleto[]>()
  for (const b of boletos) {
    const key = b.invoice_id ?? `sem-nf-${b.id}`
    porNota.set(key, [...(porNota.get(key) ?? []), b])
  }
  return Array.from(porNota.entries()).map(([key, itens]) => {
    const tipo = itens[0].invoices?.tipo_operacao ?? ''
    const locacao = tipo.toLowerCase().includes('loca')
    return {
      key,
      titulo: `NF-e (${locacao ? 'Locação' : 'venda'})`,
      linhas: itens.sort((a, b) => a.numero_parcela - b.numero_parcela).map((b) => posicaoEm(b, ref, jurosMes)),
    }
  })
}

export function soma(linhas: Linha[], campo: 'pago' | 'vencido' | 'aVencer' | 'encargos' | 'vencidoJuros'): number {
  return linhas.reduce((acc, l) => acc + l[campo], 0)
}

// "Total sem juros" de um cliente na data: principal vencido (sem juros e multa) + parcelas a vencer.
// É o valor que o financeiro confere com o sistema — aparece na lista de Títulos Vencidos, não no
// demonstrativo que vai pro cliente.
export function totalSemJuros(boletos: Boleto[], ref: string): number {
  return boletos.reduce((acc, b) => {
    const l = posicaoEm(b, ref)
    return acc + l.vencido + l.aVencer
  }, 0)
}

// Texto do título da parcela: "000562919-2/5".
export function rotuloParcela(l: Linha, totalParcelas: number): string {
  const numeroNf = l.boleto.invoices?.numero_nf ?? '—'
  return `${numeroNf.padStart(9, '0')}-${l.boleto.numero_parcela}/${totalParcelas}`
}
