-- ============================================================
-- Patch: soft-delete em boletos (com quem/quando excluiu)
-- ============================================================
-- Excluir um título financeiro era um DELETE de verdade, sem confirmação e
-- sem deixar rastro — para dado financeiro isso é arriscado (impossível
-- responder "quem apagou isso e quando" numa auditoria/disputa com
-- cliente). Passa a ser igual ao padrão já usado em invoices.excluida:
-- marca como excluído em vez de apagar, e a tela filtra por excluido=false.
-- ============================================================

alter table boletos add column if not exists excluido boolean not null default false;
alter table boletos add column if not exists excluido_em timestamptz;
alter table boletos add column if not exists excluido_por uuid references profiles(id);
