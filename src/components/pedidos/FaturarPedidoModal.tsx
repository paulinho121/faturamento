import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import type { Pedido } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

export function FaturarPedidoModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { session } = useAuth()
  const { push } = useToast()
  const [numeroNf, setNumeroNf] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function handleConfirmar() {
    if (!session) return
    const nf = numeroNf.trim()
    if (!/^[0-9]{1,12}$/.test(nf)) {
      push('error', 'Informe o número da NF (só números).')
      return
    }
    setSalvando(true)
    const { error } = await supabase
      .from('pedidos')
      .update({ status: 'faturado', numero_nf: nf, faturado_em: new Date().toISOString(), faturado_por: session.user.id })
      .eq('id', pedido.id)
    setSalvando(false)
    if (error) {
      push('error', `Erro ao marcar pedido como faturado: ${error.message}`)
      return
    }
    push('success', 'Pedido marcado como faturado.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Faturar {formatNumeroPedido(pedido.numero)}
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente} — informe a nota fiscal emitida. O número aparece no Modo TV.
          </p>
        </div>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Número da NF</span>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={numeroNf}
            onChange={(e) => setNumeroNf(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !salvando) void handleConfirmar()
            }}
            placeholder="Ex.: 123456"
            className="w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
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
            onClick={handleConfirmar}
            disabled={salvando}
            className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Marcar como faturado'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
