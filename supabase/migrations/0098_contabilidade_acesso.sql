-- ============================================================
-- Papel "contabilidade" — passo 2 de 2
-- Rode DEPOIS do 0097, em execução SEPARADA no SQL Editor.
-- ============================================================
-- A conta da contabilidade (contabilidade@mcistore.com.br) enxerga só as telas fiscais: apuração de IRPJ e CSLL,
-- Impostômetro e Notas de entrada (consulta e download de XML). Não vê faturamento, comissões, financeiro nem o
-- certificado digital. As telas leem por /api (service role, que confere o perfil); aqui ficam as policies de leitura
-- das tabelas da apuração, para o caso de consulta direta.
-- ============================================================

drop policy if exists "contab_parametros_select" on contab_parametros;
create policy "contab_parametros_select" on contab_parametros for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro') or current_user_role()::text = 'contabilidade');
drop policy if exists "contab_lancamentos_select" on contab_lancamentos;
create policy "contab_lancamentos_select" on contab_lancamentos for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro') or current_user_role()::text = 'contabilidade');
drop policy if exists "contab_fechamentos_select" on contab_fechamentos;
create policy "contab_fechamentos_select" on contab_fechamentos for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro') or current_user_role()::text = 'contabilidade');

-- Vincula a conta ao papel. Crie antes o usuário no painel do Supabase (Authentication → Users → Add user) com o e-mail
-- contabilidade@mcistore.com.br; se ele ainda não existir, este bloco só avisa e não faz nada (rode de novo depois).
do $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = 'contabilidade@mcistore.com.br' limit 1;
  if v_id is null then
    raise notice 'Usuário contabilidade@mcistore.com.br ainda não existe em Authentication → Users. Crie e rode este arquivo de novo.';
  else
    insert into profiles (id, full_name, role)
    values (v_id, 'Contabilidade', 'contabilidade')
    on conflict (id) do update set role = 'contabilidade', full_name = coalesce(profiles.full_name, excluded.full_name);
    raise notice 'Conta contabilidade@mcistore.com.br vinculada ao papel contabilidade.';
  end if;
end $$;
