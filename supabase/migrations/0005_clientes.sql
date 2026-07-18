-- ============================================================
-- Patch: tabela de clientes + busca por cliente no dashboard
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj_cpf text unique,
  estado char(2),
  cidade text,
  created_at timestamptz not null default now()
);
create index if not exists clientes_nome_idx on clientes (nome);

alter table invoices add column if not exists cliente_id uuid references clientes(id);
create index if not exists invoices_cliente_idx on invoices (cliente_id);

alter table clientes enable row level security;

create policy "clientes_read" on clientes for select
  using (auth.role() = 'authenticated');
create policy "faturista_insert_clientes" on clientes for insert
  with check (current_user_role() = 'faturista');
create policy "faturista_update_clientes" on clientes for update
  using (current_user_role() = 'faturista')
  with check (current_user_role() = 'faturista');

-- Popula clientes a partir das notas já lançadas (se houver), pra não
-- perder o histórico de quem já comprou antes desse patch.
insert into clientes (nome)
select distinct cliente from invoices
where cliente is not null and cliente <> ''
on conflict do nothing;

update invoices i
set cliente_id = c.id
from clientes c
where i.cliente_id is null and c.nome = i.cliente;

-- Adiciona o parâmetro de busca por cliente na função de KPIs do dashboard.
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
    and tipo_operacao <> 'Cancelada';
$$;
