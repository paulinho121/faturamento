-- ============================================================
-- Patch: diretor pode cadastrar/editar/remover metas pela UI
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Até aqui a tabela metas só tinha política de leitura, então o
-- diretor precisava inserir a meta direto no banco. Estas políticas
-- liberam o CRUD de metas para quem tem papel 'diretor'.

create policy "diretor_insert_metas" on metas for insert
  with check (current_user_role() = 'diretor');

create policy "diretor_update_metas" on metas for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');

create policy "diretor_delete_metas" on metas for delete
  using (current_user_role() = 'diretor');

-- Índice único parcial para a meta "global" (todas as filiais, filial_id NULL):
-- o unique(filial_id, mes, ano) da tabela não dedupe linhas com filial_id nulo
-- (NULLs são distintos), então garantimos no máximo uma meta global por mês/ano.
create unique index if not exists metas_global_unico
  on metas (mes, ano)
  where filial_id is null;
