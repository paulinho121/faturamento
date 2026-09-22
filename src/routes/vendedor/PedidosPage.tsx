import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { EnviarPedidoCard } from '../../components/pedidos/EnviarPedidoCard'
import { VENDEDOR_NAV_ITEMS } from './nav'

export function VendedorPedidosPage() {
  const { profile } = useAuth()
  const [meuVendedorId, setMeuVendedorId] = useState<string | null>(null)
  // Força o EnviarPedidoCard a recarregar (ele gerencia seu próprio estado)
  // quando o usuário puxa pra atualizar.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!profile) return
    supabase
      .from('vendedores')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle()
      .then(({ data }) => setMeuVendedorId(data?.id ?? null))
  }, [profile])

  return (
    <AppShell title="Pedidos" navItems={VENDEDOR_NAV_ITEMS} onRefresh={() => setRefreshKey((k) => k + 1)}>
      {meuVendedorId && <EnviarPedidoCard key={refreshKey} vendedorId={meuVendedorId} />}
    </AppShell>
  )
}
