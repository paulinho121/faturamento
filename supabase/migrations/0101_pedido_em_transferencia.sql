-- ============================================================
-- Pedido em transferência entre filiais (SC <-> CE, SC <-> SP)
-- Rode no SQL Editor depois da 0100.
-- ============================================================
-- Quando o pedido do vendedor depende de mercadoria que está em outra filial, o faturista marca o pedido como
-- "em transferência" e informa de onde para onde (SC, SP ou CE), o número do pedido no ERP e o número da
-- transferência. O pedido continua na etapa em que estava; enquanto a marca estiver ligada, a TV o mostra na coluna
-- "Em transferência". Ao concluir, o faturista desmarca e o pedido volta para a coluna da etapa dele.
-- Só o faturista marca, edita ou conclui (função pedido_transferencia). Cada ação vira um evento no histórico.
-- ============================================================

alter table pedidos add column if not exists em_transferencia boolean not null default false;
alter table pedidos add column if not exists transferencia_de text;
alter table pedidos add column if not exists transferencia_para text;
alter table pedidos add column if not exists transferencia_pedido_erp text;
alter table pedidos add column if not exists transferencia_numero text;
alter table pedidos add column if not exists transferencia_em timestamptz;
alter table pedidos add column if not exists transferencia_por uuid references profiles(id);

alter table pedidos drop constraint if exists pedidos_transferencia_check;
alter table pedidos add constraint pedidos_transferencia_check check (
  (transferencia_de is null or transferencia_de in ('SC', 'SP', 'CE'))
  and (transferencia_para is null or transferencia_para in ('SC', 'SP', 'CE'))
  and (
    not em_transferencia
    or (transferencia_de is not null and transferencia_para is not null and transferencia_de <> transferencia_para
        and nullif(trim(transferencia_pedido_erp), '') is not null)
  )
);

alter table pedido_eventos drop constraint if exists pedido_eventos_tipo_check;
alter table pedido_eventos add constraint pedido_eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada', 'preparando_embarque',
                  'pre_venda_marcada', 'pre_venda_desmarcada', 'separacao_concluida',
                  'nf_servico_marcada', 'nf_servico_desmarcada',
                  'parcial_marcada', 'parcial_atualizada', 'parcial_desmarcada', 'faturado_parcial',
                  'transferencia_iniciada', 'transferencia_atualizada', 'transferencia_concluida'));

-- Marca (ou atualiza) e conclui a transferência do pedido. p_em_transferencia = false conclui: o pedido volta para a
-- coluna da etapa dele na TV; os números informados continuam guardados no pedido e no histórico.
create or replace function pedido_transferencia(
  p_pedido_id uuid,
  p_em_transferencia boolean,
  p_de text,
  p_para text,
  p_pedido_erp text,
  p_numero text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v pedidos%rowtype;
  v_de text := upper(trim(coalesce(p_de, '')));
  v_para text := upper(trim(coalesce(p_para, '')));
  v_pedido_erp text := left(trim(coalesce(p_pedido_erp, '')), 40);
  v_numero text := nullif(left(trim(coalesce(p_numero, '')), 40), '');
  v_tipo text;
  v_detalhe text;
begin
  if not current_user_has_role('faturista') then
    raise exception 'Só o faturista pode marcar o pedido em transferência.';
  end if;
  select * into v from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  if v.status <> 'pendente' then
    raise exception 'Só pedidos em andamento podem ficar em transferência.';
  end if;

  if p_em_transferencia then
    if v_de not in ('SC', 'SP', 'CE') or v_para not in ('SC', 'SP', 'CE') or v_de = v_para then
      raise exception 'Escolha a filial de saída e a de chegada da transferência (SC, SP ou CE), diferentes entre si.';
    end if;
    if v_pedido_erp = '' then
      raise exception 'Informe o número do pedido no ERP.';
    end if;
    v_tipo := case when v.em_transferencia then 'transferencia_atualizada' else 'transferencia_iniciada' end;
    update pedidos
    set em_transferencia = true,
        transferencia_de = v_de,
        transferencia_para = v_para,
        transferencia_pedido_erp = v_pedido_erp,
        transferencia_numero = v_numero,
        transferencia_em = case when v.em_transferencia then coalesce(v.transferencia_em, now()) else now() end,
        transferencia_por = auth.uid()
    where id = p_pedido_id;
    v_detalhe := v_de || ' → ' || v_para || ' · Pedido ERP ' || v_pedido_erp || coalesce(' · Transferência ' || v_numero, '');
  else
    if not v.em_transferencia then
      return;
    end if;
    v_tipo := 'transferencia_concluida';
    update pedidos set em_transferencia = false where id = p_pedido_id;
    v_detalhe := coalesce(v.transferencia_de, '?') || ' → ' || coalesce(v.transferencia_para, '?')
      || coalesce(' · Pedido ERP ' || v.transferencia_pedido_erp, '') || coalesce(' · Transferência ' || v.transferencia_numero, '');
  end if;

  insert into pedido_eventos (pedido_id, tipo, motivo, por, revisao)
    values (p_pedido_id, v_tipo, v_detalhe, auth.uid(), v.revisao);
end;
$$;

grant execute on function pedido_transferencia(uuid, boolean, text, text, text, text) to authenticated;

-- Painel da TV: mesmos dados de antes + a transferência de cada pedido (coluna "Em transferência").
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
                              'processo_iniciado', 'enviado_sanco', 'separacao_iniciada', 'preparando_embarque',
                              'transferencia_iniciada', 'transferencia_concluida')),
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
        nullif(array_to_string(pd.parcial_nfs, ', '), '') as nfs_parciais,
        (pd.status = 'pendente' and pd.em_transferencia) as em_transferencia,
        pd.transferencia_de,
        pd.transferencia_para,
        pd.transferencia_pedido_erp,
        pd.transferencia_numero
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
        null::text,
        false,
        null::text,
        null::text,
        null::text,
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
