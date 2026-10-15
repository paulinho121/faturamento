-- ============================================================
-- Ajuste pontual: o título da NF 562829 (LOPES FX), parcela 2, R$ 4.325,25,
-- vencimento 15/10, foi baixado como pago em 14/10 por engano (o financeiro
-- confirmou que ele não deveria estar pago). Volta pra pendente.
--
-- Só mexe nesse título e só se ainda estiver exatamente como foi baixado
-- (pago, em 14/10) — pode rodar de novo sem efeito.
-- ============================================================
do $$
declare
  n int;
begin
  update boletos b
  set status = 'pendente',
      valor_pago = 0,
      data_pagamento = null
  from invoices i
  where i.id = b.invoice_id
    and i.numero_nf = '562829'
    and b.numero_parcela = 2
    and b.valor = 4325.25
    and b.vencimento = date '2026-10-15'
    and b.status = 'pago'
    and b.data_pagamento = date '2026-10-14'
    and b.excluido = false;
  get diagnostics n = row_count;
  raise notice '% título(s) revertido(s) para pendente (esperado: 1).', n;
end
$$;
