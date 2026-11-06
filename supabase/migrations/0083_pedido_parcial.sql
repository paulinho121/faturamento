-- ============================================================
-- Pedido parcial (SP): itens que faltam faturar e NFs parciais
-- ============================================================
-- A logística de SP marca o pedido como parcial e anota quais itens faltam faturar
-- (pedido_parcial). O faturista fatura a parte pronta com uma NF parcial (faturar_parcial): o
-- pedido continua em andamento, aparece na coluna "Faturados pendentes" (quadro da logística e
-- Modo TV) com as NFs já emitidas, e a parte faturada segue para despacho. Quando o restante é
-- faturado pelo fluxo normal (Marcar como Faturado), o pedido se conclui e sai da coluna.
-- Requer as migrações 0079, 0080 e 0082.
-- ============================================================

alter table pedidos add column if not exists parcial boolean not null default false;
alter table pedidos add column if not exists parcial_obs text;
alter table pedidos add column if not exists parcial_nfs text[] not null default '{}';
alter table pedidos add column if not exists parcial_faturada_em timestamptz;

alter table pedido_eventos drop constraint if exists pedido_eventos_tipo_check;
alter table pedido_eventos add constraint pedido_eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada', 'preparando_embarque',
                  'pre_venda_marcada', 'pre_venda_desmarcada', 'separacao_concluida',
                  'nf_servico_marcada', 'nf_servico_desmarcada',
                  'parcial_marcada', 'parcial_atualizada', 'parcial_desmarcada', 'faturado_parcial'));

-- Marca/atualiza/desmarca o pedido como parcial, com a observação dos itens que faltam faturar.
-- SP: a logística. CE: o faturista (a logística também pode). Só enquanto o pedido está em separação.
create or replace function pedido_parcial(p_pedido_id uuid, p_parcial boolean, p_obs text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ped pedidos%rowtype;
  obs text := nullif(btrim(coalesce(p_obs, '')), '');
begin
  if not (logistica_autorizada() or current_user_has_role('faturista')) then
    raise exception 'Sem permissão.';
  end if;

  select * into ped from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if ped.status <> 'pendente' then raise exception 'O pedido não está mais em andamento.'; end if;
  if ped.nf_servico then raise exception 'Pedido de NF de serviço não tem faturamento parcial.'; end if;
  if ped.origem is null or ped.origem not in ('SP', 'CE') then
    raise exception 'Só pedidos de SP e CE têm faturamento parcial.';
  end if;
  if ped.origem = 'SP' and not logistica_autorizada() then
    raise exception 'Pedido de SP: o parcial é marcado pela logística.';
  end if;
  if ped.etapa <> 'em_separacao' then
    raise exception 'O pedido ainda não foi liberado para separação.';
  end if;

  perform set_config('app.separacao_logistica', 'on', true);

  if p_parcial then
    if obs is null then raise exception 'Informe quais itens faltam faturar.'; end if;
    update pedidos set parcial = true, parcial_obs = obs where id = p_pedido_id;
    insert into pedido_eventos (pedido_id, tipo, motivo, por, revisao)
      values (p_pedido_id, case when ped.parcial then 'parcial_atualizada' else 'parcial_marcada' end, obs, auth.uid(), ped.revisao);
  else
    if ped.parcial_faturada_em is not null then
      raise exception 'Este pedido já teve faturamento parcial (NF %): não dá mais para desmarcar.',
        array_to_string(ped.parcial_nfs, ', ');
    end if;
    update pedidos set parcial = false, parcial_obs = null where id = p_pedido_id;
    if ped.parcial then
      insert into pedido_eventos (pedido_id, tipo, por, revisao)
        values (p_pedido_id, 'parcial_desmarcada', auth.uid(), ped.revisao);
    end if;
  end if;
end;
$$;

revoke all on function pedido_parcial(uuid, boolean, text) from public, anon;
grant execute on function pedido_parcial(uuid, boolean, text) to authenticated;

-- Fatura a parte pronta de um pedido parcial: guarda a NF parcial, mantém o pedido em andamento
-- (coluna "Faturados pendentes") e libera a parte faturada para despacho. Pode ser repetido.
create or replace function faturar_parcial(p_pedido_id uuid, p_numero_nf text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ped pedidos%rowtype;
  nf text := btrim(coalesce(p_numero_nf, ''));
begin
  if not current_user_has_role('faturista') then
    raise exception 'Só o faturista pode faturar parcialmente.';
  end if;
  if nf !~ '^[0-9]{1,12}$' then raise exception 'Informe o número da NF (só números).'; end if;

  select * into ped from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if ped.status <> 'pendente' then raise exception 'O pedido não está mais em andamento.'; end if;
  if not ped.parcial then raise exception 'O pedido não está marcado como parcial.'; end if;
  if ped.separacao_concluida_em is null then
    raise exception 'Faltam o número de série e os volumes da parte que vai ser faturada.';
  end if;
  if nf = any (ped.parcial_nfs) then raise exception 'A NF % já foi lançada neste pedido.', nf; end if;

  perform set_config('app.separacao_logistica', 'on', true);
  update pedidos set
    parcial_nfs = array_append(parcial_nfs, nf),
    parcial_faturada_em = coalesce(parcial_faturada_em, now())
  where id = p_pedido_id;

  update entregas set status = 'aguardando_despacho', atualizado_em = now()
    where pedido_id = p_pedido_id and status = 'aguardando_faturamento';

  insert into pedido_eventos (pedido_id, tipo, motivo, por, revisao)
    values (p_pedido_id, 'faturado_parcial', 'NF ' || nf, auth.uid(), ped.revisao);
end;
$$;

revoke all on function faturar_parcial(uuid, text) from public, anon;
grant execute on function faturar_parcial(uuid, text) to authenticated;

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
          p.numeros_serie, p.separacao_concluida_em,
          p.parcial, p.parcial_obs, p.parcial_nfs, p.parcial_faturada_em,
          (p.status = 'pendente' and p.parcial_faturada_em is not null) as parcial_pendente,
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
          and not p.nf_servico
          and (e.status <> 'finalizado' or e.finalizado_em > now() - interval '30 days'
               or (p.status = 'pendente' and p.parcial_faturada_em is not null))
      ) x
    ), '[]'::jsonb)
  else null end;
