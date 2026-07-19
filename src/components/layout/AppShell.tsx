import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'

interface NavItem {
  to: string
  icon: string
  label: string
}

export function AppShell({
  title,
  navItems,
  children,
}: {
  title: string
  navItems: NavItem[]
  children: ReactNode
}) {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-background text-on-background pb-32">
      <nav className="sticky top-0 z-50 flex w-full items-center justify-between px-margin-mobile py-sm bg-surface/80 backdrop-blur-md md:px-margin-desktop">
        <div className="flex items-center gap-md">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-tertiary-fixed-dim font-bold text-on-primary shadow-sm">
            <span className="material-symbols-outlined">payments</span>
          </div>
          <div className="leading-tight">
            <h1 className="font-title-md text-title-md text-on-surface">MCI Faturamento</h1>
            <p className="font-label-md text-label-md text-on-surface-variant">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-md">
          <span className="hidden font-label-md text-label-md text-on-surface-variant md:inline">
            {profile?.full_name ?? profile?.role}
          </span>
          <button
            onClick={() => signOut()}
            className="rounded-full p-2 text-on-secondary-container transition-colors hover:bg-surface-container-low"
            title="Sair"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </nav>

      <main className="px-margin-mobile mt-lg md:px-margin-desktop">{children}</main>

      <footer className="fixed bottom-0 left-0 z-50 flex w-full items-center justify-around border-t border-outline-variant bg-surface/80 px-md pb-lg pt-sm shadow-md backdrop-blur-md">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center rounded-full px-4 py-1 transition-all duration-200 ease-in-out active:scale-90 ${
                isActive
                  ? 'bg-primary-container text-on-primary-container'
                  : 'text-on-secondary-container hover:bg-surface-container-high'
              }`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="font-label-md text-label-md">{item.label}</span>
          </NavLink>
        ))}
      </footer>
    </div>
  )
}
