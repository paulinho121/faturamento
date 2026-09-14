import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import type { Invoice, Vendedor } from '../../types/domain'

// Troca de vendedor direto na linha do feed, sem precisar abrir o espelho da
// nota — clique no nome (ou "—") abre um select; confirmar salva na hora.
export function VendedorInlineEdit({
  invoice,
  vendedores,
  onSaved,
}: {
  invoice: Invoice
  vendedores: Vendedor[]
  onSaved: () => void
}) {
  const { push } = useToast()
  const [editing, setEditing] = useState(false)
  const [vendedorId, setVendedorId] = useState(invoice.vendedor_id ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('invoices')
      .update({ vendedor_id: vendedorId || null })
      .eq('id', invoice.id)
    setSaving(false)
    if (error) {
      push('error', `Erro ao salvar vendedor: ${error.message}`)
      return
    }
    setEditing(false)
    push('success', 'Vendedor atualizado.')
    onSaved()
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-xs" onClick={(e) => e.stopPropagation()}>
        <select
          autoFocus
          value={vendedorId}
          onChange={(e) => setVendedorId(e.target.value)}
          disabled={saving}
          className="min-w-0 max-w-[9rem] rounded border border-outline-variant bg-surface-container-lowest px-xs py-0.5 font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
        >
          <option value="">— Sem vendedor —</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nome}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label="Salvar vendedor"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-tertiary hover:bg-tertiary/10 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">check</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setVendedorId(invoice.vendedor_id ?? '')
          }}
          disabled={saving}
          aria-label="Cancelar"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Clique para alterar o vendedor"
      className="group flex items-center gap-xs font-body-md text-body-md text-on-surface"
    >
      {invoice.vendedores?.nome ?? '—'}
      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/60 transition-colors group-hover:text-primary">
        edit
      </span>
    </button>
  )
}
