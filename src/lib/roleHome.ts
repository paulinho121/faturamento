import type { UserRole } from '../types/domain'

export function roleHome(role: UserRole): string {
  if (role === 'diretor') return '/dashboard'
  if (role === 'vendedor') return '/vendedor'
  if (role === 'logistica') return '/logistica'
  return '/operacoes'
}
