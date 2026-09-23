import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime } from '../../lib/format'
import { PedidoStatusBadge } from '../../components/pedidos/PedidoStatusBadge'
import { PedidoHistoricoModal } from '../../components/pedidos/PedidoHistoricoModal'
import { DevolverPedidoModal } from '../../components/pedidos/DevolverPedidoModal'
import { PedidoOrientacaoModal } from '../../components/pedidos/PedidoOrientacaoModal'
import { PedidoProgresso } from '../../components/pedidos/PedidoProgresso'
import { IniciarProcessoModal } from '../../components/pedidos/IniciarProcessoModal'
import {
  formatNumeroPedido,
  podeAlternarPreVenda,
  podeDevolver,
  proximaAcao,
  statusOrientacao,
} from '../../components/pedidos/pedidoUtils'
import { faturistaNavItems } from './nav'
import type { Pedido, PedidoOrientacao } from '../../types/domain'

interface GrupoPedidosDia {
  dia: string
  label: string
  itens: Pedido[]
}

function labelDia(dia: string): string {
  const hoje = new Date().toISOString().slice(0, 10)
  const ontemDate = new Date()
  ontemDate.setDate(ontemDate.getDate() - 1)
  const ontem = ontemDate.toISOString().slice(0, 10)
  if (dia === hoje) return 'Hoje'
  if (dia === ontem) return 'Ontem'
  return formatDate(dia)
}

// Agrupa por dia (mais recente primeiro) pra dar pro faturista a noção do
// volume diário de pedidos — parte da rotina de conferir "o que chegou hoje".
function agruparPedidosPorDia(lista: Pedido[]): GrupoPedidosDia[] {
  const grupos = new Map<string, GrupoPedidosDia>()
  for (const pedido of lista) {
    const dia = pedido.created_at.slice(0, 10)
    if (!grupos.has(dia)) grupos.set(dia, { dia, label: labelDia(dia), itens: [] })
    grupos.get(dia)!.itens.push(pedido)
  }
  return Array.from(grupos.values()).sort((a, b) => (a.dia < b.dia ? 1 : -1))
}

