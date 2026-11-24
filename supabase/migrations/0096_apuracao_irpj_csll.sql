-- ============================================================
-- Contabilidade: apuração trimestral de IRPJ e CSLL (Lucro Presumido)
-- Rode no SQL Editor do projeto, depois da 0095.
-- ============================================================
-- Base: a planilha "IRPJ e CSLL" da contabilidade. A tela monta cada trimestre com o que o sistema já sabe (receita das
-- notas, devoluções, IPI, juros recebidos) e deixa a contabilidade digitar ou corrigir o resto (serviços, receitas
-- financeiras, IRRF...). Estas tabelas guardam:
--   contab_parametros    limite do trimestre, percentuais de presunção e alíquotas, por ano (a regra pode mudar)
--   contab_lancamentos   valores digitados à mão (por ano, mês e linha); sobrepõem o valor do sistema
--   contab_fechamentos   "fotos" do trimestre fechado (valores e resultado), para histórico
-- Só a service role (backend) escreve; leitura para diretor e financeiro (o perfil da contabilidade entra depois).
-- ============================================================

create table if not exists contab_parametros (
  ano smallint primary key,
  limite_trimestre numeric(14, 2) not null default 1250000,
  perc_merc_irpj numeric(6, 3) not null default 8,
  perc_merc_irpj_excedente numeric(6, 3) not null default 8.8,
  perc_serv numeric(6, 3) not null default 32,
  perc_serv_excedente numeric(6, 3) not null default 35.2,
  perc_merc_csll numeric(6, 3) not null default 12,
  perc_merc_csll_excedente numeric(6, 3) not null default 13.2,
  aliquota_irpj numeric(6, 3) not null default 15,
  adicional_aliquota numeric(6, 3) not null default 10,
  adicional_limite numeric(14, 2) not null default 60000,
  aliquota_csll numeric(6, 3) not null default 9,
  cotas smallint not null default 3 check (cotas between 1 and 3),
  cota_minima numeric(14, 2) not null default 1000,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references profiles(id)
);

insert into contab_parametros (ano) values (2026) on conflict (ano) do nothing;

create table if not exists contab_lancamentos (
  ano smallint not null,
  mes smallint not null check (mes between 1 and 12),
  linha text not null,
  valor numeric(14, 2) not null,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references profiles(id),
  primary key (ano, mes, linha)
);

create table if not exists contab_fechamentos (
  id uuid primary key default gen_random_uuid(),
  ano smallint not null,
  trimestre smallint not null check (trimestre between 1 and 4),
  dados jsonb not null,
  irpj_devido numeric(14, 2),
  csll_devido numeric(14, 2),
  fechado_em timestamptz not null default now(),
  fechado_por uuid references profiles(id),
  observacao text
);

create index if not exists contab_fechamentos_periodo_idx on contab_fechamentos (ano, trimestre, fechado_em desc);

alter table contab_parametros enable row level security;
alter table contab_lancamentos enable row level security;
alter table contab_fechamentos enable row level security;

drop policy if exists "contab_parametros_select" on contab_parametros;
create policy "contab_parametros_select" on contab_parametros for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
drop policy if exists "contab_lancamentos_select" on contab_lancamentos;
create policy "contab_lancamentos_select" on contab_lancamentos for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
drop policy if exists "contab_fechamentos_select" on contab_fechamentos;
create policy "contab_fechamentos_select" on contab_fechamentos for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
