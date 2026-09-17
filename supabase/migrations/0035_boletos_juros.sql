-- ============================================================
-- Patch: juros/multa em título vencido
-- ============================================================
-- Ao registrar o pagamento de um título vencido, o financeiro precisa
-- informar se houve cobrança de juros/multa e, se sim, quanto — esse valor
-- soma ao valor original do título para compor o total devido (e o saldo
-- pendente), sem sobrescrever o valor nominal original da nota.
-- ============================================================

alter table boletos add column if not exists juros numeric(14, 2) not null default 0;
