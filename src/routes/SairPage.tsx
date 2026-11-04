import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// Endereço /sair: encerra a sessão deste navegador e abre o login. Serve para quem caiu
// numa sessão que não é a sua — por exemplo, a conta da TV (que só abre o Modo TV e não tem
// botão de sair) guardada num computador que também é usado para trabalhar.
export function SairPage() {
  const navigate = useNavigate()

  useEffect(() => {
    let ativo = true
    supabase.auth
      .signOut()
      .catch(() => undefined)
      .finally(() => {
        if (ativo) navigate('/login', { replace: true })
      })
    return () => {
      ativo = false
    }
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="font-body-md text-body-md text-on-surface-variant">Saindo…</p>
    </div>
  )
}
