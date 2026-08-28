import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, tipoBadgeClass } from '../../lib/format'
import { downloadCsv, invoicesToCsv } from '../../lib/csv'
import { KpiCard } from '../kpi/KpiCard'
import { useLookups } from '../../hooks/useLookups'
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
  dataInicio: dataInicioInicial,
  dataFim: dataFimInicial,
  onClose,
}: ExtratoVendedorModalProps) {
  const { filiais, tiposOperacao } = useLookups()
  // Abre com o mesmo período do painel de Comissões, mas o diretor pode
  // ajustar aqui dentro sem afetar o filtro lá fora.
  const [dataInicio, setDataInicio] = useState(dataInicioInicial)
  const [dataFim, setDataFim] = useState(dataFimInicial)
  const [filialId, setFilialId] = useState('')
  const [tipoOperacao, setTipoOperacao] = useState('')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchInvoices() {
      if (!dataInicio || !dataFim) return
      setLoading(true)
      let query = supabase
        .from('invoices')
        .select('*, filiais!filial_id(nome)')
        .eq('vendedor_id', vendedorId)
        .gte('data_emissao', dataInicio)
        .lte('data_emissao', dataFim)
        .eq('afeta_faturamento', true)
        .eq('excluida', false)
        .neq('tipo_operacao', 'Cancelada')
        .order('data_emissao', { ascending: true })

      if (filialId) query = query.eq('filial_id', filialId)
      if (tipoOperacao) query = query.eq('tipo_operacao', tipoOperacao)

      const { data, error } = await query

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
  }, [vendedorId, dataInicio, dataFim, filialId, tipoOperacao])

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
          <div className="flex shrink-0 items-center gap-xs">
            <button
              onClick={() => {
                if (invoices.length === 0) return
                downloadCsv(`extrato-${vendedorNome}-${dataInicio}-a-${dataFim}.csv`, invoicesToCsv(invoices))
              }}
              disabled={invoices.length === 0}
              title="Baixar Excel (.csv)"
              className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Baixar Excel
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="mb-lg flex flex-wrap items-end gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">De</span>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Até</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block flex-1 min-w-[10rem]">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Filial</span>
            <select
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
              className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            >
              <option value="">Todas as filiais</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 min-w-[10rem]">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Tipo de Operação</span>
            <select
              value={tipoOperacao}
              onChange={(e) => setTipoOperacao(e.target.value)}
              className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            >
              <option value="">Todos os tipos</option>
              {tiposOperacao.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
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
                  <th className="whitespace-nowrap px-md py-sm font-medium">Tipo de Operação</th>
                  <th className="px-md py-sm font-medium">Data</th>
                  <th className="px-md py-sm font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-md">
                      <div className="space-y-sm">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-xl text-center text-on-surface-variant">
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
                      <td className="whitespace-nowrap px-md py-sm">
                        <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${tipoBadgeClass(inv.tipo_operacao)}`}>
                          {inv.tipo_operacao}
                        </span>
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
