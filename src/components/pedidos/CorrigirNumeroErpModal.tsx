import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

// Troca o número do pedido no ERP (SC) quando foi digitado errado ao iniciar o processo.
export function CorrigirNumeroErpModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const [numero, setNumero] = useState(pedido.numero_pedido_cd ?? '')
  const [salvando, setSalvando] = useState(false)

  async function handleSalvar() {
    const novo = numero.trim()
    if (!novo) {
      push('error', 'Informe o número do pedido no ERP.')
      return
    }
    if (novo === pedido.numero_pedido_cd) {
      onClose()
      return
    }
    setSalvando(true)
    // Os volumes vieram do pedido antigo no CD: zera para a próxima sincronização trazer os do número certo.
    const { error } = await supabase
      .from('pedidos')
      .update({ numero_pedido_cd: novo, volumes: null })
      .eq('id', pedido.id)
    setSalvando(false)
    if (error) {
      push(
        'error',
        error.code === '23505' && error.message.includes('pedidos_numero_pedido_cd_uniq')
          ? 'Esse número do ERP já está em outro pedido.'
          : `Erro ao corrigir o número: ${error.message}`
      )
      return
    }
    push('success', 'Número do ERP corrigido. O andamento no CD será buscado pelo número novo.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Corrigir número do ERP · {formatNumeroPedido(pedido.numero)}
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente} — número atual: <strong>{pedido.numero_pedido_cd ?? 'não informado'}</strong>
          </p>
        </div>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Número correto do pedido no ERP</span>
          <input
            type="text"
            inputMode="numeric"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            autoFocus
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
            onClick={handleSalvar}
            disabled={salvando}
            className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar número'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
