-- ============================================================
-- Reenvio de pedido devolvido pelo CRM sem origem
-- ============================================================
-- O CRM não sabe se o pedido sai de SC, SP ou CE (quem decide é o faturista, ao iniciar o
-- processo). O reenvio de um pedido devolvido pelo vendedor continua exigindo a origem, mas o
-- reenvio automático do CRM (feito sem usuário logado) passa sem ela.
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
  separacao boolean := coalesce(current_setting('app.separacao_logistica', true), '') = 'on' and auth.uid() is not null;
begin
  if old.status in ('faturado', 'cancelado') then
    raise exception 'Pedido % já está % e não pode mais ser alterado.', old.numero, old.status;
  end if;

  if separacao then
    return new;
  end if;

  -- NF de serviço: só o faturista marca/desmarca, antes de o pedido ir para separação.
  -- Marcar leva o pedido para SP (origem) e dispensa a separação da logística.
  if new.nf_servico is distinct from old.nf_servico then
    if not faturista then
      raise exception 'Só o faturista pode marcar o pedido como NF de serviço.';
    end if;
    if old.etapa not in ('enviado', 'em_processo') then
      raise exception 'A NF de serviço só pode ser marcada antes de o pedido ir para separação.';
    end if;
    if new.nf_servico then
      new.origem := 'SP';
    end if;
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
      -- Reenvio pelo vendedor exige a origem; o reenvio automático do CRM (sem usuário logado) não:
      -- quem define SC/SP/CE é o faturista, ao iniciar o processo.
      if new.origem is null and auth.uid() is not null then
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
      if new.origem in ('SP', 'CE') and new.separacao_concluida_em is null and not new.nf_servico then
        raise exception 'A logística ainda não concluiu a separação deste pedido (número de série e volumes).';
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
      if new.nf_servico then
        raise exception 'Pedido de NF de serviço não passa pela separação: fature direto.';
      end if;
      if new.origem is null then
        raise exception 'Informe a origem do pedido (SC, SP ou CE) antes de avançar.';
      end if;
      if not (
        (old.etapa = 'enviado' and new.etapa = 'em_processo')
        or (old.etapa = 'em_processo' and new.origem = 'SC' and new.etapa = 'enviado_sanco')
        or (old.etapa = 'em_processo' and new.origem in ('SP', 'CE') and new.etapa = 'em_separacao')
        or (old.etapa = 'enviado_sanco' and new.origem = 'SC' and new.etapa = 'em_separacao')
        or (old.etapa = 'em_separacao' and new.origem = 'SC' and new.etapa = 'preparando_embarque')
      ) then
        raise exception 'Etapa inválida para este pedido (de % para %, origem %).', old.etapa, new.etapa, new.origem;
      end if;
    end if;
  end if;

  return new;
end;
$$;
