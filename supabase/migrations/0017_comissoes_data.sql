-- ============================================================
-- Patch: Alteração da apuração de comissões para intervalo de datas dinâmico
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================

drop function if exists dashboard_comissoes(smallint, smallint);
drop function if exists dashboard_comissoes(date, date);

create function dashboard_comissoes(
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
  group by v.id, v.nome, v.percentual_comissao
  order by valor_comissao desc;
$$;
