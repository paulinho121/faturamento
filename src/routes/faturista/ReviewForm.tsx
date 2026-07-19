import { useState, type FormEvent, type ReactNode } from 'react'
import type { Filial, ModalidadePagamento, Vendedor } from '../../types/domain'
import { defaultAfetaFaturamento, formatCurrency } from '../../lib/format'

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
  valorDifal: number
  valorFcp: number
  afetaFaturamento: boolean
}

export function ReviewForm({
  draft,
  vendedores,
  filiais,
  tiposOperacao,
  meiosPagamento,
  filialAutoDetected,
  filialLocalDetectada,
  filialDestinoNome,
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
  filialLocalDetectada?: string
  filialDestinoNome?: string
  submitting: boolean
  onCancel: () => void
  onSubmit: (draft: InvoiceDraft) => void
}) {
  const [form, setForm] = useState<InvoiceDraft>(draft)

  function set<K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const isTransferencia = form.tipoOperacao?.toUpperCase().includes('TRANSFERÊNCIA') || form.tipoOperacao?.toUpperCase().includes('TRANSFERENCIA')
  const isExcluida = !form.afetaFaturamento
  const canSubmit = form.filialId && (form.vendedorId || isTransferencia || isExcluida) && form.tipoOperacao && (form.meioPagamento || isTransferencia || isExcluida) && form.cliente
  const temDifal = form.valorDifal > 0 || form.valorFcp > 0
  // Se algo que o XML deveria ter preenchido veio vazio (ex: CNPJ da filial
  // não reconhecido), abre "Conferir dados" automaticamente — senão o campo
  // obrigatório fica escondido e o botão de confirmar nunca habilita.
  const precisaAtencao = !draft.filialId || !draft.tipoOperacao

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    
    const submitForm = { ...form }
    if (isTransferencia) {
      if (!submitForm.vendedorId) submitForm.vendedorId = ''
      if (!submitForm.meioPagamento) submitForm.meioPagamento = 'N/A'
    }
    
    onSubmit(submitForm)
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

      {isTransferencia && filialDestinoNome && (
        <div className="flex items-start gap-sm rounded-lg border border-tertiary/30 bg-tertiary/10 p-md">
          <span className="material-symbols-outlined text-[20px] text-tertiary">swap_horiz</span>
          <div>
            <p className="font-label-md text-label-md font-medium text-tertiary">
              Transferência interna detectada — para {filialDestinoNome}
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Não conta como faturamento. Vendedor e forma de pagamento não são obrigatórios.
            </p>
          </div>
        </div>
      )}

      {/* Extraído automaticamente do XML — só o vendedor fica por sua conta */}
      <div className="flex flex-wrap gap-xs">
        <InfoBadge icon="store" label={filialAutoDetected ? 'Filial detectada' : 'Filial'}>
          {filiais.find((f) => f.id === form.filialId)?.nome ?? '—'}
          {filialLocalDetectada && ` · ${filialLocalDetectada}`}
        </InfoBadge>
        <InfoBadge icon="local_shipping" label="Frete">
          {formatCurrency(form.frete)}
        </InfoBadge>
        <InfoBadge icon="account_balance" label="DIFAL" warn={temDifal}>
          {temDifal ? formatCurrency(form.valorDifal + form.valorFcp) : 'Não houve'}
        </InfoBadge>
      </div>

      {!form.afetaFaturamento && (
        <div className="flex items-start gap-sm rounded-lg border border-tertiary/30 bg-tertiary/10 p-md">
          <span className="material-symbols-outlined text-[20px] text-tertiary">info</span>
          <div>
            <p className="font-label-md text-label-md font-medium text-tertiary">
              Esta nota não será contabilizada no faturamento
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Vendedor e forma de pagamento ficam opcionais. Exemplo: brinde, retorno de locação.
            </p>
          </div>
        </div>
      )}

      {/* Primary: o que o XML não sabe (vendedor) ou não dá pra confiar de olhos
          fechados (forma de pagamento real — Rede/Pagar.me não dá pra distinguir
          só pelo código da NF-e). Em transferências entre filiais, nenhum dos
          dois é obrigatório. */}
      <div className="rounded-lg bg-primary/5 p-md space-y-md">
        <Field label="Vendedor" required={!isTransferencia && form.afetaFaturamento}>
          <select
            value={form.vendedorId}
            onChange={(e) => set('vendedorId', e.target.value)}
            className={inputClass}
            required={!isTransferencia && form.afetaFaturamento}
            autoFocus
          >
            <option value="">{isTransferencia || isExcluida ? 'Selecione o vendedor… (opcional)' : 'Selecione o vendedor…'}</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-md">
          <Field label="Forma de Pagamento" required={!isTransferencia && form.afetaFaturamento}>
            <select
              value={form.meioPagamento}
              onChange={(e) => set('meioPagamento', e.target.value)}
              className={form.meioPagamento || isTransferencia || isExcluida ? inputClass : errorInputClass}
              required={!isTransferencia && form.afetaFaturamento}
            >
              <option value="">Selecione…</option>
              {meiosPagamento.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
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
        </div>

        {form.meioPagamento && (
          <p className="font-label-md text-label-md text-on-secondary-container">
            {form.meioPagamento}
            {form.parcelas > 1 ? `, ${form.parcelas}x` : ''}
          </p>
        )}
      </div>

      {/* Secondary: everything else, pre-filled from the XML, editable if needed */}
      <details className="group" open={precisaAtencao}>
        <summary className="cursor-pointer list-none font-label-md text-label-md text-on-surface-variant flex items-center gap-xs">
          <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-90">
            chevron_right
          </span>
          Conferir todos os dados da nota
          {precisaAtencao && (
            <span className="rounded-full bg-error/10 px-xs py-0.5 text-error">Preencha os campos em falta</span>
          )}
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
              className={form.filialId ? inputClass : errorInputClass}
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
              onChange={(e) => {
                const novoTipo = e.target.value
                setForm((f) => ({ ...f, tipoOperacao: novoTipo, afetaFaturamento: defaultAfetaFaturamento(novoTipo) }))
              }}
              className={form.tipoOperacao ? inputClass : errorInputClass}
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

          <Field label="Valor DIFAL">
            <input
              type="number"
              step="0.01"
              value={form.valorDifal}
              onChange={(e) => set('valorDifal', Number(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Valor FCP">
            <input
              type="number"
              step="0.01"
              value={form.valorFcp}
              onChange={(e) => set('valorFcp', Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>
      </details>

      <label className="flex items-center gap-sm cursor-pointer select-none rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm transition-colors hover:bg-surface-container-low">
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
          {form.afetaFaturamento ? 'check_box' : 'check_box_outline_blank'}
        </span>
        <span className="font-label-md text-label-md text-on-surface">
          Contar no faturamento
        </span>
        <input
          type="checkbox"
          checked={form.afetaFaturamento}
          onChange={(e) => set('afetaFaturamento', e.target.checked)}
          className="sr-only"
        />
      </label>

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

function InfoBadge({
  icon,
  label,
  warn,
  children,
}: {
  icon: string
  label: string
  warn?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-xs rounded-full border px-md py-xs font-label-md text-label-md ${
        warn ? 'border-tertiary/30 bg-tertiary/10 text-tertiary' : 'border-outline-variant bg-surface-container-low text-on-surface-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      <span className="text-on-surface-variant">{label}:</span>
      <span className="font-medium text-on-surface">{children}</span>
    </div>
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

const errorInputClass = inputClass.replace('border-outline-variant', 'border-error')
