-- ============================================================
-- Patch: financeiro pode corrigir a forma de pagamento da nota
-- ============================================================
-- Cenário: a nota foi lançada como "Boleto", mas o cliente combinou de pagar
-- por PIX/Cartão em vez disso — sem corrigir isso, a nota fica presa pra
-- sempre em "Pendente de Boleto" (nunca vai chegar título nenhum pra ela) em
-- vez de cair em "Pendente de Comprovante", que é o fluxo certo.
--
-- RLS não restringe update a uma coluna só — quem tem o módulo financeiro
-- (role principal ou modulos_extra) ganha update na nota inteira por essa
-- policy, mas a única tela que usa isso (MeioPagamentoInlineEdit) só manda
-- meio_pagamento.
-- ============================================================

drop policy if exists "financeiro_update_meio_pagamento" on invoices;
create policy "financeiro_update_meio_pagamento" on invoices for update
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));
