-- ============================================================
-- Patch: comissão de vendedores (percentual + apuração 21 a 20)
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- O diretor precisa definir um percentual de comissão por vendedor e ver
-- quanto cada um tem a receber num período de apuração que vai do dia 21
-- de um mês até o dia 20 do mês seguinte (não é o mês calendário normal).
-- Guardamos só o percentual ATUAL por vendedor (sem histórico de mudanças
-- de percentual) — se o percentual mudar, os períodos passados recalculam
-- com o valor novo.
-- ============================================================

alter table vendedores add column if not exists percentual_comissao numeric(5,2) not null default 0;

drop policy if exists "diretor_update_vendedores" on vendedores;
create policy "diretor_update_vendedores" on vendedores for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');

-- p_mes/p_ano identificam o MÊS DE FECHAMENTO do período (o mês em que cai o
-- dia 20). Ex: p_mes=7, p_ano=2026 -> período de 21/06/2026 a 20/07/2026.
drop function if exists dashboard_comissoes(smallint, smallint);

create function dashboard_comissoes(
  p_mes smallint default null,
  p_ano smallint default null
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
  with base as (
    select
      coalesce(p_mes, extract(month from current_date)::smallint) as mes_fim,
      coalesce(p_ano, extract(year from current_date)::smallint) as ano_fim
  ),
  periodo as (
    select
      case when mes_fim = 1
        then make_date(ano_fim - 1, 12, 21)
        else make_date(ano_fim, mes_fim - 1, 21)
      end as inicio,
      make_date(ano_fim, mes_fim, 20) as fim
    from base
  )
  select
    v.id,
    v.nome,
    v.percentual_comissao,
    coalesce(sum(i.valor), 0) as faturamento_periodo,
    round(coalesce(sum(i.valor), 0) * v.percentual_comissao / 100, 2) as valor_comissao
  from vendedores v
  left join invoices i on i.vendedor_id = v.id
    and i.data_emissao between (select inicio from periodo) and (select fim from periodo)
    and i.afeta_faturamento = true
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by v.id, v.nome, v.percentual_comissao
  order by valor_comissao desc;
$$;
