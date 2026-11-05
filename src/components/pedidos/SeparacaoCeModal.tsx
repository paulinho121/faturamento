import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { AvisoSerieModal } from '../logistica/AvisoSerieModal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Pedido } from '../../types/domain'
import { formatNumeroPedido } from './pedidoUtils'

const CAMPO =
  'w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none'
const ROTULO = 'mb-xs block font-label-md text-label-md text-on-surface-variant'

// Pedido de CE: quem separa é o faturista, então ele mesmo informa os números de série e os
// volumes (em SP essa parte é da logística). Só depois disso o pedido pode ser faturado.
export function SeparacaoCeModal({
  pedido,
  onClose,
  onDone,
}: {
  pedido: Pedido
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const [numerosSerie, setNumerosSerie] = useState(pedido.numeros_serie ?? '')
  const [volumes, setVolumes] = useState(pedido.volumes ? String(pedido.volumes) : '')
  const [salvando, setSalvando] = useState(false)
  const [semSerie, setSemSerie] = useState(false)
  const serieRef = useRef<HTMLTextAreaElement>(null)
  const jaConcluida = !!pedido.separacao_concluida_em

  async function gravar(qtd: number) {
    setSalvando(true)
    const { error } = await supabase.rpc('separacao_concluir', {
      p_pedido_id: pedido.id,
      p_numeros_serie: numerosSerie,
      p_volumes: qtd,
    })
    setSalvando(false)
    if (error) {
      push('error', error.message)
      return
    }
    push('success', jaConcluida ? 'Série e volumes atualizados.' : 'Série e volumes informados — já pode faturar.')
    onDone()
  }

  function salvar() {
    const qtd = Number(volumes)
    if (!Number.isInteger(qtd) || qtd < 1) {
      push('error', 'Informe a quantidade de volumes.')
      return
    }
    if (!numerosSerie.trim()) {
      setSemSerie(true)
      return
    }
    void gravar(qtd)
  }

  return (
    <>
      <Modal onClose={onClose} maxWidthClassName="max-w-md">
        <div className="space-y-md p-lg">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">
              Série e volumes · {formatNumeroPedido(pedido.numero)}
            </h3>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {pedido.cliente} — pedido de CE: a separação é com você. Informe o número de série (NS) de cada equipamento e a
              quantidade de volumes gerados.
            </p>
          </div>
          <label className="block">
            <span className={ROTULO}>
              Números de série (NS) — um por linha{' '}
              <span className="rounded-full bg-amber-100 px-xs py-0.5 font-label-md text-amber-900">importante</span>
            </span>
            <textarea
              ref={serieRef}
              value={numerosSerie}
              onChange={(e) => setNumerosSerie(e.target.value)}
              rows={5}
              autoFocus
              placeholder={'Ex.:\nSN123456\nSN123457'}
              className={`${CAMPO} resize-y font-mono`}
            />
          </label>
          <label className="block max-w-[12rem]">
            <span className={ROTULO}>Volumes (pacotes)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={volumes}
              onChange={(e) => setVolumes(e.target.value)}
              className={CAMPO}
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
              onClick={salvar}
              disabled={salvando}
              className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : jaConcluida ? 'Atualizar' : 'Salvar'}
            </button>
          </div>
        </div>
      </Modal>
      {/* Irmão do Modal (não filho): fica no topo da pilha e o Esc fecha só o aviso. */}
      {semSerie && (
        <AvisoSerieModal
          titulo="Você não informou nenhum NS"
          rotuloPrincipal="Voltar e informar o NS"
          onPrincipal={() => {
            setSemSerie(false)
            setTimeout(() => serieRef.current?.focus(), 0)
          }}
          rotuloSecundario="Salvar mesmo assim"
          onSecundario={() => {
            setSemSerie(false)
            void gravar(Number(volumes))
          }}
        >
          <p>
            O número de série vai junto com a nota e é a garantia do equipamento. Sem ele, o faturamento e o cliente ficam sem
            esse registro.
          </p>
          <p>Confirme só se este pedido realmente não tem equipamento com NS.</p>
        </AvisoSerieModal>
      )}
    </>
  )
}
