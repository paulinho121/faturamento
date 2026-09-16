import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'

// Troca a forma de pagamento direto na linha — útil quando o cliente combina
// de pagar diferente do que foi lançado (ex.: ia pagar Boleto e mudou pra
// PIX/Cartão), o que senão deixaria a pendência presa no tipo errado pra
// sempre.
export function MeioPagamentoInlineEdit({
  invoiceId,
  meioPagamento,
  meiosPagamento,
  onSaved,
}: {
  invoiceId: string
  meioPagamento: string
  meiosPagamento: string[]
  onSaved: () => void
}) {
  const { push } = useToast()
  const [editing, setEditing] = useState(false)
  const [valor, setValor] = useState(meioPagamento)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!valor || valor === meioPagamento) {
      setEditing(false)
      return
    }
    setSaving(true)
    const { error } = await supabase.from('invoices').update({ meio_pagamento: valor }).eq('id', invoiceId)
    setSaving(false)
    if (error) {
      push('error', `Erro ao salvar forma de pagamento: ${error.message}`)
      return
    }
    setEditing(false)
    push('success', 'Forma de pagamento atualizada.')
    onSaved()
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-xs" onClick={(e) => e.stopPropagation()}>
        <select
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          disabled={saving}
          className="min-w-0 max-w-[9rem] rounded border border-outline-variant bg-surface-container-lowest px-xs py-0.5 font-label-md text-label-md text-on-surface focus:border-primary focus:outline-none"
        >
          {meiosPagamento.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label="Salvar forma de pagamento"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-tertiary hover:bg-tertiary/10 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">check</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setValor(meioPagamento)
          }}
          disabled={saving}
          aria-label="Cancelar"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Clique para corrigir a forma de pagamento"
      className="group inline-flex items-center gap-xs"
    >
      {meioPagamento}
      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/60 transition-colors group-hover:text-primary">
        edit
      </span>
    </button>
  )
}
