import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { EntregaModal } from '../../components/logistica/EntregaModal'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import { COLUNAS_ENTREGA, diasDeAtraso, haQuanto, hojeIso, type Entrega, type EntregaStatus } from '../../lib/entregas'
import { formatNumeroPedido } from '../../components/pedidos/pedidoUtils'
import { diretorNavItems } from '../diretor/nav'
import { logisticaNavItems } from './nav'

type Filtro = 'todas' | 'problema' | 'atrasadas'

const POLL_MS = 60_000

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

function Cartao({ entrega, onAbrir }: { entrega: Entrega; onAbrir: () => void }) {
  const atraso = diasDeAtraso(entrega)
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`w-full rounded-lg border bg-surface-container-lowest p-sm text-left transition-colors hover:bg-surface-container-low ${
        entrega.ocorrencia ? 'border-error/50' : atraso > 0 ? 'border-amber-400' : 'border-outline-variant'
      }`}
    >
      <div className="flex items-center justify-between gap-xs">
        <span className="font-label-md text-label-md text-on-surface-variant">{formatNumeroPedido(entrega.pedido_numero)}</span>
        <span className="flex items-center gap-xs">
          {entrega.id_externo && (
            <span className="rounded-full bg-primary/10 px-xs font-label-md text-label-md text-primary">CRM</span>
          )}
          {entrega.volumes ? (
            <span className="font-label-md text-label-md text-on-surface-variant">📦 {entrega.volumes}</span>
          ) : null}
        </span>
      </div>
      <p className="mt-xs truncate font-body-md text-body-md font-semibold text-on-surface">{entrega.cliente}</p>
      <p className="truncate font-label-md text-label-md text-on-surface-variant">{entrega.vendedor}</p>

      <p className="mt-xs truncate font-label-md text-label-md text-on-surface">
        {entrega.numero_nf ? `NF ${entrega.numero_nf}` : 'NF não informada'}
        {entrega.nf_valor != null ? ` · ${formatCurrency(Number(entrega.nf_valor))}` : ''}
      </p>
      <p className="flex items-center gap-xs truncate font-label-md text-label-md text-on-surface-variant">
        <span className="material-symbols-outlined text-[14px]">local_shipping</span>
        {entrega.transportadora ?? 'sem transportadora'}
      </p>

      {entrega.status === 'entregue' || entrega.status === 'finalizado' ? (
        <p className="mt-xs font-label-md text-label-md text-tertiary">
          Entregue{entrega.entregue_em ? ` em ${formatDate(entrega.entregue_em.slice(0, 10))}` : ''}
        </p>
      ) : (
        <p className={`mt-xs font-label-md text-label-md ${atraso > 0 ? 'font-semibold text-error' : 'text-on-surface-variant'}`}>
          {entrega.previsao_chegada
            ? `Previsão: ${formatDate(entrega.previsao_chegada)}${atraso > 0 ? ` · ${atraso} ${atraso === 1 ? 'dia' : 'dias'} de atraso` : ''}`
            : 'Sem previsão de chegada'}
        </p>
      )}
      {entrega.ocorrencia && (
        <p className="mt-xs line-clamp-2 rounded bg-error/5 px-xs font-label-md text-label-md text-error">
          ⚠ {entrega.ultima_ocorrencia ?? 'Problema com a carga'}
        </p>
      )}
      <p className="mt-xs font-label-md text-label-md text-on-surface-variant/70">Faturado {haQuanto(entrega.faturado_em)}</p>
    </button>
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

  const hoje = hojeIso()
  const buscaNorm = busca.trim().toLowerCase()
  const visiveis = useMemo(
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

  const abertas = entregas.filter((e) => e.status === 'aguardando_despacho' || e.status === 'em_transito')
  const comProblema = entregas.filter((e) => e.ocorrencia && e.status !== 'finalizado').length
  const atrasadas = abertas.filter((e) => diasDeAtraso(e, hoje) > 0).length
  const aberta = abertaId ? entregas.find((e) => e.id === abertaId) ?? null : null

  return (
    <AppShell title={`${saudacao}, ${profile?.full_name ?? 'Logística'}`} navItems={
        profile?.role === 'diretor'
          ? diretorNavItems(profile)
          : logisticaNavItems(entregas.filter((e) => e.status === 'aguardando_despacho').length)
      } onRefresh={carregar}>
      <div className="mb-md flex flex-wrap items-center gap-sm">
        {(
          [
            ['todas', 'Todas', abertas.length],
            ['problema', 'Com problema', comProblema],
            ['atrasadas', 'Atrasadas', atrasadas],
          ] as const
        ).map(([valor, rotulo, qtd]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            aria-pressed={filtro === valor}
            className={`rounded-full border px-md py-xs font-label-md text-label-md transition-colors ${
              filtro === valor
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {rotulo} · {qtd}
          </button>
        ))}
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

      {carregando ? (
        <div className="grid gap-md lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : erro ? (
        <EmptyState icon="error" title={erro} />
      ) : (
        <div className="grid items-start gap-md lg:grid-cols-4">
          {COLUNAS_ENTREGA.map((coluna) => {
            const lista = ordenar(
              coluna.status,
              visiveis.filter((e) => e.status === coluna.status)
            )
            return (
              <section key={coluna.status} className="rounded-xl border border-outline-variant bg-surface-container-low p-sm">
                <header className="mb-sm px-xs">
                  <h3 className="flex items-center gap-xs font-title-md text-title-md text-on-surface">
                    <span className="material-symbols-outlined text-[20px] text-primary">{coluna.icone}</span>
                    {coluna.titulo}
                    <span className="ml-auto rounded-full bg-surface-container-high px-sm font-label-md text-label-md text-on-surface-variant">
                      {lista.length}
                    </span>
                  </h3>
                  <p className="font-label-md text-label-md text-on-surface-variant">{coluna.ajuda}</p>
                </header>
                <div className="space-y-sm">
                  {lista.length === 0 ? (
                    <p className="px-xs py-md text-center font-label-md text-label-md text-on-surface-variant">Nada por aqui.</p>
                  ) : (
                    lista.map((e) => <Cartao key={e.id} entrega={e} onAbrir={() => setAbertaId(e.id)} />)
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
