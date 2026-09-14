import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDateTime, isCanceladaTipo } from '../../lib/format'
import type { Invoice } from '../../types/domain'

// Busca por número de NF OU nome do cliente, em qualquer mês — o feed/KPIs
// do dashboard e do vendedor sempre ficam presos ao mês selecionado, então
// uma nota de um mês diferente do que está aberto na tela simplesmente não
// aparece ali. Isso é só consulta (RLS já limita o que cada papel enxerga);
// cancelar nota é exclusivo do faturista, em Operações.
export function BuscarNotaCard({ onSelectInvoice }: { onSelectInvoice: (invoice: Invoice) => void }) {
  const { push } = useToast()
  const [termo, setTermo] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [resultados, setResultados] = useState<Invoice[]>([])

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    const valor = termo.trim()
    if (!valor) return
    setSearching(true)
    setSearched(true)
    setResultados([])

    // Duas buscas em paralelo — número exato da NF e nome do cliente (parcial,
    // sem diferenciar maiúsculas) — e junta o resultado, sem duplicar.
    const [porNumero, porCliente] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, filiais!filial_id(nome), vendedores(nome)')
        .eq('numero_nf', valor)
        .eq('excluida', false)
        .limit(5),
      supabase
        .from('invoices')
        .select('*, filiais!filial_id(nome), vendedores(nome)')
        .ilike('cliente', `%${valor}%`)
        .eq('excluida', false)
        .order('data_emissao', { ascending: false })
        .limit(20),
    ])

    setSearching(false)
    const error = porNumero.error ?? porCliente.error
    if (error) {
      push('error', `Erro ao buscar nota: ${error.message}`)
      return
    }

    const unicos = new Map<string, Invoice>()
    for (const inv of [...(porNumero.data ?? []), ...(porCliente.data ?? [])]) {
      unicos.set(inv.id, inv as Invoice)
    }
    setResultados(Array.from(unicos.values()))
  }

  return (
    <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
      <h3 className="mb-md font-title-md text-title-md text-on-surface">Buscar Nota</h3>
      <form onSubmit={handleSearch} className="flex gap-sm">
        <input
          type="text"
          placeholder="Número da NF ou nome do cliente…"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          className="flex-1 rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching || !termo.trim()}
          className="flex items-center gap-xs rounded bg-primary px-lg py-sm font-label-md text-label-md text-on-primary hover:bg-primary/90 disabled:opacity-50"
        >
          {searching ? (
            <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[20px]">search</span>
          )}
          Buscar
        </button>
      </form>

      {searched && !searching && resultados.length === 0 && (
        <p className="mt-md font-label-md text-label-md text-on-surface-variant">
          Nenhuma nota encontrada para "{termo}".
        </p>
      )}

      {resultados.length > 0 && (
        <div className="mt-md divide-y divide-outline-variant border-t border-outline-variant">
          {resultados.map((resultado) => (
            <button
              key={resultado.id}
              type="button"
              onClick={() => onSelectInvoice(resultado)}
              className="flex w-full items-center justify-between gap-sm py-sm text-left transition-opacity hover:opacity-80"
            >
              <div className="min-w-0">
                <p className={`font-body-md text-body-md ${isCanceladaTipo(resultado.tipo_operacao) ? 'text-on-surface-variant line-through' : 'text-primary'}`}>
                  #{resultado.numero_nf} · {resultado.cliente}
                  {isCanceladaTipo(resultado.tipo_operacao) && (
                    <span className="ml-xs rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error no-underline">
                      Cancelada
                    </span>
                  )}
                </p>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  {resultado.filiais?.nome} · {resultado.vendedores?.nome ?? '—'} · {formatDateTime(resultado.created_at)}
                </p>
              </div>
              <span className="shrink-0 font-tabular-nums font-semibold text-on-surface">
                {formatCurrency(resultado.valor)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
