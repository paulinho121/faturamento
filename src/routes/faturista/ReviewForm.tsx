import { useState, type FormEvent, type ReactNode } from 'react'
import type { Filial, ModalidadePagamento, Vendedor } from '../../types/domain'
import { formatCurrency } from '../../lib/format'

export interface InvoiceDraft {
  filialId: string
  estado: string
  numeroNf: string
  dataEmissao: string
  tipoOperacao: string
  modalidadePagamento: ModalidadePagamento
  meioPagamento: string
  parcelas: number
  cliente: string
  valor: number
  vendedorId: string
  valorTransferencia: number
  valorAFaturar: number
  frete: number
}

export function ReviewForm({
  draft,
  vendedores,
  filiais,
  tiposOperacao,
  meiosPagamento,
  filialAutoDetected,
  submitting,
  onCancel,
  onSubmit,
}: {
  draft: InvoiceDraft
  vendedores: Vendedor[]
  filiais: Filial[]
  tiposOperacao: string[]
  meiosPagamento: string[]
  filialAutoDetected: boolean
  submitting: boolean
  onCancel: () => void
  onSubmit: (draft: InvoiceDraft) => void
}) {
  const [form, setForm] = useState<InvoiceDraft>(draft)

  function set<K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const canSubmit = form.filialId && form.vendedorId && form.tipoOperacao && form.meioPagamento && form.cliente

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="p-lg space-y-lg">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">Novo lançamento</h3>
          <p className="font-label-md text-label-md text-on-secondary-container">
            NF #{form.numeroNf} · {form.cliente} · {formatCurrency(form.valor || 0)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
          aria-label="Fechar"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Primary: the two things the faturista must actually decide */}
      <div className="rounded-lg bg-primary/5 p-md space-y-md">
        <Field label="Vendedor" required>
          <select
            value={form.vendedorId}
            onChange={(e) => set('vendedorId', e.target.value)}
            className={inputClass}
            required
            autoFocus
          >
            <option value="">Selecione o vendedor…</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Forma de Pagamento" required>
          <select
            value={form.meioPagamento}
            onChange={(e) => set('meioPagamento', e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Selecione a forma de pagamento…</option>
            {meiosPagamento.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Secondary: everything else, pre-filled from the XML, editable if needed */}
      <details className="group" open>
        <summary className="cursor-pointer list-none font-label-md text-label-md text-on-surface-variant flex items-center gap-xs">
          <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-90">
            chevron_right
          </span>
          Conferir dados da nota
        </summary>

        <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-2">
          <Field
            label="Filial"
            required
            hint={filialAutoDetected ? 'detectada pelo CNPJ da nota' : undefined}
          >
            <select
              value={form.filialId}
              onChange={(e) => set('filialId', e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Selecione…</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tipo de Operação" required>
            <select
              value={form.tipoOperacao}
              onChange={(e) => set('tipoOperacao', e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Selecione…</option>
              {tiposOperacao.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Estado (UF do cliente)">
            <input
              value={form.estado}
              maxLength={2}
              onChange={(e) => set('estado', e.target.value.toUpperCase())}
              className={inputClass}
            />
          </Field>

          <Field label="Data Emissão">
            <input
              type="date"
              value={form.dataEmissao}
              onChange={(e) => set('dataEmissao', e.target.value)}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Cliente" required>
            <input
              value={form.cliente}
              onChange={(e) => set('cliente', e.target.value)}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Modalidade de Pagamento">
            <select
              value={form.modalidadePagamento}
              onChange={(e) => set('modalidadePagamento', e.target.value as ModalidadePagamento)}
              className={inputClass}
            >
              <option value="Simples">Simples</option>
              <option value="Misto">Misto</option>
            </select>
          </Field>

          <Field label="Parcelas">
            <input
              type="number"
              min={1}
              value={form.parcelas}
              onChange={(e) => set('parcelas', Number(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Valor">
            <input
              type="number"
              step="0.01"
              value={form.valor}
              onChange={(e) => set('valor', Number(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Valor a Faturar">
            <input
              type="number"
              step="0.01"
              value={form.valorAFaturar}
              onChange={(e) => set('valorAFaturar', Number(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Valor / Transferência">
            <input
              type="number"
              step="0.01"
              value={form.valorTransferencia}
              onChange={(e) => set('valorTransferencia', Number(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Frete">
            <input
              type="number"
              step="0.01"
              value={form.frete}
              onChange={(e) => set('frete', Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>
      </details>

      <div className="flex items-center justify-end gap-sm border-t border-outline-variant pt-md">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Salvando…' : 'Confirmar lançamento'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
        {hint && <span className="text-tertiary"> · {hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors'
