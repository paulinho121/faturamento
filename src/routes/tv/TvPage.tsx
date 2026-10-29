import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { usePainelTv, type PainelPedido } from '../../hooks/usePainelTv'
import { CorridaCavalinhos } from '../../components/tv/CorridaCavalinhos'
import { diasUteisDoMes, ehDiaUtil } from '../../lib/diasUteis'
import { formatCurrency } from '../../lib/format'
import { roleHome } from '../../lib/roleHome'

const MEDALHAS = ['🥇', '🥈', '🥉']
// Cartões visíveis por coluna (a faixa da corrida ocupa parte da altura); devolvidos
// têm uma linha a mais (o motivo), então cabem menos.
const MAX_CARDS = 4
const MAX_CARDS_DEVOLVIDOS = 3

// O painel é desenhado sempre em 1920x1080 e escalado pra caber na tela —
// assim fica igual numa TV Full HD, num monitor 1366x768 ou num 16:10.
const LARGURA = 1920
const ALTURA = 1080

interface Coluna {
  chave: string
  titulo: string
  aberta: boolean // false = já faturado (não conta tempo de espera)
  pertence: (p: PainelPedido) => boolean
}

const COLUNAS: Coluna[] = [
  {
    chave: 'enviado',
    titulo: 'Recebido',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'enviado',
  },
  {
    chave: 'em_processo',
    titulo: 'Em processo',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'em_processo',
  },
  {
    chave: 'enviado_sanco',
    titulo: 'Na Sanco',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'enviado_sanco',
  },
  {
    chave: 'em_separacao',
    titulo: 'Em separação',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'em_separacao',
  },
  {
    chave: 'preparando_embarque',
    titulo: 'Prep. embarque',
    aberta: true,
    pertence: (p) => p.status === 'pendente' && p.etapa === 'preparando_embarque',
  },
  {
    chave: 'devolvido',
    titulo: 'Devolvidos',
    aberta: true,
    pertence: (p) => p.status === 'devolvido',
  },
  {
    chave: 'faturado',
    titulo: 'Faturados hoje',
    aberta: false,
    pertence: (p) => p.status === 'faturado',
  },
]

// Tempo máximo parado numa etapa: a barra do cartão enche e fica vermelha aqui.
const LIMITE_HORAS = 24
const MATIZ_VERDE = 135 // matiz HSL do verde; vai a 0 (vermelho) conforme o tempo passa

// "há 25 min", "há 3h", "há 2d" — quanto tempo o pedido está nessa etapa.
function haQuanto(desde: string, agora: number): { texto: string; horas: number } {
  const min = Math.max(Math.floor((agora - new Date(desde).getTime()) / 60_000), 0)
  const horas = min / 60
  if (min < 60) return { texto: `há ${min} min`, horas }
  if (min < 60 * 24) return { texto: `há ${Math.floor(horas)}h`, horas }
  return { texto: `há ${Math.floor(horas / 24)}d`, horas }
}

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

// Impede o computador de apagar a tela / ligar o protetor enquanto o painel
// está aberto (Screen Wake Lock). O navegador solta o bloqueio sozinho quando
// a janela fica escondida (minimizada, aba em segundo plano) ou o notebook
// troca de energia — então pedimos de novo ao voltar a ficar visível, no
// primeiro clique/tecla (alguns navegadores exigem um gesto) e a cada minuto.
function useTelaLigada() {
  const suportado = 'wakeLock' in navigator
  const [ativa, setAtiva] = useState(false)
  // O navegador respondeu "não" (economia de energia, política do sistema…):
  // clicar de novo não adianta, só ajustar a energia do Windows.
  const [negado, setNegado] = useState(false)
  const sentinela = useRef<WakeLockSentinel | null>(null)

  const pedir = useCallback(async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    if (sentinela.current && !sentinela.current.released) return
    try {
      const lock = await navigator.wakeLock.request('screen')
      sentinela.current = lock
      setAtiva(true)
      setNegado(false)
      lock.addEventListener('release', () => setAtiva(false))
    } catch {
      setAtiva(false)
      setNegado(true)
    }
  }, [])

  useEffect(() => {
    void pedir()
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') void pedir()
    }
    const aoInteragir = () => void pedir()
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    window.addEventListener('click', aoInteragir)
    window.addEventListener('keydown', aoInteragir)
    const renovar = setInterval(() => void pedir(), 60_000)
    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      window.removeEventListener('click', aoInteragir)
      window.removeEventListener('keydown', aoInteragir)
      clearInterval(renovar)
      void sentinela.current?.release()
    }
  }, [pedir])

  return { suportado, ativa, negado }
}

