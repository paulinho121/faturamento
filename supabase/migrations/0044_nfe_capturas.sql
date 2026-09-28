-- ============================================================
-- Captura automática de NF-e: um watcher rodando no PC do faturista observa
-- a pasta onde o emissor salva o XML e manda pra um endpoint (api/nfe-
-- watcher.ts, service role) assim que o arquivo aparece. Cada capturado cai
-- aqui como "pendente" — vira uma nota de verdade só quando o faturista abre
-- na Caixa de Entrada e confirma vendedor/tipo/filial, igual ao upload manual.
-- ============================================================

create table nfe_capturas (
  id uuid primary key default gen_random_uuid(),
  chave_acesso text,
  arquivo_nome text not null,
  xml_raw text not null,
  status text not null default 'pendente' check (status in ('pendente', 'lancada', 'descartada')),
  invoice_id uuid references invoices(id) on delete set null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create unique index nfe_capturas_chave_uniq on nfe_capturas (chave_acesso) where chave_acesso is not null;
create index nfe_capturas_status_idx on nfe_capturas (status);

alter table nfe_capturas enable row level security;

create policy "faturista_all_nfe_capturas" on nfe_capturas for all
  using (current_user_has_role('faturista'))
  with check (current_user_has_role('faturista'));
