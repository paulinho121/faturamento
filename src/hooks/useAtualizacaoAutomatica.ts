import { useEffect } from 'react'

// A TV fica ligada dias seguidos com o app aberto. Depois de um deploy, os arquivos antigos deixam de existir no
// servidor e a tela pode ficar branca. Este hook confere de tempos em tempos se saiu versão nova; se saiu, limpa o
// cache do navegador (service worker e Cache Storage — a sessão de login NÃO é apagada) e recarrega a página.

const INTERVALO_MS = 3 * 60_000
const ESPERA_ENTRE_TENTATIVAS_MS = 10 * 60_000
const CHAVE = 'mci:atualizacao-automatica'

export async function limparCachesDoApp(): Promise<void> {
  const tarefas: Promise<unknown>[] = []
  if ('serviceWorker' in navigator) {
    tarefas.push(navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))))
  }
  if ('caches' in window) {
    tarefas.push(caches.keys().then((chaves) => Promise.all(chaves.map((c) => caches.delete(c)))))
  }
  await Promise.allSettled(tarefas)
}

// Arquivo principal em uso agora (ex.: /assets/index-AbC123.js). Em desenvolvimento não existe: devolve null.
function scriptAtual(): string | null {
  const el = document.querySelector('script[src*="/assets/index-"]')
  const src = el?.getAttribute('src') ?? null
  return src ? new URL(src, window.location.origin).pathname : null
}

async function scriptPublicado(): Promise<string | null> {
  // O parâmetro evita o cache do service worker e do navegador.
  const resposta = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' })
  if (!resposta.ok) return null
  const html = await resposta.text()
  return html.match(/\/assets\/index-[^"'\s>]+\.js/)?.[0] ?? null
}

export function useAtualizacaoAutomatica(): void {
  useEffect(() => {
    let cancelado = false

    async function conferir() {
      try {
        const atual = scriptAtual()
        if (!atual) return
        const publicado = await scriptPublicado()
        if (cancelado || !publicado || publicado === atual) return
        // Já tentou atualizar para esta versão há pouco? Espera (evita recarregar em loop se a rede ainda serve a antiga).
        const tentativa = JSON.parse(sessionStorage.getItem(CHAVE) ?? 'null') as { alvo: string; em: number } | null
        if (tentativa && tentativa.alvo === publicado && Date.now() - tentativa.em < ESPERA_ENTRE_TENTATIVAS_MS) return
        sessionStorage.setItem(CHAVE, JSON.stringify({ alvo: publicado, em: Date.now() }))
        await limparCachesDoApp()
        window.location.reload()
      } catch {
        /* sem rede ou resposta inesperada: tenta de novo na próxima rodada */
      }
    }

    const timer = setInterval(conferir, INTERVALO_MS)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') conferir()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      cancelado = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])
}