function Barra({ pct, cor = 'bg-[#00b499]' }: { pct: number; cor?: string }) {
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
  // Cor do marcador: verde recém-chegado → amarelo → laranja → vermelho no limite de 24h.
  const progresso = coluna.aberta ? Math.min(horas / LIMITE_HORAS, 1) : 0
  const matiz = MATIZ_VERDE * (1 - progresso)
  const estourou = coluna.aberta && horas >= LIMITE_HORAS
  return (
    <li
      className="rounded-lg border bg-white/[0.05] px-3 py-2"
      style={{
        borderColor: estourou ? 'hsl(0 80% 55% / 0.7)' : 'rgb(255 255 255 / 0.1)',
        ...(destaque ? { animation: 'tv-pisca 1.2s ease-in-out 6' } : {}),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums text-white/55">#{pedido.numero}</span>
        <span
          className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-base font-bold"
          style={
            coluna.aberta
              ? { backgroundColor: `hsl(${matiz} 80% 45% / 0.25)`, color: `hsl(${matiz} 90% 72%)` }
              : { backgroundColor: 'rgb(255 255 255 / 0.1)', color: 'rgb(255 255 255 / 0.7)' }
          }
        >
          {estourou ? '⏱ ' : ''}
          {texto}
        </span>
      </div>
      {coluna.aberta && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.max(progresso, 0.04) * 100}%`, backgroundColor: `hsl(${matiz} 80% 50%)` }}
          />
        </div>
      )}
      <p className="mt-1 truncate text-2xl font-bold leading-tight text-white">{pedido.vendedor}</p>
      <p className="truncate text-base text-white/55">{pedido.cliente}</p>
      {pedido.status === 'devolvido' && pedido.motivo && (
        <p className="truncate text-base font-semibold text-rose-300">⚠ {pedido.motivo}</p>
      )}
      {pedido.pre_venda && <p className="text-sm font-bold tracking-[0.2em] text-amber-300">PRÉ-VENDA</p>}
    </li>
  )
}

const ROTULO = 'text-[15px] font-semibold uppercase tracking-[0.18em] text-white/50'
const PAINEL = 'rounded-xl border border-white/10 bg-white/[0.04]'

export function TvPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { ativa: telaCheia, alternar: alternarTelaCheia } = useTelaCheia()
  const { suportado: wakeSuportado, ativa: telaLigada, negado: wakeNegado } = useTelaLigada()
  const { escala, esquerda, topo } = useEscala()
  const { dados, erro, atualizadoEm, evento, destaques } = usePainelTv()

  // Aberto pelo botão "Modo TV" é uma janela própria e fecha; aberto direto
  // pelo endereço, volta pra tela inicial da pessoa. Nunca desloga: a conta é
  // a de trabalho do financeiro.
  const fechar = () => {
    if (window.opener) window.close()
    else navigate(roleHome(profile?.role ?? 'financeiro'))
  }

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
      lista.sort((a, b) => (c.aberta ? a.desde.localeCompare(b.desde) : b.desde.localeCompare(a.desde)))
      return { coluna: c, lista }
    })
  }, [dados])

  const rankingPedidos = useMemo(
    () => (dados ? dados.vendedores.filter((v) => v.pedidos_hoje > 0).slice(0, 3) : []),
    [dados]
  )

  const dataAgora = new Date(agora)
  const dataExtenso = dataAgora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const hora = dataAgora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const semConexao = !!erro || (!!atualizadoEm && agora - atualizadoEm.getTime() > 120_000)

  if (!dados || !calculo) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#070d1a] text-white">
        <img src="/logo.png" alt="MCI" className="mb-8 h-24 w-auto object-contain" />
        <span className="material-symbols-outlined animate-spin text-[48px] text-[#00b499]">progress_activity</span>
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
    <div className="fixed inset-0 overflow-hidden bg-[#070d1a]">
      <div
        className="group absolute flex flex-col overflow-hidden bg-[#070d1a] px-6 pb-3 pt-4 text-white"
        style={{ width: LARGURA, height: ALTURA, left: esquerda, top: topo, transform: `scale(${escala})`, transformOrigin: 'top left' }}
      >
        <style>{`
          @keyframes tv-queda { 0% { transform: translateY(-8vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(108vh) rotate(540deg); opacity: 1 } }
          @keyframes tv-entra { 0% { transform: translate(-50%, -140%); opacity: 0 } 12% { transform: translate(-50%, 0); opacity: 1 } 90% { transform: translate(-50%, 0); opacity: 1 } 100% { transform: translate(-50%, -140%); opacity: 0 } }
          @keyframes tv-pisca { 0%, 100% { background-color: rgba(0, 180, 153, 0.40) } 50% { background-color: rgba(0, 180, 153, 0) } }
        `}</style>

        {confete && <Confete />}

        {evento && (
          <div
            key={evento.chave}
            className="fixed left-1/2 top-4 z-50 max-w-[80vw] rounded-2xl border border-white/20 bg-[#00b499] px-8 py-4 text-2xl font-bold text-white shadow-2xl"
            style={{ animation: 'tv-entra 9s ease-in-out forwards' }}
          >
            {rotuloEvento(evento)}
          </div>
        )}

        <header className="relative mb-3 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-5">
            <img src="/logo.png" alt="MCI" className="h-16 w-auto object-contain" />
            <div className="h-12 w-px bg-white/15" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Acompanhamento de Pedidos</h1>
              <p className="text-base capitalize text-white/50">{dataExtenso}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={alternarTelaCheia}
                title={telaCheia ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white"
              >
                <span className="material-symbols-outlined">{telaCheia ? 'fullscreen_exit' : 'fullscreen'}</span>
              </button>
              <button type="button" onClick={fechar} title="Fechar o painel" className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <span
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-base font-semibold ${
                semConexao ? 'border-rose-400/40 bg-rose-500/15 text-rose-300' : 'border-[#00b499]/40 bg-[#00b499]/15 text-[#3ddbc0]'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${semConexao ? 'bg-rose-400' : 'animate-pulse bg-[#3ddbc0]'}`} />
              {semConexao ? 'SEM CONEXÃO' : 'AO VIVO'}
            </span>
            <span className="text-6xl font-semibold tabular-nums tracking-tight">{hora}</span>
          </div>
        </header>

        <div className="relative mb-3 grid shrink-0 grid-cols-12 gap-4">
          <section className={`${PAINEL} col-span-5 px-5 py-3 ${metaDiaBatida ? '!border-[#00b499]/60 !bg-[#00b499]/15' : ''}`}>
            <div className="flex items-center justify-between">
              <h2 className={ROTULO}>Meta do dia</h2>
              {metaDiaBatida && (
                <span className="rounded-full bg-[#a8e063] px-3 py-0.5 text-base font-extrabold text-slate-900">🎉 META BATIDA!</span>
              )}
            </div>
            {semMeta ? (
              <p className="mt-2 text-xl text-white/60">Defina a meta do mês no Dashboard.</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3">
                  <span className="whitespace-nowrap text-4xl font-bold tabular-nums leading-tight">{formatCurrency(dados.faturado_hoje)}</span>
                  <span className="whitespace-nowrap pb-1 text-xl text-white/50">de {formatCurrency(calculo.metaDiaria)}</span>
                  <span className="text-4xl font-bold tabular-nums text-[#a8e063]">{Math.round(calculo.pctDia * 100)}%</span>
                </div>
                <div className="mt-1 h-3.5">
                  <Barra pct={calculo.pctDia} cor="bg-[#00b499]" />
                </div>
                <p className="mt-1 truncate text-lg font-medium text-white/80">
                  {!calculo.hojeUtil
                    ? 'Hoje não é dia útil — o que entrar conta pra meta do mês 💪'
                    : metaDiaBatida
                      ? 'Meta do dia batida! Cada pedido agora é bônus 🚀'
                      : `Faltam ${formatCurrency(calculo.metaDiaria - dados.faturado_hoje)} pra meta de hoje — manda esse pedido!`}
                </p>
              </>
            )}
          </section>

          <section className={`${PAINEL} col-span-4 px-5 py-3`}>
            <h2 className={ROTULO}>Meta do mês</h2>
            {semMeta ? (
              <p className="mt-2 text-xl text-white/60">Meta do mês não definida.</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3">
                  <span className="whitespace-nowrap text-3xl font-bold tabular-nums leading-tight">{formatCurrency(dados.faturado_mes)}</span>
                  <span className="whitespace-nowrap pb-1 text-lg text-white/50">de {formatCurrency(dados.meta_mes)}</span>
                  <span className="text-4xl font-bold tabular-nums text-sky-300">{Math.round(calculo.pctMes * 100)}%</span>
                </div>
                <div className="mt-1 h-3.5">
                  <Barra pct={calculo.pctMes} cor="bg-sky-400" />
                </div>
                <p className="mt-1 truncate text-lg text-white/75">
                  Faltam <strong className="text-white">{formatCurrency(calculo.faltaMes)}</strong> ·{' '}
                  <span className="text-amber-300">{formatCurrency(calculo.precisaPorDia)}/dia</span> em {calculo.diasRestantes}{' '}
                  {calculo.diasRestantes === 1 ? 'dia útil' : 'dias úteis'}
                </p>
              </>
            )}
          </section>

          <section className={`${PAINEL} col-span-3 px-5 py-3`}>
            <h2 className={ROTULO}>🚀 Pedidos enviados hoje</h2>
            {rankingPedidos.length === 0 ? (
              <p className="mt-2 text-xl font-medium text-white/70">Nenhum ainda — quem manda o primeiro? 🏁</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {rankingPedidos.map((v, i) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-2xl font-semibold">
                    <span className="truncate">
                      {MEDALHAS[i]} {v.nome}
                    </span>
                    <span className="tabular-nums text-[#a8e063]">{v.pedidos_hoje}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <CorridaCavalinhos vendedores={dados.vendedores} metaEmpresa={dados.meta_mes} />

        <div className="relative grid min-h-0 flex-1 grid-cols-7 gap-3">
          {colunas.map(({ coluna, lista }) => {
            const max = coluna.chave === 'devolvido' ? MAX_CARDS_DEVOLVIDOS : MAX_CARDS
            return (
            <section key={coluna.chave} className={`${PAINEL} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex min-h-0 flex-1 flex-col p-2">
                <h2 className="mb-2 flex shrink-0 items-center justify-between border-b border-white/10 px-1 pb-2 pt-1">
                  <span className="text-xl font-semibold text-white">{coluna.titulo}</span>
                  <span className="min-w-[2.5rem] rounded-md bg-white/10 px-2 py-0.5 text-center text-2xl font-semibold tabular-nums text-white">
                    {lista.length}
                  </span>
                </h2>
                <ul className="min-h-0 flex-1 space-y-2 overflow-hidden">
                  {lista.slice(0, max).map((p) => (
                    <Cartao key={p.numero} pedido={p} coluna={coluna} agora={agora} destaque={!!destaques[p.numero]} />
                  ))}
                  {lista.length === 0 && (
                    <li className="py-6 text-center text-xl text-white/35">
                      {coluna.chave === 'devolvido' ? 'Nenhum devolvido 👏' : 'Nenhum pedido'}
                    </li>
                  )}
                </ul>
                {lista.length > max && (
                  <p className="shrink-0 pt-1 text-center text-xl font-bold text-white/60">
                    + {lista.length - max} pedido{lista.length - max === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            </section>
            )
          })}
        </div>

        <footer className="relative mt-2 flex h-6 shrink-0 items-center justify-between text-sm text-white/40">
          <span>
            {atualizadoEm
              ? `Atualizado às ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : 'Atualizando…'}
          </span>
          <span className={telaLigada ? 'text-[#3ddbc0]/80' : wakeNegado || !wakeSuportado ? 'text-amber-300' : 'text-white/40'}>
            {telaLigada
              ? '● Tela mantida sempre ligada'
              : !wakeSuportado
                ? '⚠ Este navegador não consegue manter a tela ligada — use Chrome ou Edge'
                : wakeNegado
                  ? '⚠ Não foi possível manter a tela ligada — no Windows: Energia → Tela "Nunca" e Protetor de tela "Nenhum"'
                  : 'Ativando tela sempre ligada…'}
          </span>
          <span>MCI Importadora · Painel Comercial</span>
        </footer>
      </div>
    </div>
  )
}
