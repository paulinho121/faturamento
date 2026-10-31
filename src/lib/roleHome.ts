import type { UserRole } from '../types/domain'

export function roleHome(role: UserRole): string {
  if (role === 'diretor') return '/dashboard'
  if (role === 'vendedor') return '/vendedor'
  if (role === 'logistica') return '/logistica/entregas'
  if (role === 'cliente') return '/cliente'
  if (role === 'financeiro') return '/financeiro'
  if (role === 'tv') return '/tv'
  return '/operacoes'
}
