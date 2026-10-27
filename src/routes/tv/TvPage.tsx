import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { usePainelTv, type PainelPedido } from '../../hooks/usePainelTv'
import { diasUteisDoMes, ehDiaUtil } from '../../lib/diasUteis'
import { formatCurrency } from '../../lib/format'
import { roleHome } from '../../lib/roleHome'

const MEDALHAS = ['🥇', '🥈', '🥉']
const MAX_CARDS = 5

// O painel é desenhado sempre em 1920x1080 e escalado pra caber na tela —
// assim fica igual numa TV Full HD, num monitor 1366x768 ou num 16:10.
const LARGURA = 1920
const ALTURA = 1080

function useEscala() {
  const calcular = () => {
    const escala = Math.min(window.innerWidth / LARGURA, window.innerHeight / ALTURA)
    return {
      escala,
      esquerda: (window.innerWidth - LARGURA * escala) / 2,
      topo: (window.innerHeight - ALTURA * escala) / 2,
    }
  }
  const [medida, setMedida] = useState(calcular)
  useEffect(() => {
    const aoRedimensionar = () => setMedida(calcular())
    window.addEventListener('resize', aoRedimensionar)
    return () => window.removeEventListener('resize', aoRedimensionar)
  }, [])
  return medida
}

interface Coluna {
  chave: string
  titulo: string
  icone: string
  cabecalho: string // classes do cabeçalho da coluna
  card: string // classes de cada cartão
  aberta: boolean // false = já faturado (não conta tempo de espera)
  pertence: (p: PainelPedido) => boolean
}

// Classes escritas por extenso (o Tailwind só gera o que aparece no código).
const COLUNAS: Coluna[] = [
  {
    chave: 'enviado',
    titulo: 'Recebido',
    icone: 'inbox',
    cabecalho: 'bg-sky-500/25 text-sky-100 border-sky-400/50',
    card: 'border-sky-400/30 bg-sky-500/10',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'enviado',
  },
  {
    chave: 'em_processo',
    titulo: 'Em processo',
    icone: 'sync',
    cabecalho: 'bg-violet-500/25 text-violet-100 border-violet-400/50',
    card: 'border-violet-400/30 bg-violet-500/10',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'em_processo',
  },
  {
    chave: 'enviado_sanco',
    titulo: 'Na Sanco',
    icone: 'local_shipping',
    cabecalho: 'bg-fuchsia-500/25 text-fuchsia-100 border-fuchsia-400/50',
    card: 'border-fuchsia-400/30 bg-fuchsia-500/10',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'enviado_sanco',
  },
  {
    chave: 'em_separacao',
    titulo: 'Em separação',
    icone: 'inventory_2',
    cabecalho: 'bg-amber-500/25 text-amber-100 border-amber-400/50',
    card: 'border-amber-400/30 bg-amber-500/10',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'em_separacao',
  },
  {
    chave: 'devolvido',
    titulo: 'Devolvidos',
    icone: 'undo',
    cabecalho: 'bg-rose-500/30 text-rose-100 border-rose-400/60',
    card: 'border-rose-400/40 bg-rose-500/15',
    aberta: true,
    pertence: (p) => p.status === 'devolvido',
  },
  {
    chave: 'faturado',
    titulo: 'Faturados hoje',
    icone: 'check_circle',
    cabecalho: 'bg-emerald-500/30 text-emerald-100 border-emerald-400/60',
    card: 'border-emerald-400/40 bg-emerald-500/15',
    aberta: false,
    pertence: (p) => p.status === 'faturado',
  },
]

// "há 25 min", "há 3h", "há 2d" — quanto tempo o pedido está nessa etapa.
function haQuanto(desde: string, agora: number): { texto: string; horas: number } {
  const min = Math.max(Math.floor((agora - new Date(desde).getTime()) / 60_000), 0)
  const horas = min / 60
  if (min < 60) return { texto: `há ${min} min`, horas }
  if (min < 60 * 24) return { texto: `há ${Math.floor(horas)}h`, horas }
  return { texto: `há ${Math.floor(horas / 24)}d`, horas }
}

function Barra({ pct, cor = 'bg-emerald-400' }: { pct: number; cor?: string }) {
  return (
    <div className="h-full w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-all duration-1000 ${cor}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 1) * 100}%` }}
      />
    </div>
  )
}

