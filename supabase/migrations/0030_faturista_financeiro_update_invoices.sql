-- ============================================================
-- Patch: conta faturista+financeiro pode editar/cancelar qualquer nota
-- ============================================================
-- Um faturista comum só edita/cancela (soft-delete via `excluida`) as
-- próprias notas (policy faturista_update_own). Uma conta administrativa
-- que também tem o módulo financeiro (profiles.modulos_extra) precisa
-- gerenciar as notas lançadas por qualquer faturista da empresa — igual o
-- diretor já pode, mas sem precisar virar diretor.
-- ============================================================

drop policy if exists "faturista_financeiro_update_all" on invoices;
create policy "faturista_financeiro_update_all" on invoices for update
  using (current_user_has_role('faturista') and current_user_has_role('financeiro'))
  with check (current_user_has_role('faturista') and current_user_has_role('financeiro'));
