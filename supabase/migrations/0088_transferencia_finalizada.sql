-- ============================================================
-- Patch: logística marca a transferência como finalizada
-- Rode no SQL Editor do projeto, depois da 0087.
-- ============================================================
-- Na aba Transferências a logística só enxergava as notas. Agora ela sinaliza quando a transferência
-- já foi concluída (e pode reabrir, se marcou por engano). A logística não tem permissão de update
-- em invoices; a marcação passa por esta função, que só mexe nestas duas colunas e só em notas de
-- Transferência.
-- ============================================================

alter table invoices add column if not exists transferencia_finalizada_em timestamptz;
alter table invoices add column if not exists transferencia_finalizada_por uuid references profiles(id);

create or replace function transferencia_finalizar(p_invoice_id uuid, p_finalizada boolean) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  nota invoices%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  select * into nota from invoices where id = p_invoice_id;
  if not found or nota.excluida then raise exception 'Nota não encontrada.'; end if;
  if upper(nota.tipo_operacao) not in ('TRANSFERÊNCIA', 'TRANSFERENCIA') then
    raise exception 'Só notas de transferência podem ser finalizadas por aqui.';
  end if;
  update invoices set
    transferencia_finalizada_em = case when p_finalizada then now() else null end,
    transferencia_finalizada_por = case when p_finalizada then auth.uid() else null end
  where id = p_invoice_id;
end;
$$;

revoke all on function transferencia_finalizar(uuid, boolean) from public, anon;
grant execute on function transferencia_finalizar(uuid, boolean) to authenticated;
