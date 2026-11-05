-- ============================================================
-- Separação de CE feita pelo próprio faturista
-- ============================================================
-- Em SP a logística informa números de série e volumes (migração 0079). Em CE quem faz essa
-- parte é o faturista, então a função separacao_concluir passa a aceitar o faturista nos
-- pedidos de CE. Pedido de SP continua só com a logística; NF de serviço não passa por aqui.
-- Requer as migrações 0079 e 0080.
-- ============================================================

create or replace function separacao_concluir(p_pedido_id uuid, p_numeros_serie text, p_volumes integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ped pedidos%rowtype;
begin
  if not (logistica_autorizada() or current_user_has_role('faturista')) then
    raise exception 'Sem permissão.';
  end if;

  select * into ped from pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if ped.status <> 'pendente' then raise exception 'O pedido não está mais em andamento.'; end if;
  if ped.nf_servico then
    raise exception 'Pedido de NF de serviço não passa pela separação.';
  end if;
  if ped.origem is null or ped.origem not in ('SP', 'CE') then
    raise exception 'Só pedidos de SP e CE passam pela separação.';
  end if;
  -- SP: a logística separa. CE: o faturista (a logística também pode, se precisar ajudar).
  if ped.origem = 'SP' and not logistica_autorizada() then
    raise exception 'Pedido de SP: o número de série e os volumes são informados pela logística.';
  end if;
  if ped.etapa <> 'em_separacao' then
    raise exception 'O pedido ainda não foi liberado para separação.';
  end if;
  if p_volumes is null or p_volumes < 1 then raise exception 'Informe a quantidade de volumes.'; end if;

  perform set_config('app.separacao_logistica', 'on', true);
  update pedidos set
    numeros_serie = nullif(btrim(coalesce(p_numeros_serie, '')), ''),
    volumes = p_volumes,
    separacao_concluida_em = coalesce(separacao_concluida_em, now()),
    separacao_concluida_por = coalesce(separacao_concluida_por, auth.uid())
  where id = p_pedido_id;
end;
$$;

revoke all on function separacao_concluir(uuid, text, integer) from public, anon;
grant execute on function separacao_concluir(uuid, text, integer) to authenticated;
