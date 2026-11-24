-- ============================================================
-- Apuração de IRPJ e CSLL: receita de mercadorias pelo CFOP
-- Rode no SQL Editor depois da 0098.
-- ============================================================
-- A receita de mercadorias passa a ser decidida pelo CFOP dos itens do XML da nota (e não pelo tipo ou pelo
-- "afeta faturamento" marcados na entrada). Esta coluna guarda, por ano, a lista de CFOPs de venda que contam como
-- receita de mercadorias (separados por vírgula). A tela de IRPJ e CSLL permite editar a lista.
-- ============================================================

alter table contab_parametros add column if not exists cfops_mercadoria text not null default '5102,6102,5108,6108,5403,5405';
