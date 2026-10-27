import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export const BUCKET_FOTOS = 'vendedores-fotos'
const VALIDADE_S = 60 * 60
const RENOVAR_MS = 50 * 60 * 1000

// O bucket das fotos é privado: cada foto vira um link temporário (1h) e é
// renovado antes de vencer, pra TV ficar ligada o dia todo sem foto quebrada.
export function useFotosVendedores(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const chave = [...new Set(paths)].sort().join('|')

  useEffect(() => {
    const lista = chave ? chave.split('|') : []
    if (lista.length === 0) return
    let ativo = true
    const buscar = async () => {
      const { data } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(lista, VALIDADE_S)
      if (!ativo || !data) return
      const mapa: Record<string, string> = {}
      for (const item of data) if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl
      setUrls(mapa)
    }
    void buscar()
    const t = setInterval(buscar, RENOVAR_MS)
    return () => {
      ativo = false
      clearInterval(t)
    }
  }, [chave])

  return urls
}
