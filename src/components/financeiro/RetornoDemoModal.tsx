import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { useAuth } from '../../auth/AuthContext'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

// Financeiro informa o número da NF de retorno quando a demonstração volta.
export function RetornoDemoModal({
  invoiceId,
  numeroNf,
  cliente,
  onClose,
  onDone,
}: {
  invoiceId: string
  numeroNf: string
  cliente: string
  onClose: () => void
  onDone: () => void
}) {
  const { push } = useToast()
  const { session } = useAuth()
  const [nfRetorno, setNfRetorno] = useState('')
  const [dataRetorno, setDataRetorno] = useState(hoje())
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function handleSalvar() {
    const nf = nfRetorno.trim()
    if (!nf) {
      push('error', 'Informe o número da NF de retorno.')
      return
    }
    if (!dataRetorno) {
      push('error', 'Informe a data do retorno.')
      return
    }
    setSalvando(true)
    const { error } = await supabase.from('demo_retornos').insert({
      invoice_id: invoiceId,
      numero_nf_retorno: nf,
      data_retorno: dataRetorno,
      observacao: observacao.trim() || null,
      registrado_por: session?.user.id ?? null,
    })
    setSalvando(false)
    if (error) {
      push(
        'error',
        error.code === '23505' ? 'O retorno dessa demo já foi registrado.' : `Erro ao registrar o retorno: ${error.message}`
      )
      return
    }
    push('success', 'Retorno da demo registrado.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">Registrar retorno da demo</h3>
          <p className="font-body-md text-body-md text-on-surface-variant">
            NF #{numeroNf} · {cliente}
          </p>
        </div>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Número da NF de retorno</span>
          <input
            type="text"
            inputMode="numeric"
            value={nfRetorno}
            onChange={(e) => setNfRetorno(e.target.value)}
            autoFocus
            placeholder="Ex.: 563120"
            className="w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Data do retorno</span>
          <input
            type="date"
            value={dataRetorno}
            onChange={(e) => setDataRetorno(e.target.value)}
            className="w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Observação (opcional)</span>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder="Ex.: voltou sem a fonte, retorno parcial…"
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
            {salvando ? 'Salvando…' : 'Registrar retorno'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
