import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido, PedidoOrigem } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

const FILIAIS: { valor: PedidoOrigem; nome: string }[] = [
  { valor: 'SC', nome: 'SC — Santa Catarina' },
  { valor: 'SP', nome: 'SP — São Paulo' },
  { valor: 'CE', nome: 'CE — Ceará' },
]

const CAMPO =
  'w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none'

// Marca (ou edita) o pedido como "em transferência": a mercadoria vem de outra filial (SC ↔ CE, SC ↔ SP).
// O pedido continua na etapa em que está; na TV ele aparece na coluna "Em transferência" até ser concluído.
export function TransferenciaPedidoModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const editando = !!pedido.em_transferencia
  // Padrão: chega na filial de onde o pedido sai; sai de SC (ou de SP, se o pedido já sai de SC).
  const paraInicial: PedidoOrigem | '' = pedido.transferencia_para ?? pedido.origem ?? ''
  const deInicial: PedidoOrigem | '' = pedido.transferencia_de ?? (paraInicial === 'SC' ? '' : 'SC')
  const [de, setDe] = useState<PedidoOrigem | ''>(deInicial)
  const [para, setPara] = useState<PedidoOrigem | ''>(paraInicial)
  const [pedidoErp, setPedidoErp] = useState(pedido.transferencia_pedido_erp ?? '')
  const [numero, setNumero] = useState(pedido.transferencia_numero ?? '')
  const [salvando, setSalvando] = useState(false)

  async function handleSalvar() {
    if (!de || !para || de === para) {
      push('error', 'Escolha a filial de saída e a de chegada (diferentes entre si).')
      return
    }
    if (!pedidoErp.trim()) {
      push('error', 'Informe o número do pedido no ERP.')
      return
    }
    setSalvando(true)
    const { error } = await supabase.rpc('pedido_transferencia', {
      p_pedido_id: pedido.id,
      p_em_transferencia: true,
      p_de: de,
      p_para: para,
      p_pedido_erp: pedidoErp.trim(),
      p_numero: numero.trim(),
    })
    setSalvando(false)
    if (error) {
      push('error', `Erro ao salvar a transferência: ${error.message}`)
      return
    }
    push('success', editando ? 'Transferência atualizada.' : `Pedido em transferência ${de} → ${para} — já aparece na TV.`)
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            {editando ? 'Editar transferência' : 'Em transferência'} · {formatNumeroPedido(pedido.numero)}
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {pedido.cliente}
            {pedido.origem ? ` — pedido sai de ${pedido.origem}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-sm">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Sai de</span>
            <select value={de} onChange={(e) => setDe(e.target.value as PedidoOrigem | '')} className={CAMPO}>
              <option value="">Escolha…</option>
              {FILIAIS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Chega em</span>
            <select value={para} onChange={(e) => setPara(e.target.value as PedidoOrigem | '')} className={CAMPO}>
              <option value="">Escolha…</option>
              {FILIAIS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Número do pedido no ERP</span>
          <input
            type="text"
            inputMode="numeric"
            value={pedidoErp}
            onChange={(e) => setPedidoErp(e.target.value)}
            autoFocus
            maxLength={40}
            placeholder="Ex.: 123456"
            className={CAMPO}
          />
        </label>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            Número da transferência <span className="text-on-surface-variant/70">(pode informar depois)</span>
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            maxLength={40}
            placeholder="Ex.: 562750"
            className={CAMPO}
          />
        </label>

        <p className="font-label-md text-label-md text-on-surface-variant">
          O pedido continua na etapa em que está. Na TV, ele vai para a coluna <strong>Em transferência</strong> até você
          concluir a transferência.
        </p>

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
            className="rounded-full bg-indigo-600 px-md py-xs font-label-md text-label-md text-white hover:opacity-90 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : editando ? 'Salvar' : 'Marcar em transferência'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
