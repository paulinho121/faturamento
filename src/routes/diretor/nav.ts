import { hasModule } from '../../lib/modules'
import type { Profile } from '../../types/domain'

export function diretorNavItems(profile: Profile | null, pedidosPendentes = 0, orientacoesPendentes = 0) {
  return [
    { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
    { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
    ...(hasModule(profile, 'financeiro') ? [{ to: '/financeiro', icon: 'account_balance', label: 'Financeiro' }] : []),
    { to: '/dashboard/pedidos', icon: 'note_add', label: 'Pedidos', badge: pedidosPendentes },
    // Local exclusivo de quem pode orientar o faturista (hoje só a Bianca) —
    // ninguém mais vê esse item.
    ...(profile?.pode_orientar_pedidos
      ? [{ to: '/dashboard/orientacoes', icon: 'help_center', label: 'Consultas', badge: orientacoesPendentes }]
      : []),
  ]
}
