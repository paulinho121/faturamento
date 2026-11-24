-- ============================================================
-- Papel "contabilidade" — passo 1 de 2
-- Rode este arquivo SOZINHO no SQL Editor (nenhum outro comando na mesma execução).
-- O Postgres não deixa usar um valor de enum recém-criado na mesma transação em que foi adicionado:
-- o 0098 (que usa 'contabilidade') precisa rodar numa execução SEPARADA, depois deste.
-- ============================================================

alter type user_role add value if not exists 'contabilidade';
