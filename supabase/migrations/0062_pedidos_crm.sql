-- ============================================================
-- Pedidos vindos do CRM (api/crm-pedido): o vendedor precisa enxergar e
-- corrigir o pedido dele, e o reenvio do CRM não pode duplicar
-- ============================================================
-- 1) O pedido criado pelo webhook tem created_by = conta de serviço, então as
--    políticas do vendedor (created_by = auth.uid()) o escondiam: se o
--    escritório devolvesse o pedido, o vendedor nunca o veria pra corrigir.
--    Agora vale também quando o pedido é de um vendedor ligado ao login dele.
-- 2) id_externo = identificador do pedido no CRM. Único entre pedidos não
--    cancelados: reenviar o mesmo pedido do CRM devolve o existente em vez de
--    criar outro (mesmo que o PDF tenha mudado).
-- ============================================================

alter table pedidos add column if not exists id_externo text;

create unique index if not exists pedidos_id_externo_uniq on pedidos (id_externo)
  where id_externo is not null and status <> 'cancelado';

create or replace function pedido_do_usuario(p_vendedor_id uuid, p_created_by uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_created_by = auth.uid()
    or exists (select 1 from vendedores v where v.id = p_vendedor_id and v.profile_id = auth.uid());
$$;

drop policy if exists "vendedor_select_own_pedidos" on pedidos;
create policy "vendedor_select_own_pedidos" on pedidos for select
  using (current_user_has_role('vendedor') and pedido_do_usuario(vendedor_id, created_by));

drop policy if exists "vendedor_update_own_pedidos_devolvidos" on pedidos;
create policy "vendedor_update_own_pedidos_devolvidos" on pedidos for update
  using (current_user_has_role('vendedor') and pedido_do_usuario(vendedor_id, created_by) and status = 'devolvido')
  with check (current_user_has_role('vendedor') and pedido_do_usuario(vendedor_id, created_by));

drop policy if exists "vendedor_select_own_pedido_eventos" on pedido_eventos;
create policy "vendedor_select_own_pedido_eventos" on pedido_eventos for select
  using (
    current_user_role() = 'vendedor'
    and exists (
      select 1 from pedidos p
      where p.id = pedido_id and pedido_do_usuario(p.vendedor_id, p.created_by)
    )
  );
