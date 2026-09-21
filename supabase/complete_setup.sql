-- ============================================================
-- FATURAMENTO DASHBOARD — setup completo (schema + RLS + RPCs + seed)
-- ============================================================
-- Rode este arquivo INTEIRO, de uma vez, no SQL Editor de um
-- projeto Supabase NOVO ou recém-zerado (schema public vazio).
-- Se as tabelas já existirem, este script falha (não usa
-- "if not exists" nas tabelas) — rode só em banco limpo.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Extensões e tipos
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";

create type user_role as enum ('faturista', 'diretor', 'vendedor', 'logistica', 'cliente', 'financeiro');
create type modalidade_pagamento as enum ('Simples', 'Misto');

-- ------------------------------------------------------------
-- 1) Perfis (vincula auth.users a um papel)
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role user_role not null,
  -- papéis adicionais que esse perfil também pode acessar (ex.: um
  -- faturista com acesso extra ao módulo financeiro), além do seu `role`
  -- padrão (login/roleHome).
  modulos_extra user_role[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) Tabelas de apoio (lookups)
-- ------------------------------------------------------------
create table vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  ativo boolean not null default true,
  percentual_comissao numeric(5, 2) not null default 0,
  profile_id uuid unique references profiles(id) -- login do próprio vendedor, opcional
);

create table filiais (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null, -- ex: 'Matriz', 'Filial SP', 'Filial SC'
  cnpj text unique, -- só dígitos; usado para auto-detectar a filial pelo emit/CNPJ do XML da NF-e
  ativo boolean not null default true
);

-- Tipo de Operação e Meio de Pagamento ficam como texto livre (não enum):
-- a planilha real tem dezenas de variações (Saída, Comodato, Armazém,
-- Transferência, Retorno Locação, Devolução de Compra, Garantia, Brinde...)
-- que mudam com frequência. Estas tabelas só guardam sugestões para o
-- formulário; a coluna em invoices aceita qualquer texto.
create table tipos_operacao (
  id serial primary key,
  nome text unique not null
);

create table meios_pagamento (
  id serial primary key,
  nome text unique not null
);

-- Clientes: cadastrados automaticamente a cada nota lançada, para permitir
-- busca/filtro por cliente no dashboard. cnpj_cpf identifica o cliente de
-- forma única quando presente na NF-e (permite reconhecer o mesmo cliente
-- em notas futuras mesmo que o nome venha escrito diferente).
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj_cpf text unique,
  estado char(2),
  cidade text,
  profile_id uuid unique references profiles(id), -- login do próprio cliente, opcional
  created_at timestamptz not null default now()
);
create index clientes_nome_idx on clientes (nome);

-- ------------------------------------------------------------
-- 3) Lançamentos de faturamento (equivalente à aba BASE_DASH da planilha)
-- ------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  filial_id uuid not null references filiais(id),
  filial_destino_id uuid references filiais(id), -- preenchido quando a nota é uma transferência p/ outra filial/matriz (destinatário == CNPJ de uma filial)
  cliente_id uuid references clientes(id),
  estado char(2) not null,
  numero_nf text not null,
  data_emissao date not null,
  tipo_operacao text not null,
  modalidade_pagamento modalidade_pagamento not null default 'Simples',
  meio_pagamento text not null,
  parcelas smallint not null default 1,
  cliente text not null,
  valor numeric(14, 2) not null default 0,
  vendedor_id uuid references vendedores(id), -- opcional: transferências entre filiais não têm vendedor
  valor_transferencia numeric(14, 2) not null default 0,
  valor_a_faturar numeric(14, 2) not null default 0,
  frete numeric(14, 2) not null default 0,
  valor_difal numeric(14, 2) not null default 0, -- ICMS de partilha p/ UF do destinatário (vICMSUFDest)
  valor_fcp numeric(14, 2) not null default 0, -- Fundo de Combate à Pobreza da UF de destino (vFCPUFDest)
  valor_icms numeric(14, 2) not null default 0,
  valor_ipi numeric(14, 2) not null default 0,
  afeta_faturamento boolean not null default true, -- false para notas que não são receita real (comodato, brinde, retorno de locação, etc)
  excluida boolean not null default false, -- soft-delete: faturista excluiu uma nota Cancelada; some da UI mas fica no banco
  transportadora text, -- só preenchido em transferências (ex: 'Jamef', 'Correios') — visto pelo papel logística
  xml_raw text,
  xml_chave_acesso text unique,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (numero_nf, filial_id)
);

