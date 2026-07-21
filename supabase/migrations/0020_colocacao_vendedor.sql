-- ============================================================
-- Patch: colocação do vendedor no ranking (gamificação)
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Retorna só a posição do vendedor logado, o total de vendedores e o
-- próprio faturamento do mês — nunca os valores dos outros vendedores.
-- O ranking é calculado com row_number() sobre TODOS os vendedores, mas o
-- WHERE final filtra pra devolver só a linha de quem chamou a função.
-- ============================================================

drop function if exists dashboard_minha_colocacao(smallint, smallint);

create function dashboard_minha_colocacao(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  colocacao bigint,
  total_vendedores bigint,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  with ranking as (
    select
      v.id,
      coalesce(sum(i.valor), 0) as faturamento,
      row_number() over (order by coalesce(sum(i.valor), 0) desc) as colocacao,
      count(*) over () as total_vendedores
    from vendedores v
    left join invoices i on i.vendedor_id = v.id
      and (p_mes is null or extract(month from i.data_emissao) = p_mes)
      and (p_ano is null or extract(year from i.data_emissao) = p_ano)
      and i.afeta_faturamento = true
      and i.excluida = false
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
      and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
    where v.ativo = true
    group by v.id
  )
  select r.colocacao, r.total_vendedores, r.faturamento
  from ranking r
  join vendedores v on v.id = r.id
  where current_user_role() = 'vendedor' and v.profile_id = auth.uid();
$$;
