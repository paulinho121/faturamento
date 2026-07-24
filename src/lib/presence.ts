import { supabase } from './supabaseClient'

const CHANNEL_NAME = 'vendedores-online'

// O vendedor "se anuncia" nesse canal de Presence (Supabase Realtime)
// enquanto a página estiver aberta — não grava nada no banco, é só um sinal
// efêmero em tempo real pro diretor ver quem está online agora. A key do
// presence é o próprio vendedor_id, então o lado do diretor já recebe a
// lista pronta sem precisar de mais nenhum dado.
export function trackVendedorOnline(vendedorId: string): () => void {
  const channel = supabase.channel(CHANNEL_NAME, { config: { presence: { key: vendedorId } } })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.track({ online_at: new Date().toISOString() })
    }
  })
  return () => {
    supabase.removeChannel(channel)
  }
}

// Diretor: observa o mesmo canal (sem se anunciar) e mantém a lista de
// vendedor_id atualmente online, atualizada ao vivo a cada entrada/saída.
export function subscribeVendedoresOnline(onChange: (onlineIds: Set<string>) => void): () => void {
  const channel = supabase.channel(CHANNEL_NAME)
  channel.on('presence', { event: 'sync' }, () => {
    onChange(new Set(Object.keys(channel.presenceState())))
  })
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
