import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { nomeArquivoSeguro } from '../../lib/storage'
import { formatNumeroPedido } from './pedidoUtils'
import type { PedidoOrientacao } from '../../types/domain'

const TIPOS_ACEITOS = ['application/pdf', 'image/jpeg', 'image/jpg']

export function ResponderOrientacaoModal({
  orientacao,
  onClose,
  onDone,
}: {
  orientacao: PedidoOrientacao
  onClose: () => void
  onDone: () => void
}) {
  const { session } = useAuth()
  const { push } = useToast()
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [respostaTexto, setRespostaTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSelecionar(file: File | undefined) {
    if (!file) return
    if (!TIPOS_ACEITOS.includes(file.type)) {
      push('error', 'Anexe um PDF ou JPEG.')
      return
    }
    setArquivo(file)
  }

  async function handleResponder() {
    if (!session) return
    if (!arquivo) {
      push('error', 'Anexe o PDF ou JPEG de orientação.')
      return
    }
    setEnviando(true)
    const path = `${orientacao.id}/${Date.now()}-${nomeArquivoSeguro(arquivo.name)}`
    const { error: uploadError } = await supabase.storage.from('orientacoes').upload(path, arquivo)
    if (uploadError) {
      setEnviando(false)
      push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
      return
    }
    const { error } = await supabase
      .from('pedido_orientacoes')
      .update({
        arquivo_path: path,
        arquivo_nome: arquivo.name,
        resposta_texto: respostaTexto.trim() || null,
        respondido_por: session.user.id,
        respondido_em: new Date().toISOString(),
      })
      .eq('id', orientacao.id)
    setEnviando(false)
    if (error) {
      await supabase.storage.from('orientacoes').remove([path])
      push('error', `Erro ao responder: ${error.message}`)
      return
    }
    push('success', 'Orientação enviada ao faturista.')
    onDone()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="space-y-md p-lg">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">
            Responder {orientacao.pedidos ? formatNumeroPedido(orientacao.pedidos.numero) : ''}
          </h3>
          <p className="font-body-md text-body-md text-on-surface-variant">{orientacao.pergunta}</p>
        </div>

        <div>
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            Orientação (PDF ou JPEG)
          </span>
          {arquivo ? (
            <div className="flex items-center justify-between gap-sm rounded-xl border border-primary/30 bg-primary/5 p-md">
              <div className="flex min-w-0 items-center gap-sm">
                <span className="material-symbols-outlined shrink-0 text-primary text-[24px]">attach_file</span>
                <span className="truncate font-body-md text-body-md text-on-surface">{arquivo.name}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setArquivo(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                title="Remover arquivo"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ) : (
            <div
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-outline-variant p-lg text-center transition-colors hover:bg-surface-container-high"
            >
              <span className="material-symbols-outlined text-primary text-[28px]">upload_file</span>
              <p className="mt-xs font-label-md text-label-md text-on-surface">Anexar PDF ou JPEG</p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg"
            onChange={(e) => handleSelecionar(e.target.files?.[0])}
            className="hidden"
          />
        </div>

        <label className="block">
          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
            Observação (opcional)
          </span>
          <textarea
            rows={3}
            value={respostaTexto}
            onChange={(e) => setRespostaTexto(e.target.value)}
            placeholder="Ex.: é comodato, siga o modelo em anexo…"
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>

        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleResponder}
            disabled={enviando}
            className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">send</span>
            {enviando ? 'Enviando…' : 'Enviar orientação'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