create index invoices_data_emissao_idx on invoices (data_emissao);
create index invoices_vendedor_idx on invoices (vendedor_id);
create index invoices_filial_idx on invoices (filial_id);
create index invoices_filial_destino_idx on invoices (filial_destino_id);
create index invoices_cliente_idx on invoices (cliente_id);
create index invoices_created_at_idx on invoices (created_at desc);

-- Metas mensais por filial, usadas no KPI "Meta do Mês"
create table metas (
  id serial primary key,
  filial_id uuid references filiais(id),
  mes smallint not null check (mes between 1 and 12),
  ano smallint not null,
  valor_meta numeric(14, 2) not null,
  unique (filial_id, mes, ano)
);

-- Meta PESSOAL de cada vendedor (diferente de "metas", que é da empresa e
-- definida pelo diretor) — só o próprio vendedor lê/cria/edita a sua.
create table metas_pessoais (
  id serial primary key,
  vendedor_id uuid not null references vendedores(id) on delete cascade,
  mes smallint not null check (mes between 1 and 12),
  ano smallint not null,
  valor_meta numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  unique (vendedor_id, mes, ano)
);

-- Parceria de comissão: um vendedor "combo" (ex: "JJ") cuja comissão é
-- dividida entre 2+ vendedores reais, cada um com seu próprio percentual.
-- Genérica — não é específica de nenhuma dupla, só a configuração muda.
create table comissao_parcerias (
  id serial primary key,
  vendedor_id uuid not null references vendedores(id) on delete cascade,
  beneficiario_id uuid not null references vendedores(id) on delete cascade,
  percentual numeric(5, 2) not null,
  created_at timestamptz not null default now(),
  unique (vendedor_id, beneficiario_id)
);

-- Boletos: 1 ou mais por nota (parcelas). Vêm de duas fontes — anexação
-- manual de PDF pelo financeiro, ou importação em massa de um XML de
-- títulos (sistema de contas a receber da empresa). invoice_id fica
-- opcional: um título importado que não bateu com nenhuma nota ainda
-- aparece pro financeiro conciliar manualmente depois. numero_titulo é o
-- identificador do sistema de origem — único, pra reimportar sem duplicar
-- (upsert). "Vencido" não é um status gravado — é calculado na tela
-- (pendente + vencimento no passado) pra não depender de um job.
create table boletos (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  tipo text not null default 'boleto' check (tipo in ('boleto', 'comprovante')),
  numero_titulo text unique,
  numero_parcela smallint not null default 1,
  cliente_nome_importado text,
  carteira text,
  valor numeric(14, 2) not null,
  valor_pago numeric(14, 2) not null default 0,
  juros numeric(14, 2) not null default 0,
  data_pagamento date,
  vencimento date not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'parcial')),
  arquivo_path text, -- caminho no Storage (bucket "boletos") — opcional
  arquivo_nome text,
  excluido boolean not null default false,
  excluido_em timestamptz,
  excluido_por uuid references profiles(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- Pedidos: vendedor anexa o PDF do pedido assim que fecha a venda; aparece
-- pro faturista como fila de "pendentes" até ele lançar a NF-e de verdade e
-- marcar como faturado (sem casamento automático com a nota).
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references vendedores(id),
  cliente text not null,
  valor_estimado numeric(14, 2),
  observacao text,
  arquivo_path text not null,
  arquivo_nome text not null,
  numero bigint generated always as identity,
  -- pendente -> (devolvido -> pendente)* -> faturado; cancelado só a partir de devolvido.
  status text not null default 'pendente' check (status in ('pendente', 'devolvido', 'faturado', 'cancelado')),
  -- SHA-256 do PDF: trava de duplicidade (único entre pedidos não cancelados).
  arquivo_hash text,
  revisao integer not null default 0,
  -- separação: SC pela Sanco; SP/CE pela própria MCI.
  origem text check (origem is null or origem in ('SC', 'SP', 'CE')),
  etapa text not null default 'enviado'
    check (etapa in ('enviado', 'em_processo', 'enviado_sanco', 'em_separacao', 'faturado')),
  devolvido_motivo text,
  devolvido_em timestamptz,
  devolvido_por uuid references profiles(id),
  faturado_em timestamptz,
  faturado_por uuid references profiles(id),
  -- Financeiro revisa o PDF e aprova antes do faturista faturar — só um
  -- selo informativo na fila do faturista, não bloqueia faturar.
  aprovado_financeiro boolean not null default false,
  aprovado_em timestamptz,
  aprovado_por uuid references profiles(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index pedidos_status_idx on pedidos (status);
create index pedidos_vendedor_idx on pedidos (vendedor_id);
create unique index pedidos_numero_uniq on pedidos (numero);
create unique index pedidos_arquivo_hash_uniq on pedidos (arquivo_hash)
  where arquivo_hash is not null and status <> 'cancelado';
alter table pedidos add constraint pedidos_devolucao_motivo_check
  check (status <> 'devolvido' or length(trim(coalesce(devolvido_motivo, ''))) > 0);

-- Garante no máximo uma meta "global" (todas as filiais, filial_id NULL) por
-- mês/ano — o unique acima não cobre isso porque NULLs são distintos.
create unique index metas_global_unico on metas (mes, ano) where filial_id is null;

-- ============================================================
-- 4) Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table vendedores enable row level security;
alter table filiais enable row level security;
alter table tipos_operacao enable row level security;
alter table meios_pagamento enable row level security;
alter table invoices enable row level security;
alter table metas enable row level security;
alter table metas_pessoais enable row level security;
alter table comissao_parcerias enable row level security;
alter table boletos enable row level security;
alter table clientes enable row level security;
alter table pedidos enable row level security;

create function current_user_role() returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- Como current_user_role(), mas também retorna true se o papel pedido está
-- em modulos_extra — usado nas policies de módulos que um perfil pode
-- acessar além do seu papel principal (ex.: faturista com Financeiro extra).
create function current_user_has_role(r user_role) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
    and (role = r or r = any(modulos_extra))
  )
