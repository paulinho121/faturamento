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
  const [numeroCd, setNumeroCd] = useState(pedido.numero_pedido_cd ?? '')
  const [salvando, setSalvando] = useState(false)

  async function handleConfirmar() {
    if (!origem) {
      push('error', 'Escolha a origem do pedido.')
      return
    }
    // SC: o ERP já gerou o pedido pro CD; esse número liga o nosso pedido ao andamento lá.
    const numeroPedidoCd = origem === 'SC' ? numeroCd.trim() : ''
    if (origem === 'SC' && !numeroPedidoCd) {
      push('error', 'Informe o número do pedido gerado no ERP.')
      return
    }
    setSalvando(true)
    const { error } = await supabase
      .from('pedidos')
      .update({ etapa: 'em_processo', origem, ...(numeroPedidoCd ? { numero_pedido_cd: numeroPedidoCd } : {}) })
      .eq('id', pedido.id)
    setSalvando(false)
    if (error) {
      push(
        'error',
        error.code === '23505' && error.message.includes('pedidos_numero_pedido_cd_uniq')
          ? 'Esse número do ERP já está em outro pedido.'
          : `Erro ao iniciar o processo: ${error.message}`
      )
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
        {origem === 'SC' && (
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
              Número do pedido no ERP
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={numeroCd}
              onChange={(e) => setNumeroCd(e.target.value)}
              placeholder="Ex.: 123456"
              className="w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
            <span className="mt-xs block font-label-md text-label-md text-on-surface-variant">
              O mesmo número que o ERP enviou ao CD de Santa Catarina.
            </span>
          </label>
        )}
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
