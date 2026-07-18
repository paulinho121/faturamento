-- ============================================================
-- Patch: lista real de formas de pagamento
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================

-- meios_pagamento é só uma tabela de sugestões (não tem FK vindo de
-- invoices, que guarda o texto livremente) — seguro apagar as antigas.
delete from meios_pagamento where nome not in ('PIX', 'Cartão Rede', 'Boleto', 'Pagarme');

insert into meios_pagamento (nome) values
  ('PIX'), ('Cartão Rede'), ('Boleto'), ('Pagarme')
on conflict (nome) do nothing;
