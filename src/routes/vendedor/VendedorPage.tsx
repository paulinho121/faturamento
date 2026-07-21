import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { MonthTabs } from '../../components/filters/MonthTabs'
import { KpiCard } from '../../components/kpi/KpiCard'
import { NfeMirrorModal } from '../../components/invoices/NfeMirrorModal'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate, isCanceladaTipo } from '../../lib/format'
import type { Invoice } from '../../types/domain'

const NAV_ITEMS = [{ to: '/vendedor', icon: 'person', label: 'Minhas Vendas' }]

interface ComissaoPropria {
  percentual_comissao: number
  faturamento_periodo: number
  valor_comissao: number
}

interface Colocacao {
  colocacao: number
  total_vendedores: number
  faturamento: number
}

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function accentFor(colocacao?: number): 'gold' | 'silver' | 'bronze' | undefined {
  if (colocacao === 1) return 'gold'
  if (colocacao === 2) return 'silver'
  if (colocacao === 3) return 'bronze'
  return undefined
}

// Mesmo ciclo de apuração 21-20 usado no painel de comissões do diretor —
// aqui é só o valor padrão pra mostrar algo sensato ao abrir a página.
function periodoPadrao(): { inicio: string; fim: string } {
  const now = new Date()
  let mesFim = now.getMonth() + 1
  let anoFim = now.getFullYear()
  if (now.getDate() >= 21) {
    mesFim += 1
    if (mesFim > 12) {
      mesFim = 1
      anoFim += 1
    }
  }
  const mesInicio = mesFim === 1 ? 12 : mesFim - 1
  const anoInicio = mesFim === 1 ? anoFim - 1 : anoFim
  return {
    inicio: `${anoInicio}-${String(mesInicio).padStart(2, '0')}-21`,
    fim: `${anoFim}-${String(mesFim).padStart(2, '0')}-20`,
  }
}

