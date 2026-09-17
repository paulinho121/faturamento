-- ============================================================
-- Patch: data do pagamento do título
-- ============================================================
-- Faltava registrar QUANDO o pagamento entrou (só tínhamos o vencimento).
-- Fica null enquanto o título está pendente e é limpo se o pagamento for
-- revertido (valor_pago voltar a zero).
-- ============================================================

alter table boletos add column if not exists data_pagamento date;
