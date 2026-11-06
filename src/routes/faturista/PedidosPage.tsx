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
import { CorrigirNumeroErpModal } from '../../components/pedidos/CorrigirNumeroErpModal'
import { SeparacaoCeModal } from '../../components/pedidos/SeparacaoCeModal'
import { FaturarParcialModal } from '../../components/pedidos/FaturarParcialModal'
import { FaturarPedidoModal } from '../../components/pedidos/FaturarPedidoModal'
import {
  aguardaSeparacaoFaturista,
  aguardaSeparacaoLogistica,
  exigeSeparacaoLogistica,
  formatNumeroPedido,
  motivoBloqueioFaturar,
  podeAlternarPreVenda,
  podeDevolver,
  podeMarcarNfServico,
  proximaAcao,
  separacaoPeloFaturista,
  statusOrientacao,
} from '../../components/pedidos/pedidoUtils'
import { faturistaNavItems } from './nav'
import type { Pedido, PedidoOrientacao } from '../../types/domain'

interface GrupoPedidosDia {
  dia: string
  label: string
  itens: Pedido[]
}

// Ações secundárias: discretas, sem borda, para o olho ir direto nos botões principais.
const BOTAO_SECUNDARIO =
  'flex items-center gap-xs rounded-full px-sm py-0.5 font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50'

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

// Cor da faixa lateral: onde o pedido está (esperando a logística, separado, em andamento).
function faixaDoPedido(pedido: Pedido): string {
  if (pedido.nf_servico) return 'border-l-sky-400'
  if (pedido.parcial) return 'border-l-violet-500'
  if (aguardaSeparacaoLogistica(pedido) || aguardaSeparacaoFaturista(pedido)) return 'border-l-amber-400'
  if (exigeSeparacaoLogistica(pedido) && pedido.separacao_concluida_em) return 'border-l-tertiary'
  if (pedido.etapa === 'enviado') return 'border-l-outline-variant'
  return 'border-l-primary'
}

