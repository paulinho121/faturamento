import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatDate } from '../../lib/format'
import { PedidoStatusBadge } from '../../components/pedidos/PedidoStatusBadge'
import { PedidoHistoricoModal } from '../../components/pedidos/PedidoHistoricoModal'
import { DevolverPedidoModal } from '../../components/pedidos/DevolverPedidoModal'
import { formatNumeroPedido, podeDevolver } from '../../components/pedidos/pedidoUtils'
import { financeiroNavItems } from './nav'
import type { Pedido } from '../../types/domain'

function combinaComBusca(busca: string, ...campos: (string | null | undefined)[]): boolean {
  const alvo = busca.trim().toLowerCase()
  if (!alvo) return true
  return campos.some((campo) => campo?.toLowerCase().includes(alvo))
}

export function FinanceiroPedidosPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()

  // Pedidos enviados pelos vendedores, aguardando o financeiro revisar o PDF
  // e aprovar (selo informativo pro faturista, não trava faturar).
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(true)
  const [aprovandoPedidoId, setAprovandoPedidoId] = useState<string | null>(null)
  const [pedidoAba, setPedidoAba] = useState<'aprovar' | 'aprovados' | 'devolvidos' | 'faturados'>('aprovar')
  const [buscaPedido, setBuscaPedido] = useState('')
  const [pedidoParaDevolver, setPedidoParaDevolver] = useState<Pedido | null>(null)
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)

  async function loadPedidos() {
    setLoadingPedidos(true)
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, vendedores(nome)')
      .neq('status', 'cancelado')
      .order('created_at', { ascending: false })
      .limit(300)
    if (!error) setPedidos((data as Pedido[]) ?? [])
    setLoadingPedidos(false)
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

  async function handleAprovarPedido(pedido: Pedido) {
    if (!session) return
    setAprovandoPedidoId(pedido.id)
    const { error } = await supabase
      .from('pedidos')
      .update({ aprovado_financeiro: true, aprovado_em: new Date().toISOString(), aprovado_por: session.user.id })
      .eq('id', pedido.id)
    setAprovandoPedidoId(null)
    if (error) {
      push('error', `Erro ao aprovar pedido: ${error.message}`)
      return
    }
    push('success', 'Pedido aprovado.')
    loadPedidos()
  }

  useEffect(() => {
    loadPedidos()
  }, [])

  const pedidosPorAba = {
    aprovar: pedidos.filter((p) => p.status === 'pendente' && !p.aprovado_financeiro).reverse(),
    aprovados: pedidos.filter((p) => p.status === 'pendente' && p.aprovado_financeiro),
    devolvidos: pedidos.filter((p) => p.status === 'devolvido'),
    faturados: pedidos.filter((p) => p.status === 'faturado'),
  }
  const pedidosExibidos = pedidosPorAba[pedidoAba].filter((p) =>
    combinaComBusca(buscaPedido, formatNumeroPedido(p.numero), p.cliente, p.vendedores?.nome)
  )

  return (
    <AppShell
      title="Pedidos"
      navItems={financeiroNavItems(profile, pedidosPorAba.aprovar.length)}
      onRefresh={loadPedidos}
    >
      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Gestão de Pedidos</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Confira o PDF, aprove ou devolva ao vendedor para correção. Pedido faturado fica travado.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant p-md">
          <div className="flex flex-wrap items-center gap-sm">
            {(
              [
                ['aprovar', 'Para aprovar'],
                ['aprovados', 'Aprovados'],
                ['devolvidos', 'Devolvidos'],
                ['faturados', 'Faturados'],
              ] as const
            ).map(([chave, label]) => (
              <button
                key={chave}
                type="button"
                onClick={() => setPedidoAba(chave)}
                className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                  pedidoAba === chave
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {label}
                {pedidosPorAba[chave].length > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] ${
                      pedidoAba === chave ? 'bg-on-primary/20' : 'bg-amber-100 text-amber-700'
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
            value={buscaPedido}
            onChange={(e) => setBuscaPedido(e.target.value)}
            placeholder="Buscar pedido, cliente ou vendedor…"
            className="w-full rounded-full border border-outline-variant bg-surface-container-lowest px-md py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary sm:w-72"
          />
        </div>
        {loadingPedidos ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : pedidosExibidos.length === 0 ? (
          <div className="p-lg">
            <EmptyState
              icon="task_alt"
              title={buscaPedido ? 'Nenhum pedido encontrado' : 'Nenhum pedido nesta situação'}
            />
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
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {formatDate(pedido.created_at.slice(0, 10))}
                      {pedido.vendedores?.nome ? ` · Vendedor: ${pedido.vendedores.nome}` : ''}
                    </p>
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
                    {podeDevolver(pedido) && (
                      <button
                        type="button"
                        onClick={() => setPedidoParaDevolver(pedido)}
                        className="flex items-center gap-xs rounded-full border border-error/40 px-md py-xs font-label-md text-label-md text-error transition-colors hover:bg-error/5"
                      >
                        <span className="material-symbols-outlined text-[16px]">undo</span>
                        Devolver
                      </button>
                    )}
                    {pedido.status === 'pendente' && !pedido.aprovado_financeiro && (
                      <button
                        type="button"
                        onClick={() => handleAprovarPedido(pedido)}
                        disabled={aprovandoPedidoId === pedido.id}
                        className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">check</span>
                        {aprovandoPedidoId === pedido.id ? 'Salvando…' : 'Aprovar'}
                      </button>
                    )}
                  </div>
                </div>
                {pedido.observacao && (
                  <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                    Obs. do vendedor: {pedido.observacao}
                  </p>
                )}
                {pedido.status === 'devolvido' && pedido.devolvido_motivo && (
                  <p className="mt-sm rounded-lg bg-error/5 p-sm font-label-md text-label-md text-on-surface">
                    <b>Motivo da devolução:</b> {pedido.devolvido_motivo}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {pedidoParaDevolver && (
        <DevolverPedidoModal
          pedido={pedidoParaDevolver}
          onClose={() => setPedidoParaDevolver(null)}
          onDone={() => {
            setPedidoParaDevolver(null)
            loadPedidos()
          }}
        />
      )}

      {pedidoHistorico && <PedidoHistoricoModal pedido={pedidoHistorico} onClose={() => setPedidoHistorico(null)} />}
    </AppShell>
  )
}
