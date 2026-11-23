-- ============================================================
-- Período (janela de datas) da captura de NF-e de entrada
-- Rode no SQL Editor do projeto, depois da 0092.
-- ============================================================
-- A SEFAZ não filtra por data: ela entrega tudo em ordem de NSU. Com este período, a captura lê normalmente, mas
-- só GRAVA as notas cuja data de emissão está entre data_inicio e data_fim (qualquer uma das duas pode ficar vazia
-- = sem limite). Notas já gravadas antes de definir o período não são apagadas.
-- Só a service role (backend) acessa: RLS ligada e nenhuma política. A tela fala com /api/dfe-certificado.
-- ============================================================

create table if not exists dfe_config (
  id smallint primary key default 1 check (id = 1),
  data_inicio date,
  data_fim date,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references profiles(id),
  check (data_inicio is null or data_fim is null or data_inicio <= data_fim)
);

alter table dfe_config enable row level security;
