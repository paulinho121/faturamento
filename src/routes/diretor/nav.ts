import { hasModule } from '../../lib/modules'
import type { Profile } from '../../types/domain'

// Menu do perfil da contabilidade: só as telas fiscais.
export function contabilidadeNavItems() {
  return [
    { to: '/contabilidade', icon: 'home', label: 'Início' },
    { to: '/dashboard/apuracao-irpj', icon: 'request_quote', label: 'IRPJ e CSLL' },
    { to: '/dashboard/impostometro', icon: 'account_balance', label: 'Impostômetro' },
    { to: '/dashboard/notas-entrada', icon: 'inbox', label: 'Notas entrada' },
  ]
}

// Telas fiscais compartilhadas (Impostômetro, IRPJ e CSLL, Notas de entrada): o diretor vê o menu dele, a contabilidade o seu.
export function navFiscal(profile: Profile | null) {
  return profile?.role === 'contabilidade' ? contabilidadeNavItems() : diretorNavItems(profile)
}

export function diretorNavItems(profile: Profile | null, pedidosPendentes = 0, orientacoesPendentes = 0) {
  return [
    { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
    { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
    ...(hasModule(profile, 'financeiro') ? [{ to: '/financeiro', icon: 'account_balance', label: 'Financeiro' }] : []),
    { to: '/dashboard/pedidos', icon: 'note_add', label: 'Pedidos', badge: pedidosPendentes },
    { to: '/dashboard/bi', icon: 'insights', label: 'BI' },
    { to: '/dashboard/impostometro', icon: 'account_balance', label: 'Impostômetro' },
    { to: '/dashboard/apuracao-irpj', icon: 'request_quote', label: 'IRPJ e CSLL' },
    { to: '/dashboard/notas-entrada', icon: 'inbox', label: 'Notas entrada' },
    { to: '/dashboard/certificado', icon: 'verified_user', label: 'Certificado' },
    { to: '/logistica/entregas', icon: 'package_2', label: 'Logística' },
    // Local exclusivo de quem pode orientar o faturista (hoje só a Bianca) —
    // ninguém mais vê esse item.
    ...(profile?.pode_orientar_pedidos
      ? [{ to: '/dashboard/orientacoes', icon: 'help_center', label: 'Consultas', badge: orientacoesPendentes }]
      : []),
  ]
}