$$;

-- profiles: cada um lê o próprio perfil; diretor lê todos (para listas/admin)
create policy "profile_self" on profiles for select
  using (id = auth.uid());
create policy "profile_diretor_all" on profiles for select
  using (current_user_role() = 'diretor');

-- lookups: leitura para qualquer usuário autenticado
create policy "vendedores_read" on vendedores for select
  using (auth.role() = 'authenticated');
create policy "diretor_update_vendedores" on vendedores for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');
create policy "filiais_read" on filiais for select
  using (auth.role() = 'authenticated');
create policy "tipos_operacao_read" on tipos_operacao for select
  using (auth.role() = 'authenticated');

-- clientes: qualquer usuário autenticado pesquisa/filtra; só faturista
-- cadastra/atualiza (acontece automaticamente a cada nota lançada).
create policy "clientes_read" on clientes for select
  using (auth.role() = 'authenticated' and current_user_role() <> 'cliente');
create policy "cliente_select_own_cadastro" on clientes for select
  using (current_user_role() = 'cliente' and profile_id = auth.uid());
create policy "faturista_insert_clientes" on clientes for insert
  with check (current_user_role() = 'faturista');
create policy "faturista_update_clientes" on clientes for update
  using (current_user_role() = 'faturista')
  with check (current_user_role() = 'faturista');
create policy "meios_pagamento_read" on meios_pagamento for select
  using (auth.role() = 'authenticated');
create policy "metas_read" on metas for select
  using (auth.role() = 'authenticated');

-- metas_pessoais: só o próprio vendedor lê/cria/edita a sua; diretor só lê.
create policy "vendedor_select_own_meta_pessoal" on metas_pessoais for select
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );
create policy "vendedor_insert_own_meta_pessoal" on metas_pessoais for insert
  with check (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );
create policy "vendedor_update_own_meta_pessoal" on metas_pessoais for update
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  )
  with check (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );
create policy "diretor_select_metas_pessoais" on metas_pessoais for select
  using (current_user_role() = 'diretor');

-- comissao_parcerias: só o diretor configura/lê (cada vendedor já vê sua
-- fatia através do dashboard_comissoes, não precisa ler esta tabela direto).
create policy "diretor_all_comissao_parcerias" on comissao_parcerias for all
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');

