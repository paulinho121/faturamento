-- ============================================================
-- Conciliação bancária: o financeiro importa o extrato OFX do banco; cada
-- crédito vira uma linha aqui (ofx_id único = nunca importa duas vezes) e,
-- quando CNPJ/CPF do pagador e valor batem com um título/nota em aberto, o
-- pagamento é baixado automaticamente. `snapshot` guarda o estado anterior
-- dos títulos e os comprovantes criados, pra dar pra desfazer uma baixa errada.
-- ============================================================

create table conciliacoes_bancarias (
  id uuid primary key default gen_random_uuid(),
  ofx_id text not null unique,
  data date not null,
  valor numeric(14, 2) not null,
  memo text not null,
  documento text,
  categoria text not null check (categoria in ('identificavel', 'cartao', 'boletos_lote', 'outro')),
  status text not null default 'pendente' check (status in ('pendente', 'conciliado', 'ignorado')),
  detalhe text,
  snapshot jsonb,
  conciliado_em timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

alter table boletos add column if not exists conciliacao_id uuid references conciliacoes_bancarias(id) on delete set null;

alter table conciliacoes_bancarias enable row level security;

create policy "financeiro_all_conciliacoes" on conciliacoes_bancarias for all
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));
create policy "diretor_select_conciliacoes" on conciliacoes_bancarias for select
  using (current_user_role() = 'diretor');
