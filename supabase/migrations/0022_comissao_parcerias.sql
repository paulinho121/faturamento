-- ============================================================
-- Patch: parcerias de comissão (vendedor "combo" dividido entre 2 pessoas)
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Caso de uso: João Sousa e João Gomes passaram a vender juntos. Criamos um
-- vendedor "JJ" — o faturista lança a nota nesse vendedor normalmente — e
-- a comissão daquelas vendas é automaticamente dividida entre os dois, cada
-- um com seu próprio percentual, sem que o faturista precise fazer nada
-- diferente. A tabela é genérica (não é hardcoded pra "JJ"), então dá pra
-- criar outras parcerias no futuro só inserindo novas linhas.
-- ============================================================

create table if not exists comissao_parcerias (
  id serial primary key,
  vendedor_id uuid not null references vendedores(id) on delete cascade,      -- o vendedor "combo" (ex: JJ)
  beneficiario_id uuid not null references vendedores(id) on delete cascade,  -- quem recebe a fatia (ex: João Gomes)
  percentual numeric(5, 2) not null,
  created_at timestamptz not null default now(),
  unique (vendedor_id, beneficiario_id)
);

alter table comissao_parcerias enable row level security;

drop policy if exists "diretor_all_comissao_parcerias" on comissao_parcerias;
create policy "diretor_all_comissao_parcerias" on comissao_parcerias for all
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');

-- Vendedor "combo". percentual_comissao próprio fica 0 — a comissão dele é
-- 100% redistribuída pelas linhas de comissao_parcerias abaixo.
insert into vendedores (nome, percentual_comissao) values ('JJ', 0)
on conflict (nome) do nothing;

insert into comissao_parcerias (vendedor_id, beneficiario_id, percentual)
select jj.id, gomes.id, 0.6
from vendedores jj, vendedores gomes
where jj.nome = 'JJ' and gomes.nome = 'João Gomes'
on conflict (vendedor_id, beneficiario_id) do update set percentual = excluded.percentual;

insert into comissao_parcerias (vendedor_id, beneficiario_id, percentual)
select jj.id, sousa.id, 1.0
from vendedores jj, vendedores sousa
where jj.nome = 'JJ' and sousa.nome = 'João Sousa'
on conflict (vendedor_id, beneficiario_id) do update set percentual = excluded.percentual;

-- dashboard_comissoes: precisa trocar de shape (nova coluna origem_parceria),
-- então dropa antes de recriar — "create or replace" não deixa mudar o
-- formato de retorno de uma function existente.
drop function if exists dashboard_comissoes(date, date);

create function dashboard_comissoes(
  p_data_inicio date,
  p_data_fim date
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  percentual_comissao numeric,
  faturamento_periodo numeric,
  valor_comissao numeric,
  origem_parceria text  -- null nas linhas normais; nome do vendedor "combo" nas linhas de parceria
)
language sql stable security definer
set search_path = public
as $$
  with faturamento_por_vendedor as (
    select
      v.id as vendedor_id,
      v.nome as vendedor_nome,
      v.percentual_comissao,
      v.profile_id,
      coalesce(sum(i.valor), 0) as faturamento_periodo
    from vendedores v
    left join invoices i on i.vendedor_id = v.id
      and i.data_emissao between coalesce(p_data_inicio, (current_date - interval '1 month')::date)
                             and coalesce(p_data_fim, current_date)
      and i.afeta_faturamento = true
      and i.excluida = false
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
      and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
    group by v.id, v.nome, v.percentual_comissao, v.profile_id
  )
  -- Comissão individual normal. Vendedores que são a ORIGEM de uma parceria
  -- (ex: JJ) não aparecem aqui — a comissão deles sai 100% dividida abaixo.
  select
    f.vendedor_id,
    f.vendedor_nome,
    f.percentual_comissao,
    f.faturamento_periodo,
    round(f.faturamento_periodo * f.percentual_comissao / 100, 2) as valor_comissao,
    null::text as origem_parceria
  from faturamento_por_vendedor f
  where not exists (select 1 from comissao_parcerias cp where cp.vendedor_id = f.vendedor_id)
    and (
      current_user_role() = 'diretor'
      or (current_user_role() = 'vendedor' and f.profile_id = auth.uid())
    )

  union all

  -- Comissão via parceria: uma linha por beneficiário, com o percentual e
  -- valor daquela fatia específica. vendedor_id fica o do vendedor "combo"
  -- (ex: JJ) — é lá que as notas de fato estão lançadas — pra abrir o
  -- extrato certo ao clicar na linha.
  select
    f.vendedor_id,
    b.nome as vendedor_nome,
    cp.percentual as percentual_comissao,
    f.faturamento_periodo,
    round(f.faturamento_periodo * cp.percentual / 100, 2) as valor_comissao,
    f.vendedor_nome as origem_parceria
  from comissao_parcerias cp
  join faturamento_por_vendedor f on f.vendedor_id = cp.vendedor_id
  join vendedores b on b.id = cp.beneficiario_id
  where current_user_role() = 'diretor'
     or (current_user_role() = 'vendedor' and b.profile_id = auth.uid())

  order by valor_comissao desc;
$$;
