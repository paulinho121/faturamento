-- ============================================================
-- Watcher de XML: filtro por data de emissão, pra não trazer pro faturista
-- o histórico inteiro da pasta (que já tinha nota lançada manualmente há
-- meses quando o watcher rodou pela primeira vez) — só interessa nota
-- emitida a partir da data de corte configurada.
-- ============================================================

alter table nfe_watcher_config add column if not exists data_corte date not null default current_date;

-- Limpeza única: descarta capturas pendentes que já foram lançadas
-- manualmente (mesma chave de acesso já numa invoice) ou são de antes da
-- data de corte — evita reprocessar o histórico que já existia na pasta.
update nfe_capturas c
set status = 'descartada'
where c.status = 'pendente'
  and (
    exists (select 1 from invoices i where i.xml_chave_acesso = c.chave_acesso)
    or coalesce(
         (substring(c.xml_raw from '<dhEmi>(\d{4}-\d{2}-\d{2})'))::date,
         (substring(c.xml_raw from '<dEmi>(\d{4}-\d{2}-\d{2})'))::date,
         '0001-01-01'::date
       ) < (select data_corte from nfe_watcher_config where id = 1)
  );
