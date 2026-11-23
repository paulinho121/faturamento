-- ============================================================
-- Certificado digital A1 da empresa, enviado pela tela (em vez de ficar numa variável da Vercel)
-- Rode no SQL Editor do projeto, depois da 0091.
-- ============================================================
-- Guarda o certificado e a senha CRIPTOGRAFADOS (AES-256-GCM, feita pelo servidor). A chave de criptografia
-- não está no banco: é derivada de um segredo do servidor, então quem só tem acesso ao banco não consegue abrir o
-- certificado. Os campos abertos (CNPJ, titular, validade) servem para a tela mostrar a situação.
-- Só a service role (backend) acessa: RLS ligada e nenhuma política. A tela fala com /api/dfe-certificado.
-- ============================================================

create table if not exists dfe_certificado (
  id smallint primary key default 1 check (id = 1), -- um certificado por empresa
  cifrado text not null,
  cnpj text,
  titular text,
  valido_ate timestamptz,
  enviado_em timestamptz not null default now(),
  enviado_por uuid references profiles(id)
);

alter table dfe_certificado enable row level security;
