-- ============================================================
-- FATURAMENTO DASHBOARD — setup completo (schema + RLS + RPCs + seed)
-- ============================================================
-- Rode este arquivo INTEIRO, de uma vez, no SQL Editor de um
-- projeto Supabase NOVO ou recém-zerado (schema public vazio).
-- Se as tabelas já existirem, este script falha (não usa
-- "if not exists" nas tabelas) — rode só em banco limpo.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Extensões e tipos
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";

create type user_role as enum ('faturista', 'diretor');
create type modalidade_pagamento as enum ('Simples', 'Misto');

-- ------------------------------------------------------------
-- 1) Perfis (vincula auth.users a um papel)
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role user_role not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) Tabelas de apoio (lookups)
-- ------------------------------------------------------------
create table vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  ativo boolean not null default true
);

create table filiais (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null, -- ex: 'SC', 'SP', 'CE'
  ativo boolean not null default true
);

-- Tipo de Operação e Meio de Pagamento ficam como texto livre (não enum):
-- a planilha real tem dezenas de variações (Saída, Comodato, Armazém,
-- Transferência, Retorno Locação, Devolução de Compra, Garantia, Brinde...)
-- que mudam com frequência. Estas tabelas só guardam sugestões para o
-- formulário; a coluna em invoices aceita qualquer texto.
create table tipos_operacao (
  id serial primary key,
  nome text unique not null
);

create table meios_pagamento (
  id serial primary key,
  nome text unique not null
);

-- ------------------------------------------------------------
-- 3) Lançamentos de faturamento (equivalente à aba BASE_DASH da planilha)
-- ------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  filial_id uuid not null references filiais(id),
  estado char(2) not null,
  numero_nf text not null,
  data_emissao date not null,
  tipo_operacao text not null,
  modalidade_pagamento modalidade_pagamento not null default 'Simples',
  meio_pagamento text not null,
  parcelas smallint not null default 1,
  cliente text not null,
  valor numeric(14, 2) not null default 0,
  vendedor_id uuid not null references vendedores(id),
  valor_transferencia numeric(14, 2) not null default 0,
  valor_a_faturar numeric(14, 2) not null default 0,
  frete numeric(14, 2) not null default 0,
  xml_raw text,
  xml_chave_acesso text unique,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (numero_nf, filial_id)
);

create index invoices_data_emissao_idx on invoices (data_emissao);
create index invoices_vendedor_idx on invoices (vendedor_id);
create index invoices_filial_idx on invoices (filial_id);
create index invoices_created_at_idx on invoices (created_at desc);

-- Metas mensais por filial, usadas no KPI "Meta do Mês"
create table metas (
  id serial primary key,
  filial_id uuid references filiais(id),
  mes smallint not null check (mes between 1 and 12),
  ano smallint not null,
  valor_meta numeric(14, 2) not null,
  unique (filial_id, mes, ano)
);

-- ============================================================
-- 4) Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table vendedores enable row level security;
alter table filiais enable row level security;
alter table tipos_operacao enable row level security;
alter table meios_pagamento enable row level security;
alter table invoices enable row level security;
alter table metas enable row level security;

create function current_user_role() returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- profiles: cada um lê o próprio perfil; diretor lê todos (para listas/admin)
create policy "profile_self" on profiles for select
  using (id = auth.uid());
create policy "profile_diretor_all" on profiles for select
  using (current_user_role() = 'diretor');

-- lookups: leitura para qualquer usuário autenticado
create policy "vendedores_read" on vendedores for select
  using (auth.role() = 'authenticated');
create policy "filiais_read" on filiais for select
  using (auth.role() = 'authenticated');
create policy "tipos_operacao_read" on tipos_operacao for select
  using (auth.role() = 'authenticated');
create policy "meios_pagamento_read" on meios_pagamento for select
  using (auth.role() = 'authenticated');
create policy "metas_read" on metas for select
  using (auth.role() = 'authenticated');

-- invoices: faturista insere e vê só o que criou; diretor vê tudo.
-- Sem UPDATE/DELETE: correções entram como novo lançamento (auditável),
-- igual a um livro-razão.
create policy "faturista_insert" on invoices for insert
  with check (current_user_role() = 'faturista' and created_by = auth.uid());
create policy "faturista_select_own" on invoices for select
  using (current_user_role() = 'faturista' and created_by = auth.uid());
create policy "diretor_select_all" on invoices for select
  using (current_user_role() = 'diretor');

-- ============================================================
-- 5) Funções RPC para o dashboard (agregações no banco, não no cliente)
-- ============================================================
create or replace function dashboard_kpis(
  p_mes smallint default null,
  p_ano smallint default null,
  p_filial_id uuid default null,
  p_estado char(2) default null,
  p_tipo_operacao text default null,
  p_vendedor_id uuid default null,
  p_meio_pagamento text default null
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
    and tipo_operacao <> 'Cancelada';
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
  group by 1
  order by 1;
$$;

-- ============================================================
-- 6) Dados iniciais (seed) — extraídos da planilha "novo modelo
--    faturamento 2026.xlsx"
-- ============================================================
insert into vendedores (nome) values
  ('VINICIUS'), ('WENDEL'), ('FELIPE'), ('JOAO SOUSA'), ('JOAO GOMES'),
  ('JOHN'), ('JONATHAN'), ('SARAH'), ('PAULO')
on conflict (nome) do nothing;

-- Filiais observadas na planilha (código por UF de origem). Adicione mais
-- pelo Table Editor do Supabase se surgir uma filial nova.
insert into filiais (nome) values
  ('SC'), ('SP'), ('CE')
on conflict (nome) do nothing;

insert into tipos_operacao (nome) values
  ('Saída'), ('Comodato'), ('Armazém'), ('Transferência'), ('Cancelada'),
  ('Locação'), ('Retorno Locação'), ('Importação'), ('Devolução'),
  ('Devolução de Compra'), ('Garantia'), ('Brinde'), ('Demo'),
  ('Demonstração'), ('Complementar'), ('Serviço'), ('Entrada para Conserto'),
  ('Inutilizada')
on conflict (nome) do nothing;

insert into meios_pagamento (nome) values
  ('Site'), ('Mercado Livre'), ('Amazon'), ('Pagar.me'), ('Mercado Pago'),
  ('Rede'), ('Boleto'), ('PIX'), ('Cartão de Crédito'), ('Cartão de Débito'),
  ('Espécie'), ('Boleto Parcelado'), ('Boleto + PIX'), ('Cartão + PIX')
on conflict (nome) do nothing;

-- ============================================================
-- Pronto. Próximos passos (fora do SQL Editor):
--   1. Authentication → Users → criar 1 usuário Faturista e 1 Diretor.
--   2. Rodar o INSERT abaixo (troque os e-mails) para vincular o papel:
--
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Faturista', 'faturista' from auth.users where email = 'faturista@empresa.com';
--
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Diretor', 'diretor' from auth.users where email = 'diretor@empresa.com';
--
--   3. Database → Replication → habilitar Realtime na tabela invoices.
--   4. Project Settings → API → copiar URL e anon key para o .env local.
-- ============================================================
