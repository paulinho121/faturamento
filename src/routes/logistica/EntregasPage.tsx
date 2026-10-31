import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { EntregaModal } from '../../components/logistica/EntregaModal'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import {
  COLUNAS_ENTREGA,
  ESTILO_STATUS,
  dataCurta,
  diasDeAtraso,
  haQuanto,
  hojeIso,
  type Entrega,
  type EntregaStatus,
} from '../../lib/entregas'
import { formatNumeroPedido } from '../../components/pedidos/pedidoUtils'
import { diretorNavItems } from '../diretor/nav'
import { logisticaNavItems } from './nav'

type Filtro = 'todas' | 'problema' | 'atrasadas'
type Visao = 'quadro' | 'lista'

const POLL_MS = 60_000
const CHAVE_VISAO = 'logistica:visao'

const COLUNAS_GRID: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
}

function visaoSalva(): Visao {
  try {
    return localStorage.getItem(CHAVE_VISAO) === 'lista' ? 'lista' : 'quadro'
  } catch {
    return 'quadro'
  }
}

// Mais urgente primeiro: aguardando despacho = faturado há mais tempo; em trânsito =
// previsão mais próxima (sem previsão por último); entregues/finalizados = mais recentes.
function ordenar(status: EntregaStatus, lista: Entrega[]): Entrega[] {
  const copia = [...lista]
  if (status === 'aguardando_despacho') {
    return copia.sort((a, b) => (a.faturado_em ?? '').localeCompare(b.faturado_em ?? ''))
  }
  if (status === 'em_transito') {
    return copia.sort((a, b) => (a.previsao_chegada ?? '9999').localeCompare(b.previsao_chegada ?? '9999'))
  }
  return copia.sort((a, b) => (b.finalizado_em ?? b.entregue_em ?? '').localeCompare(a.finalizado_em ?? a.entregue_em ?? ''))
}

function Alertas({ entrega }: { entrega: Entrega }) {
  const atraso = diasDeAtraso(entrega)
  return (
    <span className="flex shrink-0 items-center gap-xs">
      {entrega.ocorrencia && (
        <span title="Problema com a carga" className="rounded-full bg-error px-xs font-label-md text-label-md text-on-error">
          ⚠
        </span>
      )}
      {atraso > 0 && (
        <span title={`${atraso} dia(s) de atraso`} className="rounded-full bg-red-100 px-xs font-label-md text-label-md font-semibold text-red-700">
          ⏱ {atraso}d
        </span>
      )}
    </span>
  )
}

