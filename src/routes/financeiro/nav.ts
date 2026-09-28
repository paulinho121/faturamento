import { getModuleSwitcherItems } from '../../lib/modules'
import type { Profile } from '../../types/domain'

export function financeiroNavItems(profile: Profile | null, pedidosParaAprovar = 0) {
  return [
    ...getModuleSwitcherItems(profile),
    { to: '/financeiro/conciliacao', icon: 'account_balance', label: 'Conciliação' },
    { to: '/financeiro/pedidos', icon: 'note_add', label: 'Pedidos', badge: pedidosParaAprovar },
  ]
}
