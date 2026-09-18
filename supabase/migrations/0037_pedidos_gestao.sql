-- ============================================================
-- Gestão completa de pedidos: devolução p/ correção, trava de
-- duplicidade, numeração e histórico
-- ============================================================
-- Ciclo de vida: pendente -> (devolvido -> pendente)* -> faturado.
-- O vendedor NÃO edita um pedido enviado: financeiro/faturista devolve com
-- um motivo obrigatório, o vendedor corrige e reenvia (revisão +1, aprovação
-- do financeiro zerada). Pedido faturado ou cancelado fica travado.
-- Duplicidade: hash SHA-256 do PDF é único entre pedidos não cancelados.
-- Tudo fica registrado em pedido_eventos (trigger, à prova de adulteração).
-- ============================================================

alter table pedidos add column if not exists numero bigint generated always as identity;
create unique index if not exists pedidos_numero_uniq on pedidos (numero);

alter table pedidos add column if not exists arquivo_hash text;
alter table pedidos add column if not exists revisao integer not null default 0;
alter table pedidos add column if not exists devolvido_motivo text;
alter table pedidos add column if not exists devolvido_em timestamptz;
alter table pedidos add column if not exists devolvido_por uuid references profiles(id);

alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('pendente', 'devolvido', 'faturado', 'cancelado'));

alter table pedidos drop constraint if exists pedidos_devolucao_motivo_check;
alter table pedidos add constraint pedidos_devolucao_motivo_check
  check (status <> 'devolvido' or length(trim(coalesce(devolvido_motivo, ''))) > 0);

create unique index if not exists pedidos_arquivo_hash_uniq
  on pedidos (arquivo_hash)
  where arquivo_hash is not null and status <> 'cancelado';

-- Vendedor só mexe num pedido que foi devolvido pra ele (reenviar/cancelar).
drop policy if exists "vendedor_update_own_pedidos_devolvidos" on pedidos;
create policy "vendedor_update_own_pedidos_devolvidos" on pedidos for update
  using (current_user_role() = 'vendedor' and created_by = auth.uid() and status = 'devolvido')
  with check (current_user_role() = 'vendedor' and created_by = auth.uid());

-- ------------------------------------------------------------
-- Máquina de estados (BEFORE UPDATE): a regra vale no banco, não só na tela.
-- ------------------------------------------------------------
create or replace function pedidos_guard() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
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
    new.aprovado_financeiro := false;
    new.aprovado_em := null;
    new.aprovado_por := null;
    if new.status = 'pendente' then
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
    if new.status = 'devolvido' then
      new.devolvido_em := now();
      new.devolvido_por := auth.uid();
      new.aprovado_financeiro := false;
      new.aprovado_em := null;
      new.aprovado_por := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_guard_trg on pedidos;
create trigger pedidos_guard_trg before update on pedidos
  for each row execute function pedidos_guard();

-- ------------------------------------------------------------
-- Histórico
-- ------------------------------------------------------------
create table if not exists pedido_eventos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado')),
  motivo text,
  por uuid references profiles(id),
  revisao integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pedido_eventos_pedido_idx on pedido_eventos (pedido_id, created_at);

alter table pedido_eventos enable row level security;

drop policy if exists "vendedor_select_own_pedido_eventos" on pedido_eventos;
create policy "vendedor_select_own_pedido_eventos" on pedido_eventos for select
  using (
    current_user_role() = 'vendedor'
    and exists (select 1 from pedidos p where p.id = pedido_id and p.created_by = auth.uid())
  );

drop policy if exists "escritorio_select_pedido_eventos" on pedido_eventos;
create policy "escritorio_select_pedido_eventos" on pedido_eventos for select
  using (
    current_user_has_role('faturista')
    or current_user_has_role('financeiro')
    or current_user_role() = 'diretor'
  );

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

  if new.aprovado_financeiro and not old.aprovado_financeiro then
    insert into pedido_eventos (pedido_id, tipo, por, revisao) values (new.id, 'aprovado', new.aprovado_por, new.revisao);
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_log_trg on pedidos;
create trigger pedidos_log_trg after insert or update on pedidos
  for each row execute function pedidos_log();

-- Pedidos que já existiam antes desta migration ganham o evento de envio.
insert into pedido_eventos (pedido_id, tipo, por, created_at)
select p.id, 'enviado', p.created_by, p.created_at
from pedidos p
where not exists (select 1 from pedido_eventos e where e.pedido_id = p.id);
