import { supabase } from './supabaseClient'
import type { Boleto } from '../types/domain'

// Snapshot de todos os boletos (não só os em aberto) pra casar numero_titulo/
// nosso_numero contra o que o banco manda — usado pelas importações de XML,
// retorno (.RET) e lista de títulos (.txt) na Conciliação Bancária.
export async function carregarBoletosParaImportacao(): Promise<Boleto[]> {
  const { data, error } = await supabase
    .from('boletos')
    .select('*, invoices(numero_nf, cliente, valor, tipo_operacao, clientes(cnpj_cpf), vendedores(nome))')
    .eq('excluido', false)
    .order('vencimento')
    .limit(20000)
  if (error) return []
  return (data as Boleto[]) ?? []
}

// Marca um título como pago/parcial a partir de um valor já conferido
// (retorno bancário, conciliação manual) — substitui o valor pago em vez de
// somar (diferente de baixarTitulo em conciliacaoDados.ts, que soma créditos
// incrementais do extrato OFX).
export async function registrarPagamentoDireto(
  boleto: Boleto,
  novoValorPagoInput: number,
  novoJurosInput: number,
  dataPagamento: string
): Promise<{ ok: boolean; erro: string | null }> {
  const juros = Math.max(novoJurosInput, 0)
  const valorTotal = Number(boleto.valor) + juros
  const valorPago = Math.min(Math.max(novoValorPagoInput, 0), valorTotal)
  const novoStatus = valorPago <= 0 ? 'pendente' : valorPago >= valorTotal ? 'pago' : 'parcial'
  const { error } = await supabase
    .from('boletos')
    .update({
      status: novoStatus,
      valor_pago: valorPago,
      juros,
      data_pagamento: valorPago > 0 ? dataPagamento : null,
    })
    .eq('id', boleto.id)
  return { ok: !error, erro: error?.message ?? null }
}
