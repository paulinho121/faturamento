import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import { nomeArquivoSeguro } from '../../lib/storage'
import { PedidoStatusBadge } from './PedidoStatusBadge'
import { PedidoHistoricoModal } from './PedidoHistoricoModal'
import { PedidoProgresso } from './PedidoProgresso'
import { ORIGENS, formatNumeroPedido, hashArquivo, isPedidoDuplicadoError } from './pedidoUtils'
import type { Pedido, PedidoEvento, PedidoOrigem } from '../../types/domain'

// Formulário de envio/correção de pedido + lista "meus pedidos" — usado
// tanto na página de Pedidos do vendedor quanto, quando um diretor também
// vende, na página de Pedidos do diretor (mesmo comportamento, o `vendedorId`
// é que muda quem é o dono dos pedidos).
export function EnviarPedidoCard({ vendedorId }: { vendedorId: string }) {
  const { session } = useAuth()
  const { push } = useToast()

  const [meusPedidos, setMeusPedidos] = useState<Pedido[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(true)
  const [pedidoCliente, setPedidoCliente] = useState('')
  const [pedidoValor, setPedidoValor] = useState('')
  const [pedidoObservacao, setPedidoObservacao] = useState('')
  const [pedidoOrigem, setPedidoOrigem] = useState<PedidoOrigem | ''>('')
  const [eventosPorPedido, setEventosPorPedido] = useState<Record<string, PedidoEvento[]>>({})
  const [pedidoEmEdicao, setPedidoEmEdicao] = useState<Pedido | null>(null)
  const [duplicadoSugerido, setDuplicadoSugerido] = useState<Pedido | null>(null)
  const [pedidoHistorico, setPedidoHistorico] = useState<Pedido | null>(null)
  const [cancelandoPedidoId, setCancelandoPedidoId] = useState<string | null>(null)
  const formPedidoRef = useRef<HTMLDivElement>(null)
  const [pedidoArquivo, setPedidoArquivo] = useState<File | null>(null)
  const [enviandoPedido, setEnviandoPedido] = useState(false)
  const pedidoArquivoInputRef = useRef<HTMLInputElement>(null)
  const [dragOverPedido, setDragOverPedido] = useState(false)

  async function loadPedidos() {
    setLoadingPedidos(true)
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    const lista = error ? [] : ((data as Pedido[]) ?? [])
    if (!error) setMeusPedidos(lista)
    if (lista.length > 0) {
      const { data: evs } = await supabase
        .from('pedido_eventos')
        .select('*')
        .in('pedido_id', lista.map((p) => p.id))
        .order('created_at', { ascending: true })
      const mapa: Record<string, PedidoEvento[]> = {}
      for (const ev of (evs as PedidoEvento[]) ?? []) (mapa[ev.pedido_id] ??= []).push(ev)
      setEventosPorPedido(mapa)
    }
    setLoadingPedidos(false)
  }

  function handleSelecionarPedidoArquivo(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf') {
      push('error', 'O pedido precisa ser um arquivo PDF.')
      return
    }
    setPedidoArquivo(file)
  }

  function handleDropPedido(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOverPedido(false)
    handleSelecionarPedidoArquivo(e.dataTransfer.files?.[0])
  }

  function limparFormularioPedido() {
    setPedidoCliente('')
    setPedidoValor('')
    setPedidoObservacao('')
    setPedidoOrigem('')
    setPedidoArquivo(null)
    setPedidoEmEdicao(null)
    setDuplicadoSugerido(null)
    if (pedidoArquivoInputRef.current) pedidoArquivoInputRef.current.value = ''
  }

  function handleCorrigirPedido(pedido: Pedido) {
    setPedidoEmEdicao(pedido)
    setPedidoCliente(pedido.cliente)
    setPedidoValor(pedido.valor_estimado ? formatCurrency(pedido.valor_estimado).replace('R$', '').trim() : '')
    setPedidoObservacao(pedido.observacao ?? '')
    setPedidoOrigem(pedido.origem ?? '')
    setPedidoArquivo(null)
    setDuplicadoSugerido(null)
    formPedidoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleCancelarPedido(pedido: Pedido) {
    const { error } = await supabase.from('pedidos').update({ status: 'cancelado' }).eq('id', pedido.id)
    setCancelandoPedidoId(null)
    if (error) {
      push('error', `Erro ao cancelar pedido: ${error.message}`)
      return
    }
    if (pedidoEmEdicao?.id === pedido.id) limparFormularioPedido()
    push('success', 'Pedido cancelado.')
    loadPedidos()
  }

  async function handleEnviarPedido(e: FormEvent) {
    e.preventDefault()
    if (!session || enviandoPedido) return
    if (!pedidoCliente.trim()) {
      push('error', 'Informe o nome do cliente.')
      return
    }
    if (!pedidoOrigem) {
      push('error', 'Informe a origem do pedido (SC, SP ou CE).')
      return
    }
    if (!pedidoEmEdicao && !pedidoArquivo) {
      push('error', 'Selecione o PDF do pedido.')
      return
    }
    if (pedidoArquivo && pedidoArquivo.type !== 'application/pdf') {
      push('error', 'O pedido precisa ser um arquivo PDF.')
      return
    }

    const valorNumero = pedidoValor ? Number(pedidoValor.replace(/\./g, '').replace(',', '.')) : null
    const valorEstimado = valorNumero && valorNumero > 0 ? valorNumero : null

    setEnviandoPedido(true)

    // Trava 1 (dura): mesmo PDF (hash) já enviado, em qualquer pedido não cancelado.
    let hash = pedidoEmEdicao?.arquivo_hash ?? null
    if (pedidoArquivo) {
      hash = await hashArquivo(pedidoArquivo)
      const igual = meusPedidos.find(
        (p) => p.arquivo_hash === hash && p.status !== 'cancelado' && p.id !== pedidoEmEdicao?.id
      )
      if (igual) {
        setEnviandoPedido(false)
        push('error', `Este PDF já foi enviado no pedido ${formatNumeroPedido(igual.numero)}.`)
        return
      }
    }

    // Trava 2 (aviso): mesmo cliente e valor num pedido ainda ativo — pede
    // confirmação em vez de bloquear (pode ser uma venda legitimamente igual).
    if (!duplicadoSugerido && valorEstimado) {
      const parecido = meusPedidos.find(
        (p) =>
          p.id !== pedidoEmEdicao?.id &&
          p.status !== 'cancelado' &&
          p.cliente.trim().toLowerCase() === pedidoCliente.trim().toLowerCase() &&
          Number(p.valor_estimado) === valorEstimado
      )
      if (parecido) {
        setEnviandoPedido(false)
        setDuplicadoSugerido(parecido)
        return
      }
    }

    let path: string | null = null
    if (pedidoArquivo) {
      path = `${vendedorId}/${Date.now()}-${nomeArquivoSeguro(pedidoArquivo.name)}`
      const { error: uploadError } = await supabase.storage.from('pedidos').upload(path, pedidoArquivo)
      if (uploadError) {
        setEnviandoPedido(false)
        push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
        return
      }
    }

    const camposArquivo =
      pedidoArquivo && path ? { arquivo_path: path, arquivo_nome: pedidoArquivo.name, arquivo_hash: hash } : {}
    const { error } = pedidoEmEdicao
      ? await supabase
          .from('pedidos')
          .update({
            cliente: pedidoCliente.trim(),
            valor_estimado: valorEstimado,
            origem: pedidoOrigem,
            observacao: pedidoObservacao.trim() || null,
            status: 'pendente',
            ...camposArquivo,
          })
          .eq('id', pedidoEmEdicao.id)
      : await supabase.from('pedidos').insert({
          vendedor_id: vendedorId,
          cliente: pedidoCliente.trim(),
          valor_estimado: valorEstimado,
          origem: pedidoOrigem,
          observacao: pedidoObservacao.trim() || null,
          arquivo_path: path!,
          arquivo_nome: pedidoArquivo!.name,
          arquivo_hash: hash,
          created_by: session.user.id,
        })
    setEnviandoPedido(false)

    if (error) {
      if (path) await supabase.storage.from('pedidos').remove([path])
      push(
        'error',
        isPedidoDuplicadoError(error)
          ? 'Este PDF já foi enviado em outro pedido.'
          : `Erro ao enviar pedido: ${error.message}`
      )
      return
    }

    push(
      'success',
      pedidoEmEdicao ? 'Pedido corrigido e reenviado!' : 'Pedido enviado! O faturista vai processar em breve.'
    )
    limparFormularioPedido()
    loadPedidos()
  }

  useEffect(() => {
    loadPedidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedorId])

  return (
    <div
      ref={formPedidoRef}
      className="mb-lg scroll-mt-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg"
    >
      <div className="mb-lg flex items-center gap-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <span className="material-symbols-outlined text-primary text-[20px]">
            {pedidoEmEdicao ? 'edit_note' : 'note_add'}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-title-md text-title-md text-on-surface">
            {pedidoEmEdicao ? `Corrigir ${formatNumeroPedido(pedidoEmEdicao.numero)}` : 'Enviar Pedido'}
          </h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {pedidoEmEdicao
              ? 'Ajuste o que foi pedido e reenvie — o PDF só precisa ser anexado de novo se mudou.'
              : 'Anexe o PDF assim que fechar a venda — entra direto na fila do faturista. Depois de enviado, só dá pra alterar se for devolvido.'}
          </p>
        </div>
        {pedidoEmEdicao && (
          <button
            type="button"
            onClick={limparFormularioPedido}
            className="shrink-0 rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancelar correção
          </button>
        )}
      </div>

      {pedidoEmEdicao?.devolvido_motivo && (
        <div className="mb-md rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="font-label-md text-label-md font-medium text-error">Motivo da devolução</p>
          <p className="font-body-md text-body-md text-on-surface">{pedidoEmEdicao.devolvido_motivo}</p>
        </div>
      )}

      <form onSubmit={handleEnviarPedido} className="space-y-md">
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Cliente</span>
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                person
              </span>
              <input
                type="text"
                value={pedidoCliente}
                onChange={(e) => {
                  setPedidoCliente(e.target.value)
                  setDuplicadoSugerido(null)
                }}
                placeholder="Nome do cliente…"
                className={`${inputClass} pl-10`}
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
              Valor estimado (opcional)
            </span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-label-md text-label-md text-on-surface-variant">
                R$
              </span>
              <input
                inputMode="decimal"
                value={pedidoValor}
                onChange={(e) => {
                  setPedidoValor(e.target.value)
                  setDuplicadoSugerido(null)
                }}
                placeholder="1.000,00"
                className={`${inputClass} pl-9`}
              />
            </div>
          </label>
        </div>

        <div>
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Origem do pedido</span>
          <div className="flex flex-wrap gap-sm">
            {ORIGENS.map((o) => (
              <button
                key={o.valor}
                type="button"
                onClick={() => setPedidoOrigem(o.valor)}
                className={`rounded-xl border px-lg py-sm text-left transition-colors ${
                  pedidoOrigem === o.valor
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="block font-title-md text-title-md text-on-surface">{o.label}</span>
                <span className="block font-label-md text-label-md text-on-surface-variant">{o.ajuda}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            Observação (opcional)
          </span>
          <textarea
            rows={2}
            value={pedidoObservacao}
            onChange={(e) => setPedidoObservacao(e.target.value)}
            placeholder="Prazo, condição de pagamento, algo que o financeiro deva saber…"
            className={inputClass}
          />
        </label>

        <div>
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            {pedidoEmEdicao ? 'PDF do pedido (opcional — mantém o atual se não anexar outro)' : 'PDF do pedido'}
          </span>
          {pedidoEmEdicao && !pedidoArquivo && (
            <p className="mb-xs flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">attach_file</span>
              Atual: {pedidoEmEdicao.arquivo_nome}
            </p>
          )}
          {pedidoArquivo ? (
            <div className="flex items-center justify-between gap-sm rounded-xl border border-primary/30 bg-primary/5 p-md">
              <div className="flex min-w-0 items-center gap-sm">
                <span className="material-symbols-outlined shrink-0 text-primary text-[24px]">picture_as_pdf</span>
                <span className="truncate font-body-md text-body-md text-on-surface">{pedidoArquivo.name}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPedidoArquivo(null)
                  if (pedidoArquivoInputRef.current) pedidoArquivoInputRef.current.value = ''
                }}
                title="Remover arquivo"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverPedido(true)
              }}
              onDragLeave={() => setDragOverPedido(false)}
              onDrop={handleDropPedido}
              onClick={() => pedidoArquivoInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-lg text-center transition-colors ${
                dragOverPedido ? 'border-primary bg-primary/5' : 'border-outline-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-[28px]">upload_file</span>
              <p className="mt-xs font-label-md text-label-md text-on-surface">Anexar PDF do pedido</p>
              <p className="font-label-md text-label-md text-on-surface-variant">
                Arraste aqui ou clique para selecionar
              </p>
            </div>
          )}
          <input
            ref={pedidoArquivoInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => handleSelecionarPedidoArquivo(e.target.files?.[0])}
            className="hidden"
          />
        </div>

        {duplicadoSugerido && (
          <div className="flex items-start gap-sm rounded-lg border border-amber-300 bg-amber-50 p-md">
            <span className="material-symbols-outlined shrink-0 text-amber-600">warning</span>
            <p className="font-body-md text-body-md text-on-surface">
              Você já enviou o pedido <b>{formatNumeroPedido(duplicadoSugerido.numero)}</b> para este cliente com o
              mesmo valor ({formatDate(duplicadoSugerido.created_at.slice(0, 10))}). Se for outra venda, confirme
              abaixo.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={enviandoPedido}
          className="flex w-full items-center justify-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
        >
          {enviandoPedido ? (
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[18px]">send</span>
          )}
          {enviandoPedido
            ? 'Enviando…'
            : duplicadoSugerido
              ? 'Enviar mesmo assim'
              : pedidoEmEdicao
                ? 'Reenviar pedido'
                : 'Enviar Pedido'}
        </button>
      </form>

      {!loadingPedidos && meusPedidos.length > 0 && (
        <div className="mt-lg border-t border-outline-variant pt-md">
          {meusPedidos.some((p) => p.status === 'devolvido') && (
            <div className="mb-md flex items-center gap-sm rounded-lg border border-error/30 bg-error/5 p-md">
              <span className="material-symbols-outlined shrink-0 text-error">undo</span>
              <p className="font-body-md text-body-md text-on-surface">
                Você tem pedido(s) devolvido(s) aguardando correção. Ajuste e reenvie abaixo.
              </p>
            </div>
          )}
          <p className="mb-sm font-label-md text-label-md text-on-surface-variant">Meus pedidos</p>
          <div className="space-y-sm">
            {meusPedidos.map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border p-sm transition-colors hover:bg-surface-container-low ${
                  p.status === 'devolvido' ? 'border-error/40' : 'border-outline-variant'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div className="min-w-0">
                    <p className="truncate font-body-md text-body-md text-on-surface">
                      <span className="font-label-md text-label-md text-on-surface-variant">
                        {formatNumeroPedido(p.numero)}
                      </span>{' '}
                      {p.cliente}
                      {p.valor_estimado ? ` · ${formatCurrency(p.valor_estimado)}` : ''}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {formatDate(p.created_at.slice(0, 10))}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-xs">
                    <PedidoStatusBadge pedido={p} />
                    <button
                      type="button"
                      onClick={() => setPedidoHistorico(p)}
                      title="Ver histórico"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[18px]">history</span>
                    </button>
                  </div>
                </div>

                {(p.status === 'pendente' || p.status === 'faturado') && (
                  <div className="mt-md px-xs pb-xs">
                    <PedidoProgresso pedido={p} eventos={eventosPorPedido[p.id]} />
                  </div>
                )}

                {p.status === 'devolvido' && (
                  <div className="mt-sm space-y-sm">
                    {p.devolvido_motivo && (
                      <p className="rounded-lg bg-error/5 p-sm font-label-md text-label-md text-on-surface">
                        <b>Motivo:</b> {p.devolvido_motivo}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-sm">
                      <button
                        type="button"
                        onClick={() => handleCorrigirPedido(p)}
                        className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        Corrigir e reenviar
                      </button>
                      {cancelandoPedidoId === p.id ? (
                        <>
                          <span className="font-label-md text-label-md text-on-surface-variant">
                            Cancelar de vez?
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCancelarPedido(p)}
                            className="rounded-full bg-error px-md py-xs font-label-md text-label-md text-on-error hover:opacity-90"
                          >
                            Sim, cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelandoPedidoId(null)}
                            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                          >
                            Voltar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCancelandoPedidoId(p.id)}
                          className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                        >
                          Cancelar pedido
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pedidoHistorico && <PedidoHistoricoModal pedido={pedidoHistorico} onClose={() => setPedidoHistorico(null)} />}
    </div>
  )
}

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors'
