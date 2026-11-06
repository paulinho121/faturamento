import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

// Fatura só a parte pronta de um pedido parcial: guarda a NF parcial, o pedido segue em andamento
// (coluna "Faturados pendentes") e a parte faturada vai para despacho. Pode ser repetido.
export function FaturarParcialModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const [numeroNf, setNumeroNf] = useState('')
  const [salvando, setSalvando] = useState(false)
  const jaFaturados = pedido.parcial_nfs ?? []

  async function handleConfirmar() {
    const nf = numeroNf.trim()
    if (!/^[0-9]{1,12}$/.test(nf)) {
      push('error', 'Informe o número da NF (só números).')
      return
    }
    setSalvando(true)
    const { error } = await supabase.rpc('faturar_parcial', { p_pedido_id: pedido.id, p_numero_nf: nf })
    setSalvando(false)
    if (error) {
      push('error', error.message)
      return
    }
    push('success', 'NF parcial registrada — o pedido segue em “Faturados pendentes” até o restante ser faturado.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">Faturar parcial · {formatNumeroPedido(pedido.numero)}</h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente} — informe a NF da parte que está sendo faturada agora. O pedido continua em andamento até você
            faturar o restante.
          </p>
        </div>
        {pedido.parcial_obs && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-sm py-xs">
            <p className="font-label-md text-label-md font-semibold text-violet-900">Itens que faltam faturar</p>
            <p className="whitespace-pre-wrap break-words font-label-md text-label-md text-violet-900">{pedido.parcial_obs}</p>
          </div>
        )}
        {jaFaturados.length > 0 && (
          <p className="font-label-md text-label-md text-on-surface-variant">
            NF(s) parciais já lançadas: <strong className="text-on-surface">{jaFaturados.join(', ')}</strong>
          </p>
        )}
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Número da NF parcial</span>
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
            {salvando ? 'Salvando…' : 'Registrar NF parcial'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
