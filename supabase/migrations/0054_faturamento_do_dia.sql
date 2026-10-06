-- ============================================================
-- Totais do dia (notas + faturamento) da empresa inteira pra qualquer
-- faturista/financeiro/diretor. Antes, o faturista comum só via as notas que
-- ele mesmo lançou (política faturista_select_own), então as notas lançadas
-- pelo financeiro/administrativo não entravam no "Notas hoje / Faturamento
-- hoje" dele e as telas ficavam fora de sincronia. Função em vez de abrir a
-- leitura de invoices: devolve só os totais, nunca as notas dos outros.
-- Mesma regra do cálculo que a tela já fazia: conta toda nota não excluída
-- emitida no dia; o valor ignora Cancelada e notas que não afetam faturamento.
-- ============================================================
create or replace function faturamento_do_dia(
  p_data date default current_date
) returns table (
  nf_count bigint,
  faturamento numeric
)
language sql stable security definer
set search_path = public
as $$
  select
    count(*),
    coalesce(sum(valor) filter (where upper(tipo_operacao) <> 'CANCELADA' and afeta_faturamento), 0)
  from invoices
  where (
      current_user_has_role('faturista')
      or current_user_has_role('financeiro')
      or current_user_role() = 'diretor'
    )
    and excluida = false
    and data_emissao = p_data;
$$;
