-- ============================================================
-- Logística: a NF-e (XML) do pedido faturado, pra logística ver a chave de
-- acesso, baixar o XML e aproveitar a transportadora e os volumes que a nota
-- já traz. Casa o pedido com a nota pelo número da NF digitado no faturamento.
-- ============================================================

create or replace function logistica_nfe(p_entrega_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then (
    select to_jsonb(n)
    from (
      select i.numero_nf, i.valor, i.data_emissao, i.estado, i.cliente,
             i.xml_chave_acesso as chave, i.xml_raw
      from entregas e
      join pedidos p on p.id = e.pedido_id
      join invoices i on i.numero_nf = p.numero_nf and i.excluida = false
      where e.id = p_entrega_id
      order by i.data_emissao desc
      limit 1
    ) n
  ) else null end;
$$;

revoke all on function logistica_nfe(uuid) from public, anon;
grant execute on function logistica_nfe(uuid) to authenticated;
