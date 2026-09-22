import { getModuleSwitcherItems } from '../../lib/modules'
import type { Profile } from '../../types/domain'

export function faturistaNavItems(profile: Profile | null, pedidosPendentes = 0) {
  return [
    { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
    ...getModuleSwitcherItems(profile),
    { to: '/operacoes/pedidos', icon: 'note_add', label: 'Pedidos', badge: pedidosPendentes },
  ]
}
