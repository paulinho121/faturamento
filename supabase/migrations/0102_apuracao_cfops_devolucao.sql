-- ============================================================
-- Apuração de IRPJ e CSLL: devoluções de venda pelo CFOP
-- Rode no SQL Editor depois da 0101.
-- ============================================================
-- A linha "Devoluções de vendas" (e o IPI sobre elas) passa a vir do CFOP dos itens do XML:
--   notas emitidas pela empresa (nota de entrada própria da devolução): 1201, 1202, 1410, 1411, 2201, 2202, 2410, 2411
--   notas emitidas pelo cliente contra a empresa (captura da SEFAZ):    5201, 5202, 5410, 5411, 6201, 6202, 6410, 6411
-- Nas notas emitidas pela empresa só contam os CFOPs 1xxx/2xxx e nas recebidas só os 5xxx/6xxx, para uma devolução de
-- compra feita pela empresa ao fornecedor nunca entrar como devolução de venda. A lista é editável na tela, por ano.
-- ============================================================

alter table contab_parametros add column if not exists cfops_devolucao text not null
  default '1201,1202,1410,1411,2201,2202,2410,2411,5201,5202,5410,5411,6201,6202,6410,6411';
