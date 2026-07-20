-- ============================================================
-- Patch: política de UPDATE em invoices
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- A tabela invoices não tinha política de UPDATE registrada em nenhuma
-- migration (o design original era "livro-razão", só insert). Se alguma
-- política com esses nomes já existir no banco (ex: criada direto pelo
-- painel do Supabase em algum momento, sem passar por uma migration — outro
-- caso do drift documentado em [[sql-migration-workflow]]), os drops abaixo
-- garantem que este script possa ser rodado de novo sem erro.
-- Agora o diretor também precisa poder alterar o vendedor de qualquer nota
-- direto pelo espelho da NF-e, então passamos a permitir UPDATE de verdade.
-- ============================================================

drop policy if exists "faturista_update_own" on invoices;
create policy "faturista_update_own" on invoices for update
  using (current_user_role() = 'faturista' and created_by = auth.uid())
  with check (current_user_role() = 'faturista' and created_by = auth.uid());

drop policy if exists "diretor_update_all" on invoices;
create policy "diretor_update_all" on invoices for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');
