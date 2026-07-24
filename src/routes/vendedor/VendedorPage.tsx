import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { MonthTabs } from '../../components/filters/MonthTabs'
import { KpiCard } from '../../components/kpi/KpiCard'
import { FaturamentoCard } from '../../components/kpi/FaturamentoCard'
import { NfeMirrorModal } from '../../components/invoices/NfeMirrorModal'
import { BuscarNotaCard } from '../../components/invoices/BuscarNotaCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { LiquidGauge } from '../../components/ui/LiquidGauge'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate, isCanceladaTipo } from '../../lib/format'
import { getDailyQuote } from '../../lib/philosopherQuotes'
import { playCashSound } from '../../lib/sound'
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

const MESES_COMISSAO = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// Mesmo ciclo de apuração 21-20 usado no painel de comissões do diretor: o
// "mês" de comissão é rotulado pelo mês em que o ciclo TERMINA — ex.: "mês
// de julho" = 21/06 a 20/07. Isso é só o rótulo padrão ao abrir a página; o
// vendedor pode navegar pra outros meses com as setas.
function cicloComissaoPadrao(): { mes: number; ano: number } {
  const now = new Date()
  let mes = now.getMonth() + 1
  let ano = now.getFullYear()
  if (now.getDate() >= 21) {
    mes += 1
    if (mes > 12) {
      mes = 1
      ano += 1
    }
  }
  return { mes, ano }
}

function periodoDoCiclo(mes: number, ano: number): { inicio: string; fim: string } {
  const mesInicio = mes === 1 ? 12 : mes - 1
  const anoInicio = mes === 1 ? ano - 1 : ano
  return {
    inicio: `${anoInicio}-${String(mesInicio).padStart(2, '0')}-21`,
    fim: `${ano}-${String(mes).padStart(2, '0')}-20`,
  }
}

// Meta pessoal só pode ser (re)definida no dia 1º do mês — janela curta pra
// evitar que o vendedor fique reajustando a meta pra sempre bater 100%.
function proximaJanelaEdicao(referencia: Date): Date {
  return new Date(referencia.getFullYear(), referencia.getMonth() + 1, 1, 0, 0, 0)
}

function formatCountdown(alvo: Date, agora: Date): string {
  const diffMs = Math.max(0, alvo.getTime() - agora.getTime())
  const totalSegundos = Math.floor(diffMs / 1000)
  const dias = Math.floor(totalSegundos / 86400)
  const horas = Math.floor((totalSegundos % 86400) / 3600)
  const minutos = Math.floor((totalSegundos % 3600) / 60)
  const segundos = totalSegundos % 60
  return `${dias}d ${String(horas).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m ${String(segundos).padStart(2, '0')}s`
}