function Cartao({
  entrega,
  aberto,
  onAlternar,
  onAbrirDetalhes,
}: {
  entrega: Entrega
  aberto: boolean
  onAlternar: () => void
  onAbrirDetalhes: () => void
}) {
  const estilo = ESTILO_STATUS[entrega.status]
  const atraso = diasDeAtraso(entrega)
  const entregue = entrega.status === 'entregue' || entrega.status === 'finalizado'
  return (
    <div
      className={`overflow-hidden rounded-lg border border-l-4 bg-surface-container-lowest ${estilo.bordaEsq} ${
        entrega.ocorrencia ? 'border-error/60' : 'border-outline-variant'
      }`}
    >
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className={`flex w-full items-start gap-xs px-xs py-xs text-left transition-colors hover:bg-surface-container-low ${aberto ? estilo.fundo : ''}`}
      >
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-on-surface-variant">
          {aberto ? 'expand_less' : 'expand_more'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body-md text-body-md font-semibold text-on-surface">
            <span className="font-label-md text-label-md font-normal text-on-surface-variant">{formatNumeroPedido(entrega.pedido_numero)}</span>{' '}
            {entrega.cliente}
          </span>
          <span className="block truncate font-label-md text-label-md text-on-surface-variant">
            {entrega.numero_nf ? `NF ${entrega.numero_nf}` : 'sem NF'} · {entrega.transportadora ?? 'sem transportadora'}
            {!entregue && entrega.previsao_chegada ? ` · prev. ${dataCurta(entrega.previsao_chegada)}` : ''}
          </span>
        </span>
        <Alertas entrega={entrega} />
      </button>

      {aberto && (
        <div className={`space-y-xs border-t border-outline-variant px-sm py-xs ${estilo.fundo}`}>
          <p className="font-label-md text-label-md text-on-surface">
            <span className="text-on-surface-variant">Vendedor:</span> {entrega.vendedor}
            {entrega.id_externo && <span className="ml-xs rounded-full bg-primary/10 px-xs text-primary">CRM</span>}
          </p>
          <p className="font-label-md text-label-md text-on-surface">
            <span className="text-on-surface-variant">NF:</span> {entrega.numero_nf ?? 'não informada'}
            {entrega.nf_valor != null ? ` · ${formatCurrency(Number(entrega.nf_valor))}` : ''}
            {entrega.volumes ? ` · 📦 ${entrega.volumes} ${entrega.volumes === 1 ? 'vol.' : 'vols.'}` : ''}
          </p>
          <p className="font-label-md text-label-md text-on-surface">
            <span className="text-on-surface-variant">Transporte:</span> {entrega.transportadora ?? '—'}
            {entrega.codigo_rastreio ? ` · ${entrega.codigo_rastreio}` : ''}
          </p>
          <p className={`font-label-md text-label-md ${atraso > 0 ? 'font-semibold text-red-700' : 'text-on-surface'}`}>
            <span className="font-normal text-on-surface-variant">{entregue ? 'Entrega:' : 'Previsão:'}</span>{' '}
            {entregue
              ? entrega.entregue_em
                ? formatDate(entrega.entregue_em.slice(0, 10))
                : '—'
              : entrega.previsao_chegada
                ? `${formatDate(entrega.previsao_chegada)}${atraso > 0 ? ` · ${atraso} ${atraso === 1 ? 'dia' : 'dias'} de atraso` : ''}`
                : 'sem previsão'}
          </p>
          {entrega.ocorrencia && (
            <p className="rounded bg-error/10 px-xs font-label-md text-label-md text-error">
              ⚠ {entrega.ultima_ocorrencia ?? 'Problema com a carga'}
            </p>
          )}
          <div className="flex items-center justify-between gap-xs pt-xs">
            <span className="font-label-md text-label-md text-on-surface-variant/70">Faturado {haQuanto(entrega.faturado_em)}</span>
            <button
              type="button"
              onClick={onAbrirDetalhes}
              className="flex items-center gap-xs rounded-full bg-primary px-md py-0.5 font-label-md text-label-md text-on-primary hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              Detalhes e ações
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Lista({ entregas, onAbrir }: { entregas: Entrega[]; onAbrir: (id: string) => void }) {
  const ordem = COLUNAS_ENTREGA.flatMap((c) =>
    ordenar(
      c.status,
      entregas.filter((e) => e.status === c.status)
    )
  )
  const TH = 'whitespace-nowrap px-sm py-xs font-label-md text-label-md text-on-surface-variant'
  const TD = 'px-sm py-xs font-label-md text-label-md text-on-surface'
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
      <table className="w-full text-left">
        <thead className="bg-surface-container-low">
          <tr>
            <th className={TH}>Processo</th>
            <th className={TH}>Pedido</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Vendedor</th>
            <th className={TH}>NF</th>
            <th className={TH}>Transportadora</th>
            <th className={TH}>Previsão</th>
            <th className={TH}>Vol.</th>
            <th className={TH}>Faturado</th>
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody>
          {ordem.map((e) => {
            const estilo = ESTILO_STATUS[e.status]
            const atraso = diasDeAtraso(e)
            const titulo = COLUNAS_ENTREGA.find((c) => c.status === e.status)?.titulo ?? e.status
            const entregue = e.status === 'entregue' || e.status === 'finalizado'
            return (
              <tr
                key={e.id}
                onClick={() => onAbrir(e.id)}
                className={`cursor-pointer border-t border-l-4 border-outline-variant hover:bg-surface-container-low ${estilo.bordaEsq}`}
              >
                <td className={TD}>
                  <span className={`whitespace-nowrap rounded-full px-sm py-0.5 ${estilo.selo}`}>{titulo}</span>
                </td>
                <td className={`${TD} whitespace-nowrap text-on-surface-variant`}>
                  {formatNumeroPedido(e.pedido_numero)}
                  {e.id_externo && <span className="ml-xs rounded-full bg-primary/10 px-xs text-primary">CRM</span>}
                </td>
                <td className={`${TD} max-w-[16rem] truncate font-semibold`}>{e.cliente}</td>
                <td className={`${TD} whitespace-nowrap`}>{e.vendedor}</td>
                <td className={`${TD} whitespace-nowrap`}>{e.numero_nf ?? '—'}</td>
                <td className={`${TD} max-w-[12rem] truncate`}>{e.transportadora ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap ${atraso > 0 ? 'font-semibold text-red-700' : ''}`}>
                  {entregue
                    ? e.entregue_em
                      ? `entregue ${dataCurta(e.entregue_em.slice(0, 10))}`
                      : '—'
                    : e.previsao_chegada
                      ? dataCurta(e.previsao_chegada)
                      : '—'}
                </td>
                <td className={TD}>{e.volumes ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap text-on-surface-variant`}>{haQuanto(e.faturado_em)}</td>
                <td className={TD}>
                  <Alertas entrega={e} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function EntregasPage() {
  const { profile } = useAuth()
  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [entregas, setEntregas] = useState<Entrega[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [statusFiltro, setStatusFiltro] = useState<EntregaStatus | null>(null)
  const [visao, setVisao] = useState<Visao>(visaoSalva)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [abertaId, setAbertaId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('logistica_entregas')
    if (error) {
      setErro(error.message)
    } else if (!data) {
      setErro('Esta conta não tem acesso às entregas.')
    } else {
      setErro(null)
      setEntregas(data as Entrega[])
    }
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(carregar, POLL_MS)
    return () => clearInterval(t)
  }, [carregar])

  function trocarVisao(nova: Visao) {
    setVisao(nova)
    try {
      localStorage.setItem(CHAVE_VISAO, nova)
    } catch {
      // sem armazenamento local: só não lembra a escolha
    }
  }

  function alternar(id: string) {
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (!novo.delete(id)) novo.add(id)
      return novo
    })
  }

  const hoje = hojeIso()
  const buscaNorm = busca.trim().toLowerCase()
  // Busca + filtro de problema/atraso; os contadores por processo saem daqui.
  const base = useMemo(
    () =>
      entregas.filter((e) => {
        if (filtro === 'problema' && !e.ocorrencia) return false
        if (filtro === 'atrasadas' && diasDeAtraso(e, hoje) === 0) return false
        if (!buscaNorm) return true
        return [e.cliente, e.vendedor, e.numero_nf ?? '', e.transportadora ?? '', e.codigo_rastreio ?? '', String(e.pedido_numero)]
          .some((campo) => campo.toLowerCase().includes(buscaNorm))
      }),
    [entregas, filtro, buscaNorm, hoje]
  )
  const visiveis = statusFiltro ? base.filter((e) => e.status === statusFiltro) : base
  const colunas = statusFiltro ? COLUNAS_ENTREGA.filter((c) => c.status === statusFiltro) : COLUNAS_ENTREGA

  const abertas = entregas.filter((e) => e.status === 'aguardando_despacho' || e.status === 'em_transito')
  const comProblema = entregas.filter((e) => e.ocorrencia && e.status !== 'finalizado').length
  const atrasadas = abertas.filter((e) => diasDeAtraso(e, hoje) > 0).length
  const aberta = abertaId ? (entregas.find((e) => e.id === abertaId) ?? null) : null
  const todosAbertos = visiveis.length > 0 && visiveis.every((e) => abertos.has(e.id))

  return (
    <AppShell
      title={`${saudacao}, ${profile?.full_name ?? 'Logística'}`}
      navItems={
        profile?.role === 'diretor'
          ? diretorNavItems(profile)
          : logisticaNavItems(entregas.filter((e) => e.status === 'aguardando_despacho').length)
      }
      onRefresh={carregar}
    >
      <div className="mb-sm flex flex-wrap items-center gap-sm">
        <div className="flex overflow-hidden rounded-full border border-outline-variant" role="group" aria-label="Forma de visualização">
          {(
            [
              ['quadro', 'view_kanban', 'Quadro'],
              ['lista', 'table_rows', 'Lista'],
            ] as const
          ).map(([valor, icone, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => trocarVisao(valor)}
              aria-pressed={visao === valor}
              className={`flex items-center gap-xs px-md py-xs font-label-md text-label-md transition-colors ${
                visao === valor ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{icone}</span>
              {rotulo}
            </button>
          ))}
        </div>
        {visao === 'quadro' && (
          <button
            type="button"
            onClick={() => setAbertos(todosAbertos ? new Set() : new Set(visiveis.map((e) => e.id)))}
            className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[16px]">{todosAbertos ? 'unfold_less' : 'unfold_more'}</span>
            {todosAbertos ? 'Recolher todos' : 'Expandir todos'}
          </button>
        )}
        <div className="relative ml-auto">
          <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
            search
          </span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por NF, cliente, vendedor, transportadora…"
            className="w-64 rounded-full border border-outline-variant bg-surface-container-lowest py-xs pl-xl pr-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none sm:w-96"
          />
        </div>
      </div>

      <div className="mb-md flex flex-wrap items-center gap-xs">
        {COLUNAS_ENTREGA.map((c) => {
          const estilo = ESTILO_STATUS[c.status]
          const ativo = statusFiltro === c.status
          return (
            <button
              key={c.status}
              type="button"
              onClick={() => setStatusFiltro(ativo ? null : c.status)}
              aria-pressed={ativo}
              title={ativo ? 'Mostrar todos os processos' : `Mostrar só: ${c.titulo}`}
              className={`flex items-center gap-xs rounded-full border px-md py-0.5 font-label-md text-label-md transition-colors ${
                ativo ? estilo.chipAtivo : estilo.chip
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${ativo ? 'bg-white' : estilo.ponto}`} />
              {c.titulo} · {base.filter((e) => e.status === c.status).length}
            </button>
          )
        })}
        <span className="mx-xs h-5 w-px bg-outline-variant" />
        {(
          [
            ['todas', 'Todas', abertas.length],
            ['problema', '⚠ Com problema', comProblema],
            ['atrasadas', '⏱ Atrasadas', atrasadas],
          ] as const
        ).map(([valor, rotulo, qtd]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            aria-pressed={filtro === valor}
            className={`rounded-full border px-md py-0.5 font-label-md text-label-md transition-colors ${
              filtro === valor
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {rotulo} · {qtd}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="grid gap-md lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : erro ? (
        <EmptyState icon="error" title={erro} />
      ) : visao === 'lista' ? (
        visiveis.length === 0 ? (
          <EmptyState icon="local_shipping" title="Nenhuma entrega encontrada" />
        ) : (
          <Lista entregas={visiveis} onAbrir={setAbertaId} />
        )
      ) : (
        <div className={`grid items-start gap-sm ${COLUNAS_GRID[colunas.length] ?? 'lg:grid-cols-4'}`}>
          {colunas.map((coluna) => {
            const estilo = ESTILO_STATUS[coluna.status]
            const lista = ordenar(
              coluna.status,
              visiveis.filter((e) => e.status === coluna.status)
            )
            return (
              <section key={coluna.status} className="min-w-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
                <header className={`px-sm py-xs ${estilo.cabecalho}`}>
                  <h3 className="flex items-center gap-xs font-title-md text-title-md">
                    <span className="material-symbols-outlined text-[20px]">{coluna.icone}</span>
                    {coluna.titulo}
                    <span className="ml-auto rounded-full bg-white/70 px-sm font-label-md text-label-md">{lista.length}</span>
                  </h3>
                </header>
                <div className="space-y-xs p-xs lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto">
                  {lista.length === 0 ? (
                    <p className="px-xs py-md text-center font-label-md text-label-md text-on-surface-variant">Nada por aqui.</p>
                  ) : (
                    lista.map((e) => (
                      <Cartao
                        key={e.id}
                        entrega={e}
                        aberto={abertos.has(e.id)}
                        onAlternar={() => alternar(e.id)}
                        onAbrirDetalhes={() => setAbertaId(e.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {aberta && <EntregaModal key={aberta.id} entrega={aberta} onClose={() => setAbertaId(null)} onChanged={carregar} />}
    </AppShell>
  )
}
