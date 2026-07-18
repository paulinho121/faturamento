-- ============================================================
-- Patch: colunas de DIFAL e FCP em invoices
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================

alter table invoices add column if not exists valor_difal numeric(14, 2) not null default 0;
alter table invoices add column if not exists valor_fcp numeric(14, 2) not null default 0;

comment on column invoices.valor_difal is 'ICMS de partilha destinado à UF do destinatário (vICMSUFDest do XML da NF-e)';
comment on column invoices.valor_fcp is 'Fundo de Combate à Pobreza da UF de destino (vFCPUFDest do XML da NF-e)';
