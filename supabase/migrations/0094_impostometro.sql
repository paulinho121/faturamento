-- ============================================================
-- Impostômetro: créditos e débitos de impostos lidos dos XMLs das notas (Lucro Presumido)
-- Rode no SQL Editor do projeto, depois da 0093.
-- ============================================================
-- A rotina api/impostometro.ts lê o XML de cada nota (as que a empresa EMITE, em invoices.xml_raw, e as emitidas
-- CONTRA a empresa, em nfe_entrada.xml) e guarda os impostos de cada item. A tela soma por mês e por imposto:
-- débito (saídas) menos crédito (entradas). É uma ESTIMATIVA para acompanhamento: a apuração oficial é da
-- contabilidade. As regras (qual CFOP gera crédito ou débito) ficam em impostometro_regras e podem ser ajustadas.
-- Só a service role (backend) escreve; leitura para diretor e financeiro.
-- ============================================================

create table if not exists impostometro_notas (
  origem text not null check (origem in ('saida', 'entrada')),
  chave text not null,
  data_emissao date not null,
  cancelada boolean not null default false,
  itens integer not null default 0,
  processado_em timestamptz not null default now(),
  primary key (origem, chave)
);

create index if not exists impostometro_notas_emissao_idx on impostometro_notas (data_emissao);

create table if not exists impostometro_itens (
  origem text not null,
  chave text not null,
  n_item integer not null,
  cfop text,
  ncm text,
  v_prod numeric(14, 2) not null default 0,
  v_bc_icms numeric(14, 2) not null default 0,
  v_icms numeric(14, 2) not null default 0,
  v_ipi numeric(14, 2) not null default 0,
  v_pis numeric(14, 2) not null default 0,
  v_cofins numeric(14, 2) not null default 0,
  v_cbs numeric(14, 2) not null default 0,
  v_ibs numeric(14, 2) not null default 0,
  primary key (origem, chave, n_item),
  foreign key (origem, chave) references impostometro_notas (origem, chave) on delete cascade
);

create index if not exists impostometro_itens_cfop_idx on impostometro_itens (cfop);

-- Como cada CFOP entra na conta de ICMS e de IPI:
--   debito          = soma no débito (imposto a pagar)
--   credito         = soma no crédito (imposto a abater)
--   estorno_debito  = reduz o débito (ex.: devolução de venda que voltou para nós)
--   estorno_credito = reduz o crédito (ex.: devolução de compra que fizemos)
--   nenhum          = fora da conta (ex.: uso e consumo, ativo imobilizado, remessas sem ICMS)
create table if not exists impostometro_regras (
  cfop text primary key check (cfop ~ '^[0-9]{4}$'),
  efeito_icms text not null default 'nenhum' check (efeito_icms in ('debito', 'credito', 'estorno_debito', 'estorno_credito', 'nenhum')),
  efeito_ipi text not null default 'nenhum' check (efeito_ipi in ('debito', 'credito', 'estorno_debito', 'estorno_credito', 'nenhum')),
  descricao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references profiles(id)
);

alter table impostometro_notas enable row level security;
alter table impostometro_itens enable row level security;
alter table impostometro_regras enable row level security;

drop policy if exists "impostometro_notas_select" on impostometro_notas;
create policy "impostometro_notas_select" on impostometro_notas for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
drop policy if exists "impostometro_itens_select" on impostometro_itens;
create policy "impostometro_itens_select" on impostometro_itens for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));
drop policy if exists "impostometro_regras_select" on impostometro_regras;
create policy "impostometro_regras_select" on impostometro_regras for select
  using (current_user_role() = 'diretor' or current_user_has_role('financeiro'));

