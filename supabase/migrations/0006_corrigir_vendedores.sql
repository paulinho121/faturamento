-- ============================================================
-- Correção: dropdown de Vendedor só mostrava a Bianca.
--
-- Causa provável: alguma tentativa anterior de renomear os
-- vendedores (0002) não completou em todas as linhas, deixando
-- a maioria sem o nome novo/ativo=true. Este script é seguro de
-- rodar quantas vezes precisar — garante os 10 vendedores reais
-- ativos e desativa qualquer sobra com o nome antigo (tudo
-- maiúsculo), sem apagar nada (preserva notas já lançadas).
--
-- Rode no SQL Editor do DUIMP.
-- ============================================================

insert into vendedores (nome, ativo) values
  ('Paulo', true), ('Vinicius', true), ('João Sousa', true), ('João Gomes', true),
  ('Wendel', true), ('Sarah', true), ('Jhon', true), ('Felipe', true),
  ('Jonathan', true), ('Bianca', true)
on conflict (nome) do update set ativo = true;

update vendedores
set ativo = false
where nome in ('PAULO', 'VINICIUS', 'JOAO SOUSA', 'JOAO GOMES', 'WENDEL', 'SARAH', 'JOHN', 'FELIPE', 'JONATHAN');

-- Confira o resultado:
-- select nome, ativo from vendedores order by nome;
-- Deve mostrar os 10 nomes reais com ativo = true (e, se houver sobra
-- antiga, aparece com ativo = false, fora do dropdown).
