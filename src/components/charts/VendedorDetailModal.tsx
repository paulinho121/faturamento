import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Invoice } from '../../types/domain'
import type { RankingRow } from './VendedorRanking'

const MEDALS = ['🥇', '🥈', '🥉']

export function VendedorDetailModal({
  vendedor,
  rank,
  mes,
  ano,
  onClose,
  onSelectInvoice,
}: {
  vendedor: RankingRow
  rank: number
  mes: number | null
  ano: number | null
  onClose: () => void
  onSelectInvoice: (invoice: Invoice) => void
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      let query = supabase
        .from('invoices')
        .select('*, filiais!filial_id(nome), vendedores(nome)')
        .eq('vendedor_id', vendedor.vendedor_id)
        .eq('afeta_faturamento', true)
        .eq('excluida', false)
        .neq('tipo_operacao', 'Cancelada')
        .order('data_emissao', { ascending: false })
        .order('created_at', { ascending: false })

      if (ano) {
        if (mes) {
          const start = `${ano}-${String(mes).padStart(2, '0')}-01`
          const end = new Date(ano, mes, 0).toISOString().slice(0, 10)
          query = query.gte('data_emissao', start).lte('data_emissao', end)
        } else {
          query = query.gte('data_emissao', `${ano}-01-01`).lte('data_emissao', `${ano}-12-31`)
        }
      }

      const { data, error } = await query
      if (!cancelled) {
        if (!error) setInvoices((data as Invoice[]) ?? [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [vendedor.vendedor_id, mes, ano])

  const ticketMedio = vendedor.qtd_vendas > 0 ? vendedor.faturamento / vendedor.qtd_vendas : 0

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl">
      <div className="p-lg">
        <div className="mb-lg flex items-start justify-between gap-md">
          <div className="flex items-center gap-md">
            <span className="text-3xl">{MEDALS[rank] ?? '🎖️'}</span>
            <div>
              <h3 className="font-title-md text-title-md text-on-surface">{vendedor.vendedor_nome}</h3>
              <p className="font-label-md text-label-md text-on-secondary-container">Extrato de vendas no período</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mb-lg grid grid-cols-3 gap-md">
          <div className="rounded-lg bg-primary/5 p-md text-center">
            <span className="block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Faturamento
            </span>
            <span className="font-title-md text-title-md text-on-surface tabular-nums">
              {formatCurrency(vendedor.faturamento)}
            </span>
          </div>
          <div className="rounded-lg bg-primary/5 p-md text-center">
            <span className="block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Vendas
            </span>
            <span className="font-title-md text-title-md text-on-surface tabular-nums">{vendedor.qtd_vendas}</span>
          </div>
          <div className="rounded-lg bg-primary/5 p-md text-center">
            <span className="block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Ticket Médio
            </span>
            <span className="font-title-md text-title-md text-on-surface tabular-nums">
              {formatCurrency(ticketMedio)}
            </span>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-outline-variant">
          {loading ? (
            <div className="space-y-sm p-md">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-lg">
              <EmptyState icon="receipt_long" title="Sem notas no período" description="Não há lançamentos deste vendedor no período selecionado." />
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-surface-container-low">
                <tr>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Cliente</th>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Data</th>
                  <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => onSelectInvoice(inv)}
                    title="Ver espelho da nota"
                    className="cursor-pointer transition-colors hover:bg-surface-container-low"
                  >
                    <td className="px-md py-sm font-tabular-nums font-medium text-primary">#{inv.numero_nf}</td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface">{inv.cliente}</td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{inv.filiais?.nome}</td>
                    <td className="px-md py-sm font-label-md text-label-md text-on-surface-variant">{formatDate(inv.data_emissao)}</td>
                    <td className="px-md py-sm text-right font-tabular-nums font-semibold text-on-surface">
                      {formatCurrency(inv.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
