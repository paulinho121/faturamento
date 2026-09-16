import type { Profile, UserRole } from '../types/domain'

interface ModuleNavItem {
  to: string
  icon: string
  label: string
}

const MODULOS: Partial<Record<UserRole, ModuleNavItem>> = {
  faturista: { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
  financeiro: { to: '/financeiro', icon: 'account_balance', label: 'Financeiro' },
}

// Ordem fixa de exibição no rodapé, independente da ordem em modulos_extra.
const ORDEM: UserRole[] = ['faturista', 'financeiro']

// Módulos que um perfil pode alternar pelo rodapé — hoje só
// faturamento/financeiro; um faturista com acesso extra ao financeiro (ou
// vice-versa) vê os dois itens e pode trocar livremente.
export function getModuleSwitcherItems(profile: Profile | null): ModuleNavItem[] {
  if (!profile) return []
  const roles = new Set<UserRole>([profile.role, ...(profile.modulos_extra ?? [])])
  return ORDEM.filter((r) => roles.has(r)).map((r) => MODULOS[r]!)
}

// Verifica se o perfil tem acesso a um módulo, seja como papel principal ou
// como módulo extra — usado por telas que se comportam diferente pra contas
// que acumulam mais de um módulo (ex.: faturista com financeiro também vê/
// gerencia as notas de todo mundo, não só as próprias).
export function hasModule(profile: Profile | null, role: UserRole): boolean {
  if (!profile) return false
  return profile.role === role || (profile.modulos_extra ?? []).includes(role)
}
