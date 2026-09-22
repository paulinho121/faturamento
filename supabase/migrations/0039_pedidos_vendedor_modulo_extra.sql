-- ============================================================
-- Pedidos: permite quem tem "vendedor" como módulo extra (não só o
-- papel principal) enviar e gerenciar os próprios pedidos
-- ============================================================
-- Caso de uso: um diretor que também vende precisa mandar pedido pro
-- faturista, sem que a conta dele deixe de ser um diretor. Antes, essas
-- políticas exigiam current_user_role() = 'vendedor' (só o papel
-- principal); agora aceitam current_user_has_role('vendedor'), que também
-- vale para quem tem 'vendedor' em profiles.modulos_extra.
-- ============================================================

drop policy if exists "vendedor_insert_own_pedidos" on pedidos;
create policy "vendedor_insert_own_pedidos" on pedidos for insert
  with check (current_user_has_role('vendedor') and created_by = auth.uid());

drop policy if exists "vendedor_select_own_pedidos" on pedidos;
create policy "vendedor_select_own_pedidos" on pedidos for select
  using (current_user_has_role('vendedor') and created_by = auth.uid());

drop policy if exists "vendedor_update_own_pedidos_devolvidos" on pedidos;
create policy "vendedor_update_own_pedidos_devolvidos" on pedidos for update
  using (current_user_has_role('vendedor') and created_by = auth.uid() and status = 'devolvido')
  with check (current_user_has_role('vendedor') and created_by = auth.uid());

drop policy if exists "vendedor_insert_pedidos_storage" on storage.objects;
create policy "vendedor_insert_pedidos_storage" on storage.objects for insert
  with check (bucket_id = 'pedidos' and current_user_has_role('vendedor'));

drop policy if exists "vendedor_select_own_pedidos_storage" on storage.objects;
create policy "vendedor_select_own_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_has_role('vendedor') and owner = auth.uid());
