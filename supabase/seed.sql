-- ============================================================
-- Dados iniciais — rode depois de 0001_init.sql
-- Valores extraídos da planilha "novo modelo faturamento 2026.xlsx"
-- ============================================================

insert into vendedores (nome) values
  ('Paulo'), ('Vinicius'), ('João Sousa'), ('João Gomes'), ('Wendel'),
  ('Sarah'), ('Jhon'), ('Felipe'), ('Jonathan'), ('Bianca')
on conflict (nome) do nothing;

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
