-- ============================================================
-- RESET COMPLETO DO SCHEMA "public" — PostgreSQL / Supabase
-- ============================================================
-- ATENÇÃO: isto apaga TODAS as tabelas, views, funções, tipos,
-- sequences e dados do schema public. É IRREVERSÍVEL.
--
-- Faça backup antes, se tiver qualquer dúvida:
--   pg_dump --schema=public "postgresql://..." > backup.sql
--
-- Rode este arquivo inteiro no SQL Editor do projeto Supabase
-- ANTIGO que você quer zerar (confirme o projeto certo!).
--
-- Este script AGORA também apaga todos os usuários de autenticação
-- (auth.users) no passo 5 — ou seja, ninguém mais vai conseguir
-- logar nesse projeto até você cadastrar usuários novos.
-- ============================================================

-- 1) Dropa o schema public inteiro (cascade remove tudo dentro:
--    tabelas, views, funções, tipos, sequences, triggers).
drop schema if exists public cascade;

-- 2) Recria o schema vazio.
create schema public;

-- 3) Restaura as permissões padrão que o Supabase espera
--    (sem isso, a API REST/PostgREST para de enxergar o schema).
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public
  grant all on tables to postgres, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, anon;

-- 4) Reativa as extensions mais comuns (se a instalação anterior
--    usava alguma no schema public, ela some junto com o drop).
create extension if not exists "pgcrypto" schema public;
-- create extension if not exists "uuid-ossp" schema public; -- descomente se precisar

-- 5) Apaga TODOS os usuários de autenticação do projeto.
--    Roda depois do drop do schema public (passo 1) de propósito:
--    assim nenhuma tabela sua antiga com FK para auth.users(id)
--    atrapalha o delete. As tabelas internas do Supabase
--    (auth.identities, auth.sessions, auth.refresh_tokens,
--    auth.mfa_factors, auth.one_time_tokens) têm "on delete cascade"
--    para auth.users, então são limpas automaticamente junto.
delete from auth.users;

-- ============================================================
-- Pronto: schema public vazio, permissões corretas, nenhum
-- usuário de autenticação restante. Rode suas migrations/schema
-- novo e cadastre os usuários novos em seguida.
-- ============================================================
