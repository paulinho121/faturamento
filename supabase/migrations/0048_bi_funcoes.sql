-- ============================================================
-- BI Estratégico: funções de agregação pro diretor analisar o negócio além
-- do mês corrente (evolução no tempo, faturamento por estado, maiores
-- clientes, mix por tipo de operação). Mesmo padrão das funções de
-- dashboard_* já existentes (security definer, só diretor, mesmos filtros
-- de exclusão: cancelada/transferência/não afeta faturamento/excluída).
-- ============================================================

create index if not exists invoices_estado_idx on invoices (estado);

-- Últimos N meses (incluindo o atual), com zero explícito pros meses sem
-- nenhuma nota — alimenta o gráfico de evolução.
create or replace function bi_evolucao_mensal(
  p_meses smallint default 12
) returns table (
  ano smallint,
  mes smallint,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    extract(year from m)::smallint as ano,
    extract(month from m)::smallint as mes,
    coalesce(sum(i.valor), 0) as faturamento,
    count(i.id) as nf_count
  from generate_series(
    date_trunc('month', current_date) - (greatest(coalesce(p_meses, 12), 1) - 1) * interval '1 month',
    date_trunc('month', current_date),
    interval '1 month'
  ) as m
  left join invoices i on date_trunc('month', i.data_emissao) = m
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by m
  order by m;
$$;

-- Faturamento agrupado por estado no período — alimenta o ranking geográfico
-- e serve de filtro pra "maiores clientes".
create or replace function bi_faturamento_por_estado(
  p_data_inicio date default null,
  p_data_fim date default null
) returns table (
  estado char(2),
  faturamento numeric,
  nf_count bigint,
  clientes bigint
)
language sql stable security definer
set search_path = public
as $$
  select i.estado, coalesce(sum(i.valor), 0), count(i.id), count(distinct i.cliente)
  from invoices i
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.estado
  order by coalesce(sum(i.valor), 0) desc;
$$;

-- Maiores clientes no período, opcionalmente filtrado por estado (clique no
-- gráfico de estados) — "estado" aqui é o mais frequente pras notas desse
-- cliente, útil quando o mesmo cliente compra de filiais em UFs diferentes.
create or replace function bi_top_clientes(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_limit int default 15
) returns table (
  cliente text,
  estado char(2),
  faturamento numeric,
  nf_count bigint,
  ticket_medio numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    i.cliente,
    mode() within group (order by i.estado),
    coalesce(sum(i.valor), 0),
    count(i.id),
    coalesce(sum(i.valor), 0) / nullif(count(i.id), 0)
  from invoices i
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.cliente
  order by coalesce(sum(i.valor), 0) desc
  limit p_limit;
$$;

-- Mix de faturamento por tipo de operação (Venda, Locação, Comodato...) —
-- ajuda a enxergar a composição do negócio além do número bruto.
create or replace function bi_faturamento_por_tipo(
  p_data_inicio date default null,
  p_data_fim date default null
) returns table (
  tipo_operacao text,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select i.tipo_operacao, coalesce(sum(i.valor), 0), count(i.id)
  from invoices i
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.tipo_operacao
  order by coalesce(sum(i.valor), 0) desc;
$$;
