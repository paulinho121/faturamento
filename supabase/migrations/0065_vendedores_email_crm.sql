-- ============================================================
-- E-mail do vendedor no CRM
-- ============================================================
-- Quando o escritório devolve um pedido que veio do CRM, o aviso (api/crm-devolucao)
-- leva o e-mail do vendedor pro CRM achar o destinatário do popup. Por padrão é o
-- e-mail do login dele aqui; email_crm cobre quem não tem login no faturamento ou
-- usa outro e-mail no CRM.
-- ============================================================

alter table vendedores add column if not exists email_crm text;

update vendedores set email_crm = 'john.flavio@gmail.com' where nome = 'Jhon' and email_crm is null;
update vendedores set email_crm = 'luiz@mcistore.com.br' where nome = 'Luiz' and email_crm is null;
