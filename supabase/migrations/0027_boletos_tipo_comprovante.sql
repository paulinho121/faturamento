-- ============================================================
-- Patch: distinguir "boleto" de "comprovante" na tabela boletos
-- ============================================================
-- Notas pagas por Boleto precisam de um título vinculado (via anexo manual
-- ou importação do XML de títulos). Notas pagas por PIX/Cartão/Pagarme não
-- geram título — em vez disso, o financeiro anexa o comprovante do
-- pagamento. Reaproveitamos a mesma tabela/bucket/RLS pra isso, só
-- diferenciando pelo tipo: uma linha "comprovante" já nasce com
-- status = 'pago' e vencimento = data de emissão da nota (não representa um
-- vencimento real).
-- ============================================================

alter table boletos add column if not exists tipo text not null default 'boleto' check (tipo in ('boleto', 'comprovante'));
