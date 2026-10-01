-- ============================================================
-- BI Estratégico: faturamento por filial e por vendedor no período
-- selecionado (mesmo recorte de data das demais funções bi_*, diferente do
-- dashboard_participacao_filiais/dashboard_ranking_vendedores que só olham
-- mês/ano). Mesmo padrão: security definer, só diretor, mesmos filtros de
-- exclusão.
-- ============================================================

-- left join a partir de filiais pra toda filial aparecer, mesmo sem
-- faturamento no período (deixa claro quem não vendeu nada).
create or replace function bi_faturamento_por_filial(
  p_data_inicio date default null,
  p_data_fim date default null
) returns table (
  filial_id uuid,
  filial_nome text,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select f.id, f.nome, coalesce(sum(i.valor), 0), count(i.id)
  from filiais f
  left join invoices i on i.filial_id = f.id
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by f.id, f.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

-- Ranking de vendedores no período — top N por faturamento, com ticket médio.
create or replace function bi_faturamento_por_vendedor(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_limit int default 15
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  faturamento numeric,
  nf_count bigint,
  ticket_medio numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    v.id,
    v.nome,
    coalesce(sum(i.valor), 0),
    count(i.id),
    coalesce(sum(i.valor), 0) / nullif(count(i.id), 0)
  from vendedores v
  join invoices i on i.vendedor_id = v.id
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by v.id, v.nome
  order by coalesce(sum(i.valor), 0) desc
  limit greatest(coalesce(p_limit, 15), 1);
$$;
