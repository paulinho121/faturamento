import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { KpiCard } from '../kpi/KpiCard'
import type { Invoice } from '../../types/domain'

interface ExtratoVendedorModalProps {
  vendedorId: string
  vendedorNome: string
  dataInicio: string
  dataFim: string
  onClose: () => void
}

export function ExtratoVendedorModal({
  vendedorId,
  vendedorNome,
  dataInicio,
  dataFim,
  onClose,
}: ExtratoVendedorModalProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchInvoices() {
      setLoading(true)
      const { data, error } = await supabase
        .from('invoices')
        .select('*, filiais!filial_id(nome)')
        .eq('vendedor_id', vendedorId)
        .gte('data_emissao', dataInicio)
        .lte('data_emissao', dataFim)
        .eq('afeta_faturamento', true)
        .eq('excluida', false)
        .neq('tipo_operacao', 'Cancelada')
        .order('data_emissao', { ascending: false })

      if (!error && data) {
        // Filtramos em JS as transferências porque o Supabase/PostgREST não tem ilike
        // fácil para dois campos diferentes em uma mesma querystring sem usar views/RPC
        const filtrado = (data as Invoice[]).filter(
          (inv) =>
            !inv.tipo_operacao.toUpperCase().includes('TRANSFERÊNCIA') &&
            !inv.tipo_operacao.toUpperCase().includes('TRANSFERENCIA')
        )
        setInvoices(filtrado)
      }
      setLoading(false)
    }
    fetchInvoices()
  }, [vendedorId, dataInicio, dataFim])

  const faturamento = invoices.reduce((acc, inv) => acc + Number(inv.valor), 0)
  const vendas = invoices.length
  const ticketMedio = vendas > 0 ? faturamento / vendas : 0

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="p-lg">
        <div className="mb-lg flex items-start justify-between">
          <div className="flex items-center gap-sm">
            <span className="text-[32px]">🏅</span>
            <div>
              <h2 className="font-title-lg text-title-lg text-on-surface">{vendedorNome}</h2>
              <p className="font-label-md text-label-md text-on-surface-variant">Extrato de vendas no período</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-3">
          <KpiCard label="Faturamento" value={formatCurrency(faturamento)} icon="payments" loading={loading} />
          <KpiCard label="Vendas" value={String(vendas)} icon="receipt_long" loading={loading} />
          <KpiCard label="Ticket Médio" value={formatCurrency(ticketMedio)} icon="sell" loading={loading} />
        </div>

        <div className="rounded-lg border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead className="bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
                <tr>
                  <th className="px-md py-sm font-medium">NF</th>
                  <th className="px-md py-sm font-medium">Cliente</th>
                  <th className="px-md py-sm font-medium">Filial</th>
                  <th className="px-md py-sm font-medium">Data</th>
                  <th className="px-md py-sm font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-md">
                      <div className="space-y-sm">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-xl text-center text-on-surface-variant">
                      Nenhuma venda registrada no período.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-container-lowest/50 transition-colors">
                      <td className="px-md py-sm font-medium text-primary">#{inv.numero_nf}</td>
                      <td className="px-md py-sm text-on-surface max-w-[200px] truncate" title={inv.cliente}>
                        {inv.cliente}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant max-w-[150px] truncate" title={inv.filiais?.nome}>
                        {inv.filiais?.nome}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                        {inv.data_emissao.split('-').reverse().join('/')}
                      </td>
                      <td className="px-md py-sm text-right font-tabular-nums font-semibold text-on-surface whitespace-nowrap">
                        {formatCurrency(inv.valor)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}
