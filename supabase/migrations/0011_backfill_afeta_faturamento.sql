-- ============================================================
-- Patch: backfill afeta_faturamento para notas já lançadas
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- A migration 0010 criou a coluna afeta_faturamento com default true
-- para TODAS as notas, incluindo as de tipos que nunca deveriam contar
-- no faturamento (Comodato, Brinde, Retorno Locação, etc) — o formulário
-- de lançamento também não tinha um valor padrão inteligente ainda, então
-- toda nota lançada até agora ficou marcada como "conta no faturamento"
-- independente do tipo. Este patch corrige o histórico.
-- ============================================================

update invoices
set afeta_faturamento = false
where afeta_faturamento = true
  and upper(tipo_operacao) in (
    'TRANSFERÊNCIA', 'TRANSFERENCIA',
    'COMODATO',
    'CANCELADA',
    'RETORNO LOCAÇÃO', 'RETORNO LOCACAO',
    'DEVOLUÇÃO', 'DEVOLUCAO',
    'DEVOLUÇÃO DE COMPRA', 'DEVOLUCAO DE COMPRA',
    'GARANTIA',
    'BRINDE',
    'DEMO',
    'DEMONSTRAÇÃO', 'DEMONSTRACAO',
    'ENTRADA PARA CONSERTO',
    'INUTILIZADA',
    'IMPORTAÇÃO', 'IMPORTACAO',
    'ARMAZÉM', 'ARMAZEM'
  );
