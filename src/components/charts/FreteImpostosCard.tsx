import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { formatCurrency, isCanceladaTipo } from '../../lib/format'
import type { Invoice } from '../../types/domain'

export function FreteImpostosCard({
  invoices,
  loading,
  onSelectInvoice,
}: {
  invoices: Invoice[]
  loading?: boolean
  onSelectInvoice: (invoice: Invoice) => void
}) {
  const validas = invoices.filter((i) => !isCanceladaTipo(i.tipo_operacao))

  const freteTotal = validas.reduce((acc, i) => acc + Number(i.frete), 0)
  const difalTotal = validas.reduce((acc, i) => acc + Number(i.valor_difal), 0)
  const fcpTotal = validas.reduce((acc, i) => acc + Number(i.valor_fcp), 0)
  const icmsTotal = validas.reduce((acc, i) => acc + Number(i.valor_icms), 0)
  const ipiTotal = validas.reduce((acc, i) => acc + Number(i.valor_ipi), 0)

  const encargoDe = (i: Invoice) =>
    Number(i.frete) + Number(i.valor_difal) + Number(i.valor_fcp) + Number(i.valor_icms) + Number(i.valor_ipi)
  const maioresEncargos = [...validas].filter((i) => encargoDe(i) > 0).sort((a, b) => encargoDe(b) - encargoDe(a)).slice(0, 8)

  const semDados = !loading && freteTotal === 0 && difalTotal === 0 && fcpTotal === 0 && icmsTotal === 0 && ipiTotal === 0

  return (
    <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <h3 className="mb-lg font-title-md text-title-md text-on-surface">Frete &amp; Impostos</h3>

      {loading ? (
        <div className="space-y-md">
          <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-5">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      ) : semDados ? (
        <EmptyState icon="local_shipping" title="Sem frete ou impostos no período" description="Assim que uma NF com frete ou DIFAL/FCP for lançada, os totais aparecem aqui." />
      ) : (
        <>
          <div className="mb-lg grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg bg-primary/5 p-md">
              <span className="flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                Frete Total
              </span>
              <span className="font-title-md text-title-md text-on-surface tabular-nums">{formatCurrency(freteTotal)}</span>
            </div>
            <div className="rounded-lg bg-primary/5 p-md">
              <span className="flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                DIFAL Total
              </span>
              <span className="font-title-md text-title-md text-on-surface tabular-nums">{formatCurrency(difalTotal)}</span>
            </div>
            <div className="rounded-lg bg-primary/5 p-md">
              <span className="flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                FCP Total
              </span>
              <span className="font-title-md text-title-md text-on-surface tabular-nums">{formatCurrency(fcpTotal)}</span>
            </div>
            <div className="rounded-lg bg-primary/5 p-md">
              <span className="flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                ICMS Total
              </span>
              <span className="font-title-md text-title-md text-on-surface tabular-nums">{formatCurrency(icmsTotal)}</span>
            </div>
            <div className="rounded-lg bg-primary/5 p-md">
              <span className="flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                IPI Total
              </span>
              <span className="font-title-md text-title-md text-on-surface tabular-nums">{formatCurrency(ipiTotal)}</span>
            </div>
          </div>

          {maioresEncargos.length > 0 && (
            <div>
              <h4 className="mb-sm font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
                Maiores frete + impostos no período
              </h4>
              <div className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
                {maioresEncargos.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => onSelectInvoice(inv)}
                    title="Ver espelho da nota"
                    className="flex w-full flex-wrap items-center justify-between gap-x-md gap-y-xs p-md text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="min-w-0">
                      <span className="font-tabular-nums font-medium text-primary">#{inv.numero_nf}</span>{' '}
                      <span className="font-body-md text-body-md text-on-surface">{inv.cliente}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-md gap-y-0.5 font-label-md text-label-md text-on-surface-variant">
                      {inv.frete > 0 && <span>Frete: {formatCurrency(inv.frete)}</span>}
                      {inv.valor_difal > 0 && <span>DIFAL: {formatCurrency(inv.valor_difal)}</span>}
                      {inv.valor_fcp > 0 && <span>FCP: {formatCurrency(inv.valor_fcp)}</span>}
                      {inv.valor_icms > 0 && <span>ICMS: {formatCurrency(inv.valor_icms)}</span>}
                      {inv.valor_ipi > 0 && <span>IPI: {formatCurrency(inv.valor_ipi)}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
