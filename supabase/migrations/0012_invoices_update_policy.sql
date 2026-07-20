-- ============================================================
-- Patch: política de UPDATE em invoices
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- A tabela invoices nunca teve política de UPDATE (o design original era
-- "livro-razão", só insert). Isso significa que toda edição feita pelo
-- faturista no modal "Editar Lançamento" (tipo de operação, forma de
-- pagamento, vendedor, contar no faturamento) estava sendo silenciosamente
-- ignorada pelo RLS — o update rodava sem erro mas afetava 0 linhas.
-- Agora o diretor também precisa poder alterar o vendedor de qualquer nota
-- direto pelo espelho da NF-e, então passamos a permitir UPDATE de verdade.
-- ============================================================

create policy "faturista_update_own" on invoices for update
  using (current_user_role() = 'faturista' and created_by = auth.uid())
  with check (current_user_role() = 'faturista' and created_by = auth.uid());

create policy "diretor_update_all" on invoices for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');