-- metas: só o diretor cadastra/edita/remove (pela UI do dashboard).
create policy "diretor_insert_metas" on metas for insert
  with check (current_user_role() = 'diretor');
create policy "diretor_update_metas" on metas for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');
create policy "diretor_delete_metas" on metas for delete
  using (current_user_role() = 'diretor');

-- invoices: faturista insere e vê só o que criou; diretor vê tudo.
-- Ambos podem corrigir lançamentos existentes (faturista só os próprios,
-- diretor qualquer um) — ex: trocar vendedor, tipo de operação, etc.
create policy "faturista_insert" on invoices for insert
  with check (current_user_role() = 'faturista' and created_by = auth.uid());
create policy "faturista_select_own" on invoices for select
  using (current_user_role() = 'faturista' and created_by = auth.uid());
create policy "diretor_select_all" on invoices for select
  using (current_user_role() = 'diretor');
create policy "vendedor_select_own" on invoices for select
  using (
    current_user_role() = 'vendedor'
    and vendedor_id in (select id from vendedores where profile_id = auth.uid())
  );
create policy "logistica_select_transferencias" on invoices for select
  using (
    current_user_role() = 'logistica'
    and (upper(tipo_operacao) = 'TRANSFERÊNCIA' or upper(tipo_operacao) = 'TRANSFERENCIA')
  );
create policy "cliente_select_own" on invoices for select
  using (
    current_user_role() = 'cliente'
    and cliente_id in (select id from clientes where profile_id = auth.uid())
  );
create policy "financeiro_select_invoices" on invoices for select
  using (current_user_has_role('financeiro'));
create policy "faturista_update_own" on invoices for update
  using (current_user_role() = 'faturista' and created_by = auth.uid())
  with check (current_user_role() = 'faturista' and created_by = auth.uid());
-- Conta faturista que também tem o módulo financeiro (ex.: administrativo)
-- gerencia as notas de qualquer faturista, não só as próprias.
create policy "faturista_financeiro_update_all" on invoices for update
  using (current_user_has_role('faturista') and current_user_has_role('financeiro'))
  with check (current_user_has_role('faturista') and current_user_has_role('financeiro'));
create policy "diretor_update_all" on invoices for update
  using (current_user_role() = 'diretor')
  with check (current_user_role() = 'diretor');
-- Qualquer conta com o módulo financeiro (role principal ou extra) corrige
-- a forma de pagamento quando o cliente muda de Boleto pra PIX/Cartão —
-- RLS não restringe a uma coluna só, mas a única tela que usa isso só
-- manda meio_pagamento.
create policy "financeiro_update_meio_pagamento" on invoices for update
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));

-- boletos: financeiro gerencia todos; diretor só lê; cliente só lê os das
-- próprias notas.
create policy "financeiro_all_boletos" on boletos for all
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));
create policy "diretor_select_boletos" on boletos for select
  using (current_user_role() = 'diretor');
create policy "cliente_select_own_boletos" on boletos for select
  using (
    current_user_role() = 'cliente'
    and exists (
      select 1 from invoices i
      join clientes c on c.id = i.cliente_id
      where i.id = boletos.invoice_id and c.profile_id = auth.uid()
    )
  );

-- Storage: bucket privado "boletos", arquivos guardados como
-- "{invoice_id}/{arquivo}". RLS no bucket espelha a mesma regra da tabela.
insert into storage.buckets (id, name, public)
values ('boletos', 'boletos', false)
on conflict (id) do nothing;

create policy "financeiro_all_boletos_storage" on storage.objects for all
  using (bucket_id = 'boletos' and current_user_has_role('financeiro'))
  with check (bucket_id = 'boletos' and current_user_has_role('financeiro'));
create policy "diretor_select_boletos_storage" on storage.objects for select
  using (bucket_id = 'boletos' and current_user_role() = 'diretor');
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
-- Pedidos: vendedor manda o PDF do pedido, só vê/mexe nos próprios;
-- faturista gerencia todos (fila de faturamento); diretor só lê.
-- ------------------------------------------------------------
create policy "vendedor_insert_own_pedidos" on pedidos for insert
  with check (current_user_role() = 'vendedor' and created_by = auth.uid());
create policy "vendedor_select_own_pedidos" on pedidos for select
  using (current_user_role() = 'vendedor' and created_by = auth.uid());
