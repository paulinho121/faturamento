import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { formatNumeroPedido } from './pedidoUtils'
import type { Pedido, PedidoOrientacao } from '../../types/domain'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Thread de dúvidas do faturista pra Bianca (é locação ou venda? comodato?
// precisa autorização do diretor?) — cada pedido pode ter várias consultas,
// respondidas com um PDF/JPEG de orientação.
export function PedidoOrientacaoModal({
  pedido,
  onClose,
  onEnviado,
}: {
  pedido: Pedido
  onClose: () => void
  onEnviado: () => void
}) {
  const { session } = useAuth()
  const { push } = useToast()
  const [orientacoes, setOrientacoes] = useState<PedidoOrientacao[] | null>(null)
  const [pergunta, setPergunta] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('pedido_orientacoes')
      .select('*, profiles!pedido_orientacoes_solicitado_por_fkey(full_name)')
      .eq('pedido_id', pedido.id)
      .order('solicitado_em', { ascending: true })
    setOrientacoes((data as PedidoOrientacao[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.id])

  async function handleEnviar() {
    if (!session) return
    if (pergunta.trim().length < 5) {
      push('error', 'Descreva a dúvida (mínimo 5 caracteres).')
      return
    }
    setEnviando(true)
    const { error } = await supabase
      .from('pedido_orientacoes')
      .insert({ pedido_id: pedido.id, pergunta: pergunta.trim(), solicitado_por: session.user.id })
    setEnviando(false)
    if (error) {
      push('error', `Erro ao enviar para a Bianca: ${error.message}`)
      return
    }
    push('success', 'Enviado para a Bianca.')
    setPergunta('')
    load()
    onEnviado()
  }

  async function handleBaixar(o: PedidoOrientacao) {
    if (!o.arquivo_path) return
    const { data, error } = await supabase.storage.from('orientacoes').download(o.arquivo_path)
    if (error || !data) {
      push('error', `Erro ao baixar arquivo: ${error?.message ?? 'não encontrado'}`)
      return
    }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = o.arquivo_nome ?? 'orientacao'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="p-lg">
        <div className="mb-lg">
          <h3 className="font-title-md text-title-md text-on-surface">
            Consultar Bianca · {formatNumeroPedido(pedido.numero)}
          </h3>
          <p className="font-label-md text-label-md text-on-surface-variant">{pedido.cliente}</p>
        </div>

        {orientacoes === null ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="mb-lg max-h-[45vh] space-y-md overflow-y-auto">
            {orientacoes.length === 0 && (
              <p className="font-body-md text-body-md text-on-surface-variant">
                Nenhuma consulta ainda. Descreva a dúvida abaixo (é locação ou venda? é comodato? precisa autorização
                do diretor?).
              </p>
            )}
            {orientacoes.map((o) => (
              <div key={o.id} className="rounded-lg border border-outline-variant p-md">
                <p className="font-body-md text-body-md text-on-surface">{o.pergunta}</p>
                <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                  {o.profiles?.full_name ?? 'Faturista'} · {formatDataHora(o.solicitado_em)}
                </p>
                {o.arquivo_path ? (
                  <div className="mt-sm rounded-lg bg-tertiary/5 p-sm">
                    {o.resposta_texto && <p className="font-body-md text-body-md text-on-surface">{o.resposta_texto}</p>}
                    <button
                      type="button"
                      onClick={() => handleBaixar(o)}
                      className="mt-xs flex items-center gap-xs font-label-md text-label-md text-tertiary hover:underline"
                    >
                      <span className="material-symbols-outlined text-[16px]">attach_file</span>
                      {o.arquivo_nome}
                    </button>
                    <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                      Respondido{o.respondido_em ? ` em ${formatDataHora(o.respondido_em)}` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="mt-sm font-label-md text-label-md font-medium text-amber-700">Aguardando a Bianca…</p>
                )}
              </div>
            ))}
          </div>
        )}

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Nova dúvida</span>
          <textarea
            rows={3}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder="Ex.: é locação ou venda? é comodato? precisa autorização do diretor?"
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>

        <div className="mt-md flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={enviando}
            className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">send</span>
            {enviando ? 'Enviando…' : 'Enviar para a Bianca'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
