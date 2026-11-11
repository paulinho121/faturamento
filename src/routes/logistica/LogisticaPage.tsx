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
import { formatCurrency, formatDate } from '../../lib/format'
import type { Invoice } from '../../types/domain'
import { logisticaNavItems } from './nav'


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

function FinalizadaBadge({ em }: { em: string | null | undefined }) {
  if (!em) {
    return (
      <span className="inline-flex items-center gap-xs whitespace-nowrap rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-800">
        <span className="material-symbols-outlined text-[14px]">pending</span>
        Em andamento
      </span>
    )
  }
  return (
    <span
      title={`Finalizada em ${formatDate(em.slice(0, 10))}`}
      className="inline-flex items-center gap-xs whitespace-nowrap rounded-full bg-tertiary/10 px-sm py-0.5 font-label-md text-label-md text-tertiary"
    >
      <span className="material-symbols-outlined text-[14px]">task_alt</span>
      Finalizada {formatDate(em.slice(0, 10))}
    </span>
  )
}

function BotaoFinalizar({ inv, salvando, onClick }: { inv: Invoice; salvando: boolean; onClick: () => void }) {
  const finalizada = !!inv.transferencia_finalizada_em
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={salvando}
      className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors disabled:opacity-50 ${
        finalizada
          ? 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
          : 'bg-primary text-on-primary hover:opacity-90'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{finalizada ? 'undo' : 'check'}</span>
      {salvando ? 'Salvando…' : finalizada ? 'Reabrir' : 'Marcar finalizada'}
    </button>
  )
}

export function LogisticaPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [mes, setMes] = useState(now.getMonth() + 1)
  const [ano, setAno] = useState(now.getFullYear())
  const [feed, setFeed] = useState<Invoice[]>([])
  const [loadingFeed, setLoadingFeed] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [situacao, setSituacao] = useState<'todas' | 'andamento' | 'finalizadas'>('todas')
  const [salvandoId, setSalvandoId] = useState<string | null>(null)

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

  async function alternarFinalizada(inv: Invoice) {
    const finalizar = !inv.transferencia_finalizada_em
    setSalvandoId(inv.id)
    const { error } = await supabase.rpc('transferencia_finalizar', { p_invoice_id: inv.id, p_finalizada: finalizar })
    setSalvandoId(null)
    if (error) {
      push('error', `Erro ao atualizar a transferência: ${error.message}`)
      return
    }
    push(
      'success',
      finalizar ? `Transferência #${inv.numero_nf} marcada como finalizada.` : `Transferência #${inv.numero_nf} reaberta.`
    )
    loadFeed()
  }

  useEffect(() => {
    loadFeed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  const searchNorm = search.trim().toLowerCase()
  const doMes = searchNorm
    ? feed.filter(
        (inv) =>
          inv.numero_nf.toLowerCase().includes(searchNorm) || inv.cliente.toLowerCase().includes(searchNorm)
      )
    : feed
  const qtdAndamento = doMes.filter((inv) => !inv.transferencia_finalizada_em).length
  const qtdFinalizadas = doMes.length - qtdAndamento
  const filteredFeed =
    situacao === 'andamento'
      ? doMes.filter((inv) => !inv.transferencia_finalizada_em)
      : situacao === 'finalizadas'
        ? doMes.filter((inv) => inv.transferencia_finalizada_em)
        : doMes

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Logística'}`}
      navItems={logisticaNavItems()}
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

        <div className="flex flex-wrap gap-xs border-b border-outline-variant p-md">
          {(
            [
              ['todas', `Todas (${doMes.length})`],
              ['andamento', `Em andamento (${qtdAndamento})`],
              ['finalizadas', `Finalizadas (${qtdFinalizadas})`],
            ] as const
          ).map(([chave, label]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setSituacao(chave)}
              className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                situacao === chave ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
            </button>
          ))}
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
                    <th className="whitespace-nowrap px-lg py-sm font-label-md text-label-md text-on-surface-variant">Situação</th>
                    <th className="px-lg py-sm" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filteredFeed.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      title="Ver espelho da nota"
                      className={`cursor-pointer transition-colors hover:bg-surface-container-low ${
                        inv.transferencia_finalizada_em ? 'opacity-70' : ''
                      }`}
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
                      <td className="whitespace-nowrap px-lg py-md">
                        <FinalizadaBadge em={inv.transferencia_finalizada_em} />
                      </td>
                      <td className="whitespace-nowrap px-lg py-md text-right" onClick={(e) => e.stopPropagation()}>
                        <BotaoFinalizar inv={inv} salvando={salvandoId === inv.id} onClick={() => alternarFinalizada(inv)} />
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
                  className={`cursor-pointer p-lg transition-colors hover:bg-surface-container-low ${
                    inv.transferencia_finalizada_em ? 'opacity-70' : ''
                  }`}
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
                  <div className="mt-sm flex flex-wrap items-center justify-between gap-sm" onClick={(e) => e.stopPropagation()}>
                    <FinalizadaBadge em={inv.transferencia_finalizada_em} />
                    <BotaoFinalizar inv={inv} salvando={salvandoId === inv.id} onClick={() => alternarFinalizada(inv)} />
                  </div>
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
