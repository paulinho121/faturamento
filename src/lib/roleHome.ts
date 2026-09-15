import type { UserRole } from '../types/domain'

export function roleHome(role: UserRole): string {
  if (role === 'diretor') return '/dashboard'
  if (role === 'vendedor') return '/vendedor'
  if (role === 'logistica') return '/logistica'
  if (role === 'cliente') return '/cliente'
  if (role === 'financeiro') return '/financeiro'
  return '/operacoes'
}
