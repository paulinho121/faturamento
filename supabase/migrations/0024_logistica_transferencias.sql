-- ============================================================
-- Patch: papel "logística" — passo 2 de 2
-- Rode DEPOIS do 0023, em execução SEPARADA no SQL Editor.
-- ============================================================
-- O usuário de logística (ex: logisticasp@mcistore.com.br) só enxerga notas
-- de Transferência (de qualquer filial) e o campo transportadora — sem
-- acesso a faturamento, comissões ou qualquer outro dado do app.
-- ============================================================

alter table invoices add column if not exists transportadora text;

drop policy if exists "logistica_select_transferencias" on invoices;
create policy "logistica_select_transferencias" on invoices for select
  using (
    current_user_role() = 'logistica'
    and (upper(tipo_operacao) = 'TRANSFERÊNCIA' or upper(tipo_operacao) = 'TRANSFERENCIA')
  );

-- ------------------------------------------------------------
-- Depois de rodar os dois arquivos, crie o usuário no painel de Auth do
-- Supabase (Authentication → Users → Add user) com o e-mail
-- logisticasp@mcistore.com.br, depois rode:
--
--   insert into profiles (id, full_name, role)
--   select id, 'Logística SP', 'logistica' from auth.users
--   where email = 'logisticasp@mcistore.com.br'
--   on conflict (id) do update set role = 'logistica', full_name = 'Logística SP';
-- ------------------------------------------------------------
