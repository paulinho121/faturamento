import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

// PWA instalada no celular do vendedor/diretor: por padrão o navegador só
// verifica se há uma versão nova do service worker de vez em quando (em
// geral só na navegação, o que quase nunca acontece num app que fica sempre
// aberto na mesma tela). Checamos a cada 60s pra uma atualização não levar
// dias pra chegar. MAS recarregar sozinho, sem avisar, apagava formulário
// em andamento sempre que um deploy caía enquanto alguém tinha a página
// aberta (era o bug de "perde tudo ao minimizar e voltar" — o reload podia
// ficar pendente e só se concretizar quando a aba voltava a ficar visível).
// Agora só mostra um aviso; quem decide a hora de recarregar é a pessoa.
export function UpdatePrompt() {
  const [precisaAtualizar, setPrecisaAtualizar] = useState(false)
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        setInterval(() => {
          registration.update()
        }, 60 * 1000)
      },
      onNeedRefresh() {
        setPrecisaAtualizar(true)
      },
    })
    setUpdateSW(() => update)
  }, [])

  if (!precisaAtualizar) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] flex justify-center px-md pb-[max(env(safe-area-inset-bottom),12px)]">
      <div className="toast-in flex items-center gap-md rounded-full bg-inverse-surface px-lg py-sm shadow-level3">
        <span className="material-symbols-outlined text-inverse-on-surface text-[18px]">system_update</span>
        <span className="font-label-md text-label-md text-inverse-on-surface">Nova versão disponível</span>
        <button
          type="button"
          onClick={() => updateSW?.(true)}
          className="rounded-full bg-inverse-on-surface px-md py-1 font-label-md text-label-md text-inverse-surface"
        >
          Atualizar
        </button>
      </div>
    </div>
  )
}
