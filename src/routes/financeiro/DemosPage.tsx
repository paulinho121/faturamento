import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { RetornoDemoModal } from '../../components/financeiro/RetornoDemoModal'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { diferencaEmDias, PRAZO_DEMO_DIAS, situacaoPrazoDemo, type NivelPrazoDemo } from '../../lib/demos'
import { hasModule } from '../../lib/modules'
import { financeiroNavItems } from './nav'

interface DemoRetorno {
  invoice_id: string
  numero_nf_retorno: string
  data_retorno: string
  observacao: string | null
}

interface NotaDemo {
  id: string
  numero_nf: string
  data_emissao: string
  cliente: string
  valor: number
  tipo_operacao: string
  vendedores: { nome: string } | null
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

const ESTILO_NIVEL: Record<NivelPrazoDemo, { barra: string; chip: string }> = {
  ok: { barra: 'bg-tertiary', chip: 'bg-tertiary/10 text-tertiary' },
  atencao: { barra: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800' },
  atrasada: { barra: 'bg-error', chip: 'bg-error/10 text-error' },
}

function textoPrazo(diasRestantes: number): string {
  if (diasRestantes < 0) {
    const d = Math.abs(diasRestantes)
    return `Atrasada há ${d} dia${d === 1 ? '' : 's'}`
  }
  if (diasRestantes === 0) return 'Vence hoje'
  return `Faltam ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}`
}

function combinaComBusca(busca: string, ...campos: (string | null | undefined)[]): boolean {
  const alvo = busca.trim().toLowerCase()
  if (!alvo) return true
  return campos.some((campo) => campo?.toLowerCase().includes(alvo))
}

export function DemosPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const podeRegistrar = hasModule(profile, 'financeiro')

  const [notas, setNotas] = useState<NotaDemo[]>([])
  const [retornos, setRetornos] = useState<Map<string, DemoRetorno>>(new Map())
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<'aberto' | 'devolvidas'>('aberto')
  const [busca, setBusca] = useState('')
  const [registrando, setRegistrando] = useState<NotaDemo | null>(null)
  const [desfazendoId, setDesfazendoId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [notasRes, retornosRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, numero_nf, data_emissao, cliente, valor, tipo_operacao, vendedores(nome)')
        .ilike('tipo_operacao', 'demo%')
        .eq('excluida', false)
        .order('data_emissao', { ascending: false })
        .limit(2000),
      supabase.from('demo_retornos').select('invoice_id, numero_nf_retorno, data_retorno, observacao').limit(5000),
    ])
    if (notasRes.error) push('error', `Erro ao carregar as demos: ${notasRes.error.message}`)
    if (retornosRes.error) {
      push('error', `Erro ao carregar os retornos (a migração 0086 foi aplicada?): ${retornosRes.error.message}`)
    }
    setNotas((notasRes.data as unknown as NotaDemo[]) ?? [])
    setRetornos(new Map(((retornosRes.data as DemoRetorno[]) ?? []).map((r) => [r.invoice_id, r])))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function desfazerRetorno(invoiceId: string) {
    const { error } = await supabase.from('demo_retornos').delete().eq('invoice_id', invoiceId)
    setDesfazendoId(null)
    if (error) {
      push('error', `Erro ao desfazer o retorno: ${error.message}`)
      return
    }
    push('success', 'Retorno desfeito — a demo voltou para "Em aberto".')
    load()
  }

  const dia = hoje()
  const emAberto = notas
    .filter((n) => !retornos.has(n.id))
    .map((n) => ({ nota: n, prazo: situacaoPrazoDemo(n.data_emissao, dia) }))
    // Mais urgente primeiro: atrasadas (mais antigas) e depois as que vencem antes.
    .sort((a, b) => a.prazo.diasRestantes - b.prazo.diasRestantes)
  const devolvidas = notas.filter((n) => retornos.has(n.id))

  const atrasadas = emAberto.filter((e) => e.prazo.nivel === 'atrasada').length
  const vencemEm7 = emAberto.filter((e) => e.prazo.diasRestantes >= 0 && e.prazo.diasRestantes <= 7).length
  const valorEmAberto = emAberto.reduce((acc, e) => acc + Number(e.nota.valor), 0)

  const abertoFiltradas = emAberto.filter(({ nota }) =>
    combinaComBusca(busca, nota.numero_nf, nota.cliente, nota.vendedores?.nome)
  )
  const devolvidasFiltradas = devolvidas.filter((nota) =>
    combinaComBusca(busca, nota.numero_nf, nota.cliente, nota.vendedores?.nome, retornos.get(nota.id)?.numero_nf_retorno)
  )

  return (
    <AppShell title="Demonstrações" navItems={financeiroNavItems(profile)} onRefresh={load}>
      <div className="mb-lg grid grid-cols-2 gap-md md:grid-cols-4">
        {[
          { label: 'Demos em aberto', valor: String(emAberto.length), cor: 'text-on-surface' },
          { label: 'Atrasadas', valor: String(atrasadas), cor: atrasadas > 0 ? 'text-error' : 'text-on-surface' },
          { label: 'Vencem em 7 dias', valor: String(vencemEm7), cor: vencemEm7 > 0 ? 'text-amber-700' : 'text-on-surface' },
          { label: 'Valor em demo', valor: formatCurrency(valorEmAberto), cor: 'text-on-surface' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-level2">
            <p className="font-label-md text-label-md text-on-surface-variant">{k.label}</p>
            <p className={`font-title-md text-title-md ${k.cor}`}>{k.valor}</p>
          </div>
        ))}
      </div>

      <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
        <div className="border-b border-outline-variant p-lg">
          <h3 className="font-title-md text-title-md text-on-surface">Notas de demonstração</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Cada demo tem {PRAZO_DEMO_DIAS} dias, contados da emissão da nota, para retornar. Quando voltar, registre o
            número da NF de retorno.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant p-md">
          <div className="flex gap-xs">
            {(
              [
                ['aberto', `Em aberto (${emAberto.length})`],
                ['devolvidas', `Devolvidas (${devolvidas.length})`],
              ] as const
            ).map(([chave, label]) => (
              <button
                key={chave}
                type="button"
                onClick={() => setAba(chave)}
                className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                  aba === chave
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por cliente, NF ou vendedor…"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-xs pl-[40px] pr-md font-body-md text-body-md text-on-surface outline-none focus:border-primary"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : aba === 'aberto' ? (
          abertoFiltradas.length === 0 ? (
            <EmptyState
              icon={busca.trim() ? 'search_off' : 'task_alt'}
              title={busca.trim() ? 'Nenhuma demo encontrada' : 'Nenhuma demo em aberto'}
              description={busca.trim() ? undefined : 'Notas com tipo de operação Demo/Demonstração aparecem aqui.'}
            />
          ) : (
            <div className="divide-y divide-outline-variant">
              {abertoFiltradas.map(({ nota, prazo }) => {
                const estilo = ESTILO_NIVEL[prazo.nivel]
                const pct = Math.min(Math.max((prazo.diasDecorridos / PRAZO_DEMO_DIAS) * 100, 0), 100)
                return (
                  <div key={nota.id} className="flex flex-wrap items-center justify-between gap-md p-lg">
                    <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
                      <p className="font-body-md font-semibold text-body-md text-on-surface">
                        NF #{nota.numero_nf} · {nota.cliente}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">
                        Emitida em {formatDate(nota.data_emissao)} · prazo até {formatDate(prazo.prazoFinal)}
                        {nota.vendedores?.nome ? ` · Vendedor: ${nota.vendedores.nome}` : ''} ·{' '}
                        {formatCurrency(Number(nota.valor))}
                      </p>
                      <div className="mt-xs h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-container-high">
                        <div className={`h-full rounded-full ${estilo.barra}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-sm">
                      <span
                        className={`flex items-center gap-xs whitespace-nowrap rounded-full px-md py-xs font-label-md text-label-md font-semibold ${estilo.chip}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">timer</span>
                        {textoPrazo(prazo.diasRestantes)}
                      </span>
                      {podeRegistrar && (
                        <button
                          type="button"
                          onClick={() => setRegistrando(nota)}
                          className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
                        >
                          Registrar retorno
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : devolvidasFiltradas.length === 0 ? (
          <EmptyState
            icon={busca.trim() ? 'search_off' : 'inventory_2'}
            title={busca.trim() ? 'Nenhuma demo encontrada' : 'Nenhuma demo devolvida ainda'}
          />
        ) : (
          <div className="divide-y divide-outline-variant">
            {devolvidasFiltradas.map((nota) => {
              const retorno = retornos.get(nota.id)!
              const prazoFinal = situacaoPrazoDemo(nota.data_emissao, retorno.data_retorno).prazoFinal
              const atraso = diferencaEmDias(prazoFinal, retorno.data_retorno)
              return (
                <div key={nota.id} className="flex flex-wrap items-center justify-between gap-md p-lg">
                  <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
                    <p className="font-body-md font-semibold text-body-md text-on-surface">
                      NF #{nota.numero_nf} · {nota.cliente}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      Emitida em {formatDate(nota.data_emissao)}
                      {nota.vendedores?.nome ? ` · Vendedor: ${nota.vendedores.nome}` : ''} · {formatCurrency(Number(nota.valor))}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface">
                      Retornou em {formatDate(retorno.data_retorno)} · <b>NF de retorno #{retorno.numero_nf_retorno}</b>
                      {retorno.observacao ? ` · ${retorno.observacao}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-sm">
                    <span
                      className={`whitespace-nowrap rounded-full px-md py-xs font-label-md text-label-md font-semibold ${
                        atraso > 0 ? 'bg-error/10 text-error' : 'bg-tertiary/10 text-tertiary'
                      }`}
                    >
                      {atraso > 0 ? `Voltou com ${atraso} dia${atraso === 1 ? '' : 's'} de atraso` : 'Voltou no prazo'}
                    </span>
                    {podeRegistrar &&
                      (desfazendoId === nota.id ? (
                        <span className="flex items-center gap-xs">
                          <button
                            type="button"
                            onClick={() => desfazerRetorno(nota.id)}
                            className="rounded-full bg-error px-md py-xs font-label-md text-label-md text-on-error hover:opacity-90"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDesfazendoId(null)}
                            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                          >
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDesfazendoId(nota.id)}
                          className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                        >
                          Desfazer
                        </button>
                      ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {registrando && (
        <RetornoDemoModal
          invoiceId={registrando.id}
          numeroNf={registrando.numero_nf}
          cliente={registrando.cliente}
          onClose={() => setRegistrando(null)}
          onDone={() => {
            setRegistrando(null)
            load()
          }}
        />
      )}
    </AppShell>
  )
}