export function VendedorPage() {
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

  const [comissao, setComissao] = useState<ComissaoPropria | null>(null)
  const [loadingComissao, setLoadingComissao] = useState(true)
  const cicloAtual = cicloComissaoPadrao()
  // Um único state (não dois) pra mes+ano do ciclo: cliques rápidos em
  // sequência disparam vários setState síncronos que, com dois states
  // separados, capturariam o mesmo valor "antigo" de cada um (closure
  // obsoleta) — combinado num objeto só, o updater funcional sempre lê o
  // par mes/ano mais recente de uma vez.
  const [cicloComissao, setCicloComissao] = useState({ mes: cicloAtual.mes, ano: cicloAtual.ano })
  const { mes: mesComissao, ano: anoComissao } = cicloComissao
  const periodo = periodoDoCiclo(mesComissao, anoComissao)
  const noCicloAtual = mesComissao === cicloAtual.mes && anoComissao === cicloAtual.ano

  function mudarCicloComissao(delta: number) {
    setCicloComissao((prev) => {
      let novoMes = prev.mes + delta
      let novoAno = prev.ano
      if (novoMes > 12) {
        novoMes = 1
        novoAno += 1
      } else if (novoMes < 1) {
        novoMes = 12
        novoAno -= 1
      }
      return { mes: novoMes, ano: novoAno }
    })
  }

  const [colocacao, setColocacao] = useState<Colocacao | null>(null)
  const [loadingColocacao, setLoadingColocacao] = useState(true)

  const [meuVendedorId, setMeuVendedorId] = useState<string | null>(null)
  const [metaEmpresa, setMetaEmpresa] = useState(0)
  const [metaPessoal, setMetaPessoal] = useState<number | null>(null)
  const [loadingMetas, setLoadingMetas] = useState(true)
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaInput, setMetaInput] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [isCensored, setIsCensored] = useState(false)

  const [relogio, setRelogio] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const podeEditarMeta = relogio.getDate() === 1
  const proximaEdicao = proximaJanelaEdicao(relogio)

  const dailyQuote = getDailyQuote()

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

  // Meta da empresa (mesma preferência de useDashboardData.loadMeta): meta
  // global (filial_id null) se existir, senão soma das metas por filial.
  async function loadMetaEmpresa(): Promise<number> {
    const { data: global } = await supabase
      .from('metas')
      .select('valor_meta')
      .is('filial_id', null)
      .eq('mes', mes)
      .eq('ano', ano)
      .maybeSingle()
    if (global) return Number(global.valor_meta)

    const { data: porFilial } = await supabase
      .from('metas')
      .select('valor_meta')
      .not('filial_id', 'is', null)
      .eq('mes', mes)
      .eq('ano', ano)
    return (porFilial ?? []).reduce((sum, r) => sum + Number(r.valor_meta), 0)
  }

  async function loadMetas(vendedorId: string | null) {
    setLoadingMetas(true)
    const [empresa, pessoalResult] = await Promise.all([
      loadMetaEmpresa(),
      vendedorId
        ? supabase
            .from('metas_pessoais')
            .select('valor_meta')
            .eq('vendedor_id', vendedorId)
            .eq('mes', mes)
            .eq('ano', ano)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setMetaEmpresa(empresa)
    setMetaPessoal(pessoalResult.data ? Number(pessoalResult.data.valor_meta) : null)
    setLoadingMetas(false)
  }

  async function salvarMetaPessoal() {
    const valor = Number(metaInput.replace(/\./g, '').replace(',', '.')) || 0
    if (!meuVendedorId || valor <= 0) {
      push('error', 'Informe um valor de meta maior que zero.')
      return
    }
    setSavingMeta(true)
    const { error } = await supabase
      .from('metas_pessoais')
      .upsert(
        { vendedor_id: meuVendedorId, mes, ano, valor_meta: valor },
        { onConflict: 'vendedor_id,mes,ano' }
      )
    setSavingMeta(false)
    if (error) {
      push('error', `Não foi possível salvar sua meta: ${error.message}`)
      return
    }
    setMetaPessoal(valor)
    setEditingMeta(false)
    push('success', `Meta pessoal definida em ${formatCurrency(valor)}.`)
  }

  useEffect(() => {
    loadFeed()
    loadColocacao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  // Toca um som de "dinheiro" + toast quando uma nota nova é lançada para
  // este vendedor. A RLS (vendedor_select_own) já garante que o Realtime só
  // entrega INSERTs de notas cujo vendedor_id é o dele — o diretor nunca
  // recebe esse evento aqui porque essa assinatura só existe nesta página.
  // Recriamos o canal a cada troca de mês pra evitar closure obsoleta
  // (loadFeed/loadColocacao fechariam sobre o mes/ano antigo senão).
  useEffect(() => {
    const channel = supabase
      .channel('vendedor-novas-notas')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invoices' },
        (payload) => {
          const nova = payload.new as Invoice
          playCashSound()
          push('success', `💰 Nova nota lançada! #${nova.numero_nf} — ${formatCurrency(Number(nova.valor))}`)
          loadFeed()
          loadColocacao()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  useEffect(() => {
    loadComissao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesComissao, anoComissao])

  useEffect(() => {
    if (!profile) return
    supabase
      .from('vendedores')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle()
      .then(({ data }) => setMeuVendedorId(data?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  useEffect(() => {
    loadMetas(meuVendedorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano, meuVendedorId])

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

  const dailyFaturamento = validas.reduce<Record<number, number>>((acc, inv) => {
    const dia = Number(inv.data_emissao.slice(8, 10))
    acc[dia] = (acc[dia] ?? 0) + Number(inv.valor)
    return acc
  }, {})

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Vendedor'}`}
      navItems={NAV_ITEMS}
      onRefresh={async () => {
        await Promise.all([loadFeed(), loadComissao(), loadColocacao(), loadMetas(meuVendedorId)])
      }}
    >
      {/* Frase do dia (filósofos) — mesmo componente/estilo do painel do diretor. */}
      <p className="mb-md flex items-start gap-xs font-body-md text-body-md italic text-on-surface-variant">
        <span className="material-symbols-outlined shrink-0 text-[16px] not-italic text-outline">format_quote</span>
        <span>
          {dailyQuote.text} <span className="not-italic text-on-surface-variant/70">— {dailyQuote.author}</span>
        </span>
      </p>

      <MonthTabs mes={mes} ano={ano} onChange={(m, a) => { setMes(m); setAno(a) }} />

      {/* Busca independente do mês selecionado — uma nota de outro mês não
          aparece na lista "Minhas Notas" abaixo (ela é sempre filtrada pelo mês). */}
      <BuscarNotaCard onSelectInvoice={setSelectedInvoice} />

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

      <div className="mb-md">
        <FaturamentoCard
          faturamento={faturamento}
          crescimentoPct={null}
          dailyFaturamento={dailyFaturamento}
          mes={mes}
          ano={ano}
          loading={loadingFeed}
          accent={accentFor(colocacao?.colocacao)}
          isCensored={isCensored}
          onToggleCensor={() => setIsCensored(!isCensored)}
        />
      </div>

      <div className="mb-lg grid grid-cols-2 gap-md lg:grid-cols-3">
        <KpiCard label="Notas" value={String(naoCanceladas.length)} icon="receipt_long" loading={loadingFeed} />
        <KpiCard label="Ticket Médio" value={isCensored ? 'R$ •••••' : formatCurrency(ticketMedio)} icon="leaderboard" loading={loadingFeed} />
        <KpiCard
          label="% da Meta"
          value={metaEmpresa > 0 ? `${((faturamento / metaEmpresa) * 100).toFixed(1)}%` : '—'}
          icon="flag"
          loading={loadingFeed || loadingMetas}
        />
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <div className="mb-md flex items-center gap-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tertiary/10">
            <span className="material-symbols-outlined text-tertiary text-[18px]">military_tech</span>
          </span>
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Minha Meta Pessoal</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">Defina seu objetivo do mês e acompanhe o progresso</p>
          </div>
        </div>

        {loadingMetas ? (
          <Skeleton className="h-48 w-full rounded-2xl" />
        ) : metaPessoal === null || (podeEditarMeta && editingMeta) ? (
          <div className="flex flex-col gap-sm sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Valor da meta (R$)</span>
              <input
                inputMode="decimal"
                value={metaInput}
                onChange={(e) => setMetaInput(e.target.value)}
                placeholder="Ex.: 50.000,00"
                autoFocus
                className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none transition-colors focus:border-primary"
              />
            </label>
            <div className="flex gap-sm">
              {metaPessoal !== null && (
                <button
                  type="button"
                  onClick={() => setEditingMeta(false)}
                  className="rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  Cancelar
                </button>
              )}
              <button
                type="button"
                disabled={savingMeta}
                onClick={salvarMetaPessoal}
                className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {savingMeta ? 'Salvando…' : 'Salvar meta'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <LiquidGauge
              percent={metaPessoal > 0 ? (faturamento / metaPessoal) * 100 : 0}
              caption={`${isCensored ? 'R$ •••••' : formatCurrency(faturamento)} de ${isCensored ? 'R$ •••••' : formatCurrency(metaPessoal)}`}
            />
            {podeEditarMeta ? (
              <button
                type="button"
                onClick={() => {
                  setMetaInput(metaPessoal.toFixed(2).replace('.', ','))
                  setEditingMeta(true)
                }}
                className="mt-md flex items-center gap-xs font-label-md text-label-md text-primary transition-opacity hover:opacity-80"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                Editar meta
              </button>
            ) : (
              <div className="mt-md flex flex-wrap items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                <span>Editável em {formatCountdown(proximaEdicao, relogio)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
          <div className="flex items-center gap-sm">
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
          <div className="flex items-center gap-xs">
            <button
              type="button"
              onClick={() => mudarCicloComissao(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
              aria-label="Mês anterior"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <span className="min-w-[6.5rem] text-center font-label-md text-label-md text-on-surface">
              {MESES_COMISSAO[mesComissao - 1]} {anoComissao}
            </span>
            <button
              type="button"
              onClick={() => mudarCicloComissao(1)}
              disabled={noCicloAtual}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-30"
              aria-label="Próximo mês"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
          </div>
        </div>
        {loadingComissao ? (
          <Skeleton className="h-9 w-40" />
        ) : comissao ? (
          <div>
            <span className="break-words font-display text-2xl text-on-surface tabular-nums sm:text-display">
              {isCensored ? 'R$ •••••••' : formatCurrency(comissao.valor_comissao)}
            </span>
            <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
              {comissao.percentual_comissao.toLocaleString('pt-BR')}% de {isCensored ? 'R$ •••••••' : formatCurrency(comissao.faturamento_periodo)} em vendas
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
                        {isCensored ? 'R$ •••••' : formatCurrency(inv.valor)}
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
                        {isCensored ? 'R$ •••••' : formatCurrency(inv.valor)}
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
