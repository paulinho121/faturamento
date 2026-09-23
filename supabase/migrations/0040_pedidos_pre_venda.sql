-- ============================================================
-- Pedidos: marcar como pré-venda (item sem estoque)
-- ============================================================
-- Flag simples, ortogonal ao status/etapa — não tem "separação" nem
-- "faturamento" possível enquanto não chega estoque, então em vez de criar
-- mais um status na máquina de etapas, é só uma marcação que tira o pedido
-- da fila de "em andamento" do faturista e joga numa aba própria até
-- alguém desmarcar (quando o estoque chegar). O gatilho de proteção
-- (pedidos_guard, 0037/0038) já deixa passar uma atualização que só mexe
-- nessa coluna, sem precisar de nenhuma regra nova lá.
-- ============================================================

alter table pedidos add column if not exists pre_venda boolean not null default false;

alter table pedido_eventos drop constraint if exists pedido_eventos_tipo_check;
alter table pedido_eventos add constraint pedido_eventos_tipo_check
  check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada',
                  'pre_venda_marcada', 'pre_venda_desmarcada'));

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

  if new.pre_venda and not old.pre_venda then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'pre_venda_marcada', auth.uid(), new.revisao);
  elsif old.pre_venda and not new.pre_venda then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'pre_venda_desmarcada', auth.uid(), new.revisao);
  end if;

  return new;
end;
$$;
