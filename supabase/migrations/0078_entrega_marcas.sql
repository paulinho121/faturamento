-- ============================================================
-- Logística: cada pessoa pode fixar os pedidos que quer acompanhar de perto e esconder
-- os que não interessam. A marca é pessoal (por usuário), então uma pessoa esconder um
-- pedido não o tira da tela dos colegas.
-- ============================================================

create table if not exists entrega_marcas (
  user_id uuid not null references profiles(id) on delete cascade,
  entrega_id uuid not null references entregas(id) on delete cascade,
  marca text not null check (marca in ('fixada', 'oculta')),
  created_at timestamptz not null default now(),
  primary key (user_id, entrega_id)
);

alter table entrega_marcas enable row level security;

-- p_marca = 'fixada' | 'oculta'; null limpa a marca.
create or replace function entrega_marcar(p_entrega_id uuid, p_marca text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if p_marca is null then
    delete from entrega_marcas where user_id = auth.uid() and entrega_id = p_entrega_id;
    return;
  end if;
  if p_marca not in ('fixada', 'oculta') then raise exception 'Marca inválida.'; end if;
  if not exists (select 1 from entregas where id = p_entrega_id) then raise exception 'Entrega não encontrada.'; end if;
  insert into entrega_marcas (user_id, entrega_id, marca) values (auth.uid(), p_entrega_id, p_marca)
    on conflict (user_id, entrega_id) do update set marca = excluded.marca, created_at = now();
end;
$$;

create or replace function logistica_entregas()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then
    coalesce((
      select jsonb_agg(to_jsonb(x) order by coalesce(x.faturado_em, x.pedido_criado_em) desc nulls last)
      from (
        select
          e.id, e.status, e.tipo_entrega, e.transportadora, e.codigo_rastreio, e.previsao_chegada, e.ocorrencia,
          e.despachado_em, e.entregue_em, e.recebido_por, e.finalizado_em, e.created_at,
          p.id as pedido_id, p.numero as pedido_numero, p.cliente, v.nome as vendedor,
          p.origem, p.volumes, p.numero_nf, p.faturado_em, p.id_externo, p.observacao,
          p.arquivo_path, p.arquivo_nome,
          p.status as pedido_status, p.etapa as pedido_etapa, p.created_at as pedido_criado_em,
          inv.valor as nf_valor, inv.data_emissao as nf_emissao, inv.estado as nf_estado,
          (select r.texto from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'ocorrencia'
            order by r.created_at desc limit 1) as ultima_ocorrencia,
          (select r.created_at from entrega_registros r
            where r.entrega_id = e.id order by r.created_at desc limit 1) as ultimo_registro_em,
          (select count(*) from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'carta_correcao')::int as cartas_correcao,
          (select m.marca from entrega_marcas m
            where m.entrega_id = e.id and m.user_id = auth.uid()) as marca
        from entregas e
        join pedidos p on p.id = e.pedido_id
        join vendedores v on v.id = p.vendedor_id
        left join lateral (
          select i.valor, i.data_emissao, i.estado
          from invoices i
          where i.numero_nf = p.numero_nf and i.excluida = false
          order by i.data_emissao desc
          limit 1
        ) inv on true
        where p.status <> 'cancelado'
          and (e.status <> 'finalizado' or e.finalizado_em > now() - interval '30 days')
      ) x
    ), '[]'::jsonb)
  else null end;
$$;

revoke all on function entrega_marcar(uuid, text) from public, anon;
grant execute on function entrega_marcar(uuid, text) to authenticated;
