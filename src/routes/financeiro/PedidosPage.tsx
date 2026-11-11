import { useEffect, useRef, useState } from 'react'
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

const LIMITE_BUSCA = 200
const MIN_CARACTERES_BUSCA = 2

// Tira o que quebraria o filtro .or() do PostgREST (vírgula, parênteses, curingas) do texto digitado.
function termoSeguro(texto: string): string {
  return texto.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function FinanceiroPedidosPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()

  // Pedidos enviados pelos vendedores, aguardando o financeiro revisar o PDF
  // e aprovar (selo informativo pro faturista, não trava faturar).
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(true)
  const [aprovandoPedidoId, setAprovandoPedidoId] = useState<string | null>(null)
  const [pedidoAba, setPedidoAba] = useState<'aprovar' | 'aprovados' | 'pre_venda' | 'devolvidos' | 'faturados'>(
    'aprovar'
  )
  const [buscaPedido, setBuscaPedido] = useState('')
  const [pedidoParaDevolver, setPedidoParaDevolver] = useState<Pedido | null>(null)
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)

  // Busca global: consulta o banco inteiro (inclusive pedidos antigos, fora dos 300 mais recentes das abas).
  const [termoBusca, setTermoBusca] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<Pedido[]>([])
  const [buscando, setBuscando] = useState(false)
  const termoAtivoRef = useRef('')
  const buscaSeqRef = useRef(0)
  const emBusca = termoBusca.length >= MIN_CARACTERES_BUSCA

  async function executarBusca(termo: string) {
    const seq = ++buscaSeqRef.current
    setBuscando(true)
    const filtros: string[] = [
      `cliente.ilike.%${termo}%`,
      `observacao.ilike.%${termo}%`,
      `numero_pedido_cd.ilike.%${termo}%`,
      `numero_nf.ilike.%${termo}%`,
      `id_externo.ilike.%${termo}%`,
    ]
    // "PED-0074", "ped74" ou só "74" encontram o pedido de número 74.
    const numero = termo.match(/^(?:ped-?\s*)?0*(\d{1,9})$/i)
    if (numero) filtros.push(`numero.eq.${Number(numero[1])}`)
    // Vendedor: acha os ids pelo nome e inclui no filtro.
    const { data: vend } = await supabase.from('vendedores').select('id').ilike('nome', `%${termo}%`).limit(50)
    if (vend && vend.length > 0) filtros.push(`vendedor_id.in.(${vend.map((v) => v.id).join(',')})`)

    const { data, error } = await supabase
      .from('pedidos')
      .select('*, vendedores(nome)')
      .or(filtros.join(','))
      .order('created_at', { ascending: false })
      .limit(LIMITE_BUSCA)
    if (seq !== buscaSeqRef.current) return // chegou uma busca mais nova: descarta esta
    if (error) push('error', `Erro na busca: ${error.message}`)
    setResultadosBusca(error ? [] : ((data as Pedido[]) ?? []))
    setBuscando(false)
  }

  // Espera a pessoa parar de digitar antes de consultar.
  useEffect(() => {
    const t = setTimeout(() => setTermoBusca(termoSeguro(buscaPedido)), 350)
    return () => clearTimeout(t)
  }, [buscaPedido])

  useEffect(() => {
    if (termoBusca.length >= MIN_CARACTERES_BUSCA) {
      termoAtivoRef.current = termoBusca
      executarBusca(termoBusca)
    } else {
      termoAtivoRef.current = ''
      buscaSeqRef.current++
      setResultadosBusca([])
      setBuscando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termoBusca])

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
    // Atualiza também o resultado da busca aberta (depois de aprovar/devolver, por exemplo).
    if (termoAtivoRef.current) executarBusca(termoAtivoRef.current)
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
    pre_venda: pedidos.filter((p) => p.pre_venda),
    devolvidos: pedidos.filter((p) => p.status === 'devolvido'),
    faturados: pedidos.filter((p) => p.status === 'faturado'),
  }
  // Com busca ativa, a lista vira o resultado global (todas as situações); sem ela, a aba escolhida.
  const pedidosExibidos = emBusca ? resultadosBusca : pedidosPorAba[pedidoAba]
  const carregandoLista = emBusca ? buscando : loadingPedidos

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
                ['pre_venda', 'Pré-vendas'],
                ['devolvidos', 'Devolvidos'],
                ['faturados', 'Faturados'],
              ] as const
            ).map(([chave, label]) => (
              <button
                key={chave}
                type="button"
                onClick={() => {
                  setBuscaPedido('')
                  setTermoBusca('')
                  setPedidoAba(chave)
                }}
                className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                  !emBusca && pedidoAba === chave
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {label}
                {pedidosPorAba[chave].length > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] ${
                      !emBusca && pedidoAba === chave
                        ? 'bg-on-primary/20'
                        : chave === 'pre_venda'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {pedidosPorAba[chave].length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-96">
            <span className="material-symbols-outlined pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              type="text"
              value={buscaPedido}
              onChange={(e) => setBuscaPedido(e.target.value)}
              placeholder="Buscar em todos os pedidos (cliente, vendedor, nº, NF, ERP, CRM)…"
              className="w-full rounded-full border border-outline-variant bg-surface-container-lowest py-xs pl-[40px] pr-[36px] font-body-md text-body-md text-on-surface outline-none focus:border-primary"
            />
            {buscaPedido && (
              <button
                type="button"
                onClick={() => setBuscaPedido('')}
                aria-label="Limpar busca"
                className="absolute right-xs top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>
        </div>
        {emBusca && (
          <div className="border-b border-outline-variant bg-primary/5 px-lg py-sm font-label-md text-label-md text-on-surface-variant">
            {buscando
              ? 'Buscando em todos os pedidos…'
              : `${resultadosBusca.length}${resultadosBusca.length >= LIMITE_BUSCA ? '+' : ''} resultado${resultadosBusca.length === 1 ? '' : 's'} em todos os pedidos, inclusive os antigos`}
            {!buscando && resultadosBusca.length >= LIMITE_BUSCA && ` — mostrando os ${LIMITE_BUSCA} mais recentes, refine a busca`}
          </div>
        )}
        {carregandoLista ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : pedidosExibidos.length === 0 ? (
          <div className="p-lg">
            <EmptyState
              icon={emBusca ? 'search_off' : 'task_alt'}
              title={emBusca ? 'Nenhum pedido encontrado' : 'Nenhum pedido nesta situação'}
              description={emBusca ? 'Tente outro nome, número do pedido, NF ou ID do CRM.' : undefined}
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
                      {pedido.numero_pedido_cd ? ` · ERP ${pedido.numero_pedido_cd}` : ''}
                      {pedido.numero_nf ? ` · NF ${pedido.numero_nf}` : ''}
                      {pedido.id_externo ? ` · CRM ${pedido.id_externo}` : ''}
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
