-- ============================================================
-- Patch: pagamento parcial de título
-- ============================================================
-- Um título só podia ser "pendente" ou "pago" — sem jeito de registrar que
-- o cliente pagou só parte do valor. Isso escondia o saldo que ainda falta
-- (a nota some da lista de pendentes assim que alguém marca "pago", mesmo
-- tendo pago só metade). Agora existe um terceiro status "parcial" com
-- valor_pago rastreando quanto já entrou; o saldo (valor - valor_pago)
-- continua contando como "em aberto"/"vencido" em todo o painel.
-- ============================================================

alter table boletos add column if not exists valor_pago numeric(14, 2) not null default 0;

-- Backfill: títulos já marcados como pagos antes desta coluna existir devem
-- ficar com valor_pago = valor (senão os totais do painel ficariam errados).
update boletos set valor_pago = valor where status = 'pago' and valor_pago = 0;

alter table boletos drop constraint if exists boletos_status_check;
alter table boletos add constraint boletos_status_check check (status in ('pendente', 'pago', 'parcial'));
