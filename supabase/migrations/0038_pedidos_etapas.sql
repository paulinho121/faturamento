-- ============================================================
-- Acompanhamento do pedido: origem (SC/SP/CE) e etapas até o faturamento
-- ============================================================
-- Etapas (só o faturista avança, sempre para a próxima):
--   SC:       enviado -> em_processo -> enviado_sanco -> em_separacao -> faturado
--             (separação feita pela Sanco)
--   SP / CE:  enviado -> em_processo -> em_separacao -> faturado
--             (separação feita pela própria MCI)
-- Faturar é permitido de qualquer etapa (pedidos antigos / exceções).
-- Depois que o pedido segue para a Sanco/separação ele não pode mais ser
-- devolvido nem trocar de origem. Cada avanço vira um evento no histórico.
-- ============================================================

alter table pedidos add column if not exists origem text;
alter table pedidos drop constraint if exists pedidos_origem_check;
alter table pedidos add constraint pedidos_origem_check check (origem is null or origem in ('SC', 'SP', 'CE'));

alter table pedidos add column if not exists etapa text not null default 'enviado';
alter table pedidos drop constraint if exists pedidos_etapa_check;
alter table pedidos add constraint pedidos_etapa_check
  check (etapa in ('enviado', 'em_processo', 'enviado_sanco', 'em_separacao', 'faturado'));

-- O gatilho de proteção (0037) bloqueia qualquer alteração em pedido faturado,
-- então ele é desligado só durante este ajuste dos pedidos já faturados.
alter table pedidos disable trigger pedidos_guard_trg;
update pedidos set etapa = 'faturado' where status = 'faturado' and etapa <> 'faturado';
alter table pedidos enable trigger pedidos_guard_trg;

alter table pedido_eventos drop constraint if exists pedido_eventos_tipo_check;
alter table pedido_eventos add constraint pedido_eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada'));

create or replace function pedidos_guard() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  faturista boolean := current_user_has_role('faturista');
  escritorio boolean := current_user_has_role('faturista') or current_user_has_role('financeiro');
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
      if not faturista then
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

create or replace function pedidos_log() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'enviado', new.created_by, new.revisao);
    return new;
  end if;

  if new.status = 'devolvido' and old.status <> 'devolvido' then
    insert into pedido_eventos (pedido_id, tipo, motivo, por, revisao)
      values (new.id, 'devolvido', new.devolvido_motivo, new.devolvido_por, new.revisao);
  elsif old.status = 'devolvido' and new.status = 'pendente' then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'reenviado', auth.uid(), new.revisao);
  elsif new.status = 'cancelado' and old.status <> 'cancelado' then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'cancelado', auth.uid(), new.revisao);
  elsif new.status = 'faturado' and old.status <> 'faturado' then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'faturado', new.faturado_por, new.revisao);
  end if;

  if new.status = 'pendente' and new.etapa is distinct from old.etapa then
    insert into pedido_eventos (pedido_id, tipo, por, revisao)
      values (
        new.id,
        case new.etapa
          when 'em_processo' then 'processo_iniciado'
          when 'enviado_sanco' then 'enviado_sanco'
          else 'separacao_iniciada'
        end,
        auth.uid(),
        new.revisao
      );
  end if;

  if new.aprovado_financeiro and not old.aprovado_financeiro then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'aprovado', new.aprovado_por, new.revisao);
  end if;

  return new;
end;
$$;