export function FaturistaPedidosPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(true)
  const [pedidoParaDevolver, setPedidoParaDevolver] = useState<Pedido | null>(null)
  const [pedidoIniciando, setPedidoIniciando] = useState<Pedido | null>(null)
  const [avancandoId, setAvancandoId] = useState<string | null>(null)
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)
  const [marcandoFaturadoId, setMarcandoFaturadoId] = useState<string | null>(null)
  const [alternandoPreVendaId, setAlternandoPreVendaId] = useState<string | null>(null)
  const [aba, setAba] = useState<'andamento' | 'pre_venda'>('andamento')
  const [orientacoesPorPedido, setOrientacoesPorPedido] = useState<Record<string, PedidoOrientacao[]>>({})
  const [pedidoOrientacao, setPedidoOrientacao] = useState<Pedido | null>(null)

  async function loadPedidos() {
    setLoadingPedidos(true)
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, vendedores(nome)')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
    const lista = (data as Pedido[]) ?? []
    if (!error) setPedidos(lista)
    setLoadingPedidos(false)

    if (lista.length > 0) {
      const { data: orientacoes } = await supabase
        .from('pedido_orientacoes')
        .select('*')
        .in('pedido_id', lista.map((p) => p.id))
      const mapa: Record<string, PedidoOrientacao[]> = {}
      for (const o of (orientacoes as PedidoOrientacao[]) ?? []) (mapa[o.pedido_id] ??= []).push(o)
      setOrientacoesPorPedido(mapa)
    }
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

  async function handleAvancarPedido(pedido: Pedido, etapa: Pedido['etapa']) {
    setAvancandoId(pedido.id)
    const { error } = await supabase.from('pedidos').update({ etapa }).eq('id', pedido.id)
    setAvancandoId(null)
    if (error) {
      push('error', `Erro ao avançar o pedido: ${error.message}`)
      return
    }
    push('success', 'Etapa atualizada — o vendedor já vê o andamento.')
    loadPedidos()
  }

  async function handleMarcarFaturado(pedido: Pedido) {
    if (!session) return
    setMarcandoFaturadoId(pedido.id)
    const { error } = await supabase
      .from('pedidos')
      .update({ status: 'faturado', faturado_em: new Date().toISOString(), faturado_por: session.user.id })
      .eq('id', pedido.id)
    setMarcandoFaturadoId(null)
    if (error) {
      push('error', `Erro ao marcar pedido como faturado: ${error.message}`)
      return
    }
    push('success', 'Pedido marcado como faturado.')
    loadPedidos()
  }

  async function handleTogglePreVenda(pedido: Pedido) {
    setAlternandoPreVendaId(pedido.id)
    const { error } = await supabase.from('pedidos').update({ pre_venda: !pedido.pre_venda }).eq('id', pedido.id)
    setAlternandoPreVendaId(null)
    if (error) {
      push('error', `Erro ao atualizar pré-venda: ${error.message}`)
      return
    }
    push('success', pedido.pre_venda ? 'Pedido voltou para o fluxo normal.' : 'Pedido marcado como pré-venda.')
    loadPedidos()
  }

  useEffect(() => {
    loadPedidos()
  }, [])

  const emAndamento = pedidos.filter((p) => !p.pre_venda)
  const emPreVenda = pedidos.filter((p) => p.pre_venda)
  const pedidosExibidos = aba === 'andamento' ? emAndamento : emPreVenda
  const gruposPedidos = agruparPedidosPorDia(pedidosExibidos)

  return (
    <AppShell title="Pedidos" navItems={faturistaNavItems(profile, emAndamento.length)} onRefresh={loadPedidos}>
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden mb-lg">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Pedidos Pendentes</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Pedidos enviados pelos vendedores, aguardando virar nota fiscal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-sm border-b border-outline-variant p-md">
          {(
            [
              ['andamento', 'Em andamento', emAndamento.length],
              ['pre_venda', 'Pré-vendas', emPreVenda.length],
            ] as const
          ).map(([chave, label, total]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setAba(chave)}
              className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                aba === chave ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
              {total > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    aba === chave
                      ? 'bg-on-primary/20'
                      : chave === 'pre_venda'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {total}
                </span>
              )}
            </button>
          ))}
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
              title={aba === 'pre_venda' ? 'Nenhum pedido em pré-venda' : 'Nenhum pedido pendente'}
            />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {gruposPedidos.map((grupo) => (
              <div key={grupo.dia}>
                <div className="flex items-center gap-sm bg-surface-container-low px-lg py-xs">
                  <span className="font-label-md text-label-md font-medium text-on-surface">{grupo.label}</span>
                  <span className="font-label-md text-label-md text-on-surface-variant">
                    · {grupo.itens.length} pedido{grupo.itens.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="divide-y divide-outline-variant">
                  {grupo.itens.map((pedido) => (
                    <div key={pedido.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                      <div className="min-w-0">
                        <p className="font-body-md text-body-md text-on-surface">
                          <span className="font-label-md text-label-md text-on-surface-variant">
                            {formatNumeroPedido(pedido.numero)}
                          </span>{' '}
                          {pedido.cliente}
                        </p>
                        <p className="font-label-md text-label-md font-medium text-on-surface-variant">
                          {formatDateTime(pedido.created_at)}
                          {pedido.vendedores?.nome ? ` · Vendedor: ${pedido.vendedores.nome}` : ''}
                        </p>
                        {pedido.observacao && (
                          <p className="font-label-md text-label-md text-on-surface-variant">
                            Obs.: {pedido.observacao}
                          </p>
                        )}
                        <div className="mt-xs">
                          <PedidoStatusBadge pedido={pedido} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-sm">
                        <button
                          type="button"
                          onClick={() => setPedidoHistorico(pedido)}
                          title="Ver histórico"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                        >
                          <span className="material-symbols-outlined text-[18px]">history</span>
                        </button>
                        {!pedido.pre_venda && podeDevolver(pedido) && (
                          <button
                            type="button"
                            onClick={() => setPedidoParaDevolver(pedido)}
                            className="flex items-center gap-xs rounded-full border border-error/40 px-md py-xs font-label-md text-label-md text-error transition-colors hover:bg-error/5"
                          >
                            <span className="material-symbols-outlined text-[16px]">undo</span>
                            Devolver
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownloadPedido(pedido)}
                          className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          Baixar PDF
                        </button>
                        {(() => {
                          const status = statusOrientacao(orientacoesPorPedido[pedido.id])
                          return (
                            <button
                              type="button"
                              onClick={() => setPedidoOrientacao(pedido)}
                              className={`flex items-center gap-xs rounded-full border px-md py-xs font-label-md text-label-md transition-colors ${
                                status === 'pendente'
                                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                                  : status === 'respondida'
                                    ? 'border-tertiary/40 text-tertiary hover:bg-tertiary/5'
                                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[16px]">help_center</span>
                              {status === 'pendente'
                                ? 'Aguardando Bianca'
                                : status === 'respondida'
                                  ? 'Orientação recebida'
                                  : 'Consultar Bianca'}
                            </button>
                          )
                        })()}
                        {podeAlternarPreVenda(pedido) && (
                          <button
                            type="button"
                            onClick={() => handleTogglePreVenda(pedido)}
                            disabled={alternandoPreVendaId === pedido.id}
                            className={`flex items-center gap-xs rounded-full border px-md py-xs font-label-md text-label-md transition-colors disabled:opacity-50 ${
                              pedido.pre_venda
                                ? 'border-violet-300 text-violet-700 hover:bg-violet-50'
                                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                            {alternandoPreVendaId === pedido.id
                              ? 'Salvando…'
                              : pedido.pre_venda
                                ? 'Tirar da pré-venda'
                                : 'Marcar pré-venda'}
                          </button>
                        )}
                        {!pedido.pre_venda && (
                          <>
                            {(() => {
                              const proxima = proximaAcao(pedido)
                              if (!proxima) return null
                              return (
                                <button
                                  type="button"
                                  onClick={() =>
                                    proxima.etapa === 'em_processo'
                                      ? setPedidoIniciando(pedido)
                                      : handleAvancarPedido(pedido, proxima.etapa)
                                  }
                                  disabled={avancandoId === pedido.id}
                                  className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                                  {avancandoId === pedido.id ? 'Salvando…' : proxima.botao}
                                </button>
                              )
                            })()}
                            <button
                              type="button"
                              onClick={() => handleMarcarFaturado(pedido)}
                              disabled={marcandoFaturadoId === pedido.id}
                              className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-opacity hover:opacity-90 disabled:opacity-50 ${
                                proximaAcao(pedido)
                                  ? 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                                  : 'bg-primary text-on-primary'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[16px]">check</span>
                              {marcandoFaturadoId === pedido.id ? 'Salvando…' : 'Marcar como Faturado'}
                            </button>
                          </>
                        )}
                      </div>
                      <div className="w-full px-xs pt-sm">
                        <PedidoProgresso pedido={pedido} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pedidoIniciando && (
        <IniciarProcessoModal
          pedido={pedidoIniciando}
          onClose={() => setPedidoIniciando(null)}
          onDone={() => {
            setPedidoIniciando(null)
            loadPedidos()
          }}
        />
      )}

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

      {pedidoOrientacao && (
        <PedidoOrientacaoModal
          pedido={pedidoOrientacao}
          onClose={() => setPedidoOrientacao(null)}
          onEnviado={loadPedidos}
        />
      )}
    </AppShell>
  )
}