export function FaturistaPedidosPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(true)
  const [pedidoParaDevolver, setPedidoParaDevolver] = useState<Pedido | null>(null)
  const [pedidoIniciando, setPedidoIniciando] = useState<Pedido | null>(null)
  const [pedidoCorrigindoErp, setPedidoCorrigindoErp] = useState<Pedido | null>(null)
  const [pedidoSeparandoCe, setPedidoSeparandoCe] = useState<Pedido | null>(null)
  const [pedidoFaturandoParcial, setPedidoFaturandoParcial] = useState<Pedido | null>(null)
  const [avancandoId, setAvancandoId] = useState<string | null>(null)
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)
  const [pedidoFaturando, setPedidoFaturando] = useState<Pedido | null>(null)
  const [alternandoPreVendaId, setAlternandoPreVendaId] = useState<string | null>(null)
  const [alternandoServicoId, setAlternandoServicoId] = useState<string | null>(null)
  const [aba, setAba] = useState<'andamento' | 'pre_venda'>('andamento')
  const [orientacoesPorPedido, setOrientacoesPorPedido] = useState<Record<string, PedidoOrientacao[]>>({})
  const [pedidoOrientacao, setPedidoOrientacao] = useState<Pedido | null>(null)

  async function loadPedidos(silencioso = false) {
    if (!silencioso) setLoadingPedidos(true)
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
    if (separacaoPeloFaturista(pedido) && etapa === 'em_separacao') {
      // CE: o faturista mesmo informa série e volumes — já abre a janela.
      push('success', 'Separação iniciada — informe o número de série e os volumes para poder faturar.')
      setPedidoSeparandoCe({ ...pedido, etapa })
    } else {
      push(
        'success',
        exigeSeparacaoLogistica(pedido) && etapa === 'em_separacao'
          ? 'Pedido enviado para a logística separar — quando ela informar série e volumes, você libera o faturamento.'
          : 'Etapa atualizada — o vendedor já vê o andamento.'
      )
    }
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

  // NF de serviço: o pedido vai direto para SP (origem), sem separação, e fica pronto para faturar.
  async function handleToggleNfServico(pedido: Pedido) {
    setAlternandoServicoId(pedido.id)
    const { error } = await supabase.from('pedidos').update({ nf_servico: !pedido.nf_servico }).eq('id', pedido.id)
    setAlternandoServicoId(null)
    if (error) {
      push('error', `Erro ao atualizar NF de serviço: ${error.message}`)
      return
    }
    push(
      'success',
      pedido.nf_servico
        ? 'NF de serviço desmarcada. O pedido segue o fluxo normal (origem SP).'
        : 'Marcado como NF de serviço: origem SP, sem separação — já pode faturar.'
    )
    loadPedidos()
  }

  async function copiarSeries(pedido: Pedido) {
    try {
      await navigator.clipboard.writeText(pedido.numeros_serie ?? '')
      push('success', 'Números de série copiados.')
    } catch {
      push('error', 'Não consegui copiar — selecione o texto e copie manualmente.')
    }
  }

  useEffect(() => {
    loadPedidos()
  }, [])

  const emAndamento = pedidos.filter((p) => !p.pre_venda)
  const emPreVenda = pedidos.filter((p) => p.pre_venda)
  const pedidosExibidos = aba === 'andamento' ? emAndamento : emPreVenda
  const gruposPedidos = agruparPedidosPorDia(pedidosExibidos)
  const esperandoLogistica = pedidos.filter(aguardaSeparacaoLogistica).length

  // Enquanto algum pedido espera a logística, confere de tempos em tempos (sem piscar a tela)
  // para liberar o faturamento assim que a separação for concluída.
  useEffect(() => {
    if (esperandoLogistica === 0) return
    const id = window.setInterval(() => loadPedidos(true), 30000)
    return () => window.clearInterval(id)
  }, [esperandoLogistica])

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
          {esperandoLogistica > 0 && (
            <span className="ml-auto flex items-center gap-xs rounded-full bg-amber-100 px-md py-xs font-label-md text-label-md text-amber-800">
              <span className="material-symbols-outlined text-[16px]">inventory</span>
              {esperandoLogistica} aguardando a logística
            </span>
          )}
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
          <div>
            {gruposPedidos.map((grupo) => (
              <div key={grupo.dia}>
                <div className="flex items-center gap-sm border-y border-outline-variant bg-surface-container px-lg py-xs">
                  <span className="font-label-md text-label-md font-semibold text-on-surface">{grupo.label}</span>
                  <span className="font-label-md text-label-md text-on-surface-variant">
                    · {grupo.itens.length} pedido{grupo.itens.length === 1 ? '' : 's'}
                  </span>
                </div>
                {grupo.itens.map((pedido, i) => {
                  const proxima = proximaAcao(pedido)
                  const bloqueio = motivoBloqueioFaturar(pedido)
                  const status = statusOrientacao(orientacoesPorPedido[pedido.id])
                  const aguardaLogistica = aguardaSeparacaoLogistica(pedido)
                  const aguardaFaturista = aguardaSeparacaoFaturista(pedido)
                  const separado = exigeSeparacaoLogistica(pedido) && !!pedido.separacao_concluida_em
                  return (
                    // Zebra: linhas alternadas, com uma faixa colorida na lateral para o estado do pedido.
                    <div
                      key={pedido.id}
                      className={`space-y-sm border-b border-l-4 border-b-outline-variant/60 px-lg py-md ${faixaDoPedido(pedido)} ${
                        i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-body-md text-body-md text-on-surface">
                            <span className="font-label-md text-label-md text-on-surface-variant">
                              {formatNumeroPedido(pedido.numero)}
                            </span>{' '}
                            <span className="font-semibold">{pedido.cliente}</span>
                          </p>
                          <p className="font-label-md text-label-md text-on-surface-variant">
                            {formatDateTime(pedido.created_at)}
                            {pedido.vendedores?.nome ? ` · Vendedor: ${pedido.vendedores.nome}` : ''}
                            {pedido.numero_pedido_cd ? ` · ERP ${pedido.numero_pedido_cd}` : ''}
                          </p>
                          <div className="mt-xs">
                            <PedidoStatusBadge pedido={pedido} />
                          </div>
                        </div>

                        {/* Só o que o faturista faz agora: próximo passo e faturar. */}
                        {!pedido.pre_venda && (
                          <div className="flex flex-wrap items-center justify-end gap-sm">
                            {proxima && (
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
                            )}
                            {pedido.parcial && (
                              <button
                                type="button"
                                onClick={() => setPedidoFaturandoParcial(pedido)}
                                disabled={!!bloqueio}
                                title={bloqueio ?? 'Fatura só a parte pronta; o pedido continua em Pedidos faturados parcialmente'}
                                className="flex items-center gap-xs rounded-full bg-violet-600 px-md py-xs font-label-md text-label-md text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <span className="material-symbols-outlined text-[16px]">{bloqueio ? 'lock' : 'pending_actions'}</span>
                                Faturar parcial
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setPedidoFaturando(pedido)}
                              disabled={!!bloqueio}
                              title={bloqueio ?? undefined}
                              className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                                proxima || pedido.parcial
                                  ? 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                                  : 'bg-primary text-on-primary'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[16px]">{bloqueio ? 'lock' : 'check'}</span>
                              {pedido.parcial
                                ? pedido.parcial_faturada_em
                                  ? 'Faturar restante'
                                  : 'Faturar tudo'
                                : 'Marcar como Faturado'}
                            </button>
                          </div>
                        )}
                      </div>

                      {pedido.observacao && (
                        <p className="font-label-md text-label-md text-on-surface-variant">Obs.: {pedido.observacao}</p>
                      )}

                      {pedido.nf_servico && (
                        <p className="flex items-start gap-xs rounded-lg border border-sky-300 bg-sky-50 px-sm py-xs font-label-md text-label-md text-sky-900">
                          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                          <span>NF de serviço: origem São Paulo, sem separação da logística. Pode faturar direto.</span>
                        </p>
                      )}

                      {pedido.parcial && (
                        <div className="rounded-lg border border-violet-300 bg-violet-50 px-sm py-xs font-label-md text-label-md text-violet-900">
                          <p className="flex items-center gap-xs font-semibold">
                            <span className="material-symbols-outlined text-[18px]">pending_actions</span>
                            Pedido parcial
                            {(pedido.parcial_nfs ?? []).length > 0 && ` · NF parcial ${pedido.parcial_nfs.join(', ')}`}
                          </p>
                          {pedido.parcial_obs && (
                            <p className="whitespace-pre-wrap break-words">Faltam faturar: {pedido.parcial_obs}</p>
                          )}
                        </div>
                      )}

                      {aguardaLogistica && (
                        <p className="flex items-start gap-xs rounded-lg border border-amber-300 bg-amber-50 px-sm py-xs font-label-md text-label-md text-amber-900">
                          <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
                          <span>
                            Com a logística: ela separa e informa número de série e volumes. O faturamento libera
                            sozinho quando ela concluir.
                          </span>
                        </p>
                      )}

                      {aguardaFaturista && (
                        <div className="flex flex-wrap items-center justify-between gap-sm rounded-lg border border-amber-300 bg-amber-50 px-sm py-xs">
                          <p className="flex items-start gap-xs font-label-md text-label-md text-amber-900">
                            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
                            <span>Pedido de CE: informe o número de série (NS) e os volumes para poder faturar.</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => setPedidoSeparandoCe(pedido)}
                            className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit_note</span>
                            Informar série e volumes
                          </button>
                        </div>
                      )}

                      {separado && (
                        <div className="rounded-lg border border-tertiary/40 bg-tertiary/5 px-sm py-xs">
                          <div className="flex flex-wrap items-center justify-between gap-xs">
                            <p className="flex items-center gap-xs font-label-md text-label-md font-semibold text-tertiary">
                              <span className="material-symbols-outlined text-[18px]">inventory</span>
                              {pedido.origem === 'CE' ? 'Série e volumes informados' : 'Separado pela logística'} · 📦{' '}
                              {pedido.volumes ?? '?'} {pedido.volumes === 1 ? 'volume' : 'volumes'}
                            </p>
                            <div className="flex flex-wrap items-center gap-xs">
                              {separacaoPeloFaturista(pedido) && pedido.etapa === 'em_separacao' && (
                                <button type="button" onClick={() => setPedidoSeparandoCe(pedido)} className={BOTAO_SECUNDARIO}>
                                  <span className="material-symbols-outlined text-[16px]">edit</span>
                                  Editar
                                </button>
                              )}
                              {pedido.numeros_serie && (
                                <button type="button" onClick={() => copiarSeries(pedido)} className={BOTAO_SECUNDARIO}>
                                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                  Copiar séries
                                </button>
                              )}
                            </div>
                          </div>
                          {pedido.numeros_serie && (
                            <pre className="mt-xs max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-on-surface">
                              {pedido.numeros_serie}
                            </pre>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-xs">
                        <button
                          type="button"
                          onClick={() => setPedidoHistorico(pedido)}
                          title="Ver histórico"
                          className={BOTAO_SECUNDARIO}
                        >
                          <span className="material-symbols-outlined text-[16px]">history</span>
                          Histórico
                        </button>
                        <button type="button" onClick={() => handleDownloadPedido(pedido)} className={BOTAO_SECUNDARIO}>
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          Baixar PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => setPedidoOrientacao(pedido)}
                          className={`${BOTAO_SECUNDARIO} ${
                            status === 'pendente'
                              ? '!bg-amber-100 !text-amber-800'
                              : status === 'respondida'
                                ? '!text-tertiary'
                                : ''
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">help_center</span>
                          {status === 'pendente'
                            ? 'Aguardando Bianca'
                            : status === 'respondida'
                              ? 'Orientação recebida'
                              : 'Consultar Bianca'}
                        </button>
                        {podeMarcarNfServico(pedido) && (
                          <button
                            type="button"
                            onClick={() => handleToggleNfServico(pedido)}
                            disabled={alternandoServicoId === pedido.id}
                            title="Nota fiscal de serviço: vai direto para São Paulo, sem separação"
                            className={`${BOTAO_SECUNDARIO} ${pedido.nf_servico ? '!bg-sky-100 !text-sky-800' : ''}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                            {alternandoServicoId === pedido.id
                              ? 'Salvando…'
                              : pedido.nf_servico
                                ? 'Tirar NF de serviço'
                                : 'NF de serviço'}
                          </button>
                        )}
                        {pedido.origem === 'SC' && pedido.numero_pedido_cd && (
                          <button type="button" onClick={() => setPedidoCorrigindoErp(pedido)} className={BOTAO_SECUNDARIO}>
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Corrigir nº do ERP
                          </button>
                        )}
                        {podeAlternarPreVenda(pedido) && (
                          <button
                            type="button"
                            onClick={() => handleTogglePreVenda(pedido)}
                            disabled={alternandoPreVendaId === pedido.id}
                            className={`${BOTAO_SECUNDARIO} ${pedido.pre_venda ? '!bg-violet-100 !text-violet-700' : ''}`}
                          >
                            <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                            {alternandoPreVendaId === pedido.id
                              ? 'Salvando…'
                              : pedido.pre_venda
                                ? 'Tirar da pré-venda'
                                : 'Marcar pré-venda'}
                          </button>
                        )}
                        {!pedido.pre_venda && podeDevolver(pedido) && (
                          <button
                            type="button"
                            onClick={() => setPedidoParaDevolver(pedido)}
                            className={`${BOTAO_SECUNDARIO} !text-error hover:!bg-error/5`}
                          >
                            <span className="material-symbols-outlined text-[16px]">undo</span>
                            Devolver
                          </button>
                        )}
                      </div>

                      <div className="rounded-lg bg-surface-container-lowest/70 px-xs pb-xs pt-sm">
                        <PedidoProgresso pedido={pedido} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {pedidoFaturando && (
        <FaturarPedidoModal
          pedido={pedidoFaturando}
          onClose={() => setPedidoFaturando(null)}
          onDone={() => {
            setPedidoFaturando(null)
            loadPedidos()
          }}
        />
      )}

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

      {pedidoFaturandoParcial && (
        <FaturarParcialModal
          pedido={pedidoFaturandoParcial}
          onClose={() => setPedidoFaturandoParcial(null)}
          onDone={() => {
            setPedidoFaturandoParcial(null)
            loadPedidos()
          }}
        />
      )}

      {pedidoSeparandoCe && (
        <SeparacaoCeModal
          pedido={pedidoSeparandoCe}
          onClose={() => setPedidoSeparandoCe(null)}
          onDone={() => {
            setPedidoSeparandoCe(null)
            loadPedidos()
          }}
        />
      )}

      {pedidoCorrigindoErp && (
        <CorrigirNumeroErpModal
          pedido={pedidoCorrigindoErp}
          onClose={() => setPedidoCorrigindoErp(null)}
          onDone={() => {
            setPedidoCorrigindoErp(null)
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
