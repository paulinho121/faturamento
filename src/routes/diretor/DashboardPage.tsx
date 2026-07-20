import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { FilterBar } from '../../components/filters/FilterBar'
import { MonthTabs } from '../../components/filters/MonthTabs'
import { KpiCard } from '../../components/kpi/KpiCard'
import { HourlyBarChart } from '../../components/charts/HourlyBarChart'
import { VendedorRanking, type RankingRow } from '../../components/charts/VendedorRanking'
import { VendedorDetailModal } from '../../components/charts/VendedorDetailModal'
import { FilialDonut } from '../../components/charts/FilialDonut'
import { FreteImpostosCard } from '../../components/charts/FreteImpostosCard'
import { MetaCard } from '../../components/metas/MetaCard'
import { MetaDialog } from '../../components/metas/MetaDialog'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { NfeMirrorModal } from '../../components/invoices/NfeMirrorModal'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useLookups } from '../../hooks/useLookups'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate, isCanceladaTipo } from '../../lib/format'
import { downloadCsv, invoicesToCsv } from '../../lib/csv'
import { getDailyQuote } from '../../lib/philosopherQuotes'
import type { Invoice } from '../../types/domain'

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
]

const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function tipoBadgeClass(tipoOperacao: string): string {
  const upper = tipoOperacao?.toUpperCase() ?? ''
  if (upper === 'SAÍDA' || upper === 'SAIDA') return 'bg-primary/10 text-primary'
  if (upper === 'TRANSFERÊNCIA' || upper === 'TRANSFERENCIA') return 'bg-tertiary/10 text-tertiary'
  if (upper === 'LOCAÇÃO' || upper === 'LOCACAO') return 'bg-amber-100 text-amber-700'
  if (upper === 'CANCELADA') return 'bg-error/10 text-error'
  return 'bg-surface-container-high text-on-surface-variant'
}

