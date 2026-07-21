-- ============================================================
-- Patch: login do vendedor — vínculo, RLS e comissão própria
-- Rode no SQL Editor do projeto DUIMP DEPOIS do 0018 (que adiciona o
-- valor 'vendedor' ao enum user_role — precisa rodar em transação separada).
-- ============================================================
-- O vendedor loga com uma conta própria (criada por você no painel de
-- Auth do Supabase, igual já fazemos com faturista/diretor) e essa conta
-- fica vinculada a UMA linha da tabela vendedores via profile_id. A partir
-- daí ele só enxerga as próprias notas (RLS) e a própria comissão.
-- ============================================================

alter table vendedores add column if not exists profile_id uuid references profiles(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendedores_profile_id_key'
  ) then
    alter table vendedores add constraint vendedores_profile_id_key unique (profile_id);
  end if;
end $$;

-- invoices: vendedor vê só as próprias notas (join implícito via vendedores.profile_id)
drop policy if exists "vendedor_select_own" on invoices;
create policy "vendedor_select_own" on invoices for select
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );

-- dashboard_comissoes: agora também roda pro vendedor, mas ele só recebe a
-- própria linha (o join com vendedores já filtra pra "v.profile_id = auth.uid()").
create or replace function dashboard_comissoes(
  p_data_inicio date,
  p_data_fim date
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  percentual_comissao numeric,
  faturamento_periodo numeric,
  valor_comissao numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    v.id,
    v.nome,
    v.percentual_comissao,
    coalesce(sum(i.valor), 0) as faturamento_periodo,
    round(coalesce(sum(i.valor), 0) * v.percentual_comissao / 100, 2) as valor_comissao
  from vendedores v
  left join invoices i on i.vendedor_id = v.id
    and i.data_emissao between coalesce(p_data_inicio, (current_date - interval '1 month')::date)
                           and coalesce(p_data_fim, current_date)
    and i.afeta_faturamento = true
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
    and i.excluida = false
  where current_user_role() = 'diretor'
     or (current_user_role() = 'vendedor' and v.profile_id = auth.uid())
  group by v.id, v.nome, v.percentual_comissao
  order by valor_comissao desc;
$$;
