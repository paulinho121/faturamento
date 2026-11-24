-- ============================================================
-- Impostômetro: dados de cada nota para filtros e totais (número, cliente/fornecedor, valor)
-- Rode no SQL Editor do projeto, depois da 0094.
-- ============================================================
-- A tela do impostômetro passa a filtrar por período, venda/compra, CFOP e busca de nota (número, nome, CNPJ ou
-- chave) e a mostrar uma lista de notas com totais. Para isso cada nota guarda agora quem é a outra parte e o valor.
-- As notas já lidas pela versão anterior (versao = 1) são relidas automaticamente pela tela, uma única vez.
-- ============================================================

alter table impostometro_notas add column if not exists numero text;
alter table impostometro_notas add column if not exists serie text;
alter table impostometro_notas add column if not exists participante text;       -- cliente (venda) ou emitente (compra)
alter table impostometro_notas add column if not exists participante_cnpj text;
alter table impostometro_notas add column if not exists valor_nf numeric(14, 2) not null default 0;
alter table impostometro_notas add column if not exists versao smallint not null default 1;

create index if not exists impostometro_notas_numero_idx on impostometro_notas (numero);
