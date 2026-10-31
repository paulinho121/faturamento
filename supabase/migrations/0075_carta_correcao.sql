-- ============================================================
-- Logística: carta de correção (CC-e) da NF-e. A carta é emitida no ERP/Sefaz; aqui a
-- logística registra o que foi corrigido e anexa o arquivo (PDF ou XML) à entrega,
-- quantas vezes precisar. Entra no diário como tipo "carta_correcao".
-- ============================================================

alter table entrega_registros drop constraint if exists entrega_registros_tipo_check;
alter table entrega_registros add constraint entrega_registros_tipo_check
  check (tipo in ('despacho', 'previsao', 'ocorrencia', 'ocorrencia_resolvida', 'observacao', 'entrega', 'finalizacao', 'carta_correcao'));

create or replace function logistica_entregas()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when logistica_autorizada() then
    coalesce((
      select jsonb_agg(to_jsonb(x) order by x.faturado_em desc nulls last)
      from (
        select
          e.id, e.status, e.transportadora, e.codigo_rastreio, e.previsao_chegada, e.ocorrencia,
          e.despachado_em, e.entregue_em, e.recebido_por, e.finalizado_em, e.created_at,
          p.id as pedido_id, p.numero as pedido_numero, p.cliente, v.nome as vendedor,
          p.origem, p.volumes, p.numero_nf, p.faturado_em, p.id_externo, p.observacao,
          p.arquivo_path, p.arquivo_nome,
          inv.valor as nf_valor, inv.data_emissao as nf_emissao, inv.estado as nf_estado,
          (select r.texto from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'ocorrencia'
            order by r.created_at desc limit 1) as ultima_ocorrencia,
          (select r.created_at from entrega_registros r
            where r.entrega_id = e.id order by r.created_at desc limit 1) as ultimo_registro_em,
          (select count(*) from entrega_registros r
            where r.entrega_id = e.id and r.tipo = 'carta_correcao')::int as cartas_correcao
        from entregas e
        join pedidos p on p.id = e.pedido_id
        join vendedores v on v.id = p.vendedor_id
        left join lateral (
          select i.valor, i.data_emissao, i.estado
          from invoices i
          where i.numero_nf = p.numero_nf and i.excluida = false
          order by i.data_emissao desc
          limit 1
        ) inv on true
        where e.status <> 'finalizado' or e.finalizado_em > now() - interval '30 days'
      ) x
    ), '[]'::jsonb)
  else null end;
$$;

create or replace function entrega_registrar(
  p_entrega_id uuid, p_tipo text, p_texto text, p_previsao date,
  p_arquivo_path text default null, p_arquivo_nome text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if p_tipo not in ('previsao', 'ocorrencia', 'ocorrencia_resolvida', 'observacao', 'carta_correcao') then
    raise exception 'Tipo de registro inválido.';
  end if;
  if p_tipo = 'previsao' and p_previsao is null then raise exception 'Informe a nova previsão de chegada.'; end if;
  if p_tipo in ('ocorrencia', 'observacao') and coalesce(trim(p_texto), '') = '' and p_arquivo_path is null then
    raise exception 'Descreva o que aconteceu.';
  end if;
  if p_tipo = 'carta_correcao' and coalesce(trim(p_texto), '') = '' and p_arquivo_path is null then
    raise exception 'Descreva o que foi corrigido ou anexe a carta de correção.';
  end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status = 'finalizado' then raise exception 'Ciclo já finalizado.'; end if;
  update entregas set
    previsao_chegada = coalesce(p_previsao, previsao_chegada),
    ocorrencia = case p_tipo when 'ocorrencia' then true when 'ocorrencia_resolvida' then false else ocorrencia end,
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, previsao, por, arquivo_path, arquivo_nome)
    values (p_entrega_id, p_tipo, nullif(trim(coalesce(p_texto, '')), ''), p_previsao, auth.uid(), p_arquivo_path, p_arquivo_nome);
end;
$$;

