import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { BUCKET_FOTOS, useFotosVendedores } from '../../hooks/useFotosVendedores'

interface VendedorFoto {
  id: string
  nome: string
  foto_path: string | null
  na_corrida: boolean
}

const LADO_PX = 320

// Recorta o centro em quadrado e reduz — foto de celular tem vários MB, e na TV
// o rosto aparece num círculo pequeno.
async function recortarQuadrado(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const lado = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = LADO_PX
  canvas.height = LADO_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível processar a imagem.')
  ctx.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, LADO_PX, LADO_PX)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/jpeg', 0.85)
  )
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export function FotosVendedoresModal({ onClose }: { onClose: () => void }) {
  const { push } = useToast()
  const [vendedores, setVendedores] = useState<VendedorFoto[]>([])
  const [loading, setLoading] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const alvoRef = useRef<VendedorFoto | null>(null)

  const fotos = useFotosVendedores(vendedores.map((v) => v.foto_path).filter((p): p is string => !!p))

  async function carregar() {
    const { data, error } = await supabase.from('vendedores').select('id, nome, foto_path, na_corrida').eq('ativo', true).order('nome')
    if (error) push('error', `Erro ao carregar vendedores: ${error.message}`)
    else setVendedores((data as VendedorFoto[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function enviar(vendedor: VendedorFoto, arquivo: File) {
    if (!arquivo.type.startsWith('image/')) {
      push('error', 'Escolha um arquivo de imagem (JPG ou PNG).')
      return
    }
    setSalvandoId(vendedor.id)
    try {
      const imagem = await recortarQuadrado(arquivo)
      // Caminho novo a cada envio: a TV percebe a troca na próxima atualização
      // (o link da foto antiga ficaria em cache).
      const caminho = `${vendedor.id}-${Date.now()}.jpg`
      const { error: erroUpload } = await supabase.storage
        .from(BUCKET_FOTOS)
        .upload(caminho, imagem, { contentType: 'image/jpeg' })
      if (erroUpload) throw new Error(erroUpload.message)
      const { error: erroDefinir } = await supabase.rpc('definir_foto_vendedor', {
        p_vendedor_id: vendedor.id,
        p_foto_path: caminho,
      })
      if (erroDefinir) {
        await supabase.storage.from(BUCKET_FOTOS).remove([caminho])
        throw new Error(erroDefinir.message)
      }
      if (vendedor.foto_path) await supabase.storage.from(BUCKET_FOTOS).remove([vendedor.foto_path])
      push('success', `Foto de ${vendedor.nome} salva.`)
      await carregar()
    } catch (err) {
      push('error', `Erro ao salvar a foto: ${err instanceof Error ? err.message : 'tente de novo'}`)
    } finally {
      setSalvandoId(null)
    }
  }

  async function alternarCorrida(vendedor: VendedorFoto) {
    setSalvandoId(vendedor.id)
    const { error } = await supabase.rpc('definir_na_corrida', {
      p_vendedor_id: vendedor.id,
      p_na_corrida: !vendedor.na_corrida,
    })
    if (error) push('error', `Erro ao atualizar a corrida: ${error.message}`)
    else await carregar()
    setSalvandoId(null)
  }

  async function remover(vendedor: VendedorFoto) {
    if (!vendedor.foto_path) return
    setSalvandoId(vendedor.id)
    const { error } = await supabase.rpc('definir_foto_vendedor', { p_vendedor_id: vendedor.id, p_foto_path: null })
    if (error) push('error', `Erro ao remover a foto: ${error.message}`)
    else {
      await supabase.storage.from(BUCKET_FOTOS).remove([vendedor.foto_path])
      push('success', `Foto de ${vendedor.nome} removida.`)
      await carregar()
    }
    setSalvandoId(null)
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="p-lg">
        <div className="mb-md flex items-start justify-between gap-md">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Fotos da TV</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Marque quem aparece na corrida dos cavalinhos e envie a foto de cada um (rosto de frente; é recortada em quadrado).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0]
            if (arquivo && alvoRef.current) void enviar(alvoRef.current, arquivo)
            e.target.value = ''
          }}
        />

        {loading ? (
          <div className="space-y-sm">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <ul className="max-h-[55vh] divide-y divide-outline-variant overflow-y-auto">
            {vendedores.map((v) => {
              const url = v.foto_path ? fotos[v.foto_path] : undefined
              const ocupado = salvandoId === v.id
              return (
                <li key={v.id} className="flex items-center gap-md py-sm">
                  {url ? (
                    <img src={url} alt={v.nome} className="h-12 w-12 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-label-md text-label-md text-on-surface-variant">
                      {iniciais(v.nome)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-body-md text-body-md text-on-surface">{v.nome}</span>
                  <label className="flex cursor-pointer items-center gap-xs font-label-md text-label-md text-on-surface-variant" title="Aparece na corrida da TV">
                    <input
                      type="checkbox"
                      checked={v.na_corrida}
                      disabled={ocupado}
                      onChange={() => void alternarCorrida(v)}
                    />
                    Na corrida
                  </label>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      alvoRef.current = v
                      inputRef.current?.click()
                    }}
                    className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
                  >
                    {ocupado ? 'Salvando…' : v.foto_path ? 'Trocar' : 'Enviar foto'}
                  </button>
                  {v.foto_path && (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void remover(v)}
                      title="Remover foto"
                      className="text-on-surface-variant hover:text-error disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
