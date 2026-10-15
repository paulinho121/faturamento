-- ============================================================
-- Ajuste pontual: títulos baixados pelo .RET antes da correção da data de
-- compensação ficaram com a data da ocorrência do banco (13/10), mas o
-- dinheiro compensou no dia útil seguinte (14/10) — que é a data que o
-- financeiro usa na planilha de controle ("foram baixados 14 títulos neste
-- dia 14/10"). Sem isso, o relatório por data de pagamento de 14/10 mostrava
-- só 3 títulos.
--
-- Mexe só nos 12 títulos da planilha (identificados por valor + vencimento),
-- e só se já estiverem pagos com data 13/10 — nada mais é tocado. Os outros 2
-- da planilha (R$ 7.694,98 e R$ 13.800,00) já estão em 14/10 no sistema.
-- Pode rodar mais de uma vez: na segunda não acha mais nenhum.
-- ============================================================
do $$
declare
  n int;
begin
  update boletos
  set data_pagamento = date '2026-10-14'
  where excluido = false
    and status in ('pago', 'parcial')
    and data_pagamento = date '2026-10-13'
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
  get diagnostics n = row_count;
  raise notice '% título(s) ajustado(s) para 14/10 (esperado: até 12).', n;
end
$$;
