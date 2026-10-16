-- ============================================================
-- Guarda as DUAS datas de um boleto pago pelo retorno (.RET):
--   data_pagamento    = a data que vem no arquivo do banco (quando o cliente
--                       pagou) — é o que a coluna "Pago em" mostra;
--   data_compensacao  = o dia útil seguinte, quando o dinheiro de fato cai na
--                       conta — é com ela que o financeiro confere o extrato.
-- Pagamento lançado na mão ou confirmado pelo extrato (OFX) deixa
-- data_compensacao vazia: aí vale a própria data_pagamento.
-- ============================================================

alter table boletos add column if not exists data_compensacao date;

-- Dois lotes já gravados antes desta mudança, quando a data de compensação
-- era salva no lugar da data de pagamento. Cada um só é mexido se ainda não
-- tiver data_compensacao (pode rodar de novo sem efeito).
do $$
declare
  n_a int;
  n_b int;
begin
  -- (a) Os 12 títulos do .RET de 13/10 que a 0056 passou pra 14/10: o
  -- pagamento foi 13/10 e a compensação 14/10.
  update boletos
  set data_pagamento = date '2026-10-13',
      data_compensacao = date '2026-10-14'
  where excluido = false
    and status in ('pago', 'parcial')
    and data_pagamento = date '2026-10-14'
    and data_compensacao is null
    and (valor, vencimento) in (values
      (578.60::numeric,   date '2026-10-10'),
      (179.40::numeric,   date '2026-10-10'),
      (1648.25::numeric,  date '2026-10-10'),
      (5919.60::numeric,  date '2026-10-10'),
      (7985.87::numeric,  date '2026-10-10'),
      (13463.90::numeric, date '2026-10-10'),
      (7382.85::numeric,  date '2026-10-10'),
      (3022.50::numeric,  date '2026-10-10'),
      (1931.56::numeric,  date '2026-10-11'),
      (2500.00::numeric,  date '2026-10-11'),
      (9000.00::numeric,  date '2026-10-12'),
      (5311.15::numeric,  date '2026-10-14')
    );
  get diagnostics n_a = row_count;

  -- (b) Os baixados pelo .RET de 15/10: ficaram com data 16/10 (a
  -- compensação). O pagamento foi 15/10.
  update boletos
  set data_pagamento = date '2026-10-15',
      data_compensacao = date '2026-10-16'
  where excluido = false
    and status in ('pago', 'parcial')
    and data_pagamento = date '2026-10-16'
    and data_compensacao is null;
  get diagnostics n_b = row_count;

  raise notice 'Lote 13->14/10: % título(s). Lote 15->16/10: % título(s).', n_a, n_b;
end
$$;
