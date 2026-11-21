-- ============================================================
-- Patch: controle dos envios ao JARVIS (integração com o assistente executivo do diretor)
-- Rode no SQL Editor do projeto, depois da 0088.
-- ============================================================
-- A rotina api/jarvis-sync.ts manda ao JARVIS as NF-e (XML), comissões, títulos a receber e indicadores.
-- Esta tabela guarda uma "impressão digital" (hash) do que já foi enviado com sucesso, para reenviar só o que
-- mudou. Os envios são idempotentes no JARVIS, então apagar esta tabela só faz tudo ser reenviado.
-- Só a service role (backend) acessa: RLS ligada e nenhuma política.
-- ============================================================

create table if not exists jarvis_envios (
  tipo text not null check (tipo in ('nota', 'comissao', 'titulo', 'indicadores')),
  chave text not null,
  hash text not null,
  enviado_em timestamptz not null default now(),
  primary key (tipo, chave)
);

alter table jarvis_envios enable row level security;
