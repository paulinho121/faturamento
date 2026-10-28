import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PullToRefresh } from '../ui/PullToRefresh'
import { isEmbedded } from '../../lib/embed'

interface NavItem {
  to: string
  icon: string
  label: string
  // Contador pequeno no ícone (ex.: pedidos aguardando ação) — não some do
  // rodapé só porque a seção saiu da tela principal.
  badge?: number
}

export function AppShell({
  title,
  navItems,
  children,
  onRefresh,
}: {
  title: string
  navItems: NavItem[]
  children: ReactNode
  onRefresh?: () => Promise<void> | void
}) {
  const { profile, signOut } = useAuth()
  const embedded = isEmbedded()

  return (
    <div className={`min-h-screen bg-background text-on-background ${embedded ? 'pb-28' : 'pb-32'}`}>
      <nav
        className={`sticky top-0 z-50 flex w-full items-center justify-between px-margin-mobile bg-surface/80 backdrop-blur-md md:px-margin-desktop ${
          embedded ? 'py-xs' : 'pb-sm pt-[max(env(safe-area-inset-top),8px)] md:pt-[max(env(safe-area-inset-top),16px)]'
        }`}
      >
        {embedded ? (
          <h1 className="font-title-md text-title-md text-on-surface">{title}</h1>
        ) : (
          <div className="flex items-center gap-md">
            <img src="/logo.png" alt="MCI Faturamento" className="h-10 w-auto object-contain" />
            <div className="leading-tight">
              <h1 className="font-title-md text-title-md text-on-surface">MCI Faturamento</h1>
              <p className="font-label-md text-label-md text-on-surface-variant">{title}</p>
            </div>
          </div>
        )}
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

      <main className="px-margin-mobile mt-lg md:px-margin-desktop">
        {onRefresh ? <PullToRefresh onRefresh={onRefresh}>{children}</PullToRefresh> : children}
      </main>

      <footer className="fixed bottom-0 left-0 z-50 w-full border-t border-outline-variant bg-surface/90 pb-[max(env(safe-area-inset-bottom),12px)] pt-sm shadow-[0_-4px_16px_rgba(0,0,0,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-stretch gap-xs px-md">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // "/operacoes" é prefixo de "/operacoes/pedidos": sem `end` os dois
              // ficariam ativos juntos.
              end={navItems.some((o) => o !== item && o.to.startsWith(`${item.to}/`))}
              className={({ isActive }) =>
                `group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`relative flex h-8 w-16 items-center justify-center rounded-full transition-all duration-200 group-active:scale-95 ${
                      isActive
                        ? 'bg-primary-container text-on-primary-container'
                        : 'group-hover:bg-surface-container-high'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontVariationSettings: `'FILL' ${isActive ? 1 : 0}` }}
                    >
                      {item.icon}
                    </span>
                    {!!item.badge && (
                      <span className="absolute right-2 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-medium leading-none text-on-error ring-2 ring-surface">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </span>
                  <span
                    className={`max-w-full truncate font-label-md text-label-md ${isActive ? 'font-semibold' : ''}`}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </footer>
    </div>
  )
}