-- Regras iniciais (a contabilidade deve revisar). CFOPs não listados: saída = débito; entrada = fora da conta
-- até alguém definir (a tela lista os CFOPs sem regra para revisão).
insert into impostometro_regras (cfop, efeito_icms, efeito_ipi, descricao)
select cfop, efeito, efeito, descricao from (values
  -- entradas que geram crédito (compra para revenda/industrialização e importação)
  ('1101', 'credito', 'Compra para industrialização'), ('1102', 'credito', 'Compra para comercialização'),
  ('1111', 'credito', 'Compra para industrialização de mercadoria recebida anteriormente em consignação'),
  ('1113', 'credito', 'Compra para comercialização de mercadoria recebida anteriormente em consignação'),
  ('1116', 'credito', 'Compra para industrialização, originada de encomenda para recebimento futuro'),
  ('1117', 'credito', 'Compra para comercialização, originada de encomenda para recebimento futuro'),
  ('1118', 'credito', 'Compra de mercadoria para comercialização pelo adquirente originário'),
  ('1120', 'credito', 'Compra para industrialização, em venda à ordem'),
  ('1121', 'credito', 'Compra para comercialização, em venda à ordem'),
  ('1122', 'credito', 'Compra para industrialização (cadeia de comercialização)'),
  ('1401', 'credito', 'Compra para industrialização em operação com ST'),
  ('1403', 'credito', 'Compra para comercialização em operação com ST'),
  ('2101', 'credito', 'Compra para industrialização (interestadual)'), ('2102', 'credito', 'Compra para comercialização (interestadual)'),
  ('2111', 'credito', 'Compra para industrialização, consignação (interestadual)'),
  ('2113', 'credito', 'Compra para comercialização, consignação (interestadual)'),
  ('2116', 'credito', 'Compra para industrialização, encomenda futura (interestadual)'),
  ('2117', 'credito', 'Compra para comercialização, encomenda futura (interestadual)'),
  ('2118', 'credito', 'Compra de mercadoria para comercialização pelo adquirente originário (interestadual)'),
  ('2120', 'credito', 'Compra para industrialização, venda à ordem (interestadual)'),
  ('2121', 'credito', 'Compra para comercialização, venda à ordem (interestadual)'),
  ('2122', 'credito', 'Compra para industrialização (interestadual, cadeia)'),
  ('2401', 'credito', 'Compra para industrialização com ST (interestadual)'),
  ('2403', 'credito', 'Compra para comercialização com ST (interestadual)'),
  ('3101', 'credito', 'Compra para industrialização (importação)'), ('3102', 'credito', 'Compra para comercialização (importação)'),
  ('3126', 'credito', 'Compra para utilização na prestação de serviço sujeita ao ICMS (importação)'),
  -- entradas que desfazem débito (devolução de venda)
  ('1201', 'estorno_debito', 'Devolução de venda de produção do estabelecimento'), ('1202', 'estorno_debito', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros'),
  ('1203', 'estorno_debito', 'Devolução de venda de produção do estabelecimento (ZFM/ALC)'), ('1204', 'estorno_debito', 'Devolução de venda de mercadoria de terceiros (ZFM/ALC)'),
  ('1208', 'estorno_debito', 'Devolução de produção do estabelecimento remetida em transferência'), ('1209', 'estorno_debito', 'Devolução de mercadoria de terceiros remetida em transferência'),
  ('1410', 'estorno_debito', 'Devolução de venda de produção com ST'), ('1411', 'estorno_debito', 'Devolução de venda de mercadoria de terceiros com ST'),
  ('2201', 'estorno_debito', 'Devolução de venda de produção do estabelecimento (interestadual)'), ('2202', 'estorno_debito', 'Devolução de venda de mercadoria de terceiros (interestadual)'),
  ('2203', 'estorno_debito', 'Devolução de venda de produção (ZFM/ALC, interestadual)'), ('2204', 'estorno_debito', 'Devolução de venda de mercadoria de terceiros (ZFM/ALC, interestadual)'),
  ('2208', 'estorno_debito', 'Devolução de produção remetida em transferência (interestadual)'), ('2209', 'estorno_debito', 'Devolução de mercadoria de terceiros remetida em transferência (interestadual)'),
  ('2410', 'estorno_debito', 'Devolução de venda de produção com ST (interestadual)'), ('2411', 'estorno_debito', 'Devolução de venda de mercadoria de terceiros com ST (interestadual)'),
  -- saídas que desfazem crédito (devolução de compra)
  ('5201', 'estorno_credito', 'Devolução de compra para industrialização'), ('5202', 'estorno_credito', 'Devolução de compra para comercialização'),
  ('5208', 'estorno_credito', 'Devolução de mercadoria recebida em transferência (produção)'), ('5209', 'estorno_credito', 'Devolução de mercadoria recebida em transferência (terceiros)'),
  ('5210', 'estorno_credito', 'Devolução de compra para utilização na prestação de serviço'),
  ('5410', 'estorno_credito', 'Devolução de compra para industrialização com ST'), ('5411', 'estorno_credito', 'Devolução de compra para comercialização com ST'),
  ('6201', 'estorno_credito', 'Devolução de compra para industrialização (interestadual)'), ('6202', 'estorno_credito', 'Devolução de compra para comercialização (interestadual)'),
  ('6208', 'estorno_credito', 'Devolução de mercadoria recebida em transferência (interestadual, produção)'), ('6209', 'estorno_credito', 'Devolução de mercadoria recebida em transferência (interestadual, terceiros)'),
  ('6210', 'estorno_credito', 'Devolução de compra para utilização na prestação de serviço (interestadual)'),
  ('6410', 'estorno_credito', 'Devolução de compra para industrialização com ST (interestadual)'), ('6411', 'estorno_credito', 'Devolução de compra para comercialização com ST (interestadual)'),
  -- sem efeito (uso e consumo, ativo imobilizado)
  ('1556', 'nenhum', 'Compra de material para uso ou consumo'), ('2556', 'nenhum', 'Compra de material para uso ou consumo (interestadual)'),
  ('1551', 'nenhum', 'Compra de bem para o ativo imobilizado'), ('2551', 'nenhum', 'Compra de bem para o ativo imobilizado (interestadual)'),
  ('3556', 'nenhum', 'Compra de material para uso ou consumo (importação)'), ('3551', 'nenhum', 'Compra de bem para o ativo imobilizado (importação)')
) as r(cfop, efeito, descricao)
on conflict (cfop) do nothing;
