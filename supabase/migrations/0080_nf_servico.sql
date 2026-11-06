-- ============================================================
-- NF de serviço
-- ============================================================
-- O faturista marca o pedido como "NF de serviço": ele vai direto para São Paulo
-- (origem SP, sem Sanco), dispensa a separação da logística (número de série e volumes)
-- e fica fora da lista de entregas, porque não há mercadoria a despachar. Só dá para marcar
-- antes de o pedido ir para separação. Requer a migração 0079.
-- ============================================================

alter table pedidos add column if not exists nf_servico boolean not null default false;

alter table pedido_eventos drop constraint if exists pedido_eventos_tipo_check;
alter table pedido_eventos add constraint pedido_eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada', 'preparando_embarque',
                  'pre_venda_marcada', 'pre_venda_desmarcada', 'separacao_concluida',
                  'nf_servico_marcada', 'nf_servico_desmarcada'));

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
          when 'preparando_embarque' then 'preparando_embarque'
          else 'separacao_iniciada'
        end,
        auth.uid(),
        new.revisao
      );
  end if;

  if new.aprovado_financeiro and not old.aprovado_financeiro then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'aprovado', new.aprovado_por, new.revisao);
  end if;

  if new.pre_venda and not old.pre_venda then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'pre_venda_marcada', auth.uid(), new.revisao);
  elsif old.pre_venda and not new.pre_venda then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'pre_venda_desmarcada', auth.uid(), new.revisao);
  end if;

  if new.nf_servico and not old.nf_servico then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'nf_servico_marcada', auth.uid(), new.revisao);
  elsif old.nf_servico and not new.nf_servico then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'nf_servico_desmarcada', auth.uid(), new.revisao);
  end if;

  if new.separacao_concluida_em is not null and old.separacao_concluida_em is null then
    insert into pedido_eventos (pedido_id, tipo, por, revisao)
      values (new.id, 'separacao_concluida', new.separacao_concluida_por, new.revisao);
  end if;

  return new;
end;
$$;

create or replace function logistica_entregas()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then
    coalesce((
      select jsonb_agg(to_jsonb(x) order by coalesce(x.faturado_em, x.pedido_criado_em) desc nulls last)
      from (
        select
          e.id, e.status, e.tipo_entrega, e.transportadora, e.codigo_rastreio, e.previsao_chegada, e.ocorrencia,
          e.despachado_em, e.entregue_em, e.recebido_por, e.finalizado_em, e.created_at,
          p.id as pedido_id, p.numero as pedido_numero, p.cliente, v.nome as vendedor,
          p.origem, p.volumes, p.numero_nf, p.faturado_em, p.id_externo, p.observacao,
          p.arquivo_path, p.arquivo_nome,
          p.status as pedido_status, p.etapa as pedido_etapa, p.created_at as pedido_criado_em,
          p.numeros_serie, p.separacao_concluida_em,
          inv.valor as nf_valor, inv.data_emissao as nf_emissao, inv.estado as nf_estado,
          (select r.texto from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'ocorrencia'
            order by r.created_at desc limit 1) as ultima_ocorrencia,
          (select r.created_at from entrega_registros r
            where r.entrega_id = e.id order by r.created_at desc limit 1) as ultimo_registro_em,
          (select count(*) from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'carta_correcao')::int as cartas_correcao,
          (select m.marca from entrega_marcas m
            where m.entrega_id = e.id and m.user_id = auth.uid()) as marca
        from entregas e
        join pedidos p on p.id = e.pedido_id
        join vendedores v on v.id = p.vendedor_id
        left join lateral (
          select i.valor, i.data_emissao, i.estado
          from invoices i
          where i.numero_nf = p.numero_nf and i.excluida = false
          order by i.data_emissao desc
          limit 1
        ) inv on true
        where p.status <> 'cancelado'
          and not p.nf_servico
          and (e.status <> 'finalizado' or e.finalizado_em > now() - interval '30 days')
      ) x
    ), '[]'::jsonb)
  else null end;
$$;
