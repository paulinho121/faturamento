-- ============================================================
-- Patch: papel "logística" — passo 1 de 2
-- Rode este arquivo SOZINHO no SQL Editor (nenhum outro comando na mesma
-- execução). Postgres não deixa usar um valor de enum recém-criado na
-- mesma transação em que foi adicionado — o 0024 (que usa 'logistica')
-- precisa rodar numa execução SEPARADA, depois desta.
-- ============================================================

alter type user_role add value if not exists 'logistica';
