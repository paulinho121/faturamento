import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { roleHome } from '../lib/roleHome'
import type { UserRole } from '../types/domain'

export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="material-symbols-outlined animate-spin text-primary text-[32px]">progress_activity</span>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) {
    return <Navigate to={roleHome(profile.role)} replace />
  }

  return <>{children}</>
}
