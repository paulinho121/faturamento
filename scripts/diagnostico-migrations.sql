-- Confere se cada migration (0002 a 0009) já foi aplicada no banco.
-- Só leitura — não muda nada. Rode tudo de uma vez no SQL Editor do DUIMP.

select
  '0002/0003 — filiais com CNPJ e nomes reais' as migration,
  case when exists (
    select 1 from information_schema.columns
    where table_name = 'filiais' and column_name = 'cnpj'
  ) then '✅ aplicada' else '❌ FALTA rodar' end as status
union all
select
  '0004 — valor_difal / valor_fcp em invoices',
  case when exists (
    select 1 from information_schema.columns
    where table_name = 'invoices' and column_name = 'valor_difal'
  ) then '✅ aplicada' else '❌ FALTA rodar' end
union all
select
  '0005 — tabela clientes',
  case when exists (
    select 1 from information_schema.tables where table_name = 'clientes'
  ) then '✅ aplicada' else '❌ FALTA rodar' end
union all
select
  '0006 — vendedores reais ativos (10 esperados)',
  case when (select count(*) from vendedores where ativo) >= 10
    then '✅ aplicada' else '❌ confira — só ' || (select count(*) from vendedores where ativo) || ' ativos' end
union all
select
  '0007 — meios_pagamento reais (PIX/Boleto/Cartão Rede/Pagarme)',
  case when exists (select 1 from meios_pagamento where nome = 'Cartão Rede')
    then '✅ aplicada' else '❌ FALTA rodar' end
union all
select
  '0008 — diretor pode inserir metas',
  case when exists (
    select 1 from pg_policies where tablename = 'metas' and policyname = 'diretor_insert_metas'
  ) then '✅ aplicada' else '❌ FALTA rodar' end
union all
select
  '0009 — filial_destino_id + vendedor_id opcional',
  case when exists (
    select 1 from information_schema.columns
    where table_name = 'invoices' and column_name = 'filial_destino_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_name = 'invoices' and column_name = 'vendedor_id' and is_nullable = 'YES'
  ) then '✅ aplicada' else '❌ FALTA rodar' end;
