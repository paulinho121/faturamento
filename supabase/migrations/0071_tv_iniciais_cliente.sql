-- ============================================================
-- Modo TV do link (conta "tv"): o nome do cliente vira iniciais e o motivo da
-- devolução é omitido, pra os comerciais não verem os clientes uns dos outros.
-- Feito aqui no banco: o nome nem chega ao navegador da TV. Financeiro e
-- diretor continuam vendo tudo.
-- ============================================================

-- Iniciais do cliente ("Mário Silva Comércio Ltda" -> "M. S. C."): ignora
-- ltda/me/epp/eireli/sa e ligações (de, da, do, e), no máximo 4 palavras.
create or replace function iniciais_cliente(p_nome text)
returns text
language sql immutable
as $$
  select coalesce(nullif(string_agg(upper(left(w, 1)) || '.', ' ' order by n), ''), '—')
  from (
    select w, n
    from regexp_split_to_table(trim(coalesce(p_nome, '')), '\s+') with ordinality as t(w, n)
    where w ~ '[[:alnum:]]'
      and lower(w) !~ '^(ltda\.?|me|epp|eireli|s/?a|s\.a\.?|de|da|do|das|dos|e)$'
    order by n
    limit 4
  ) x
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
        pd.volumes
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
        ps.volumes
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