export function VendedorPage() {
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

  const [comissao, setComissao] = useState<ComissaoPropria | null>(null)
  const [loadingComissao, setLoadingComissao] = useState(true)
  const periodo = periodoPadrao()

  const [colocacao, setColocacao] = useState<Colocacao | null>(null)
  const [loadingColocacao, setLoadingColocacao] = useState(true)

  async function loadFeed() {
    setLoadingFeed(true)
    const start = `${ano}-${String(mes).padStart(2, '0')}-01`
    const end = new Date(ano, mes, 0).toISOString().slice(0, 10)
    // RLS (vendedor_select_own) já restringe isso às notas do próprio vendedor.
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome), vendedores(nome)')
      .gte('data_emissao', start)
      .lte('data_emissao', end)
      .eq('excluida', false)
      .order('data_emissao', { ascending: false })
      .order('created_at', { ascending: false })
    if (!error) setFeed((data as Invoice[]) ?? [])
    setLoadingFeed(false)
  }

  async function loadComissao() {
    setLoadingComissao(true)
    const { data, error } = await supabase.rpc('dashboard_comissoes', {
      p_data_inicio: periodo.inicio,
      p_data_fim: periodo.fim,
    })
    if (!error && data && data.length > 0) setComissao(data[0])
    setLoadingComissao(false)
  }

  async function loadColocacao() {
    setLoadingColocacao(true)
    const { data, error } = await supabase.rpc('dashboard_minha_colocacao', { p_mes: mes, p_ano: ano })
    if (!error && data && data.length > 0) setColocacao(data[0])
    else if (!error) setColocacao(null)
    setLoadingColocacao(false)
  }

  useEffect(() => {
    loadFeed()
    loadColocacao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  useEffect(() => {
    loadComissao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const searchNorm = search.trim().toLowerCase()
  const filteredFeed = searchNorm
    ? feed.filter(
        (inv) =>
          inv.numero_nf.toLowerCase().includes(searchNorm) || inv.cliente.toLowerCase().includes(searchNorm)
      )
    : feed

  const naoCanceladas = feed.filter((inv) => !isCanceladaTipo(inv.tipo_operacao))
  const validas = naoCanceladas.filter((inv) => inv.afeta_faturamento)
  const faturamento = validas.reduce((acc, i) => acc + Number(i.valor), 0)
  const ticketMedio = validas.length > 0 ? faturamento / validas.length : 0

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Vendedor'}`}
      navItems={NAV_ITEMS}
      onRefresh={async () => {
        await Promise.all([loadFeed(), loadComissao(), loadColocacao()])
      }}
    >
      <MonthTabs mes={mes} ano={ano} onChange={(m, a) => { setMes(m); setAno(a) }} />

      {!loadingColocacao && colocacao && (
        <div className="mb-lg flex items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-level1">
          <span className="text-3xl">{MEDALS[colocacao.colocacao] ?? '🎖️'}</span>
          <div>
            <p className="font-title-md text-title-md text-on-surface">{colocacao.colocacao}º lugar</p>
            <p className="font-label-md text-label-md text-on-surface-variant">
              de {colocacao.total_vendedores} vendedor{colocacao.total_vendedores === 1 ? '' : 'es'} este mês
            </p>
          </div>
        </div>
      )}

      <div className="mb-lg grid grid-cols-2 gap-md lg:grid-cols-3">
        <KpiCard
          label="Faturamento"
          value={formatCurrency(faturamento)}
          icon="payments"
          loading={loadingFeed}
          accent={accentFor(colocacao?.colocacao)}
        />
        <KpiCard label="Notas" value={String(naoCanceladas.length)} icon="receipt_long" loading={loadingFeed} />
        <KpiCard label="Ticket Médio" value={formatCurrency(ticketMedio)} icon="leaderboard" loading={loadingFeed} />
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <div className="mb-md flex items-center gap-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <span className="material-symbols-outlined text-primary text-[18px]">payments</span>
          </span>
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Sua Comissão</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              {formatDate(periodo.inicio)} a {formatDate(periodo.fim)}
            </p>
          </div>
        </div>
        {loadingComissao ? (
          <Skeleton className="h-9 w-40" />
        ) : comissao ? (
          <div>
            <span className="break-words font-display text-2xl text-on-surface tabular-nums sm:text-display">
              {formatCurrency(comissao.valor_comissao)}
            </span>
            <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
              {comissao.percentual_comissao.toLocaleString('pt-BR')}% de {formatCurrency(comissao.faturamento_periodo)} em vendas
            </p>
          </div>
        ) : (
          <EmptyState icon="payments" title="Sem dados de comissão neste período" />
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex flex-wrap items-center justify-between gap-md">
          <h3 className="font-title-md text-title-md text-on-surface">Minhas Notas</h3>
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por NF ou cliente…"
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
              icon="receipt_long"
              title={searchNorm ? `Nenhuma nota encontrada para "${search}"` : 'Nenhuma nota no período'}
            />
          </div>
        ) : (
          <>
            {/* Desktop/tablet: tabela completa */}
            <table className="hidden w-full text-left md:table">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Cliente</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">Valor</th>
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
                      className={`cursor-pointer transition-colors hover:bg-surface-container-low ${cancelada ? 'opacity-60' : ''}`}
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
                      <td className={`px-lg py-md font-tabular-nums font-semibold ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                        {formatCurrency(inv.valor)}
                      </td>
                      <td className="px-lg py-md font-label-md text-label-md text-on-surface-variant">{formatDate(inv.data_emissao)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile: cartões empilhados */}
            <div className="divide-y divide-outline-variant md:hidden">
              {filteredFeed.map((inv) => {
                const cancelada = isCanceladaTipo(inv.tipo_operacao)
                return (
                  <div
                    key={inv.id}
                    onClick={() => setSelectedInvoice(inv)}
                    className={`cursor-pointer p-lg transition-colors hover:bg-surface-container-low ${cancelada ? 'opacity-60' : ''}`}
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
                      {cancelada && (
                        <span className="rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error">
                          Cancelada
                        </span>
                      )}
                      <span className="font-label-md text-label-md text-on-surface-variant">{formatDate(inv.data_emissao)}</span>
                    </div>
                    <p className="mt-xs font-label-md text-label-md text-on-surface-variant">{inv.filiais?.nome}</p>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {selectedInvoice && <NfeMirrorModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </AppShell>
  )
}
