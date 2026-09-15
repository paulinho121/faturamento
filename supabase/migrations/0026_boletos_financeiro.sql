-- ============================================================
-- Patch: papéis "cliente" e "financeiro" — passo 2 de 2
-- Rode DEPOIS do 0025, em execução SEPARADA no SQL Editor.
-- ============================================================
-- "cliente" loga com conta própria vinculada a uma linha de `clientes` (via
-- profile_id) e só enxerga as próprias notas e os próprios boletos.
--
-- "financeiro" tem painel próprio: gerencia todos os boletos da empresa (via
-- PDF anexado manualmente OU importação em massa de um XML de títulos do
-- sistema de contas a receber) e enxerga as notas (só leitura) pra conferir
-- a quem cada título pertence. O faturista NÃO mexe em boletos.
-- ============================================================

alter table clientes add column if not exists profile_id uuid unique references profiles(id);

-- clientes_read (auth.role() = 'authenticated') era liberado demais pra um
-- cliente externo logado — ele não pode enxergar a lista inteira de clientes
-- da empresa. Refeita para excluir o papel cliente; ele ganha uma policy
-- própria, só pra ler o próprio cadastro.
drop policy if exists "clientes_read" on clientes;
create policy "clientes_read" on clientes for select
  using (auth.role() = 'authenticated' and current_user_role() <> 'cliente');

drop policy if exists "cliente_select_own_cadastro" on clientes;
create policy "cliente_select_own_cadastro" on clientes for select
  using (current_user_role() = 'cliente' and profile_id = auth.uid());

-- invoices: cliente vê só as próprias notas; financeiro vê todas (só
-- leitura — não cria/edita nota, só precisa conferir dados pra conciliar).
drop policy if exists "cliente_select_own" on invoices;
create policy "cliente_select_own" on invoices for select
  using (
    current_user_role() = 'cliente'
    and cliente_id in (select id from clientes where profile_id = auth.uid())
  );

drop policy if exists "financeiro_select_invoices" on invoices;
create policy "financeiro_select_invoices" on invoices for select
  using (current_user_role() = 'financeiro');

-- ------------------------------------------------------------
-- Boletos: 1 ou mais por nota (parcelas). Vêm de duas fontes — anexação
-- manual de PDF pelo financeiro, ou importação em massa de um XML de
-- títulos (formato exportado do sistema de contas a receber da empresa,
-- com <numero>, <pessoa>, <vencimento>, <valor>, <observacao> etc.).
-- invoice_id fica opcional: um título importado que não bateu com nenhuma
-- nota ainda aparece pro financeiro conciliar manualmente depois.
-- numero_titulo é o identificador do sistema de origem — único, pra reimportar
-- o mesmo arquivo (ex: XML atualizado) sem duplicar linhas (upsert).
-- "Vencido" não é um status gravado — é calculado na tela (pendente +
-- vencimento no passado) pra não depender de um job.
-- ------------------------------------------------------------
create table if not exists boletos (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  numero_titulo text unique,
  numero_parcela smallint not null default 1,
  cliente_nome_importado text,
  carteira text,
  valor numeric(14, 2) not null,
  vencimento date not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago')),
  arquivo_path text,
  arquivo_nome text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

alter table boletos enable row level security;

drop policy if exists "financeiro_all_boletos" on boletos;
create policy "financeiro_all_boletos" on boletos for all
  using (current_user_role() = 'financeiro')
  with check (current_user_role() = 'financeiro');

drop policy if exists "diretor_select_boletos" on boletos;
create policy "diretor_select_boletos" on boletos for select
  using (current_user_role() = 'diretor');

drop policy if exists "cliente_select_own_boletos" on boletos;
create policy "cliente_select_own_boletos" on boletos for select
  using (
    current_user_role() = 'cliente'
    and exists (
      select 1 from invoices i
      join clientes c on c.id = i.cliente_id
      where i.id = boletos.invoice_id and c.profile_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Storage: bucket privado "boletos", arquivos guardados como
-- "{invoice_id}/{arquivo}" (só é possível anexar PDF depois que o título
-- está vinculado a uma nota). RLS no bucket espelha a mesma regra da tabela.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('boletos', 'boletos', false)
on conflict (id) do nothing;

drop policy if exists "financeiro_all_boletos_storage" on storage.objects;
create policy "financeiro_all_boletos_storage" on storage.objects for all
  using (bucket_id = 'boletos' and current_user_role() = 'financeiro')
  with check (bucket_id = 'boletos' and current_user_role() = 'financeiro');

drop policy if exists "diretor_select_boletos_storage" on storage.objects;
create policy "diretor_select_boletos_storage" on storage.objects for select
  using (bucket_id = 'boletos' and current_user_role() = 'diretor');

drop policy if exists "cliente_select_own_boletos_storage" on storage.objects;
create policy "cliente_select_own_boletos_storage" on storage.objects for select
  using (
    bucket_id = 'boletos'
    and current_user_role() = 'cliente'
    and exists (
      select 1 from invoices i
      join clientes c on c.id = i.cliente_id
      where i.id::text = (storage.foldername(name))[1] and c.profile_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Depois de rodar este arquivo, crie os usuários no painel de Auth do
-- Supabase (Authentication → Users → Add user), depois rode (um bloco por
-- pessoa, trocando e-mail/nome/CNPJ conforme o caso):
--
--   -- Financeiro (acesso interno, não precisa de vínculo com cliente):
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Financeiro', 'financeiro' from auth.users where email = 'financeiro@empresa.com'
--   on conflict (id) do update set role = 'financeiro', full_name = 'Nome do Financeiro';
--
--   -- Cliente (precisa vincular a uma linha de `clientes` pelo CNPJ/CPF):
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Cliente', 'cliente' from auth.users where email = 'cliente@empresa.com'
--   on conflict (id) do update set role = 'cliente', full_name = 'Nome do Cliente';
--
--   update clientes
--   set profile_id = (select id from auth.users where email = 'cliente@empresa.com')
--   where cnpj_cpf = '00000000000000';
-- ------------------------------------------------------------
