-- ============================================================
-- Apuração de IRPJ e CSLL: simples faturamento (CFOP 5922 e 6922) entra na receita de mercadorias
-- Rode no SQL Editor depois da 0099.
-- ============================================================
-- Na venda para entrega futura, a receita nasce na nota de simples faturamento (5922/6922). A nota de remessa que vem
-- depois (5117/6117) repete o valor e fica de fora da lista, para não contar duas vezes.
-- ============================================================

alter table contab_parametros alter column cfops_mercadoria set default '5102,6102,5108,6108,5403,5405,5922,6922';

update contab_parametros
set cfops_mercadoria = cfops_mercadoria || ',5922,6922'
where cfops_mercadoria not like '%5922%'
  and cfops_mercadoria not like '%6922%';
