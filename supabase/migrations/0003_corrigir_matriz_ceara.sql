-- ============================================================
-- Correção: a Matriz é a filial do Ceará (CNPJ 05502390000111),
-- não a de Santa Catarina como o 0002 tinha assumido.
--
-- Estado atual (depois do 0002, errado):
--   'Matriz'    cnpj 05502390000111  <- na verdade é a filial de SC
--   'Filial SP' cnpj 05502390000383  <- essa já estava certa
--   'CE'        sem cnpj, ativo=false <- na verdade é a Matriz
--   'Filial SC' cnpj 05502390000200  <- linha duplicada/vazia, criada do zero
--
-- Rode este arquivo inteiro, de uma vez, no SQL Editor do DUIMP.
-- ============================================================

-- 1) Se algum lançamento de teste já foi feito contra a "Filial SC"
--    duplicada (linha nova, vazia), move para a linha real que veio
--    da antiga 'SC' (por enquanto ainda chamada 'Matriz').
update invoices
set filial_id = (select id from filiais where nome = 'Matriz')
where filial_id = (select id from filiais where nome = 'Filial SC' and cnpj = '05502390000200');

-- 2) Remove a linha duplicada — não é mais necessária.
delete from filiais where nome = 'Filial SC' and cnpj = '05502390000200';

-- 3) A linha que era 'SC' (hoje mal-nomeada 'Matriz') vira a Filial SC de verdade.
--    Usa um nome temporário pra não colidir com o rename do passo 4.
update filiais set nome = 'Filial SC (tmp)', cnpj = '05502390000200' where nome = 'Matriz';

-- 4) A linha que era 'CE' vira a Matriz de verdade.
update filiais set nome = 'Matriz', cnpj = '05502390000111', ativo = true where nome = 'CE';

-- 5) Fecha o rename do passo 3.
update filiais set nome = 'Filial SC' where nome = 'Filial SC (tmp)';

-- ============================================================
-- Resultado esperado: 3 filiais ativas —
--   Matriz     cnpj 05502390000111
--   Filial SP  cnpj 05502390000383
--   Filial SC  cnpj 05502390000200
-- Confira rodando: select nome, cnpj, ativo from filiais order by nome;
-- ============================================================
