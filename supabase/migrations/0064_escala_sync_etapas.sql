-- ============================================================
-- Andamento automático dos pedidos SC pela API do CD (Escalasoft)
-- ============================================================
-- A rotina api/escala-sync consulta o CD e avança a etapa do pedido. Ela roda
-- no servidor (service role, sem usuário logado), e o pedidos_guard só deixa o
-- faturista avançar etapas. escala_avancar_etapa é a única porta: só o
-- service_role executa, e só ela liga a flag que o guard reconhece. As regras
-- de sequência (em_processo -> enviado_sanco -> em_separacao) continuam valendo,
-- e faturar continua sendo exclusivo do faturista.
-- ============================================================

create or replace function pedidos_guard() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  faturista boolean := current_user_has_role('faturista');
  -- Sincronização com o CD (escala_avancar_etapa): só o backend, sem usuário logado.
  sync_cd boolean := coalesce(current_setting('app.escala_sync', true), '') = 'on' and auth.uid() is null;
  escritorio boolean := current_user_has_role('faturista') or current_user_has_role('financeiro') or sync_cd;
begin
  if old.status in ('faturado', 'cancelado') then
    raise exception 'Pedido % já está % e não pode mais ser alterado.', old.numero, old.status;
  end if;

  if new.vendedor_id <> old.vendedor_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at or new.numero <> old.numero then
    raise exception 'Campos de origem do pedido não podem ser alterados.';
  end if;

  if not escritorio then
    -- vendedor: só reenvia (devolvido -> pendente) ou cancela (devolvido -> cancelado)
    if old.status <> 'devolvido' or new.status not in ('pendente', 'cancelado') then
      raise exception 'Este pedido só pode ser alterado pelo vendedor depois de devolvido.';
    end if;
    if new.faturado_em is distinct from old.faturado_em or new.faturado_por is distinct from old.faturado_por then
      raise exception 'Vendedor não pode marcar pedido como faturado.';
    end if;
    new.etapa := 'enviado';
    new.aprovado_financeiro := false;
    new.aprovado_em := null;
    new.aprovado_por := null;
    if new.status = 'pendente' then
      if new.origem is null then
        raise exception 'Informe a origem do pedido (SC, SP ou CE) para reenviar.';
      end if;
      new.revisao := old.revisao + 1;
      new.devolvido_motivo := null;
      new.devolvido_em := null;
      new.devolvido_por := null;
    end if;
  else
    if old.status = 'devolvido' then
      raise exception 'Pedido devolvido: aguardando o vendedor corrigir e reenviar.';
    end if;
    if new.status not in ('pendente', 'devolvido', 'faturado') then
      raise exception 'Transição de status inválida.';
    end if;
    if new.origem is distinct from old.origem and old.etapa not in ('enviado', 'em_processo') then
      raise exception 'A origem não pode mais ser alterada: o pedido já foi encaminhado para separação.';
    end if;

    if new.status = 'faturado' then
      if not faturista then
        raise exception 'Só o faturista pode marcar o pedido como faturado.';
      end if;
      new.etapa := 'faturado';
    elsif new.status = 'devolvido' then
      if old.etapa not in ('enviado', 'em_processo') then
        raise exception 'O pedido já foi encaminhado para separação e não pode mais ser devolvido.';
      end if;
      new.etapa := 'enviado';
      new.devolvido_em := now();
      new.devolvido_por := auth.uid();
      new.aprovado_financeiro := false;
      new.aprovado_em := null;
      new.aprovado_por := null;
    elsif new.etapa is distinct from old.etapa then
      if not (faturista or sync_cd) then
        raise exception 'Só o faturista pode avançar as etapas do pedido.';
      end if;
      if new.origem is null then
        raise exception 'Informe a origem do pedido (SC, SP ou CE) antes de avançar.';
      end if;
      if not (
        (old.etapa = 'enviado' and new.etapa = 'em_processo')
        or (old.etapa = 'em_processo' and new.origem = 'SC' and new.etapa = 'enviado_sanco')
        or (old.etapa = 'em_processo' and new.origem in ('SP', 'CE') and new.etapa = 'em_separacao')
        or (old.etapa = 'enviado_sanco' and new.origem = 'SC' and new.etapa = 'em_separacao')
      ) then
        raise exception 'Etapa inválida para este pedido (de % para %, origem %).', old.etapa, new.etapa, new.origem;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function escala_avancar_etapa(p_pedido_id uuid, p_etapa text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_etapa not in ('enviado_sanco', 'em_separacao') then
    raise exception 'Etapa inválida para a sincronização: %', p_etapa;
  end if;
  perform set_config('app.escala_sync', 'on', true);
  update pedidos set etapa = p_etapa where id = p_pedido_id and status = 'pendente';
end;
$$;

revoke all on function escala_avancar_etapa(uuid, text) from public, anon, authenticated;
grant execute on function escala_avancar_etapa(uuid, text) to service_role;