export function DashboardPage() {
  const {
    filters,
    setFilters,
    kpis,
    transferenciasPorFilial,
    crescimentoPct,
    meta,
    ranking,
    participacao,
    hourly,
    feed,
    loading,
    dailyFaturamento,
    refetch,
  } = useDashboardData()
  const { vendedores, filiais, tiposOperacao, meiosPagamento } = useLookups()
  const { push } = useToast()

  const [pulse, setPulse] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showMetaDialog, setShowMetaDialog] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [selectedVendedor, setSelectedVendedor] = useState<{ row: RankingRow; rank: number } | null>(null)
  const [feedSearch, setFeedSearch] = useState('')
  const dailyQuote = getDailyQuote()
  const prevFeedIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    const currentIds = new Set(feed.map((i) => i.id))
    const previous = prevFeedIds.current
    if (previous) {
      const newest = feed.find((i) => !previous.has(i.id))
      if (newest) {
        setPulse(true)
        setHighlightId(newest.id)
        push('success', `Nova NF #${newest.numero_nf} · ${formatCurrency(newest.valor)}`)
        const t = setTimeout(() => {
          setPulse(false)
          setHighlightId(null)
        }, 2500)
        prevFeedIds.current = currentIds
        return () => clearTimeout(t)
      }
    }
    prevFeedIds.current = currentIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed])

  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  const mesSel = filters.mes ?? now.getMonth() + 1
  const anoSel = filters.ano ?? now.getFullYear()
  const hasActiveFilters = Boolean(
    filters.filialId ||
      filters.estado ||
      filters.tipoOperacao ||
      filters.vendedorId ||
      filters.meioPagamento ||
      filters.clienteSearch
  )

  const feedSearchNorm = feedSearch.trim().toLowerCase()
  const filteredFeed = feedSearchNorm
    ? feed.filter(
        (inv) =>
          inv.numero_nf.toLowerCase().includes(feedSearchNorm) ||
          inv.cliente.toLowerCase().includes(feedSearchNorm)
      )
    : feed

  return (
    <AppShell title={`${saudacao}, Diretor`} navItems={NAV_ITEMS}>
      {showMetaDialog && (
        <MetaDialog
          filiais={filiais}
          initialMes={filters.mes ?? now.getMonth() + 1}
          initialAno={filters.ano ?? now.getFullYear()}
          onClose={() => setShowMetaDialog(false)}
          onSaved={refetch}
        />
      )}

      {selectedInvoice && (
        <NfeMirrorModal
          invoice={selectedInvoice}
          vendedores={vendedores}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={refetch}
        />
      )}

      {selectedVendedor && (
        <VendedorDetailModal
          vendedor={selectedVendedor.row}
          rank={selectedVendedor.rank}
          mes={filters.mes}
          ano={filters.ano}
          onClose={() => setSelectedVendedor(null)}
          onSelectInvoice={setSelectedInvoice}
        />
      )}

      {/* Frase do dia (filósofos) — muda todo dia, uma linha só, sem tomar espaço útil. */}
      <p className="mb-md flex items-start gap-xs font-body-md text-body-md italic text-on-surface-variant">
        <span className="material-symbols-outlined shrink-0 text-[16px] not-italic text-outline">format_quote</span>
        <span>
          {dailyQuote.text} <span className="not-italic text-on-surface-variant/70">— {dailyQuote.author}</span>
        </span>
      </p>

      {/* Seletor de mês — coração do app: o CEO acompanha o faturamento mensal
          e troca de mês numa aba. Por padrão abre no mês corrente. */}
      <MonthTabs
        mes={mesSel}
        ano={anoSel}
        dia={filters.dia}
        dailyValues={dailyFaturamento}
        onChange={(mes, ano) => setFilters({ ...filters, mes, ano })}
        onDiaChange={(dia) => setFilters({ ...filters, dia })}
      />

      {/* Barra compacta: período + status ao vivo + filtros (ícone) */}
      <div className="mb-lg flex items-center justify-between gap-sm">
        <div className="flex flex-wrap items-baseline gap-x-xs gap-y-0">
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface md:font-headline-lg md:text-headline-lg">
            {filters.dia ? `${filters.dia} de ${MESES_LONGOS[mesSel - 1]}` : MESES_LONGOS[mesSel - 1]}
          </h2>
          <span className="font-title-md text-title-md text-on-surface-variant">{anoSel}</span>
          {filters.dia && (
            <button
              onClick={() => setFilters({ ...filters, dia: null })}
              className="ml-xs flex items-center gap-xs rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary transition-colors hover:bg-primary/20"
              title="Voltar a ver o mês inteiro"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
              só esse dia
            </button>
          )}
        </div>
        <div className="flex items-center gap-sm">
          <span
            className="flex items-center gap-xs rounded-full bg-tertiary/10 px-sm py-xs font-label-md text-label-md text-tertiary"
            title="Dados atualizados em tempo real"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tertiary opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-tertiary"></span>
            </span>
            <span className="hidden sm:inline">Ao vivo</span>
          </span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
              showFilters
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
            aria-label="Filtros avançados"
            title="Filtros avançados"
          >
            <span className="material-symbols-outlined text-[20px]">{showFilters ? 'close' : 'tune'}</span>
            {hasActiveFilters && !showFilters && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-lg bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant shadow-level2 animate-in fade-in slide-in-from-top-4 duration-300">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            filiais={filiais}
            vendedores={vendedores}
            tiposOperacao={tiposOperacao}
            meiosPagamento={meiosPagamento}
          />
        </div>
      )}

      <div className="mb-lg grid grid-cols-2 gap-md lg:grid-cols-4">
        <KpiCard label="Faturamento" value={formatCurrency(kpis.faturamento)} icon="payments" loading={loading}
          subValue={
            kpis.transferencias > 0 && (
              <div className="flex flex-wrap items-center gap-x-sm gap-y-0.5 font-label-md text-label-md text-on-surface-variant">
                <span className="flex items-center gap-xs font-medium">
                  <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                  Transferido:
                </span>
                {transferenciasPorFilial.length > 0 ? (
                  transferenciasPorFilial.map((t) => (
                    <span key={t.filialId}>
                      {filiais.find((f) => f.id === t.filialId)?.nome ?? 'Filial'}: {formatCurrency(t.valor)}
                    </span>
                  ))
                ) : (
                  <span>{formatCurrency(kpis.transferencias)}</span>
                )}
              </div>
            )
          }
          trend={crescimentoPct !== null ? `${crescimentoPct >= 0 ? '+' : ''}${crescimentoPct.toFixed(1)}% vs. ano anterior` : undefined}
          trendTone={crescimentoPct !== null ? (crescimentoPct >= 0 ? 'positive' : 'negative') : 'neutral'}
        />
        <KpiCard label="Quantidade de Notas" value={String(kpis.nf_count)} icon="receipt_long" loading={loading}
          trend="Sincronizado em tempo real" trendTone="positive"
        />
        <KpiCard label="Ticket Médio" value={formatCurrency(kpis.ticket_medio)} icon="leaderboard" loading={loading}
          trend={`${kpis.clientes} clientes no período`} trendTone="neutral"
        />

        <MetaCard
          meta={meta}
          faturamento={kpis.faturamento}
          loading={loading}
          onDefinir={() => setShowMetaDialog(true)}
        />
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
        <HourlyBarChart data={hourly} loading={loading} />
        <VendedorRanking
          data={ranking}
          loading={loading}
          onSelectVendedor={(row, rank) => setSelectedVendedor({ row, rank })}
        />
        <FilialDonut data={participacao} loading={loading} />

        <FreteImpostosCard invoices={feed} loading={loading} onSelectInvoice={setSelectedInvoice} />

        <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
          <div className="p-lg border-b border-outline-variant flex flex-wrap items-center justify-between gap-md">
            <div className="flex items-center gap-sm">
              <h3 className="font-title-md text-title-md text-on-surface">Feed em Tempo Real</h3>
              <span className={`material-symbols-outlined text-tertiary text-[18px] ${pulse ? 'sync-active' : ''}`}>sync</span>
              {!loading && (
                <span className="font-label-md text-label-md text-on-surface-variant">
                  {feedSearchNorm ? `${filteredFeed.length} de ${feed.length}` : `${feed.length} notas`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-md">
              <div className="relative">
                <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  search
                </span>
                <input
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  placeholder="Buscar por NF ou cliente…"
                  className="w-48 rounded-full border border-outline-variant bg-surface-container-lowest py-xs pl-xl pr-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none sm:w-64"
                />
                {feedSearch && (
                  <button
                    onClick={() => setFeedSearch('')}
                    aria-label="Limpar busca"
                    className="absolute right-xs top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  if (filteredFeed.length === 0) {
                    push('info', 'Nenhum lançamento para exportar.')
                    return
                  }
                  downloadCsv(`faturamento-${filters.ano ?? ''}-${filters.mes ?? ''}.csv`, invoicesToCsv(filteredFeed))
                }}
                className="shrink-0 text-primary font-label-md text-label-md flex items-center gap-xs hover:underline"
              >
                Exportar CSV
                <span className="material-symbols-outlined text-[16px]">download</span>
              </button>
            </div>
          </div>
          <div className="max-h-[600px] overflow-auto">
            {loading ? (
              <div className="space-y-sm p-lg">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filteredFeed.length === 0 ? (
              <div className="p-lg">
                <EmptyState
                  icon="receipt_long"
                  title={
                    feedSearchNorm
                      ? `Nenhuma nota encontrada para "${feedSearch}"`
                      : filters.dia
                        ? `Nenhuma nota em ${filters.dia}/${mesSel}`
                        : 'Nenhuma nota no período'
                  }
                  description={
                    feedSearchNorm
                      ? 'Tente buscar pelo número da NF ou parte do nome do cliente.'
                      : filters.dia
                        ? 'Você está vendo só esse dia — as notas do resto do mês podem estar escondidas.'
                        : 'Assim que o faturista lançar uma NF, ela aparece aqui.'
                  }
                />
                {feedSearchNorm ? (
                  <button
                    onClick={() => setFeedSearch('')}
                    className="mx-auto mt-md flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                    Limpar busca
                  </button>
                ) : (
                  filters.dia && (
                    <button
                      onClick={() => setFilters({ ...filters, dia: null })}
                      className="mx-auto mt-md flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
                    >
                      <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                      Ver o mês inteiro
                    </button>
                  )
                )}
              </div>
            ) : (
              <>
                {/* Desktop/tablet: tabela completa */}
                <table className="hidden w-full text-left md:table">
                  <thead className="sticky top-0 z-10 bg-surface-container-low">
                    <tr>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Cliente</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Vendedor</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Valor</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Tipo de Operação</th>
                      <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {filteredFeed.map((inv) => {
                      const cancelada = isCanceladaTipo(inv.tipo_operacao)
                      return (
                      <tr
                        key={inv.id}
                        onClick={() => setSelectedInvoice(inv)}
                        title="Ver espelho da nota"
                        className={`cursor-pointer transition-colors duration-1000 ${
                          inv.id === highlightId ? 'bg-tertiary/10' : 'hover:bg-surface-container-low'
                        } ${cancelada ? 'opacity-60' : ''}`}
                      >
                        <td className={`px-lg py-md font-tabular-nums font-medium ${cancelada ? 'text-on-surface-variant line-through' : 'text-primary'}`}>
                          #{inv.numero_nf}
                        </td>
                        <td className={`px-lg py-md font-body-md text-body-md ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                          {inv.cliente}
                          {cancelada && (
                            <span className="ml-xs rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error no-underline">
                              Cancelada
                            </span>
                          )}
                        </td>
                        <td className="px-lg py-md font-body-md text-body-md text-on-surface-variant">{inv.filiais?.nome}</td>
                        <td className="px-lg py-md font-body-md text-body-md text-on-surface">{inv.vendedores?.nome}</td>
                        <td className={`px-lg py-md font-tabular-nums font-semibold ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                          {formatCurrency(inv.valor)}
                        </td>
                        <td className="px-lg py-md">
                          <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${tipoBadgeClass(inv.tipo_operacao)}`}>
                            {inv.tipo_operacao}
                          </span>
                        </td>
                        <td className="px-lg py-md font-label-md text-label-md text-on-surface-variant">
                          {formatDate(inv.data_emissao)}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Mobile: cartões empilhados — 7 colunas não cabem numa tela de
                    celular sem scroll lateral, então cada nota vira um cartão. */}
                <div className="divide-y divide-outline-variant md:hidden">
                  {filteredFeed.map((inv) => {
                    const cancelada = isCanceladaTipo(inv.tipo_operacao)
                    return (
                      <div
                        key={inv.id}
                        onClick={() => setSelectedInvoice(inv)}
                        className={`cursor-pointer p-lg transition-colors ${
                          inv.id === highlightId ? 'bg-tertiary/10' : 'hover:bg-surface-container-low'
                        } ${cancelada ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-sm">
                          <div className="min-w-0">
                            <span className={`font-tabular-nums font-medium ${cancelada ? 'text-on-surface-variant line-through' : 'text-primary'}`}>
                              #{inv.numero_nf}
                            </span>
                            <p className={`font-body-md text-body-md ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                              {inv.cliente}
                            </p>
                          </div>
                          <span className={`shrink-0 font-tabular-nums font-semibold ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                            {formatCurrency(inv.valor)}
                          </span>
                        </div>
                        <div className="mt-sm flex flex-wrap items-center gap-x-sm gap-y-xs">
                          <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${tipoBadgeClass(inv.tipo_operacao)}`}>
                            {inv.tipo_operacao}
                          </span>
                          {cancelada && (
                            <span className="rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error">
                              Cancelada
                            </span>
                          )}
                          <span className="font-label-md text-label-md text-on-surface-variant">
                            {formatDate(inv.data_emissao)}
                          </span>
                        </div>
                        <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                          {inv.filiais?.nome}
                          {inv.vendedores?.nome ? ` · ${inv.vendedores.nome}` : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