function Confete() {
  const pecas = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        esquerda: Math.random() * 100,
        atraso: Math.random() * 2.5,
        duracao: 3 + Math.random() * 2.5,
        emoji: ['🎉', '✨', '🎊', '⭐', '💚'][i % 5],
        tamanho: 22 + Math.random() * 26,
      })),
    []
  )
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pecas.map((p, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={{
            left: `${p.esquerda}%`,
            fontSize: p.tamanho,
            animation: `tv-queda ${p.duracao}s ${p.atraso}s linear forwards`,
            opacity: 0,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  )
}

function Cartao({
  pedido,
  coluna,
  agora,
  destaque,
}: {
  pedido: PainelPedido
  coluna: Coluna
  agora: number
  destaque: boolean
}) {
  const { texto, horas } = haQuanto(pedido.desde, agora)
  const urgencia = !coluna.aberta
    ? 'text-emerald-200'
    : horas >= 48
      ? 'text-rose-300'
      : horas >= 24
        ? 'text-amber-300'
        : 'text-white/70'
  return (
    <li
      className={`rounded-2xl border px-3 py-2 ${coluna.card}`}
      style={destaque ? { animation: 'tv-pisca 1.2s ease-in-out 6' } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xl font-extrabold tabular-nums text-white/90">#{pedido.numero}</span>
        <span className={`whitespace-nowrap text-lg font-bold ${urgencia}`}>
          {horas >= 24 && coluna.aberta ? '⏱ ' : ''}
          {texto}
        </span>
      </div>
      <p className="truncate text-2xl font-extrabold leading-tight">{pedido.vendedor}</p>
      <p className="truncate text-base text-white/60">{pedido.cliente}</p>
      {pedido.status === 'devolvido' && pedido.motivo && (
        <p className="truncate text-base font-semibold text-rose-200">⚠ {pedido.motivo}</p>
      )}
      {pedido.pre_venda && <p className="text-sm font-bold tracking-wider text-amber-300">PRÉ-VENDA</p>}
    </li>
  )
}

// Tela cheia no monitor onde a janela estiver (o financeiro arrasta a janela
// do painel pro segundo monitor e aperta F ou clica no botão).
function useTelaCheia() {
  const [ativa, setAtiva] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const aoMudar = () => setAtiva(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', aoMudar)
    return () => document.removeEventListener('fullscreenchange', aoMudar)
  }, [])
  const alternar = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    const aoApertar = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) alternar()
    }
    window.addEventListener('keydown', aoApertar)
    return () => window.removeEventListener('keydown', aoApertar)
  }, [alternar])
  return { ativa, alternar }
}

