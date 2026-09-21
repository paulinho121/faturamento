import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import type { Pedido, PedidoEvento } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

const EVENTO: Record<PedidoEvento['tipo'], { texto: string; icone: string; cor: string }> = {
  enviado: { texto: 'Pedido enviado', icone: 'send', cor: 'text-primary' },
  aprovado: { texto: 'Aprovado pelo Financeiro', icone: 'verified', cor: 'text-tertiary' },
  devolvido: { texto: 'Devolvido ao vendedor', icone: 'undo', cor: 'text-error' },
  reenviado: { texto: 'Corrigido e reenviado', icone: 'forward_to_inbox', cor: 'text-primary' },
  faturado: { texto: 'Faturado', icone: 'receipt_long', cor: 'text-tertiary' },
  cancelado: { texto: 'Cancelado', icone: 'cancel', cor: 'text-on-surface-variant' },
  processo_iniciado: { texto: 'Processo iniciado pelo faturista', icone: 'play_circle', cor: 'text-primary' },
  enviado_sanco: { texto: 'Enviado para a Sanco', icone: 'local_shipping', cor: 'text-primary' },
  separacao_iniciada: { texto: 'Em separação', icone: 'inventory_2', cor: 'text-primary' },
}

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function PedidoHistoricoModal({ pedido, onClose }: { pedido: Pedido; onClose: () => void }) {
  const [eventos, setEventos] = useState<PedidoEvento[] | null>(null)

  useEffect(() => {
    supabase
      .from('pedido_eventos')
      .select('*, profiles(full_name)')
      .eq('pedido_id', pedido.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setEventos((data as PedidoEvento[]) ?? []))
  }, [pedido.id])

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="p-lg">
        <div className="mb-lg flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <h3 className="font-title-md text-title-md text-on-surface">
              Histórico · {formatNumeroPedido(pedido.numero)}
            </h3>
            <p className="truncate font-label-md text-label-md text-on-surface-variant">{pedido.cliente}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {eventos === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ol className="space-y-md">
            {eventos.map((ev) => {
              const info = EVENTO[ev.tipo]
              return (
                <li key={ev.id} className="flex gap-sm">
                  <span className={`material-symbols-outlined mt-0.5 shrink-0 text-[20px] ${info.cor}`}>
                    {info.icone}
                  </span>
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      {info.texto}
                      {ev.revisao > 0 && ` (rev. ${ev.revisao})`}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {formatDataHora(ev.created_at)}
                      {ev.profiles?.full_name ? ` · ${ev.profiles.full_name}` : ''}
                    </p>
                    {ev.motivo && (
                      <p className="mt-xs rounded-lg bg-error/5 p-sm font-label-md text-label-md text-on-surface">
                        Motivo: {ev.motivo}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Modal>
  )
}
