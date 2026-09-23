-- ============================================================
-- Consulta ao diretor: faturista manda um pedido pra orientação quando
-- tem dúvida (é locação ou venda? comodato? precisa autorização do
-- diretor?), e quem pode orientar (hoje só a Bianca, via a flag
-- profiles.pode_orientar_pedidos) anexa um PDF ou JPEG explicando como
-- proceder. Local exclusivo dela — nem os outros diretores veem, só quem
-- tem a flag e o faturista que perguntou (e qualquer outro faturista,
-- já que a fila de pedidos já é compartilhada entre eles).
-- ============================================================

alter table profiles add column if not exists pode_orientar_pedidos boolean not null default false;

create table pedido_orientacoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  pergunta text not null,
  solicitado_por uuid not null references profiles(id),
  solicitado_em timestamptz not null default now(),
  arquivo_path text,
  arquivo_nome text,
  resposta_texto text,
  respondido_por uuid references profiles(id),
  respondido_em timestamptz
);

create index pedido_orientacoes_pedido_idx on pedido_orientacoes (pedido_id);

alter table pedido_orientacoes enable row level security;

create function current_user_pode_orientar() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select pode_orientar_pedidos from profiles where id = auth.uid()), false)
$$;

create policy "faturista_le_orientacoes" on pedido_orientacoes for select
  using (current_user_has_role('faturista') or current_user_pode_orientar());
create policy "faturista_cria_orientacao" on pedido_orientacoes for insert
  with check (current_user_has_role('faturista') and solicitado_por = auth.uid());
create policy "orientador_responde" on pedido_orientacoes for update
  using (current_user_pode_orientar())
  with check (current_user_pode_orientar());

-- Storage: bucket privado "orientacoes", arquivos guardados como
-- "{pedido_orientacoes.id}/{arquivo}". Acesso não é por dono (como em
-- "pedidos"), é por papel: qualquer faturista lê, só quem tem a flag escreve.
insert into storage.buckets (id, name, public)
values ('orientacoes', 'orientacoes', false)
on conflict (id) do nothing;

create policy "orientacoes_storage_select" on storage.objects for select
  using (bucket_id = 'orientacoes' and (current_user_has_role('faturista') or current_user_pode_orientar()));
create policy "orientacoes_storage_write" on storage.objects for insert
  with check (bucket_id = 'orientacoes' and current_user_pode_orientar());
create policy "orientacoes_storage_update" on storage.objects for update
  using (bucket_id = 'orientacoes' and current_user_pode_orientar());
