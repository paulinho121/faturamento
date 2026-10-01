-- ============================================================
-- BI Estratégico: filtros globais (estado, filial, vendedor, tipo de
-- operação) que o diretor escolhe no topo da página e que recortam todos os
-- painéis — não só o clique no mapa. Cada painel que já é o dono de uma
-- dessas dimensões (ex: "Faturamento por Estado" pro filtro de estado) NÃO
-- recebe o próprio filtro, só os outros três — senão o gráfico colapsaria
-- pra uma barra só quando você seleciona aquela dimensão nele mesmo.
--
-- Como isso muda a assinatura das funções bi_* já existentes (novos
-- parâmetros), precisa dropar a versão antiga antes: "create or replace"
-- só substitui quando os tipos de parâmetro batem exatamente — com uma
-- lista diferente ele criaria uma segunda função sobrecarregada em vez de
-- substituir, e aí chamadas por nome ficariam ambíguas.
-- ============================================================

drop function if exists bi_evolucao_mensal(smallint);
drop function if exists bi_faturamento_por_estado(date, date);
drop function if exists bi_top_clientes(date, date, char(2), int);
drop function if exists bi_faturamento_por_tipo(date, date);
drop function if exists bi_faturamento_por_cidade(date, date, char(2));
drop function if exists bi_operacoes(date, date, char(2), text, int);
drop function if exists bi_faturamento_por_filial(date, date);
drop function if exists bi_faturamento_por_vendedor(date, date, int);

create or replace function bi_evolucao_mensal(
  p_meses smallint default 12,
  p_estado char(2) default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null
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
    and (p_estado is null or i.estado = p_estado)
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by m
  order by m;
$$;

create or replace function bi_faturamento_por_estado(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null
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
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.estado
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function bi_top_clientes(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null,
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
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.cliente
  order by coalesce(sum(i.valor), 0) desc
  limit p_limit;
$$;

create or replace function bi_faturamento_por_tipo(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null
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
    and (p_estado is null or i.estado = p_estado)
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by i.tipo_operacao
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function bi_faturamento_por_cidade(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null
) returns table (
  cidade text,
  estado char(2),
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(c.cidade, 'Não informado'),
    i.estado,
    coalesce(sum(i.valor), 0),
    count(i.id)
  from invoices i
  left join clientes c on c.id = i.cliente_id
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by coalesce(c.cidade, 'Não informado'), i.estado
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function bi_operacoes(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_cidade text default null,
  p_filial_id uuid default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null,
  p_limit int default 300
) returns table (
  id uuid,
  numero_nf text,
  data_emissao date,
  cliente text,
  cidade text,
  estado char(2),
  tipo_operacao text,
  valor numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    i.id,
    i.numero_nf,
    i.data_emissao,
    i.cliente,
    coalesce(c.cidade, 'Não informado'),
    i.estado,
    i.tipo_operacao,
    i.valor
  from invoices i
  left join clientes c on c.id = i.cliente_id
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and (p_cidade is null or coalesce(c.cidade, 'Não informado') = p_cidade)
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  order by i.data_emissao desc, i.created_at desc
  limit greatest(coalesce(p_limit, 300), 1);
$$;

create or replace function bi_faturamento_por_filial(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_vendedor_id uuid default null,
  p_tipo_operacao text default null
) returns table (
  filial_id uuid,
  filial_nome text,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select f.id, f.nome, coalesce(sum(i.valor), 0), count(i.id)
  from filiais f
  left join invoices i on i.filial_id = f.id
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and (p_vendedor_id is null or i.vendedor_id = p_vendedor_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by f.id, f.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function bi_faturamento_por_vendedor(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_filial_id uuid default null,
  p_tipo_operacao text default null,
  p_limit int default 15
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  faturamento numeric,
  nf_count bigint,
  ticket_medio numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    v.id,
    v.nome,
    coalesce(sum(i.valor), 0),
    count(i.id),
    coalesce(sum(i.valor), 0) / nullif(count(i.id), 0)
  from vendedores v
  join invoices i on i.vendedor_id = v.id
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and (p_filial_id is null or i.filial_id = p_filial_id)
    and (p_tipo_operacao is null or i.tipo_operacao = p_tipo_operacao)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by v.id, v.nome
  order by coalesce(sum(i.valor), 0) desc
  limit greatest(coalesce(p_limit, 15), 1);
$$;
