-- ============================================================
-- Escolha de quem aparece na Corrida dos Cavalinhos (antes eram só os que
-- tinham meta pessoal ou já tinham vendido no mês, até 6, e o vendedor
-- "combo" JJ entrava junto). Agora cada vendedor tem a marca na_corrida e a
-- corrida mostra sempre esses, vendendo ou não.
-- ============================================================

alter table vendedores add column if not exists na_corrida boolean not null default false;

-- Liga/desliga o vendedor na Corrida dos Cavalinhos da TV. Função (e não update
-- direto na tabela) pra o financeiro só poder mexer nesse campo.
create or replace function definir_na_corrida(p_vendedor_id uuid, p_na_corrida boolean)
returns void
language sql security definer
set search_path = public
as $$
  update vendedores set na_corrida = p_na_corrida
  where id = p_vendedor_id
    and (current_user_has_role('financeiro') or current_user_role() = 'diretor');
$$;

-- Quem corre hoje. Casa o nome sem acento nem maiúscula ("João Sousa" =
-- "JOAO SOUSA") e aceita "Jhon" ou "John". Depois é só ajustar na tela
-- "Fotos da TV". Não cria vendedor: se algum nome não existir, avisa abaixo.
do $$
declare
  n text;
  achou int;
  faltando text[] := '{}';
begin
  update vendedores
  set na_corrida = true
  where ativo
    and translate(lower(trim(nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
        in ('felipe', 'vinicius', 'joao sousa', 'joao gomes', 'wendel', 'jhon', 'john', 'jonathan', 'luiz');

  foreach n in array array['felipe', 'vinicius', 'joao sousa', 'joao gomes', 'wendel', 'jonathan', 'luiz'] loop
    select count(*) into achou from vendedores
    where ativo and translate(lower(trim(nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = n;
    if achou = 0 then faltando := faltando || n; end if;
  end loop;
  select count(*) into achou from vendedores
  where ativo and translate(lower(trim(nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') in ('jhon', 'john');
  if achou = 0 then faltando := faltando || 'jhon/john'; end if;

  if array_length(faltando, 1) > 0 then
    raise notice 'Vendedores NÃO encontrados (cadastre-os ou ajuste o nome): %', faltando;
  else
    raise notice 'Todos os vendedores da corrida foram marcados.';
  end if;
end
$$;

-- painel_tv agora também devolve na_corrida de cada vendedor.
create or replace function painel_tv()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with
  ref as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as hoje,
      date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as inicio
  ),
  validas as (
    select i.vendedor_id, i.valor, i.data_emissao
    from invoices i, ref
    where i.excluida = false
      and i.afeta_faturamento = true
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) not in ('TRANSFERÊNCIA', 'TRANSFERENCIA')
      and i.data_emissao between ref.inicio and ref.hoje
  ),
  meta as (
    select coalesce(
      (select m.valor_meta from metas m, ref
        where m.filial_id is null
          and m.mes = extract(month from ref.hoje) and m.ano = extract(year from ref.hoje)
        limit 1),
      (select sum(m.valor_meta) from metas m, ref
        where m.filial_id is not null
          and m.mes = extract(month from ref.hoje) and m.ano = extract(year from ref.hoje)),
      0
    ) as valor
  ),
  vend as (
    select
      v.id,
      v.nome,
      v.foto_path,
      v.na_corrida,
      mp.valor_meta as meta_pessoal,
      coalesce(sum(n.valor) filter (where n.data_emissao = ref.hoje), 0) as faturado_hoje,
      coalesce(sum(n.valor), 0) as faturado_mes,
      (select count(*) from pedidos pd
        where pd.vendedor_id = v.id and pd.status <> 'cancelado'
          and (pd.created_at at time zone 'America/Sao_Paulo')::date = ref.hoje) as pedidos_hoje,
      (select count(*) from pedidos pd
        where pd.vendedor_id = v.id and pd.status <> 'cancelado'
          and (pd.created_at at time zone 'America/Sao_Paulo')::date >= ref.inicio) as pedidos_mes
    from vendedores v
    cross join ref
    left join validas n on n.vendedor_id = v.id
    left join metas_pessoais mp on mp.vendedor_id = v.id
      and mp.mes = extract(month from ref.hoje) and mp.ano = extract(year from ref.hoje)
    where v.ativo
    group by v.id, v.nome, v.foto_path, v.na_corrida, mp.valor_meta, ref.hoje, ref.inicio
  ),
  etapas as (
    select coalesce(jsonb_object_agg(t.etapa, t.qtd), '{}'::jsonb) as j
    from (select etapa, count(*) as qtd from pedidos where status = 'pendente' group by etapa) t
  ),
  quadro as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.desde), '[]'::jsonb) as j
    from (
      select
        pd.numero, pd.cliente, v.nome as vendedor, pd.status, pd.etapa, pd.pre_venda,
        pd.devolvido_motivo as motivo,
        pd.created_at as criado_em,
        -- desde quando está nesta etapa/situação: último evento que mexeu nisso
        -- (aprovação do financeiro e pré-venda não mudam a etapa)
        coalesce(
          (select max(pe.created_at) from pedido_eventos pe
            where pe.pedido_id = pd.id
              and pe.tipo in ('enviado', 'reenviado', 'devolvido', 'faturado',
                              'processo_iniciado', 'enviado_sanco', 'separacao_iniciada')),
          pd.created_at
        ) as desde
      from pedidos pd
      join vendedores v on v.id = pd.vendedor_id
      cross join ref
      where pd.status in ('pendente', 'devolvido')
         or (pd.status = 'faturado'
             and (pd.faturado_em at time zone 'America/Sao_Paulo')::date = ref.hoje)
      order by pd.created_at
      limit 300
    ) r
  )
  select case
    when current_user_has_role('financeiro') or current_user_role() = 'diretor' then
      jsonb_build_object(
        'hoje', (select hoje from ref),
        'meta_mes', (select valor from meta),
        'faturado_hoje', (select coalesce(sum(valor), 0) from validas, ref where data_emissao = ref.hoje),
        'faturado_mes', (select coalesce(sum(valor), 0) from validas),
        'vendedores', (
          select coalesce(
            jsonb_agg(to_jsonb(x) order by x.pedidos_hoje desc, x.faturado_hoje desc, x.nome),
            '[]'::jsonb)
          from vend x
        ),
        'etapas', (select j from etapas),
        'devolvidos', (select count(*) from pedidos where status = 'devolvido'),
        'faturados_hoje', (
          select count(*) from pedidos, ref
          where status = 'faturado'
            and (faturado_em at time zone 'America/Sao_Paulo')::date = ref.hoje
        ),
        'pedidos', (select j from quadro)
      )
    else null
  end;
$$;
