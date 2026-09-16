-- ============================================================
-- Novo módulo: pedidos do vendedor → fila de faturamento
-- ============================================================
-- Vendedor anexa o PDF do pedido (do jeito que fechou com o cliente) assim
-- que a venda é combinada; isso aparece pro faturista como uma fila de
-- "pedidos pendentes" — ele baixa o PDF, lança a NF-e do jeito que já faz
-- hoje, e marca o pedido como "faturado" manualmente pra tirar da fila.
-- Não tenta casar pedido <-> nota automaticamente (o vendedor nem sempre
-- sabe o número da NF de antemão).
-- ============================================================

create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references vendedores(id),
  cliente text not null,
  valor_estimado numeric(14, 2),
  observacao text,
  arquivo_path text not null,
  arquivo_nome text not null,
  status text not null default 'pendente' check (status in ('pendente', 'faturado')),
  faturado_em timestamptz,
  faturado_por uuid references profiles(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists pedidos_status_idx on pedidos (status);
create index if not exists pedidos_vendedor_idx on pedidos (vendedor_id);

alter table pedidos enable row level security;

drop policy if exists "vendedor_insert_own_pedidos" on pedidos;
create policy "vendedor_insert_own_pedidos" on pedidos for insert
  with check (current_user_role() = 'vendedor' and created_by = auth.uid());

drop policy if exists "vendedor_select_own_pedidos" on pedidos;
create policy "vendedor_select_own_pedidos" on pedidos for select
  using (current_user_role() = 'vendedor' and created_by = auth.uid());

drop policy if exists "faturista_all_pedidos" on pedidos;
create policy "faturista_all_pedidos" on pedidos for all
  using (current_user_role() = 'faturista')
  with check (current_user_role() = 'faturista');

drop policy if exists "diretor_select_pedidos" on pedidos;
create policy "diretor_select_pedidos" on pedidos for select
  using (current_user_role() = 'diretor');

-- ------------------------------------------------------------
-- Storage: bucket privado "pedidos", arquivo em "{vendedor_id}/{arquivo}".
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('pedidos', 'pedidos', false)
on conflict (id) do nothing;

drop policy if exists "vendedor_insert_pedidos_storage" on storage.objects;
create policy "vendedor_insert_pedidos_storage" on storage.objects for insert
  with check (bucket_id = 'pedidos' and current_user_role() = 'vendedor');

drop policy if exists "vendedor_select_own_pedidos_storage" on storage.objects;
create policy "vendedor_select_own_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'vendedor' and owner = auth.uid());

drop policy if exists "faturista_select_pedidos_storage" on storage.objects;
create policy "faturista_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'faturista');

drop policy if exists "diretor_select_pedidos_storage" on storage.objects;
create policy "diretor_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'diretor');
