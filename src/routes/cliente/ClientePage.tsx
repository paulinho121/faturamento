import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { MonthTabs } from '../../components/filters/MonthTabs'
import { NfeMirrorModal } from '../../components/invoices/NfeMirrorModal'
import { BuscarNotaCard } from '../../components/invoices/BuscarNotaCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate, isCanceladaTipo } from '../../lib/format'
import type { Boleto, Invoice } from '../../types/domain'

const NAV_ITEMS = [{ to: '/cliente', icon: 'folder_shared', label: 'Minhas Notas' }]

function SituacaoBadge({ boleto }: { boleto: Boleto }) {
  if (boleto.status === 'pago') {
    return <span className="rounded-full bg-tertiary/10 px-sm py-0.5 font-label-md text-label-md text-tertiary">Pago</span>
  }
  if (boleto.vencimento < new Date().toISOString().slice(0, 10)) {
    return <span className="rounded-full bg-error/10 px-sm py-0.5 font-label-md text-label-md text-error">Vencido</span>
  }
  return <span className="rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-700">Pendente</span>
}

export function ClientePage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [mes, setMes] = useState(now.getMonth() + 1)
  const [ano, setAno] = useState(now.getFullYear())
  const [feed, setFeed] = useState<Invoice[]>([])
  const [loadingFeed, setLoadingFeed] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

  const [boletos, setBoletos] = useState<Boleto[]>([])
  const [loadingBoletos, setLoadingBoletos] = useState(true)

  async function loadFeed() {
    setLoadingFeed(true)
    const start = `${ano}-${String(mes).padStart(2, '0')}-01`
    const end = new Date(ano, mes, 0).toISOString().slice(0, 10)
    // RLS (cliente_select_own) já restringe isso às notas do próprio cliente.
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome)')
      .gte('data_emissao', start)
      .lte('data_emissao', end)
      .eq('excluida', false)
      .order('data_emissao', { ascending: false })
    if (!error) setFeed((data as Invoice[]) ?? [])
    setLoadingFeed(false)
  }

  async function loadBoletos() {
    setLoadingBoletos(true)
    const { data, error } = await supabase
      .from('boletos')
      .select('*, invoices(numero_nf, cliente)')
      .order('vencimento')
    if (!error) setBoletos((data as Boleto[]) ?? [])
    setLoadingBoletos(false)
  }

  useEffect(() => {
    loadFeed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  useEffect(() => {
    loadBoletos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDownloadBoleto(boleto: Boleto) {
    if (!boleto.arquivo_path) return
    const { data, error } = await supabase.storage.from('boletos').download(boleto.arquivo_path)
    if (error || !data) {
      push('error', `Erro ao baixar boleto: ${error?.message ?? 'arquivo não encontrado'}`)
      return
    }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = boleto.arquivo_nome ?? 'boleto.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const naoCanceladas = feed.filter((inv) => !isCanceladaTipo(inv.tipo_operacao))

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Cliente'}`}
      navItems={NAV_ITEMS}
      onRefresh={async () => {
        await Promise.all([loadFeed(), loadBoletos()])
      }}
    >
      <BuscarNotaCard onSelectInvoice={setSelectedInvoice} />

      {/* Boletos — independente do mês selecionado abaixo, ordenado pelo
          vencimento mais próximo primeiro. */}
      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Meus Boletos</h3>
        </div>
        {loadingBoletos ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : boletos.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="request_quote" title="Nenhum boleto disponível" />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {boletos.map((boleto) => (
              <div key={boleto.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                <div className="min-w-0">
                  <p className="font-body-md text-body-md text-on-surface">
                    NF #{boleto.invoices?.numero_nf} · Parcela {boleto.numero_parcela} · {formatCurrency(boleto.valor)}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    Vencimento {formatDate(boleto.vencimento)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-sm">
                  <SituacaoBadge boleto={boleto} />
                  {boleto.arquivo_path ? (
                    <button
                      type="button"
                      onClick={() => handleDownloadBoleto(boleto)}
                      className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Baixar
                    </button>
                  ) : (
                    <span className="font-label-md text-label-md text-on-surface-variant">PDF indisponível</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MonthTabs mes={mes} ano={ano} onChange={(m, a) => { setMes(m); setAno(a) }} />

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Minhas Notas</h3>
        </div>

        {loadingFeed ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : naoCanceladas.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="receipt_long" title="Nenhuma nota no período" />
          </div>
        ) : (
          <>
            {/* Desktop/tablet: tabela completa */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Valor</th>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {naoCanceladas.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      title="Ver espelho / baixar PDF"
                      className="cursor-pointer transition-colors hover:bg-surface-container-low"
                    >
                      <td className="whitespace-nowrap px-lg py-md font-tabular-nums font-medium text-primary">
                        #{inv.numero_nf}
                      </td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface-variant">{inv.filiais?.nome}</td>
                      <td className="whitespace-nowrap px-lg py-md font-tabular-nums font-semibold text-on-surface">
                        {formatCurrency(inv.valor)}
                      </td>
                      <td className="whitespace-nowrap px-lg py-md font-label-md text-label-md text-on-surface-variant">
                        {formatDate(inv.data_emissao)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cartões empilhados */}
            <div className="divide-y divide-outline-variant md:hidden">
              {naoCanceladas.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  className="cursor-pointer p-lg transition-colors hover:bg-surface-container-low"
                >
                  <div className="flex items-start justify-between gap-sm">
                    <span className="font-tabular-nums font-medium text-primary">#{inv.numero_nf}</span>
                    <span className="shrink-0 font-tabular-nums font-semibold text-on-surface">
                      {formatCurrency(inv.valor)}
                    </span>
                  </div>
                  <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                    {inv.filiais?.nome} · {formatDate(inv.data_emissao)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedInvoice && <NfeMirrorModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </AppShell>
  )
}
