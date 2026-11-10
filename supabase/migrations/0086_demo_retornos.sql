-- ============================================================
-- Patch: acompanhamento de notas de demonstração (prazo de 45 dias para retornar)
-- Rode no SQL Editor do projeto, depois da 0085.
-- ============================================================
-- Nota de demo = nota com tipo de operação "Demo"/"Demonstração". O prazo (45 dias da emissão) é
-- calculado na tela; aqui só fica o registro do retorno: o financeiro informa o número da NF de
-- retorno quando a mercadoria volta. Sem linha nesta tabela = demo ainda fora (contando o prazo).
-- ============================================================

create table if not exists demo_retornos (
  invoice_id uuid primary key references invoices(id) on delete cascade,
  numero_nf_retorno text not null check (length(btrim(numero_nf_retorno)) between 1 and 30),
  data_retorno date not null default current_date,
  observacao text,
  registrado_por uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table demo_retornos enable row level security;

-- Financeiro (papel principal ou módulo extra) e diretor enxergam; só o financeiro registra/desfaz.
drop policy if exists "demo_retornos_select" on demo_retornos;
create policy "demo_retornos_select" on demo_retornos for select
  using (current_user_has_role('financeiro') or current_user_role() = 'diretor');

drop policy if exists "demo_retornos_insert" on demo_retornos;
create policy "demo_retornos_insert" on demo_retornos for insert
  with check (current_user_has_role('financeiro'));

drop policy if exists "demo_retornos_update" on demo_retornos;
create policy "demo_retornos_update" on demo_retornos for update
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));

drop policy if exists "demo_retornos_delete" on demo_retornos;
create policy "demo_retornos_delete" on demo_retornos for delete
  using (current_user_has_role('financeiro'));