export function TvPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { ativa: telaCheia, alternar: alternarTelaCheia } = useTelaCheia()
  const { dados, erro, atualizadoEm, evento, destaques } = usePainelTv()

  // Aberto pelo botão "Modo TV" é uma janela própria e fecha; aberto direto
  // pelo endereço, volta pra tela inicial da pessoa. Nunca desloga: a conta é
  // a de trabalho do financeiro.
  const fechar = () => {
    if (window.opener) window.close()
    else navigate(roleHome(profile?.role ?? 'financeiro'))
  }
  const { escala, esquerda, topo } = useEscala()
  const [agora, setAgora] = useState(() => Date.now())
  const [confete, setConfete] = useState(false)
  const batidaAntes = useRef<boolean | null>(null)

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])

  const calculo = useMemo(() => {
    if (!dados) return null
    const [ano, mes] = dados.hoje.split('-').map(Number)
    const diasUteis = diasUteisDoMes(ano, mes)
    const metaDiaria = diasUteis.length > 0 ? dados.meta_mes / diasUteis.length : 0
    const diasRestantes = diasUteis.filter((d) => d >= dados.hoje).length
    const faltaMes = Math.max(dados.meta_mes - dados.faturado_mes, 0)
    return {
      metaDiaria,
      hojeUtil: ehDiaUtil(dados.hoje),
      diasRestantes,
      faltaMes,
      precisaPorDia: diasRestantes > 0 ? faltaMes / diasRestantes : faltaMes,
      pctDia: metaDiaria > 0 ? dados.faturado_hoje / metaDiaria : 0,
      pctMes: dados.meta_mes > 0 ? dados.faturado_mes / dados.meta_mes : 0,
    }
  }, [dados])

  const metaDiaBatida = !!calculo && calculo.metaDiaria > 0 && calculo.pctDia >= 1

  // Confete só quando a meta é batida COM a TV ligada (não ao abrir já batida).
  useEffect(() => {
    if (!calculo) return
    if (batidaAntes.current === false && metaDiaBatida) {
      setConfete(true)
      const t = setTimeout(() => setConfete(false), 9000)
      batidaAntes.current = metaDiaBatida
      return () => clearTimeout(t)
    }
    batidaAntes.current = metaDiaBatida
  }, [metaDiaBatida, calculo])

  const colunas = useMemo(() => {
    if (!dados) return []
    return COLUNAS.map((c) => {
      const lista = dados.pedidos.filter(c.pertence)
      // Quem espera há mais tempo aparece primeiro; faturados, os mais recentes.
      lista.sort((a, b) =>
        c.aberta ? a.desde.localeCompare(b.desde) : b.desde.localeCompare(a.desde)
      )
      return { coluna: c, lista }
    })
  }, [dados])

  const rankingPedidos = useMemo(
    () => (dados ? dados.vendedores.filter((v) => v.pedidos_hoje > 0).slice(0, 3) : []),
    [dados]
  )

  const dataAgora = new Date(agora)
  const dataExtenso = dataAgora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const hora = dataAgora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const semConexao = !!erro || (!!atualizadoEm && agora - atualizadoEm.getTime() > 120_000)

  if (!dados || !calculo) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
        <span className="material-symbols-outlined animate-spin text-[56px] text-emerald-400">progress_activity</span>
        <p className="mt-4 text-2xl text-white/70">{erro ?? 'Carregando o painel…'}</p>
        {erro && (
          <button type="button" onClick={fechar} className="mt-6 rounded-full border border-white/30 px-6 py-2 text-white/70">
            Voltar
          </button>
        )}
      </div>
    )
  }

  const semMeta = dados.meta_mes <= 0
  const rotuloEvento = (e: NonNullable<typeof evento>) => {
    const p = e.pedido
    if (e.tipo === 'novo') return `🛎️ Novo pedido #${p.numero} — ${p.vendedor} · ${p.cliente}`
    const col = COLUNAS.find((c) => c.pertence(p))
    return `🔄 Pedido #${p.numero} de ${p.vendedor} agora: ${col?.titulo ?? 'atualizado'}`
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
    <div
      className="group absolute flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white"
      style={{ width: LARGURA, height: ALTURA, left: esquerda, top: topo, transform: `scale(${escala})`, transformOrigin: 'top left' }}
    >
      <style>{`
        @keyframes tv-queda { 0% { transform: translateY(-8vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(108vh) rotate(540deg); opacity: 1 } }
        @keyframes tv-entra { 0% { transform: translate(-50%, -140%); opacity: 0 } 12% { transform: translate(-50%, 0); opacity: 1 } 90% { transform: translate(-50%, 0); opacity: 1 } 100% { transform: translate(-50%, -140%); opacity: 0 } }
        @keyframes tv-pisca { 0%, 100% { background-color: rgba(52, 211, 153, 0.45) } 50% { background-color: rgba(52, 211, 153, 0) } }
      `}</style>

      {confete && <Confete />}

      {evento && (
        <div
          key={evento.chave}
          className="fixed left-1/2 top-4 z-50 max-w-[80vw] rounded-2xl border border-emerald-300/50 bg-emerald-500 px-8 py-4 text-2xl font-bold text-slate-950 shadow-2xl"
          style={{ animation: 'tv-entra 9s ease-in-out forwards' }}
        >
          {rotuloEvento(evento)}
        </div>
      )}


      <header className="mb-3 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-[44px] text-emerald-400">assignment</span>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">Acompanhamento de Pedidos</h1>
            <p className="text-lg capitalize text-white/60">{dataExtenso}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={alternarTelaCheia}
              title={telaCheia ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
              className="rounded-full bg-black/40 p-2 text-white/80 hover:text-white"
            >
              <span className="material-symbols-outlined">{telaCheia ? 'fullscreen_exit' : 'fullscreen'}</span>
            </button>
            <button type="button" onClick={fechar} title="Fechar o painel" className="rounded-full bg-black/40 p-2 text-white/80 hover:text-white">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <span className={`flex items-center gap-2 text-lg font-semibold ${semConexao ? 'text-rose-300' : 'text-emerald-300'}`}>
            <span className={`h-3 w-3 rounded-full ${semConexao ? 'bg-rose-400' : 'animate-pulse bg-emerald-400'}`} />
            {semConexao ? 'SEM CONEXÃO' : 'AO VIVO'}
          </span>
          <span className="text-6xl font-extrabold tabular-nums">{hora}</span>
        </div>
      </header>

      <div className="mb-3 grid shrink-0 grid-cols-12 gap-4">
        <section
          className={`col-span-5 rounded-2xl border px-5 py-3 ${
            metaDiaBatida ? 'border-emerald-300/60 bg-emerald-500/15' : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-widest text-white/70">META DO DIA</h2>
            {metaDiaBatida && (
              <span className="rounded-full bg-emerald-400 px-3 py-0.5 text-base font-extrabold text-slate-950">
                🎉 META BATIDA!
              </span>
            )}
          </div>
          {semMeta ? (
            <p className="mt-2 text-xl text-white/60">Defina a meta do mês no Dashboard.</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <span className="whitespace-nowrap text-4xl font-extrabold tabular-nums leading-tight">{formatCurrency(dados.faturado_hoje)}</span>
                <span className="whitespace-nowrap pb-1 text-xl text-white/60">de {formatCurrency(calculo.metaDiaria)}</span>
                <span className="text-4xl font-extrabold tabular-nums text-emerald-300">{Math.round(calculo.pctDia * 100)}%</span>
              </div>
              <div className="mt-1 h-4">
                <Barra pct={calculo.pctDia} cor={metaDiaBatida ? 'bg-emerald-300' : 'bg-gradient-to-r from-emerald-500 to-lime-300'} />
              </div>
              <p className="mt-1 truncate text-lg font-semibold text-white/85">
                {!calculo.hojeUtil
                  ? 'Hoje não é dia útil — o que entrar conta pra meta do mês 💪'
                  : metaDiaBatida
                    ? 'Meta do dia batida! Cada pedido agora é bônus 🚀'
                    : `Faltam ${formatCurrency(calculo.metaDiaria - dados.faturado_hoje)} pra meta de hoje — manda esse pedido!`}
              </p>
            </>
          )}
        </section>

        <section className="col-span-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-3">
          <h2 className="text-lg font-bold tracking-widest text-white/70">META DO MÊS</h2>
          {semMeta ? (
            <p className="mt-2 text-xl text-white/60">Meta do mês não definida.</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <span className="whitespace-nowrap text-3xl font-extrabold tabular-nums leading-tight">{formatCurrency(dados.faturado_mes)}</span>
                <span className="whitespace-nowrap pb-1 text-lg text-white/60">de {formatCurrency(dados.meta_mes)}</span>
                <span className="text-4xl font-extrabold tabular-nums text-sky-300">{Math.round(calculo.pctMes * 100)}%</span>
              </div>
              <div className="mt-1 h-4">
                <Barra pct={calculo.pctMes} cor="bg-gradient-to-r from-sky-500 to-emerald-300" />
              </div>
              <p className="mt-1 truncate text-lg text-white/80">
                Faltam <strong>{formatCurrency(calculo.faltaMes)}</strong> ·{' '}
                <span className="text-amber-300">{formatCurrency(calculo.precisaPorDia)}/dia</span> em {calculo.diasRestantes}{' '}
                {calculo.diasRestantes === 1 ? 'dia útil' : 'dias úteis'}
              </p>
            </>
          )}
        </section>

        <section className="col-span-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3">
          <h2 className="text-lg font-bold tracking-widest text-white/70">🚀 PEDIDOS ENVIADOS HOJE</h2>
          {rankingPedidos.length === 0 ? (
            <p className="mt-2 text-xl font-semibold text-white/70">Nenhum ainda — quem manda o primeiro? 🏁</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {rankingPedidos.map((v, i) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-2xl font-bold">
                  <span className="truncate">
                    {MEDALHAS[i]} {v.nome}
                  </span>
                  <span className="tabular-nums text-emerald-300">{v.pedidos_hoje}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-6 gap-3">
        {colunas.map(({ coluna, lista }) => (
          <section key={coluna.chave} className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-2">
            <h2 className={`mb-2 flex shrink-0 items-center justify-between rounded-xl border px-3 py-2 ${coluna.cabecalho}`}>
              <span className="flex items-center gap-2 text-xl font-extrabold">
                <span className="material-symbols-outlined text-[26px]">{coluna.icone}</span>
                {coluna.titulo}
              </span>
              <span className="text-3xl font-extrabold tabular-nums">{lista.length}</span>
            </h2>
            <ul className="min-h-0 flex-1 space-y-2 overflow-hidden">
              {lista.slice(0, MAX_CARDS).map((p) => (
                <Cartao key={p.numero} pedido={p} coluna={coluna} agora={agora} destaque={!!destaques[p.numero]} />
              ))}
              {lista.length === 0 && (
                <li className="py-6 text-center text-xl text-white/40">
                  {coluna.chave === 'devolvido' ? 'Nenhum devolvido 👏' : 'Nenhum pedido'}
                </li>
              )}
            </ul>
            {lista.length > MAX_CARDS && (
              <p className="shrink-0 pt-1 text-center text-xl font-bold text-white/60">
                + {lista.length - MAX_CARDS} pedido{lista.length - MAX_CARDS === 1 ? '' : 's'}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
    </div>
  )
}
