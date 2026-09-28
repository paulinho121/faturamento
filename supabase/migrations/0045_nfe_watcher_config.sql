-- ============================================================
-- Configuração do watcher de XML: em vez de editar um arquivo local no PC do
-- faturista pra trocar a pasta observada, ele configura aqui pelo app, e o
-- script (watcher/watch-nfe.js) busca esse valor periodicamente no
-- endpoint api/nfe-watcher.ts (GET). Linha única (singleton) — só existe
-- uma pasta configurada por vez.
-- ============================================================

create table nfe_watcher_config (
  id smallint primary key default 1 check (id = 1),
  pasta text,
  atualizado_em timestamptz,
  atualizado_por uuid references profiles(id)
);

insert into nfe_watcher_config (id) values (1);

alter table nfe_watcher_config enable row level security;

create policy "faturista_all_nfe_watcher_config" on nfe_watcher_config for all
  using (current_user_has_role('faturista'))
  with check (current_user_has_role('faturista'));
