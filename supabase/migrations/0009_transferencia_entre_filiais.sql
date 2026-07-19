-- ============================================================
-- Patch: transferências entre filiais/matriz
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Quando o destinatário da NF-e é o CNPJ de uma das nossas próprias
-- filiais (ou a matriz), a nota é uma transferência interna: não é
-- faturamento de venda e não precisa de vendedor. Este patch:
--   1) permite vendedor_id nulo (o app já enviava null p/ transferências,
--      mas o banco ainda rejeitava por causa do NOT NULL);
--   2) adiciona filial_destino_id, pra saber pra qual filial foi a
--      transferência (usado no resumo "Transferido por filial");
--   3) garante que as RPCs do dashboard (ranking, participação por
--      filial, faturamento por hora) também ignoram transferências —
--      isso já tinha sido feito no dashboard_kpis mas não nas outras.
-- ============================================================

alter table invoices alter column vendedor_id drop not null;

alter table invoices add column if not exists filial_destino_id uuid references filiais(id);
create index if not exists invoices_filial_destino_idx on invoices (filial_destino_id);

create or replace function dashboard_kpis(
  p_mes smallint default null,
  p_ano smallint default null,
  p_filial_id uuid default null,
  p_estado char(2) default null,
  p_tipo_operacao text default null,
  p_vendedor_id uuid default null,
  p_meio_pagamento text default null,
  p_cliente text default null
) returns table (
  faturamento numeric,
  nf_count bigint,
  clientes bigint,
  ticket_medio numeric,
  a_faturar numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(sum(valor), 0) as faturamento,
    count(*) as nf_count,
    count(distinct cliente) as clientes,
    case when count(*) > 0 then coalesce(sum(valor), 0) / count(*) else 0 end as ticket_medio,
    coalesce(sum(valor_a_faturar), 0) as a_faturar
  from invoices
  where current_user_role() = 'diretor'
    and (p_mes is null or extract(month from data_emissao) = p_mes)
    and (p_ano is null or extract(year from data_emissao) = p_ano)
    and (p_filial_id is null or filial_id = p_filial_id)
    and (p_estado is null or estado = p_estado)
    and (p_tipo_operacao is null or tipo_operacao = p_tipo_operacao)
    and (p_vendedor_id is null or vendedor_id = p_vendedor_id)
    and (p_meio_pagamento is null or meio_pagamento = p_meio_pagamento)
    and (p_cliente is null or cliente ilike '%' || p_cliente || '%')
    and tipo_operacao <> 'Cancelada'
    and upper(tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(tipo_operacao) <> 'TRANSFERENCIA';
$$;

create or replace function dashboard_ranking_vendedores(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  faturamento numeric,
  qtd_vendas bigint
)
language sql stable security definer
set search_path = public
as $$
  select v.id, v.nome, coalesce(sum(i.valor), 0), count(i.id)
  from vendedores v
  left join invoices i on i.vendedor_id = v.id
    and (p_mes is null or extract(month from i.data_emissao) = p_mes)
    and (p_ano is null or extract(year from i.data_emissao) = p_ano)
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by v.id, v.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function dashboard_participacao_filiais(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  filial_id uuid,
  filial_nome text,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  select f.id, f.nome, coalesce(sum(i.valor), 0)
  from filiais f
  left join invoices i on i.filial_id = f.id
    and (p_mes is null or extract(month from i.data_emissao) = p_mes)
    and (p_ano is null or extract(year from i.data_emissao) = p_ano)
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by f.id, f.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function dashboard_faturamento_por_hora(
  p_data date default current_date
) returns table (
  hora smallint,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  select extract(hour from created_at)::smallint as hora, coalesce(sum(valor), 0)
  from invoices
  where current_user_role() = 'diretor'
    and data_emissao = p_data
    and tipo_operacao <> 'Cancelada'
    and upper(tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(tipo_operacao) <> 'TRANSFERENCIA'
  group by 1
  order by 1;
$$;
