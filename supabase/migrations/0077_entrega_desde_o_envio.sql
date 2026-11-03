-- ============================================================
-- Logística: acompanha o pedido desde o envio para o faturamento. A entrega passa a
-- nascer quando o pedido é enviado (status 'aguardando_faturamento') e, ao faturar,
-- vai para 'aguardando_despacho'. Pedidos cancelados saem da lista. Pedidos que já
-- estão na fila do faturamento ganham a entrega agora.
-- ============================================================

alter table entregas drop constraint if exists entregas_status_check;
alter table entregas add constraint entregas_status_check
  check (status in ('aguardando_faturamento', 'aguardando_despacho', 'em_transito', 'entregue', 'finalizado'));

-- Pedido enviado -> nasce a entrega (aguardando faturamento).
create or replace function pedidos_cria_entrega() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into entregas (pedido_id, status)
    values (new.id, case when new.status = 'faturado' then 'aguardando_despacho' else 'aguardando_faturamento' end)
    on conflict (pedido_id) do nothing;
  return new;
end;
$$;

drop trigger if exists pedidos_cria_entrega_trg on pedidos;
create trigger pedidos_cria_entrega_trg
  after insert on pedidos
  for each row
  execute function pedidos_cria_entrega();

-- Pedido faturado -> a entrega segue para "aguardando despacho" (cria se não existir).
create or replace function pedidos_fatura_entrega() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into entregas (pedido_id, status) values (new.id, 'aguardando_despacho')
    on conflict (pedido_id) do update
      set status = 'aguardando_despacho', atualizado_em = now()
      where entregas.status = 'aguardando_faturamento';
  return new;
end;
$$;

drop trigger if exists pedidos_fatura_entrega_trg on pedidos;
create trigger pedidos_fatura_entrega_trg
  after update of status on pedidos
  for each row
  when (new.status = 'faturado' and old.status is distinct from 'faturado')
  execute function pedidos_fatura_entrega();

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
            where r.entrega_id = e.id and r.tipo = 'carta_correcao')::int as cartas_correcao
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

-- Despachar e registrar retirada só depois do faturamento.
create or replace function entrega_despachar(
  p_entrega_id uuid, p_transportadora text, p_rastreio text, p_previsao date
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_transportadora), '') = '' then raise exception 'Informe a transportadora.'; end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status = 'aguardando_faturamento' then
    raise exception 'O pedido ainda não foi faturado.';
  end if;
  if atual.status not in ('aguardando_despacho', 'em_transito') then
    raise exception 'Essa entrega já foi entregue.';
  end if;
  update entregas set
    transportadora = trim(p_transportadora),
    codigo_rastreio = nullif(trim(coalesce(p_rastreio, '')), ''),
    previsao_chegada = coalesce(p_previsao, previsao_chegada),
    status = 'em_transito',
    despachado_em = coalesce(despachado_em, now()),
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, previsao, por)
    values (p_entrega_id,
            case when atual.status = 'aguardando_despacho' then 'despacho' else 'observacao' end,
            case when atual.status = 'aguardando_despacho' then 'Despachado com ' else 'Dados do transporte atualizados: ' end
              || trim(p_transportadora)
              || coalesce(' · rastreio ' || nullif(trim(coalesce(p_rastreio, '')), ''), ''),
            p_previsao, auth.uid());
end;
$$;

create or replace function entrega_retirada(
  p_entrega_id uuid, p_retirado_em timestamptz, p_retirado_por text, p_texto text,
  p_arquivo_path text default null, p_arquivo_nome text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_retirado_por), '') = '' then raise exception 'Informe quem retirou.'; end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status = 'aguardando_faturamento' then
    raise exception 'O pedido ainda não foi faturado.';
  end if;
  if atual.status not in ('aguardando_despacho', 'em_transito') then
    raise exception 'Essa entrega já foi entregue.';
  end if;
  update entregas set
    tipo_entrega = 'retirada',
    status = 'entregue',
    entregue_em = coalesce(p_retirado_em, now()),
    recebido_por = trim(p_retirado_por),
    ocorrencia = false,
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, por, arquivo_path, arquivo_nome)
    values (p_entrega_id, 'retirada',
            'Retirado por ' || trim(p_retirado_por) || coalesce(' · ' || nullif(trim(coalesce(p_texto, '')), ''), ''),
            auth.uid(), p_arquivo_path, p_arquivo_nome);
end;
$$;

-- Pedidos que já estão na fila do faturamento (e ainda não têm entrega) passam a aparecer.
insert into entregas (pedido_id, status, created_at)
select id, 'aguardando_faturamento', created_at
from pedidos
where status in ('pendente', 'devolvido')
on conflict (pedido_id) do nothing;
