-- ============================================================
-- Notas fiscais emitidas CONTRA a empresa (NF-e de entrada) — captura automática pela SEFAZ
-- Rode no SQL Editor do projeto, depois da 0090.
-- ============================================================
-- A rotina api/dfe-sync.ts consulta o serviço Distribuição DF-e da SEFAZ (com o certificado A1 da empresa) e
-- grava aqui as notas em que o CNPJ da empresa é o destinatário. Base do módulo da contabilidade.
-- Só o backend (service role) escreve. Leitura: diretor e financeiro (o perfil da contabilidade será liberado
-- quando o módulo for criado).
-- ============================================================

-- Controle da consulta por CNPJ: até onde já lemos (NSU) e quando pode consultar de novo (a SEFAZ bloqueia
-- por cerca de 1 hora quem consulta demais sem novidade).
create table if not exists dfe_controle (
  cnpj text primary key,
  ult_nsu text not null default '000000000000000',
  max_nsu text,
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  ultimo_status text,
  ultima_mensagem text,
  erros_seguidos integer not null default 0
);

create table if not exists nfe_entrada (
  chave text primary key check (chave ~ '^[0-9]{44}$'),
  cnpj_destinatario text not null,
  nsu text,
  emitente_cnpj text,
  emitente_nome text,
  emitente_ie text,
  numero text,
  serie text,
  data_emissao timestamptz,
  valor numeric(14, 2),
  tipo_operacao smallint, -- 0 = entrada, 1 = saída (tpNF do emitente)
  natureza_operacao text,
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada', 'denegada')),
  xml text, -- XML completo (procNFe); nulo enquanto só temos o resumo
  completa boolean not null default false,
  manifestacao text check (manifestacao in ('ciencia', 'confirmada', 'desconhecida', 'nao_realizada')),
  manifestada_em timestamptz,
  capturado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists nfe_entrada_emissao_idx on nfe_entrada (data_emissao desc);
create index if not exists nfe_entrada_emitente_idx on nfe_entrada (emitente_cnpj);
create index if not exists nfe_entrada_cnpj_idx on nfe_entrada (cnpj_destinatario, data_emissao desc);

-- Eventos da nota (cancelamento, carta de correção, manifestações...).
create table if not exists nfe_entrada_eventos (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  nsu text,
  tipo_evento text not null,
  sequencia integer not null default 1,
  descricao text,
  data_evento timestamptz,
  xml text,
  capturado_em timestamptz not null default now(),
  unique (chave, tipo_evento, sequencia)
);

create index if not exists nfe_entrada_eventos_chave_idx on nfe_entrada_eventos (chave);

alter table dfe_controle enable row level security;
alter table nfe_entrada enable row level security;
alter table nfe_entrada_eventos enable row level security;

drop policy if exists "nfe_entrada_select" on nfe_entrada;
create policy "nfe_entrada_select" on nfe_entrada for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));

drop policy if exists "nfe_entrada_eventos_select" on nfe_entrada_eventos;
create policy "nfe_entrada_eventos_select" on nfe_entrada_eventos for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
-- dfe_controle: só a service role (sem política).
