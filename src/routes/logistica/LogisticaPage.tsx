import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { MonthTabs } from '../../components/filters/MonthTabs'
import { NfeMirrorModal } from '../../components/invoices/NfeMirrorModal'
import { BuscarNotaCard } from '../../components/invoices/BuscarNotaCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Invoice } from '../../types/domain'

const NAV_ITEMS = [{ to: '/logistica', icon: 'local_shipping', label: 'Transferências' }]

function TransportadoraBadge({ nome }: { nome: string | null }) {
  if (!nome) {
    return <span className="font-label-md text-label-md text-on-surface-variant">— não definida —</span>
  }
  return (
    <span className="inline-flex items-center gap-xs rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary">
      <span className="material-symbols-outlined text-[14px]">local_shipping</span>
      {nome}
    </span>
  )
}

export function LogisticaPage() {
  const { profile } = useAuth()
  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [mes, setMes] = useState(now.getMonth() + 1)
  const [ano, setAno] = useState(now.getFullYear())
  const [feed, setFeed] = useState<Invoice[]>([])
  const [loadingFeed, setLoadingFeed] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

  async function loadFeed() {
    setLoadingFeed(true)
    const start = `${ano}-${String(mes).padStart(2, '0')}-01`
    const end = new Date(ano, mes, 0).toISOString().slice(0, 10)
    // RLS (logistica_select_transferencias) já restringe isso só às notas
    // de Transferência — não precisa repetir o filtro de tipo_operacao aqui.
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome), filial_destino:filiais!filial_destino_id(nome)')
      .gte('data_emissao', start)
      .lte('data_emissao', end)
      .eq('excluida', false)
      .order('data_emissao', { ascending: false })
      .order('created_at', { ascending: false })
    if (!error) setFeed((data as Invoice[]) ?? [])
    setLoadingFeed(false)
  }

  useEffect(() => {
    loadFeed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  const searchNorm = search.trim().toLowerCase()
  const filteredFeed = searchNorm
    ? feed.filter(
        (inv) =>
          inv.numero_nf.toLowerCase().includes(searchNorm) || inv.cliente.toLowerCase().includes(searchNorm)
      )
    : feed

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Logística'}`}
      navItems={NAV_ITEMS}
      onRefresh={loadFeed}
    >
      <MonthTabs mes={mes} ano={ano} onChange={(m, a) => { setMes(m); setAno(a) }} />

      {/* Busca independente do mês selecionado — uma transferência de outro
          mês não aparece na lista abaixo (ela é sempre filtrada pelo mês). */}
      <BuscarNotaCard onSelectInvoice={setSelectedInvoice} />

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex flex-wrap items-center justify-between gap-md">
          <h3 className="font-title-md text-title-md text-on-surface">Transferências do Mês</h3>
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por NF ou destino…"
              className="w-48 rounded-full border border-outline-variant bg-surface-container-lowest py-xs pl-xl pr-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none sm:w-64"
            />
          </div>
        </div>

        {loadingFeed ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filteredFeed.length === 0 ? (
          <div className="p-lg">
            <EmptyState
              icon="local_shipping"
              title={searchNorm ? `Nenhuma transferência encontrada para "${search}"` : 'Nenhuma transferência no período'}
            />
          </div>
        ) : (
          <>
            {/* Desktop/tablet: tabela completa */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Destino</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial Origem</th>
                    <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial Destino</th>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Transportadora</th>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Valor</th>
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filteredFeed.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      title="Ver espelho da nota"
                      className="cursor-pointer transition-colors hover:bg-surface-container-low"
                    >
                      <td className="whitespace-nowrap px-lg py-md font-tabular-nums font-medium text-primary">
                        #{inv.numero_nf}
                      </td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface">{inv.cliente}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface-variant">{inv.filiais?.nome}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface-variant">
                        {inv.filial_destino?.nome ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-lg py-md">
                        <TransportadoraBadge nome={inv.transportadora} />
                      </td>
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
              {filteredFeed.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  className="cursor-pointer p-lg transition-colors hover:bg-surface-container-low"
                >
                  <div className="flex items-start justify-between gap-sm">
                    <div className="min-w-0">
                      <span className="font-tabular-nums font-medium text-primary">#{inv.numero_nf}</span>
                      <p className="font-body-md text-body-md text-on-surface">{inv.cliente}</p>
                    </div>
                    <span className="shrink-0 font-tabular-nums font-semibold text-on-surface">
                      {formatCurrency(inv.valor)}
                    </span>
                  </div>
                  <div className="mt-sm flex flex-wrap items-center gap-x-sm gap-y-xs">
                    <TransportadoraBadge nome={inv.transportadora} />
                    <span className="font-label-md text-label-md text-on-surface-variant">{formatDate(inv.data_emissao)}</span>
                  </div>
                  <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                    {inv.filiais?.nome} → {inv.filial_destino?.nome ?? '—'}
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