create policy "faturista_all_pedidos" on pedidos for all
  using (current_user_role() = 'faturista')
  with check (current_user_role() = 'faturista');
create policy "diretor_select_pedidos" on pedidos for select
  using (current_user_role() = 'diretor');
-- Financeiro revisa (baixa o PDF) e aprova o pedido — só um selo
-- informativo pro faturista, não trava o fluxo de faturar.
create policy "financeiro_select_pedidos" on pedidos for select
  using (current_user_has_role('financeiro'));
create policy "financeiro_update_pedidos_aprovacao" on pedidos for update
  using (current_user_has_role('financeiro'))
  with check (current_user_has_role('financeiro'));

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

drop trigger if exists pedidos_guard_trg on pedidos;
create trigger pedidos_guard_trg before update on pedidos
  for each row execute function pedidos_guard();

-- ------------------------------------------------------------
-- Histórico
-- ------------------------------------------------------------
create table if not exists pedido_eventos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('enviado', 'aprovado', 'devolvido', 'reenviado', 'faturado', 'cancelado',
                  'processo_iniciado', 'enviado_sanco', 'separacao_iniciada')),
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

drop trigger if exists pedidos_log_trg on pedidos;
create trigger pedidos_log_trg after insert or update on pedidos
  for each row execute function pedidos_log();

-- Storage: bucket privado "pedidos", arquivo em "{vendedor_id}/{arquivo}".
insert into storage.buckets (id, name, public)
values ('pedidos', 'pedidos', false)
on conflict (id) do nothing;

create policy "vendedor_insert_pedidos_storage" on storage.objects for insert
  with check (bucket_id = 'pedidos' and current_user_role() = 'vendedor');
create policy "vendedor_select_own_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'vendedor' and owner = auth.uid());
create policy "faturista_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'faturista');
create policy "financeiro_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_has_role('financeiro'));
create policy "diretor_select_pedidos_storage" on storage.objects for select
  using (bucket_id = 'pedidos' and current_user_role() = 'diretor');

