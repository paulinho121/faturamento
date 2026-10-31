-- ============================================================
-- Logística: retirada pelo cliente na MCI. Em vez de despachar com transportadora, a
-- logística registra quem retirou, quando e (opcional) a foto ou o comprovante. A
-- entrega vai direto para "entregue"; falta só finalizar o ciclo.
-- ============================================================

alter table entregas add column if not exists tipo_entrega text not null default 'transportadora'
  check (tipo_entrega in ('transportadora', 'retirada'));

alter table entrega_registros drop constraint if exists entrega_registros_tipo_check;
alter table entrega_registros add constraint entrega_registros_tipo_check
  check (tipo in ('despacho', 'previsao', 'ocorrencia', 'ocorrencia_resolvida', 'observacao', 'entrega', 'finalizacao', 'carta_correcao', 'retirada'));

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
          e.id, e.status, e.tipo_entrega, e.transportadora, e.codigo_rastreio, e.previsao_chegada, e.ocorrencia,
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

create or replace function entrega_retirada(
  p_entrega_id uuid, p_retirado_em timestamptz, p_retirado_por text, p_texto text,
  p_arquivo_path text default null, p_arquivo_nome text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  atual entregas%rowtype;
begin
  if not logistica_autorizada() then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_retirado_por), '') = '' then raise exception 'Informe quem retirou.'; end if;
  select * into atual from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if atual.status not in ('aguardando_despacho', 'em_transito') then
    raise exception 'Essa entrega já foi entregue.';
  end if;
  update entregas set
    tipo_entrega = 'retirada',
    status = 'entregue',
    entregue_em = coalesce(p_retirado_em, now()),
    recebido_por = trim(p_retirado_por),
    ocorrencia = false,
    atualizado_em = now()
  where id = p_entrega_id;
  insert into entrega_registros (entrega_id, tipo, texto, por, arquivo_path, arquivo_nome)
    values (p_entrega_id, 'retirada',
            'Retirado por ' || trim(p_retirado_por) || coalesce(' · ' || nullif(trim(coalesce(p_texto, '')), ''), ''),
            auth.uid(), p_arquivo_path, p_arquivo_nome);
end;
$$;

revoke all on function entrega_retirada(uuid, timestamptz, text, text, text, text) from public, anon;
grant execute on function entrega_retirada(uuid, timestamptz, text, text, text, text) to authenticated;