$$;

create or replace function painel_tv()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with
  ref as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as hoje,
      date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as inicio
  ),
  validas as (
    select i.vendedor_id, i.valor, i.data_emissao
    from invoices i, ref
    where i.excluida = false
      and i.afeta_faturamento = true
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) not in ('TRANSFERÊNCIA', 'TRANSFERENCIA')
      and i.data_emissao between ref.inicio and ref.hoje
  ),
  meta as (
    select coalesce(
      (select m.valor_meta from metas m, ref
        where m.filial_id is null
          and m.mes = extract(month from ref.hoje) and m.ano = extract(year from ref.hoje)
        limit 1),
      (select sum(m.valor_meta) from metas m, ref
        where m.filial_id is not null
          and m.mes = extract(month from ref.hoje) and m.ano = extract(year from ref.hoje)),
      0
    ) as valor
  ),
  vend as (
    select
      v.id,
      v.nome,
      v.foto_path,
      v.na_corrida,
      mp.valor_meta as meta_pessoal,
      coalesce(sum(n.valor) filter (where n.data_emissao = ref.hoje), 0) as faturado_hoje,
      coalesce(sum(n.valor), 0) as faturado_mes,
      (select count(*) from pedidos pd
        where pd.vendedor_id = v.id and pd.status <> 'cancelado'
          and (pd.created_at at time zone 'America/Sao_Paulo')::date = ref.hoje) as pedidos_hoje,
      (select count(*) from pedidos pd
        where pd.vendedor_id = v.id and pd.status <> 'cancelado'
          and (pd.created_at at time zone 'America/Sao_Paulo')::date >= ref.inicio) as pedidos_mes
    from vendedores v
    cross join ref
    left join validas n on n.vendedor_id = v.id
    left join metas_pessoais mp on mp.vendedor_id = v.id
      and mp.mes = extract(month from ref.hoje) and mp.ano = extract(year from ref.hoje)
    where v.ativo
    group by v.id, v.nome, v.foto_path, v.na_corrida, mp.valor_meta, ref.hoje, ref.inicio
  ),
  etapas as (
    select coalesce(jsonb_object_agg(t.etapa, t.qtd), '{}'::jsonb) as j
    from (select etapa, count(*) as qtd from pedidos where status = 'pendente' group by etapa) t
  ),
  quadro as (
    select coalesce(jsonb_agg(
      to_jsonb(r) || (case when current_user_role()::text = 'tv' then
        jsonb_build_object(
          'cliente', case when r.sanco and r.cliente = 'Pedido da Sanco' then r.cliente else iniciais_cliente(r.cliente) end,
          'motivo', null)
        else '{}'::jsonb end)
      order by r.desde), '[]'::jsonb) as j
    from (
      (select
        pd.numero, pd.cliente, v.nome as vendedor, pd.status, pd.etapa, pd.pre_venda,
        pd.devolvido_motivo as motivo,
        pd.created_at as criado_em,
        -- desde quando está nesta etapa/situação: último evento que mexeu nisso
        -- (aprovação do financeiro e pré-venda não mudam a etapa)
        coalesce(
          (select max(pe.created_at) from pedido_eventos pe
            where pe.pedido_id = pd.id
              and pe.tipo in ('enviado', 'reenviado', 'devolvido', 'faturado',
                              'processo_iniciado', 'enviado_sanco', 'separacao_iniciada', 'preparando_embarque')),
          pd.created_at
        ) as desde,
        false as sanco,
        pd.numero_nf as nf,
        pd.volumes,
        pd.origem,
        pd.nf_servico,
        -- SP em separação sem série/volumes: a logística ainda precisa informar
        (pd.origem = 'SP' and not pd.nf_servico and pd.status = 'pendente' and pd.etapa = 'em_separacao'
          and pd.separacao_concluida_em is null) as serie_pendente,
        (pd.origem in ('SP', 'CE') and pd.separacao_concluida_em is not null) as serie_ok,
        pd.parcial,
        (pd.status = 'pendente' and pd.parcial_faturada_em is not null) as faturado_pendente,
        nullif(array_to_string(pd.parcial_nfs, ', '), '') as nfs_parciais
      from pedidos pd
      join vendedores v on v.id = pd.vendedor_id
      cross join ref
      where pd.status in ('pendente', 'devolvido')
         or (pd.status = 'faturado'
             and (pd.faturado_em at time zone 'America/Sao_Paulo')::date = ref.hoje)
      order by pd.created_at
      limit 300)
      union all
      select
        ps.numero_pedido_cd::bigint,
        coalesce(nullif(trim(ps.cliente), ''), 'Pedido da Sanco'),
        coalesce(nullif(trim(ps.vendedor), ''), 'Sanco'),
        case when ps.etapa = 'devolucao' then 'devolvido' else 'pendente' end,
        case when ps.etapa = 'devolucao' then 'enviado_sanco' else ps.etapa end,
        false,
        case when ps.etapa = 'devolucao' then 'Devolução na Sanco' end,
        ps.created_at,
        ps.desde,
        true,
        null::text,
        ps.volumes,
        'SC'::text,
        false,
        false,
        false,
        false,
        false,
        null::text
      from pedidos_sanco ps
      where ps.etapa <> 'encerrada'
        and not exists (
          select 1 from pedidos p
          where p.numero_pedido_cd = ps.numero_pedido_cd and p.status <> 'cancelado'
        )
    ) r
  )
  select case
    when current_user_has_role('financeiro') or current_user_role() = 'diretor' or current_user_role()::text = 'tv' then
      jsonb_build_object(
        'hoje', (select hoje from ref),
        'meta_mes', (select valor from meta),
        'faturado_hoje', (select coalesce(sum(valor), 0) from validas, ref where data_emissao = ref.hoje),
        'faturado_mes', (select coalesce(sum(valor), 0) from validas),
        'vendedores', (
          select coalesce(
            jsonb_agg(to_jsonb(x) order by x.pedidos_hoje desc, x.faturado_hoje desc, x.nome),
            '[]'::jsonb)
          from vend x
        ),
        'etapas', (select j from etapas),
        'devolvidos', (select count(*) from pedidos where status = 'devolvido'),
        'faturados_hoje', (
          select count(*) from pedidos, ref
          where status = 'faturado'
            and (faturado_em at time zone 'America/Sao_Paulo')::date = ref.hoje
        ),
        'pedidos', (select j from quadro)
      )
    else null
  end;
$$;
