-- ============================================================
-- Patch: CNPJ das filiais + lista real de vendedores
-- Rode no SQL Editor do projeto DUIMP (banco já em produção,
-- criado a partir do complete_setup.sql antigo).
-- ============================================================

-- 1) Adiciona a coluna de CNPJ (usada para auto-detectar a filial
--    a partir do emit/CNPJ do XML da NF-e).
alter table filiais add column if not exists cnpj text unique;

-- 2) Atualiza as filiais existentes para os nomes/CNPJs reais.
--    'SC' vira a Matriz (é a que tem mais faturamento nos dados
--    originais, indicando ser a sede) e 'SP' vira 'Filial SP'.
--    Ajuste manualmente pelo Table Editor se o mapeamento estiver
--    errado — é só um UPDATE, não perde nenhum lançamento já feito.
update filiais set nome = 'Matriz', cnpj = '05502390000111' where nome = 'SC';
update filiais set nome = 'Filial SP', cnpj = '05502390000383' where nome = 'SP';

-- 'CE' não é uma filial de verdade (nenhum CNPJ informado pra ela) —
-- desativa em vez de apagar, pra não quebrar lançamentos antigos que
-- porventura já apontem pra ela.
update filiais set ativo = false where nome = 'CE';

-- Cria a filial nova que ainda não existia.
insert into filiais (nome, cnpj) values ('Filial SC', '05502390000200')
on conflict (nome) do nothing;

-- 3) Atualiza os nomes dos vendedores para a grafia correta e
--    adiciona a Bianca, que não estava na lista original.
update vendedores set nome = 'Paulo' where nome = 'PAULO';
update vendedores set nome = 'Vinicius' where nome = 'VINICIUS';
update vendedores set nome = 'João Sousa' where nome = 'JOAO SOUSA';
update vendedores set nome = 'João Gomes' where nome = 'JOAO GOMES';
update vendedores set nome = 'Wendel' where nome = 'WENDEL';
update vendedores set nome = 'Sarah' where nome = 'SARAH';
update vendedores set nome = 'Jhon' where nome = 'JOHN';
update vendedores set nome = 'Felipe' where nome = 'FELIPE';
update vendedores set nome = 'Jonathan' where nome = 'JONATHAN';

insert into vendedores (nome) values ('Bianca')
on conflict (nome) do nothing;
