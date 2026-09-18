import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

export function DevolverPedidoModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function handleDevolver() {
    if (motivo.trim().length < 5) {
      push('error', 'Explique o que o vendedor precisa corrigir (mínimo 5 caracteres).')
      return
    }
    setSalvando(true)
    const { error } = await supabase
      .from('pedidos')
      .update({ status: 'devolvido', devolvido_motivo: motivo.trim() })
      .eq('id', pedido.id)
    setSalvando(false)
    if (error) {
      push('error', `Erro ao devolver pedido: ${error.message}`)
      return
    }
    push('success', 'Pedido devolvido ao vendedor.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Devolver {formatNumeroPedido(pedido.numero)} ao vendedor
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente} — o vendedor poderá corrigir e reenviar. A aprovação do financeiro é zerada.
          </p>
        </div>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            O que precisa ser corrigido?
          </span>
          <textarea
            autoFocus
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: valor divergente do combinado, faltou o CNPJ do cliente…"
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>
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
            onClick={handleDevolver}
            disabled={salvando}
            className="rounded-full bg-error px-md py-xs font-label-md text-label-md text-on-error hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? 'Devolvendo…' : 'Devolver pedido'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
