-- ============================================================
-- Cadastro Manual de Título: o Junior às vezes junta a NF de compra e a NFS
-- de serviço da assistência técnica num boleto só, parcelado — mas o
-- formulário só vinculava UMA nota por título. Esta tabela guarda as notas
-- EXTRAS vinculadas a um título; a nota "principal" continua em
-- boletos.invoice_id, sem mudar nada do que já lê/casa por ela (auto-baixa
-- de RET, impressão, conciliação etc).
-- ============================================================

create table boleto_notas_adicionais (
  boleto_id uuid not null references boletos(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  primary key (boleto_id, invoice_id)
);

create index boleto_notas_adicionais_invoice_idx on boleto_notas_adicionais (invoice_id);

alter table boleto_notas_adicionais enable row level security;

create policy "financeiro_all_boleto_notas_adicionais" on boleto_notas_adicionais for all
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));
create policy "diretor_select_boleto_notas_adicionais" on boleto_notas_adicionais for select
  using (current_user_role() = 'diretor');
