-- ============================================================
-- Patch: novo papel de login "vendedor"
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- IMPORTANTE: rode este arquivo SOZINHO (sem colar junto com o 0019) e
-- clique em "Run" separado. O Postgres não deixa usar um valor de enum
-- recém-criado na MESMA transação em que ele foi adicionado — se você
-- colar este ALTER TYPE junto com o 0019 (que já usa 'vendedor' em
-- políticas/funções), o SQL Editor vai dar erro "unsafe use of new value".
-- ============================================================

alter type user_role add value if not exists 'vendedor';
