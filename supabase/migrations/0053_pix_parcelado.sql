-- Nova forma de pagamento "PIX Parcelado": como o Boleto, gera título com
-- parcelas e vencimentos (aparece como "Registrar título" nas Pendências).
-- meios_pagamento é só uma lista de sugestões; invoices guarda o texto livre.
insert into meios_pagamento (nome) values ('PIX Parcelado')
on conflict (nome) do nothing;
