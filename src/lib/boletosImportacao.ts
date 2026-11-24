import { lerPaginado } from './paginacao'
import { supabase } from './supabaseClient'
import type { Boleto } from '../types/domain'
import { arredonda2 } from './dinheiro'

// Snapshot de todos os boletos (não só os em aberto) pra casar numero_titulo/
// nosso_numero contra o que o banco manda — usado pelas importações de XML,
// retorno (.RET) e lista de títulos (.txt) na Conciliação Bancária.
export async function carregarBoletosParaImportacao(): Promise<Boleto[]> {
  const { data, error } = await lerPaginado<Boleto>((de, ate) =>
    supabase
      .from('boletos')
      .select('*, invoices!invoice_id(numero_nf, cliente, valor, tipo_operacao, clientes(cnpj_cpf), vendedores(nome))')
      .eq('excluido', false)
      .order('vencimento')
      .order('id')
      .range(de, ate)
  )
  if (error) return []
  return data
}

// Marca um título como pago/parcial a partir de um valor já conferido
// (retorno bancário, conciliação manual) — substitui o valor pago em vez de
// somar (diferente de baixarTitulo em conciliacaoDados.ts, que soma créditos
// incrementais do extrato OFX).
export async function registrarPagamentoDireto(
  boleto: Boleto,
  novoValorPagoInput: number,
  novoJurosInput: number,
  dataPagamento: string,
  // Só o retorno (.RET) informa: o dia útil em que o dinheiro cai na conta.
  // Sem ele (pagamento lançado na mão), vale a própria data de pagamento.
  dataCompensacao: string | null = null
): Promise<{ ok: boolean; erro: string | null }> {
  // Em centavos exatos: 358,92 + 4,04 não pode virar 362,96000000000004 (deixava o título "parcial").
  const juros = arredonda2(Math.max(novoJurosInput, 0))
  const valorTotal = arredonda2(Number(boleto.valor) + juros)
  const valorPago = arredonda2(Math.min(Math.max(novoValorPagoInput, 0), valorTotal))
  const novoStatus = valorPago <= 0 ? 'pendente' : valorPago >= valorTotal ? 'pago' : 'parcial'
  const { error } = await supabase
    .from('boletos')
    .update({
      status: novoStatus,
      valor_pago: valorPago,
      juros,
      data_pagamento: valorPago > 0 ? dataPagamento : null,
      data_compensacao: valorPago > 0 ? dataCompensacao : null,
    })
    .eq('id', boleto.id)
  return { ok: !error, erro: error?.message ?? null }
}
