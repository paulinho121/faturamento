-- ============================================================
-- Patch: vincular sozinho os títulos importados antes da nota existir
-- Rode no SQL Editor do projeto, depois da 0086.
-- ============================================================
-- O XML de títulos do ERP às vezes chega antes de a nota ser lançada no sistema: os títulos entram
-- sem nota (invoice_id nulo, "Sem Nota") e continuam assim mesmo depois que a nota é lançada.
-- Daqui pra frente, ao lançar uma nota, os títulos soltos dela (mesmo número de NF no número do
-- título: "000562285-1/6" ou "NE000562285-6/9") são vinculados automaticamente. O mesmo vínculo é
-- aplicado agora aos títulos soltos que já existem.
-- ============================================================

create or replace function invoices_vincular_titulos() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.numero_nf ~ '^[0-9]+$' then
    update boletos
    set invoice_id = new.id
    where invoice_id is null
      and excluido = false
      and numero_titulo ~ '^(NE)?0*[0-9]+-[0-9]+/[0-9]+$'
      and regexp_replace(numero_titulo, '^(NE)?0*([0-9]+)-.*$', '\2') = regexp_replace(new.numero_nf, '^0+', '');
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_vincular_titulos_trg on invoices;
create trigger invoices_vincular_titulos_trg
  after insert on invoices
  for each row execute function invoices_vincular_titulos();

-- Títulos soltos que já existem: vincula à nota de mesmo número (a mais antiga, se houver mais de uma).
update boletos b
set invoice_id = i.id
from (
  select distinct on (regexp_replace(numero_nf, '^0+', ''))
         id, regexp_replace(numero_nf, '^0+', '') as nf
  from invoices
  where excluida = false and numero_nf ~ '^[0-9]+$'
  order by regexp_replace(numero_nf, '^0+', ''), created_at
) i
where b.invoice_id is null
  and b.excluido = false
  and b.numero_titulo ~ '^(NE)?0*[0-9]+-[0-9]+/[0-9]+$'
  and regexp_replace(b.numero_titulo, '^(NE)?0*([0-9]+)-.*$', '\2') = i.nf;
