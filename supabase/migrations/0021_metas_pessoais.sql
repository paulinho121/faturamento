-- ============================================================
-- Patch: meta pessoal do vendedor (gamificação)
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Diferente de "metas" (meta da empresa, definida pelo diretor, por filial),
-- esta tabela é a meta PESSOAL que cada vendedor define pra si mesmo — só
-- ele pode ler/criar/editar a própria linha. O diretor pode ver todas (só
-- leitura), útil pra acompanhar o quão ambiciosos os vendedores estão sendo.
-- ============================================================

create table if not exists metas_pessoais (
  id serial primary key,
  vendedor_id uuid not null references vendedores(id) on delete cascade,
  mes smallint not null check (mes between 1 and 12),
  ano smallint not null,
  valor_meta numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  unique (vendedor_id, mes, ano)
);

alter table metas_pessoais enable row level security;

drop policy if exists "vendedor_select_own_meta_pessoal" on metas_pessoais;
create policy "vendedor_select_own_meta_pessoal" on metas_pessoais for select
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );

drop policy if exists "vendedor_insert_own_meta_pessoal" on metas_pessoais;
create policy "vendedor_insert_own_meta_pessoal" on metas_pessoais for insert
  with check (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );

drop policy if exists "vendedor_update_own_meta_pessoal" on metas_pessoais;
create policy "vendedor_update_own_meta_pessoal" on metas_pessoais for update
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  )
  with check (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );

drop policy if exists "diretor_select_metas_pessoais" on metas_pessoais;
create policy "diretor_select_metas_pessoais" on metas_pessoais for select
  using (current_user_role() = 'diretor');
