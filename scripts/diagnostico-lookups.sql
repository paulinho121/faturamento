select 'tipos_operacao' as tabela, count(*) as total from tipos_operacao
union all
select 'meios_pagamento', count(*) from meios_pagamento
union all
select 'filiais_ativas', count(*) from filiais where ativo
union all
select 'filiais_com_cnpj', count(*) from filiais where cnpj is not null
union all
select 'vendedores_ativos', count(*) from vendedores where ativo;

-- Detalhe das filiais (confirma se 0002/0003 já rodaram):
select nome, cnpj, ativo from filiais order by nome;

-- Confirma se 'Saída' e 'Boleto' existem com esse texto exato:
select nome from tipos_operacao where nome ilike '%saída%' or nome ilike '%saida%';
select nome from meios_pagamento where nome ilike '%boleto%';
