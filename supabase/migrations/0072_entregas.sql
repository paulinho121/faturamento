-- ============================================================
-- Logística: acompanhamento da entrega do pedido faturado até o cliente.
-- Um registro em `entregas` por pedido faturado (criado quando o pedido é
-- faturado); a logística preenche transportadora/rastreio, anota dia a dia a
-- previsão de chegada e os problemas da carga (`entrega_registros`) e, no fim,
-- marca entregue e finaliza o ciclo.
-- Tudo passa por funções (security definer) com checagem de papel: logística
-- e diretor. As tabelas ficam fechadas (RLS ligada, sem policy).
-- ============================================================

create table if not exists entregas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references pedidos(id) on delete cascade,
  status text not null default 'aguardando_despacho'
    check (status in ('aguardando_despacho', 'em_transito', 'entregue', 'finalizado')),
  transportadora text,
  codigo_rastreio text,
  previsao_chegada date, -- sempre a última informada no diário
  ocorrencia boolean not null default false, -- problema com a carga em aberto
  despachado_em timestamptz,
  entregue_em timestamptz,
  recebido_por text,
  finalizado_em timestamptz,
  finalizado_por uuid references profiles(id),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists entregas_status_idx on entregas (status);

create table if not exists entrega_registros (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references entregas(id) on delete cascade,
  tipo text not null
    check (tipo in ('despacho', 'previsao', 'ocorrencia', 'ocorrencia_resolvida', 'observacao', 'entrega', 'finalizacao')),
  texto text,
  previsao date,
  por uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists entrega_registros_entrega_idx on entrega_registros (entrega_id, created_at);

alter table entregas enable row level security;
alter table entrega_registros enable row level security;

-- Pedido faturado -> nasce a entrega (aguardando despacho).
create or replace function pedidos_cria_entrega() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into entregas (pedido_id) values (new.id) on conflict (pedido_id) do nothing;
  return new;
end;
$$;

drop trigger if exists pedidos_cria_entrega_trg on pedidos;
create trigger pedidos_cria_entrega_trg
  after update of status on pedidos
  for each row
  when (new.status = 'faturado' and old.status is distinct from 'faturado')
  execute function pedidos_cria_entrega();

create or replace function logistica_autorizada() returns boolean
language sql stable security definer
set search_path = public
as $$
  select current_user_has_role('logistica') or current_user_role() = 'diretor'
$$;

-- Lista das entregas com tudo que a logística precisa ver: pedido (CRM),
-- vendedor, volumes, NF (número digitado no faturamento e, se a nota já foi
-- anexada, valor/emissão/UF dela) e o último aviso do diário. Finalizadas só dos
-- últimos 30 dias.
create or replace function logistica_entregas()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then
    coalesce((
      select jsonb_agg(to_jsonb(x) order by x.faturado_em desc nulls last)
      from (
        select
          e.id, e.status, e.transportadora, e.codigo_rastreio, e.previsao_chegada, e.ocorrencia,
          e.despachado_em, e.entregue_em, e.recebido_por, e.finalizado_em, e.created_at,
          p.id as pedido_id, p.numero as pedido_numero, p.cliente, v.nome as vendedor,
          p.origem, p.volumes, p.numero_nf, p.faturado_em, p.id_externo, p.observacao,
          inv.valor as nf_valor, inv.data_emissao as nf_emissao, inv.estado as nf_estado,
          (select r.texto from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'ocorrencia'
            order by r.created_at desc limit 1) as ultima_ocorrencia,
          (select r.created_at from entrega_registros r
            where r.entrega_id = e.id order by r.created_at desc limit 1) as ultimo_registro_em
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
        where e.status <> 'finalizado' or e.finalizado_em > now() - interval '30 days'
      ) x
    ), '[]'::jsonb)
  else null end;
$$;

-- Linha do tempo da entrega: eventos do pedido (CRM -> faturamento -> Sanco ->
-- faturado) e o diário da logística, em ordem.
create or replace function logistica_historico(p_entrega_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then
    coalesce((
      select jsonb_agg(to_jsonb(h) order by h.quando)
      from (
        select pe.created_at as quando, 'pedido'::text as origem, pe.tipo, pe.motivo as texto,
               null::date as previsao, pr.full_name as por
        from entregas e
        join pedido_eventos pe on pe.pedido_id = e.pedido_id
        left join profiles pr on pr.id = pe.por
        where e.id = p_entrega_id
        union all
        select r.created_at, 'entrega', r.tipo, r.texto, r.previsao, pr.full_name
        from entrega_registros r
        left join profiles pr on pr.id = r.por
        where r.entrega_id = p_entrega_id
      ) h
    ), '[]'::jsonb)
  else null end;
$$;

-- Despacho: define/atualiza transportadora, rastreio e previsão; passa a "em trânsito".
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

-- Diário: previsão de chegada, problema na carga (e sua resolução) ou observação.
create or replace function entrega_registrar(
  p_entrega_id uuid, p_tipo text, p_texto text, p_previsao date
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if p_tipo not in ('previsao', 'ocorrencia', 'ocorrencia_resolvida', 'observacao') then
    raise exception 'Tipo de registro inválido.';
  end if;
  if p_tipo = 'previsao' and p_previsao is null then raise exception 'Informe a nova previsão de chegada.'; end if;
  if p_tipo in ('ocorrencia', 'observacao') and coalesce(trim(p_texto), '') = '' then
    raise exception 'Descreva o que aconteceu.';
  end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status = 'finalizado' then raise exception 'Ciclo já finalizado.'; end if;
  update entregas set
    previsao_chegada = coalesce(p_previsao, previsao_chegada),
    ocorrencia = case p_tipo when 'ocorrencia' then true when 'ocorrencia_resolvida' then false else ocorrencia end,
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, previsao, por)
    values (p_entrega_id, p_tipo, nullif(trim(coalesce(p_texto, '')), ''), p_previsao, auth.uid());
end;
$$;

-- Chegada no cliente.
create or replace function entrega_entregar(
  p_entrega_id uuid, p_entregue_em timestamptz, p_recebido_por text, p_texto text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status <> 'em_transito' then
    raise exception 'Só dá pra marcar como entregue o que já foi despachado.';
  end if;
  update entregas set
    status = 'entregue',
    entregue_em = coalesce(p_entregue_em, now()),
    recebido_por = nullif(trim(coalesce(p_recebido_por, '')), ''),
    ocorrencia = false,
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, por)
    values (p_entrega_id, 'entrega',
            nullif(trim(coalesce(p_texto, '')), ''), auth.uid());
end;
$$;

-- Fecha o ciclo.
create or replace function entrega_finalizar(p_entrega_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status <> 'entregue' then
    raise exception 'Marque como entregue antes de finalizar o ciclo.';
  end if;
  update entregas set status = 'finalizado', finalizado_em = now(), finalizado_por = auth.uid(), atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, por) values (p_entrega_id, 'finalizacao', auth.uid());
end;
$$;

revoke all on function logistica_autorizada() from public, anon;
revoke all on function logistica_entregas() from public, anon;
revoke all on function logistica_historico(uuid) from public, anon;
revoke all on function entrega_despachar(uuid, text, text, date) from public, anon;
revoke all on function entrega_registrar(uuid, text, text, date) from public, anon;
revoke all on function entrega_entregar(uuid, timestamptz, text, text) from public, anon;
revoke all on function entrega_finalizar(uuid) from public, anon;
grant execute on function logistica_entregas() to authenticated;
grant execute on function logistica_historico(uuid) to authenticated;
grant execute on function entrega_despachar(uuid, text, text, date) to authenticated;
grant execute on function entrega_registrar(uuid, text, text, date) to authenticated;
grant execute on function entrega_entregar(uuid, timestamptz, text, text) to authenticated;
grant execute on function entrega_finalizar(uuid) to authenticated;