-- ============================================================
-- 5) Funções RPC para o dashboard (agregações no banco, não no cliente)
-- ============================================================
create or replace function dashboard_kpis(
  p_mes smallint default null,
  p_ano smallint default null,
  p_filial_id uuid default null,
  p_estado char(2) default null,
  p_tipo_operacao text default null,
  p_vendedor_id uuid default null,
  p_meio_pagamento text default null,
  p_cliente text default null
) returns table (
  faturamento numeric,
  nf_count bigint,
  clientes bigint,
  ticket_medio numeric,
  a_faturar numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(sum(valor), 0) as faturamento,
    count(*) as nf_count,
    count(distinct cliente) as clientes,
    case when count(*) > 0 then coalesce(sum(valor), 0) / count(*) else 0 end as ticket_medio,
    coalesce(sum(valor_a_faturar), 0) as a_faturar
  from invoices
  where current_user_role() = 'diretor'
    and afeta_faturamento = true
    and excluida = false
    and (p_mes is null or extract(month from data_emissao) = p_mes)
    and (p_ano is null or extract(year from data_emissao) = p_ano)
    and (p_filial_id is null or filial_id = p_filial_id)
    and (p_estado is null or estado = p_estado)
    and (p_tipo_operacao is null or tipo_operacao = p_tipo_operacao)
    and (p_vendedor_id is null or vendedor_id = p_vendedor_id)
    and (p_meio_pagamento is null or meio_pagamento = p_meio_pagamento)
    and (p_cliente is null or cliente ilike '%' || p_cliente || '%')
    and tipo_operacao <> 'Cancelada'
    and upper(tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(tipo_operacao) <> 'TRANSFERENCIA';
$$;

create or replace function dashboard_ranking_vendedores(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  faturamento numeric,
  qtd_vendas bigint
)
language sql stable security definer
set search_path = public
as $$
  select v.id, v.nome, coalesce(sum(i.valor), 0), count(i.id)
  from vendedores v
  left join invoices i on i.vendedor_id = v.id
    and (p_mes is null or extract(month from i.data_emissao) = p_mes)
    and (p_ano is null or extract(year from i.data_emissao) = p_ano)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by v.id, v.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function dashboard_participacao_filiais(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  filial_id uuid,
  filial_nome text,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  select f.id, f.nome, coalesce(sum(i.valor), 0)
  from filiais f
  left join invoices i on i.filial_id = f.id
    and (p_mes is null or extract(month from i.data_emissao) = p_mes)
    and (p_ano is null or extract(year from i.data_emissao) = p_ano)
    and i.afeta_faturamento = true
    and i.excluida = false
    and i.tipo_operacao <> 'Cancelada'
    and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
  where current_user_role() = 'diretor'
  group by f.id, f.nome
  order by coalesce(sum(i.valor), 0) desc;
$$;

create or replace function dashboard_faturamento_por_hora(
  p_data date default current_date
) returns table (
  hora smallint,
  faturamento numeric,
  nf_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select extract(hour from created_at)::smallint as hora, coalesce(sum(valor), 0), count(*)
  from invoices
  where current_user_role() = 'diretor'
    and data_emissao = p_data
    and afeta_faturamento = true
    and excluida = false
    and tipo_operacao <> 'Cancelada'
    and upper(tipo_operacao) <> 'TRANSFERÊNCIA'
    and upper(tipo_operacao) <> 'TRANSFERENCIA'
  group by 1
  order by 1;
$$;

-- Comissão de vendedores: p_mes/p_ano identificam o MÊS DE FECHAMENTO do
-- período de apuração (o mês em que cai o dia 20). Ex: p_mes=7, p_ano=2026
-- -> período de 21/06/2026 a 20/07/2026 (não é o mês calendário normal).
-- dashboard_comissoes retorna 2 tipos de linha:
--  1. comissão individual normal (a maioria dos vendedores);
--  2. comissão via parceria (ex: JJ) — uma linha por beneficiário, marcada
--     em origem_parceria, com o percentual daquela fatia específica.
create function dashboard_comissoes(
  p_data_inicio date,
  p_data_fim date
) returns table (
  vendedor_id uuid,
  vendedor_nome text,
  percentual_comissao numeric,
  faturamento_periodo numeric,
  valor_comissao numeric,
  origem_parceria text
)
language sql stable security definer
set search_path = public
as $$
  with faturamento_por_vendedor as (
    select
      v.id as vendedor_id,
      v.nome as vendedor_nome,
      v.percentual_comissao,
      v.profile_id,
      coalesce(sum(i.valor), 0) as faturamento_periodo
    from vendedores v
    left join invoices i on i.vendedor_id = v.id
      and i.data_emissao between coalesce(p_data_inicio, (current_date - interval '1 month')::date)
                             and coalesce(p_data_fim, current_date)
      and i.afeta_faturamento = true
      and i.excluida = false
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
      and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
    group by v.id, v.nome, v.percentual_comissao, v.profile_id
  )
  select
    f.vendedor_id,
    f.vendedor_nome,
    f.percentual_comissao,
    f.faturamento_periodo,
    round(f.faturamento_periodo * f.percentual_comissao / 100, 2) as valor_comissao,
    null::text as origem_parceria
  from faturamento_por_vendedor f
  where not exists (select 1 from comissao_parcerias cp where cp.vendedor_id = f.vendedor_id)
    and (
      current_user_role() = 'diretor'
      or (current_user_role() = 'vendedor' and f.profile_id = auth.uid())
    )

  union all

  select
    f.vendedor_id,
    b.nome as vendedor_nome,
    cp.percentual as percentual_comissao,
    f.faturamento_periodo,
    round(f.faturamento_periodo * cp.percentual / 100, 2) as valor_comissao,
    f.vendedor_nome as origem_parceria
  from comissao_parcerias cp
  join faturamento_por_vendedor f on f.vendedor_id = cp.vendedor_id
  join vendedores b on b.id = cp.beneficiario_id
  where current_user_role() = 'diretor'
     or (current_user_role() = 'vendedor' and b.profile_id = auth.uid())

  order by valor_comissao desc;
$$;

-- Colocação do vendedor no ranking (gamificação): devolve só a posição, o
-- total de vendedores e o próprio faturamento de quem chamou a função —
-- nunca os valores dos outros vendedores.
create or replace function dashboard_minha_colocacao(
  p_mes smallint default null,
  p_ano smallint default null
) returns table (
  colocacao bigint,
  total_vendedores bigint,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  with ranking as (
    select
      v.id,
      coalesce(sum(i.valor), 0) as faturamento,
      row_number() over (order by coalesce(sum(i.valor), 0) desc) as colocacao,
      count(*) over () as total_vendedores
    from vendedores v
    left join invoices i on i.vendedor_id = v.id
      and (p_mes is null or extract(month from i.data_emissao) = p_mes)
      and (p_ano is null or extract(year from i.data_emissao) = p_ano)
      and i.afeta_faturamento = true
      and i.excluida = false
      and i.tipo_operacao <> 'Cancelada'
      and upper(i.tipo_operacao) <> 'TRANSFERÊNCIA'
      and upper(i.tipo_operacao) <> 'TRANSFERENCIA'
    where v.ativo = true
    group by v.id
  )
  select r.colocacao, r.total_vendedores, r.faturamento
  from ranking r
  join vendedores v on v.id = r.id
  where current_user_role() = 'vendedor' and v.profile_id = auth.uid();
$$;

-- ============================================================
-- 6) Dados iniciais (seed) — extraídos da planilha "novo modelo
--    faturamento 2026.xlsx"
-- ============================================================
insert into vendedores (nome) values
  ('Paulo'), ('Vinicius'), ('João Sousa'), ('João Gomes'), ('Wendel'),
  ('Sarah'), ('Jhon'), ('Felipe'), ('Jonathan'), ('Bianca')
on conflict (nome) do nothing;

-- Vendedor "combo": João Sousa + João Gomes vendendo juntos. percentual_comissao
-- próprio fica 0 — a comissão dele é 100% redistribuída pela tabela
-- comissao_parcerias (dashboard_comissoes cuida da divisão automaticamente).
insert into vendedores (nome, percentual_comissao) values ('JJ', 0)
on conflict (nome) do nothing;

insert into comissao_parcerias (vendedor_id, beneficiario_id, percentual)
select jj.id, gomes.id, 0.6
from vendedores jj, vendedores gomes
where jj.nome = 'JJ' and gomes.nome = 'João Gomes'
on conflict (vendedor_id, beneficiario_id) do update set percentual = excluded.percentual;

insert into comissao_parcerias (vendedor_id, beneficiario_id, percentual)
select jj.id, sousa.id, 1.0
from vendedores jj, vendedores sousa
where jj.nome = 'JJ' and sousa.nome = 'João Sousa'
on conflict (vendedor_id, beneficiario_id) do update set percentual = excluded.percentual;

-- Filiais reais da empresa (nome + CNPJ). O CNPJ é usado para auto-detectar
-- a filial a partir do emit/CNPJ do XML da NF-e. Adicione mais pelo Table
-- Editor do Supabase se abrir uma filial nova.
insert into filiais (nome, cnpj) values
  ('Matriz', '05502390000111'),
  ('Filial SP', '05502390000383'),
  ('Filial SC', '05502390000200')
on conflict (nome) do nothing;

insert into tipos_operacao (nome) values
  ('Saída'), ('Comodato'), ('Armazém'), ('Transferência'), ('Cancelada'),
  ('Locação'), ('Retorno Locação'), ('Importação'), ('Devolução'),
  ('Devolução de Compra'), ('Garantia'), ('Brinde'), ('Demo'),
  ('Demonstração'), ('Complementar'), ('Serviço'), ('Entrada para Conserto'),
  ('Inutilizada')
on conflict (nome) do nothing;

insert into meios_pagamento (nome) values
  ('PIX'), ('Cartão Rede'), ('Boleto'), ('Pagarme')
on conflict (nome) do nothing;

-- ============================================================
-- Pronto. Próximos passos (fora do SQL Editor):
--   1. Authentication → Users → criar 1 usuário Faturista e 1 Diretor.
--   2. Rodar o INSERT abaixo (troque os e-mails) para vincular o papel:
--
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Faturista', 'faturista' from auth.users where email = 'faturista@empresa.com';
--
--   insert into profiles (id, full_name, role)
--   select id, 'Nome do Diretor', 'diretor' from auth.users where email = 'diretor@empresa.com';
--
--   3. Database → Replication → habilitar Realtime na tabela invoices.
--   4. Project Settings → API → copiar URL e anon key para o .env local.
-- ============================================================
