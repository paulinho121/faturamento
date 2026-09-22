import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { PedidoStatusBadge } from '../../components/pedidos/PedidoStatusBadge'
import { PedidoHistoricoModal } from '../../components/pedidos/PedidoHistoricoModal'
import { PedidoProgresso } from '../../components/pedidos/PedidoProgresso'
import { formatNumeroPedido } from '../../components/pedidos/pedidoUtils'
import { diretorNavItems } from './nav'
import type { Pedido } from '../../types/domain'

function combinaComBusca(busca: string, ...campos: (string | null | undefined)[]): boolean {
  const alvo = busca.trim().toLowerCase()
  if (!alvo) return true
  return campos.some((campo) => campo?.toLowerCase().includes(alvo))
}

type Aba = 'todos' | 'pendentes' | 'devolvidos' | 'faturados' | 'cancelados'

// Diretor só acompanha — sem aprovar, devolver, avançar etapa ou faturar,
// que são ações do financeiro/faturista.
export function DiretorPedidosPage() {
  const { profile } = useAuth()
  const { push } = useToast()

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('todos')
  const [busca, setBusca] = useState('')
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)

  async function loadPedidos() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, vendedores(nome)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (!error) setPedidos((data as Pedido[]) ?? [])
    setLoading(false)
  }

  async function handleDownloadPedido(pedido: Pedido) {
    const { data, error } = await supabase.storage.from('pedidos').download(pedido.arquivo_path)
    if (error || !data) {
      push('error', `Erro ao baixar pedido: ${error?.message ?? 'arquivo não encontrado'}`)
      return
    }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = pedido.arquivo_nome
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    loadPedidos()
  }, [])

  const pendentes = pedidos.filter((p) => p.status === 'pendente')
  const pedidosPorAba: Record<Aba, Pedido[]> = {
    todos: pedidos,
    pendentes,
    devolvidos: pedidos.filter((p) => p.status === 'devolvido'),
    faturados: pedidos.filter((p) => p.status === 'faturado'),
    cancelados: pedidos.filter((p) => p.status === 'cancelado'),
  }
  const pedidosExibidos = pedidosPorAba[aba].filter((p) =>
    combinaComBusca(busca, formatNumeroPedido(p.numero), p.cliente, p.vendedores?.nome)
  )

  return (
    <AppShell title="Pedidos" navItems={diretorNavItems(profile, pendentes.length)} onRefresh={loadPedidos}>
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden mb-lg">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Pedidos</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Acompanhamento dos pedidos enviados pelos vendedores até o faturamento.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant p-md">
          <div className="flex flex-wrap items-center gap-sm">
            {(
              [
                ['todos', 'Todos'],
                ['pendentes', 'Em andamento'],
                ['devolvidos', 'Devolvidos'],
                ['faturados', 'Faturados'],
                ['cancelados', 'Cancelados'],
              ] as const
            ).map(([chave, label]) => (
              <button
                key={chave}
                type="button"
                onClick={() => setAba(chave)}
                className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                  aba === chave ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {label}
                {pedidosPorAba[chave].length > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] ${
                      aba === chave ? 'bg-on-primary/20' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {pedidosPorAba[chave].length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pedido, cliente ou vendedor…"
            className="w-full rounded-full border border-outline-variant bg-surface-container-lowest px-md py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary sm:w-72"
          />
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : pedidosExibidos.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="task_alt" title={busca ? 'Nenhum pedido encontrado' : 'Nenhum pedido nesta situação'} />
          </div>
        ) : (
          <div className="max-h-[70vh] divide-y divide-outline-variant overflow-y-auto">
            {pedidosExibidos.map((pedido) => (
              <div key={pedido.id} className="p-lg">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      <span className="font-label-md text-label-md text-on-surface-variant">
                        {formatNumeroPedido(pedido.numero)}
                      </span>{' '}
                      {pedido.cliente}
                      {pedido.valor_estimado ? ` · ${formatCurrency(pedido.valor_estimado)}` : ''}
                    </p>
                    <p className="font-label-md text-label-md font-medium text-on-surface-variant">
                      {formatDateTime(pedido.created_at)}
                      {pedido.vendedores?.nome ? ` · Vendedor: ${pedido.vendedores.nome}` : ''}
                    </p>
                    {pedido.observacao && (
                      <p className="font-label-md text-label-md text-on-surface-variant">Obs.: {pedido.observacao}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-sm">
                    <PedidoStatusBadge pedido={pedido} />
                    <button
                      type="button"
                      onClick={() => setPedidoHistorico(pedido)}
                      title="Ver histórico"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[18px]">history</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadPedido(pedido)}
                      className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Baixar PDF
                    </button>
                  </div>
                </div>
                {pedido.devolvido_motivo && pedido.status === 'devolvido' && (
                  <p className="mt-sm rounded-lg bg-error/5 p-sm font-label-md text-label-md text-on-surface">
                    <b>Motivo da devolução:</b> {pedido.devolvido_motivo}
                  </p>
                )}
                {(pedido.status === 'pendente' || pedido.status === 'faturado') && (
                  <div className="mt-md px-xs pb-xs">
                    <PedidoProgresso pedido={pedido} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {pedidoHistorico && <PedidoHistoricoModal pedido={pedidoHistorico} onClose={() => setPedidoHistorico(null)} />}
    </AppShell>
  )
}
