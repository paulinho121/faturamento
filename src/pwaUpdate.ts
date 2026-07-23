import { registerSW } from 'virtual:pwa-register'

// PWA instalada no celular do vendedor/diretor: por padrão o navegador só
// verifica se há uma versão nova do service worker de vez em quando (em
// geral só na navegação, o que quase nunca acontece num app que fica sempre
// aberto na mesma tela). Sem isso, uma atualização podia levar dias pra
// chegar no celular de alguém. Aqui forçamos duas coisas:
//   1. Checar por atualização a cada 60s enquanto o app está aberto.
//   2. Assim que uma versão nova é detectada, recarregar automaticamente —
//      sem esperar o usuário clicar em nada.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => {
      registration.update()
    }, 60 * 1000)
  },
  onNeedRefresh() {
    updateSW(true)
  },
})
