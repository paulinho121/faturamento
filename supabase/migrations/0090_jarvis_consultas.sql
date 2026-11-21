-- ============================================================
-- Patch: registro (auditoria) das consultas do JARVIS à API de leitura
-- Rode no SQL Editor do projeto, depois da 0089.
-- ============================================================
-- A API /api/jarvis/... (somente leitura) grava aqui cada consulta: quando, qual rota, com quais filtros, a
-- resposta e quanto demorou. Também serve para o limite de requisições por minuto. Não guarda o token.
-- Só a service role (backend) acessa: RLS ligada e nenhuma política.
-- ============================================================

create table if not exists jarvis_consultas (
  id uuid primary key default gen_random_uuid(),
  em timestamptz not null default now(),
  endpoint text not null,
  parametros jsonb,
  status integer not null,
  itens integer,
  ms integer,
  ip text
);

create index if not exists jarvis_consultas_em_idx on jarvis_consultas (em desc);

alter table jarvis_consultas enable row level security;
