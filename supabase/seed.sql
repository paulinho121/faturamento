-- ============================================================
-- Dados iniciais — rode depois de 0001_init.sql
-- Valores extraídos da planilha "novo modelo faturamento 2026.xlsx"
-- ============================================================

insert into vendedores (nome) values
  ('VINICIUS'), ('WENDEL'), ('FELIPE'), ('JOAO SOUSA'), ('JOAO GOMES'),
  ('JOHN'), ('JONATHAN'), ('SARAH'), ('PAULO')
on conflict (nome) do nothing;

-- Filiais observadas na planilha (código por UF de origem). Adicione mais
-- pelo Table Editor do Supabase se surgir uma filial nova.
insert into filiais (nome) values
  ('SC'), ('SP'), ('CE')
on conflict (nome) do nothing;

insert into tipos_operacao (nome) values
  ('Saída'), ('Comodato'), ('Armazém'), ('Transferência'), ('Cancelada'),
  ('Locação'), ('Retorno Locação'), ('Importação'), ('Devolução'),
  ('Devolução de Compra'), ('Garantia'), ('Brinde'), ('Demo'),
  ('Demonstração'), ('Complementar'), ('Serviço'), ('Entrada para Conserto'),
  ('Inutilizada')
on conflict (nome) do nothing;

insert into meios_pagamento (nome) values
  ('Site'), ('Mercado Livre'), ('Amazon'), ('Pagar.me'), ('Mercado Pago'),
  ('Rede'), ('Boleto'), ('PIX'), ('Cartão de Crédito'), ('Cartão de Débito'),
  ('Espécie'), ('Boleto Parcelado'), ('Boleto + PIX'), ('Cartão + PIX')
on conflict (nome) do nothing;
