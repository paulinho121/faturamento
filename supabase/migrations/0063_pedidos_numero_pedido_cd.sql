-- ============================================================
-- Número do pedido no ERP/CD (Escalasoft) — pedidos com origem SC
-- ============================================================
-- O pedido é enviado ao CD de Santa Catarina por um ERP; o faturista digita o
-- número que o ERP gerou ao iniciar o processo. É o vínculo com a API do CD
-- (NumeroPedido) pra atualizar o andamento sozinho.
-- Único entre pedidos não cancelados: o mesmo número em dois pedidos faria o
-- andamento de um aparecer no outro.
-- ============================================================

alter table pedidos add column if not exists numero_pedido_cd text;

create unique index if not exists pedidos_numero_pedido_cd_uniq on pedidos (numero_pedido_cd)
  where numero_pedido_cd is not null and status <> 'cancelado';
