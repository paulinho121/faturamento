import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'
import type { Filial } from '../../types/domain'

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function MetaDialog({
  filiais,
  initialMes,
  initialAno,
  onClose,
  onSaved,
}: {
  filiais: Filial[]
  initialMes: number
  initialAno: number
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [mes, setMes] = useState(initialMes)
  const [ano, setAno] = useState(initialAno)
  const [filialId, setFilialId] = useState<string>('') // '' = todas as filiais (meta global)
  const [valorTexto, setValorTexto] = useState('')
  const [saving, setSaving] = useState(false)

  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 1 + i)
  const valor = Number(valorTexto.replace(/\./g, '').replace(',', '.')) || 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (valor <= 0) {
      push('error', 'Informe um valor de meta maior que zero.')
      return
    }
    setSaving(true)

    const filial = filialId || null

    // Sem confiar em upsert (o unique não cobre filial_id NULL): procuro a meta
    // existente para esse período/filial e faço update; senão, insert.
    let existingQuery = supabase.from('metas').select('id').eq('mes', mes).eq('ano', ano)
    existingQuery = filial ? existingQuery.eq('filial_id', filial) : existingQuery.is('filial_id', null)
    const { data: existing } = await existingQuery.maybeSingle()

    const { error } = existing
      ? await supabase.from('metas').update({ valor_meta: valor }).eq('id', existing.id)
      : await supabase.from('metas').insert({ filial_id: filial, mes, ano, valor_meta: valor })

    setSaving(false)

    if (error) {
      push('error', `Não foi possível salvar a meta: ${error.message}`)
      return
    }
    push('success', `Meta de ${MESES[mes - 1]}/${ano} definida em ${formatCurrency(valor)}.`)
    onSaved()
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-lg space-y-lg">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Definir meta de faturamento</h3>
            <p className="font-label-md text-label-md text-on-secondary-container">
              Defina o objetivo do mês e acompanhe o progresso em tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-md">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Mês</span>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className={inputClass}>
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Ano</span>
            <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className={inputClass}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Filial</span>
          <select value={filialId} onChange={(e) => setFilialId(e.target.value)} className={inputClass}>
            <option value="">Todas as filiais (meta global)</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Valor da meta (R$)</span>
          <input
            inputMode="decimal"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            placeholder="Ex.: 500.000,00"
            className={inputClass}
            autoFocus
          />
          {valor > 0 && (
            <span className="mt-xs block font-label-md text-label-md text-tertiary">{formatCurrency(valor)}</span>
          )}
        </label>

        <div className="flex items-center justify-end gap-sm border-t border-outline-variant pt-md">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || valor <= 0}
            className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar meta'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors'
