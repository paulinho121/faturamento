-- ============================================================
-- Patch: aprovação do financeiro sobre pedidos
-- ============================================================
-- Financeiro passa a revisar/aprovar cada pedido (baixando o PDF pra
-- conferir) antes do faturista faturar — o selo "Aprovado pelo Financeiro"
-- aparece na fila do faturista, mas é só informativo: não bloqueia faturar,
-- o faturista continua vendo e processando todos os pedidos normalmente.
-- ============================================================

alter table pedidos add column if not exists aprovado_financeiro boolean not null default false;
alter table pedidos add column if not exists aprovado_em timestamptz;
alter table pedidos add column if not exists aprovado_por uuid references profiles(id);

drop policy if exists "financeiro_select_pedidos" on pedidos;
create policy "financeiro_select_pedidos" on pedidos for select
  using (current_user_has_role('financeiro'));

drop policy if exists "financeiro_update_pedidos_aprovacao" on pedidos;
create policy "financeiro_update_pedidos_aprovacao" on pedidos for update
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));

-- Financeiro também precisa baixar o PDF do pedido pra revisar antes de aprovar.
drop policy if exists "financeiro_select_pedidos_storage" on storage.objects;
create policy "financeiro_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_has_role('financeiro'));
