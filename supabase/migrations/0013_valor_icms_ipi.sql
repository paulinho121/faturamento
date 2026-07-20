-- ============================================================
-- Patch: colunas valor_icms e valor_ipi + backfill via XML salvo
-- Rode no SQL Editor do projeto DUIMP.
-- ============================================================
-- Frete/DIFAL/FCP já eram salvos por nota desde o upload. ICMS e IPI só
-- eram calculados na hora de abrir o espelho da NF-e (a partir do xml_raw),
-- nunca persistidos — então não davam pra somar no card "Frete & Impostos".
-- Este patch adiciona as colunas e faz o backfill das notas que já têm o
-- XML original salvo, extraindo vICMS/vIPI de dentro do <ICMSTot> via xpath
-- (funciona com o XML namespaced da NFe usando local-name(), sem precisar
-- de nenhuma lib externa — só recursos nativos do Postgres).
-- ============================================================

alter table invoices add column if not exists valor_icms numeric(14,2) not null default 0;
alter table invoices add column if not exists valor_ipi numeric(14,2) not null default 0;

do $$
declare
  r record;
  v_xml xml;
  v_icms numeric;
  v_ipi numeric;
begin
  for r in select id, xml_raw from invoices where xml_raw is not null loop
    begin
      v_xml := r.xml_raw::xml;
      v_icms := coalesce(
        (xpath('//*[local-name()="ICMSTot"]/*[local-name()="vICMS"]/text()', v_xml))[1]::text::numeric,
        0
      );
      v_ipi := coalesce(
        (xpath('//*[local-name()="ICMSTot"]/*[local-name()="vIPI"]/text()', v_xml))[1]::text::numeric,
        0
      );
      update invoices set valor_icms = v_icms, valor_ipi = v_ipi where id = r.id;
    exception when others then
      raise notice 'Falha ao processar XML da nota % (ICMS/IPI ficam 0): %', r.id, sqlerrm;
    end;
  end loop;
end $$;
