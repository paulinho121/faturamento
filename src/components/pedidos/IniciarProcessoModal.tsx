import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido, PedidoOrigem } from '../../types/domain'
import { ORIGENS, formatNumeroPedido } from './pedidoUtils'

export function IniciarProcessoModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const [origem, setOrigem] = useState<PedidoOrigem | ''>(pedido.origem ?? '')
  const [salvando, setSalvando] = useState(false)

  async function handleConfirmar() {
    if (!origem) {
      push('error', 'Escolha a origem do pedido.')
      return
    }
    setSalvando(true)
    const { error } = await supabase.from('pedidos').update({ etapa: 'em_processo', origem }).eq('id', pedido.id)
    setSalvando(false)
    if (error) {
      push('error', `Erro ao iniciar o processo: ${error.message}`)
      return
    }
    push('success', 'Processo iniciado. O vendedor já acompanha o andamento.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Iniciar processo · {formatNumeroPedido(pedido.numero)}
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente} — confirme de onde o pedido sai. O vendedor passa a ver que o processo foi iniciado.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          {ORIGENS.map((o) => (
            <button
              key={o.valor}
              type="button"
              onClick={() => setOrigem(o.valor)}
              className={`rounded-xl border px-lg py-sm text-left transition-colors ${
                origem === o.valor ? 'border-primary bg-primary/5' : 'border-outline-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="block font-title-md text-title-md text-on-surface">{o.label}</span>
              <span className="block font-label-md text-label-md text-on-surface-variant">{o.ajuda}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={salvando}
            className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Iniciar processo'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
