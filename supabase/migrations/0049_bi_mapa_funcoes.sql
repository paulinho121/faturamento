-- ============================================================
-- BI Estratégico: drill-down geográfico (mapa do Brasil por estado) — clique
-- num estado abre as cidades daquele estado e a lista de operações (notas)
-- por trás do número. Mesmo padrão das funções bi_* já existentes (security
-- definer, só diretor, mesmos filtros de exclusão).
-- ============================================================

create index if not exists clientes_cidade_idx on clientes (cidade);

-- Faturamento agrupado por cidade dentro de um estado (ou de todos) —
-- alimenta o segundo nível do drill-down do mapa (estado -> cidade).
create or replace function bi_faturamento_por_cidade(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null
) returns table (
  cidade text,
  estado char(2),
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(c.cidade, 'Não informado'),
    i.estado,
    coalesce(sum(i.valor), 0),
    count(i.id)
  from invoices i
  left join clientes c on c.id = i.cliente_id
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  group by coalesce(c.cidade, 'Não informado'), i.estado
  order by coalesce(sum(i.valor), 0) desc;
$$;

-- Lista das operações (notas) por trás de um estado/cidade — terceiro nível
-- do drill-down, as mais recentes primeiro, com teto pra não devolver uma
-- UF inteira de uma vez.
create or replace function bi_operacoes(
  p_data_inicio date default null,
  p_data_fim date default null,
  p_estado char(2) default null,
  p_cidade text default null,
  p_limit int default 300
) returns table (
  id uuid,
  numero_nf text,
  data_emissao date,
  cliente text,
  cidade text,
  estado char(2),
  tipo_operacao text,
  valor numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    i.id,
    i.numero_nf,
    i.data_emissao,
    i.cliente,
    coalesce(c.cidade, 'Não informado'),
    i.estado,
    i.tipo_operacao,
    i.valor
  from invoices i
  left join clientes c on c.id = i.cliente_id
  where current_user_role() = 'diretor'
    and (p_data_inicio is null or i.data_emissao >= p_data_inicio)
    and (p_data_fim is null or i.data_emissao <= p_data_fim)
    and (p_estado is null or i.estado = p_estado)
    and (p_cidade is null or coalesce(c.cidade, 'Não informado') = p_cidade)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  order by i.data_emissao desc, i.created_at desc
  limit greatest(coalesce(p_limit, 300), 1);
$$;
