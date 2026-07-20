-- ============================================================
-- Patch: quantidade de notas por hora
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- O gráfico "Faturamento por hora" só trazia a soma de valor por hora.
-- Pra alternar entre Valor/Quantidade no dashboard, a mesma função passa
-- a devolver também a contagem de notas por hora.
-- ============================================================

drop function if exists dashboard_faturamento_por_hora(date);

create function dashboard_faturamento_por_hora(
  p_data date default current_date
) returns table (
  hora smallint,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select extract(hour from created_at)::smallint as hora, coalesce(sum(valor), 0), count(*)
  from invoices
  where current_user_role() = 'diretor'
    and data_emissao = p_data
    and afeta_faturamento = true
    and tipo_operacao <> 'Cancelada'
    and upper(tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(tipo_operacao) <> 'TRANSFERENCIA'
  group by 1
  order by 1;
$$;
