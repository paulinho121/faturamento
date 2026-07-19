import { useState } from 'react'
import type { Invoice, Vendedor } from '../../types/domain'

export function EditInvoiceModal({
  invoice,
  tiposOperacao,
  meiosPagamento,
  vendedores,
  onClose,
  onSave,
}: {
  invoice: Invoice
  tiposOperacao: string[]
  meiosPagamento: string[]
  vendedores: Vendedor[]
  onClose: () => void
  onSave: (
    id: string,
    tipoOperacao: string,
    meioPagamento: string,
    afetaFaturamento: boolean,
    vendedorId: string | null
  ) => Promise<void>
}) {
  const [tipo, setTipo] = useState(invoice.tipo_operacao)
  const [meio, setMeio] = useState(invoice.meio_pagamento)
  const [afetaFaturamento, setAfetaFaturamento] = useState(invoice.afeta_faturamento)
  const [vendedorId, setVendedorId] = useState(invoice.vendedor_id ?? '')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await onSave(invoice.id, tipo, meio, afetaFaturamento, vendedorId || null)
    setSubmitting(false)
  }

  return (
    <div className="p-lg">
      <div className="mb-lg border-b border-outline-variant pb-md">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Editar Lançamento</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
          NF #{invoice.numero_nf} · {invoice.cliente}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-lg">
        <div>
          <label className="mb-xs block font-label-md text-label-md text-on-surface">
            Tipo da Operação
          </label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          >
            <option value="">Selecione...</option>
            {tiposOperacao.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-xs block font-label-md text-label-md text-on-surface">
            Forma de Pagamento
          </label>
          <select
            value={meio}
            onChange={(e) => setMeio(e.target.value)}
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          >
            <option value="">Selecione...</option>
            {meiosPagamento.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-xs block font-label-md text-label-md text-on-surface">
            Vendedor
          </label>
          <select
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">— Sem vendedor —</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-sm cursor-pointer select-none rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm transition-colors hover:bg-surface-container-low">
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
            {afetaFaturamento ? 'check_box' : 'check_box_outline_blank'}
          </span>
          <span className="font-label-md text-label-md text-on-surface">
            Contar no faturamento
          </span>
          <input
            type="checkbox"
            checked={afetaFaturamento}
            onChange={(e) => setAfetaFaturamento(e.target.checked)}
            className="sr-only"
          />
        </label>

        <div className="flex justify-end gap-sm pt-md">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary shadow-level1 transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
