-- ============================================================
-- Unifica os dois cadastros do Felipe (vendedor "Felipe" e o do diretor,
-- "Felipe Aguiar") num só, pra o faturamento dele aparecer em um valor único
-- no ranking, no Dashboard e no BI.
--
-- Mantém o cadastro "Felipe" (o original) e move tudo do "Felipe Aguiar" pra
-- ele: notas, pedidos, metas pessoais, parcerias de comissão e o vínculo de
-- login (profile_id), se o "Felipe" ainda não tiver um. Depois apaga o
-- duplicado. Se algum dos dois não existir (ou já tiver sido unificado), não
-- faz nada — pode rodar de novo sem problema.
--
-- Pra manter o outro nome, troque v_manter / v_duplicado abaixo.
-- ============================================================
do $$
declare
  v_manter    text := 'felipe';
  v_duplicado text := 'felipe aguiar';
  v_keep uuid;
  v_dup  uuid;
  v_profile uuid;
  n_invoices int;
  n_pedidos int;
begin
  select id into v_keep from vendedores where lower(trim(nome)) = v_manter;
  select id into v_dup  from vendedores where lower(trim(nome)) = v_duplicado;

  if v_keep is null or v_dup is null or v_keep = v_dup then
    raise notice 'Nada a unificar (manter=%, duplicado=%).', v_keep, v_dup;
    return;
  end if;

  update invoices set vendedor_id = v_keep where vendedor_id = v_dup;
  get diagnostics n_invoices = row_count;

  -- O gatilho de proteção dos pedidos proíbe trocar o vendedor (e qualquer
  -- alteração em pedido já faturado/cancelado), então ele é desligado só
  -- durante esta linha, como a 0038 já fez. Tudo roda numa transação: se algo
  -- falhar depois, o gatilho volta ao normal junto com o resto.
  alter table pedidos disable trigger pedidos_guard_trg;
  update pedidos set vendedor_id = v_keep where vendedor_id = v_dup;
  get diagnostics n_pedidos = row_count;
  alter table pedidos enable trigger pedidos_guard_trg;

  -- Metas pessoais: se os dois já têm meta no mesmo mês, vale a do cadastro
  -- mantido; as outras passam pra ele.
  delete from metas_pessoais d
  using metas_pessoais k
  where d.vendedor_id = v_dup and k.vendedor_id = v_keep
    and d.mes = k.mes and d.ano = k.ano;
  update metas_pessoais set vendedor_id = v_keep where vendedor_id = v_dup;

  -- Parcerias de comissão (o duplicado pode ser o "combo" ou o beneficiário).
  -- Remove o que colidiria com o que o cadastro mantido já tem e qualquer
  -- parceria dele consigo mesmo, depois move o resto.
  delete from comissao_parcerias d
  using comissao_parcerias k
  where d.vendedor_id = v_dup and k.vendedor_id = v_keep
    and d.beneficiario_id = k.beneficiario_id;
  delete from comissao_parcerias d
  using comissao_parcerias k
  where d.beneficiario_id = v_dup and k.beneficiario_id = v_keep
    and d.vendedor_id = k.vendedor_id;
  delete from comissao_parcerias
  where (vendedor_id = v_dup and beneficiario_id = v_keep)
     or (vendedor_id = v_keep and beneficiario_id = v_dup);
  update comissao_parcerias set vendedor_id = v_keep where vendedor_id = v_dup;
  update comissao_parcerias set beneficiario_id = v_keep where beneficiario_id = v_dup;

  -- Login: profile_id é único, então só herda se o mantido não tiver um — e o
  -- do duplicado precisa ser solto antes de atribuir, senão bate na unicidade.
  select profile_id into v_profile from vendedores where id = v_dup;
  update vendedores set profile_id = null where id = v_dup;
  update vendedores set profile_id = v_profile
  where id = v_keep and profile_id is null and v_profile is not null;

  delete from vendedores where id = v_dup;

  raise notice 'Unificado: % notas e % pedidos movidos para "%".', n_invoices, n_pedidos, v_manter;
end
$$;
