-- ============================================================
-- Logística: anexos (foto/PDF do comprovante de entrega ou da carga com problema,
-- opcionais) e download do orçamento do vendedor (o PDF do pedido).
-- Os anexos ficam no bucket privado "entregas", em "{entrega_id}/{arquivo}"; a
-- logística lê o PDF do pedido (bucket "pedidos") só das entregas dela.
-- ============================================================

alter table entrega_registros add column if not exists arquivo_path text;
alter table entrega_registros add column if not exists arquivo_nome text;

insert into storage.buckets (id, name, public)
values ('entregas', 'entregas', false)
on conflict (id) do nothing;

drop policy if exists "logistica_all_entregas_anexos" on storage.objects;
create policy "logistica_all_entregas_anexos" on storage.objects for all
  using (
    bucket_id = 'entregas'
    and (current_user_has_role('logistica') or current_user_role() = 'diretor')
  )
  with check (
    bucket_id = 'entregas'
    and (current_user_has_role('logistica') or current_user_role() = 'diretor')
  );

create or replace function logistica_le_pedido_arquivo(p_path text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select (current_user_has_role('logistica') or current_user_role() = 'diretor')
    and exists (
      select 1 from pedidos p join entregas e on e.pedido_id = p.id
      where p.arquivo_path = p_path
    )
$$;

revoke all on function logistica_le_pedido_arquivo(text) from public, anon;
grant execute on function logistica_le_pedido_arquivo(text) to authenticated;

drop policy if exists "logistica_select_pedidos_arquivos" on storage.objects;
create policy "logistica_select_pedidos_arquivos" on storage.objects for select
  using (bucket_id = 'pedidos' and logistica_le_pedido_arquivo(name));

-- Assinaturas novas (com anexo opcional): as antigas saem.
drop function if exists entrega_registrar(uuid, text, text, date);
drop function if exists entrega_entregar(uuid, timestamptz, text, text);

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
          p.arquivo_path, p.arquivo_nome,
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
               null::date as previsao, pr.full_name as por,
               null::text as arquivo_path, null::text as arquivo_nome
        from entregas e
        join pedido_eventos pe on pe.pedido_id = e.pedido_id
        left join profiles pr on pr.id = pe.por
        where e.id = p_entrega_id
        union all
        select r.created_at, 'entrega', r.tipo, r.texto, r.previsao, pr.full_name, r.arquivo_path, r.arquivo_nome
        from entrega_registros r
        left join profiles pr on pr.id = r.por
        where r.entrega_id = p_entrega_id
      ) h
    ), '[]'::jsonb)
  else null end;
$$;

create or replace function entrega_registrar(
  p_entrega_id uuid, p_tipo text, p_texto text, p_previsao date,
  p_arquivo_path text default null, p_arquivo_nome text default null
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
  if p_tipo in ('ocorrencia', 'observacao') and coalesce(trim(p_texto), '') = '' and p_arquivo_path is null then
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
  insert into entrega_registros (entrega_id, tipo, texto, previsao, por, arquivo_path, arquivo_nome)
    values (p_entrega_id, p_tipo, nullif(trim(coalesce(p_texto, '')), ''), p_previsao, auth.uid(), p_arquivo_path, p_arquivo_nome);
end;
$$;

create or replace function entrega_entregar(
  p_entrega_id uuid, p_entregue_em timestamptz, p_recebido_por text, p_texto text,
  p_arquivo_path text default null, p_arquivo_nome text default null
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
  insert into entrega_registros (entrega_id, tipo, texto, por, arquivo_path, arquivo_nome)
    values (p_entrega_id, 'entrega',
            nullif(trim(coalesce(p_texto, '')), ''), auth.uid(), p_arquivo_path, p_arquivo_nome);
end;
$$;


revoke all on function entrega_registrar(uuid, text, text, date, text, text) from public, anon;
revoke all on function entrega_entregar(uuid, timestamptz, text, text, text, text) from public, anon;
grant execute on function entrega_registrar(uuid, text, text, date, text, text) to authenticated;
grant execute on function entrega_entregar(uuid, timestamptz, text, text, text, text) to authenticated;
