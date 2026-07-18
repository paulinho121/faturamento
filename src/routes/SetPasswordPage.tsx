import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Landing page for both Supabase invite links and password-reset links.
// Supabase's client SDK auto-detects the access token in the URL and
// creates a session before this component even mounts — the person is
// already authenticated here, they just need to pick a password.
export function SetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => navigate('/', { replace: true }), 1200)
      return () => clearTimeout(t)
    }
  }, [done, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (error) {
      setError('Não foi possível salvar a senha: ' + error.message)
      return
    }
    setDone(true)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="material-symbols-outlined animate-spin text-primary text-[32px]">progress_activity</span>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile">
        <div className="w-full max-w-sm text-center">
          <span className="material-symbols-outlined text-error text-[40px]">link_off</span>
          <h1 className="mt-sm font-title-md text-title-md text-on-surface">Link inválido ou expirado</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Peça um novo convite, ou use "Esqueci minha senha" na tela de login.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile">
      <div className="w-full max-w-sm">
        <div className="mb-xl text-center">
          <div className="mx-auto mb-md flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
            <span className="material-symbols-outlined text-on-primary-container text-[28px]">lock</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Crie sua senha</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            {session.user.email}
          </p>
        </div>

        {done ? (
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg text-center">
            <span className="material-symbols-outlined text-tertiary text-[32px]">check_circle</span>
            <p className="mt-sm font-body-md text-body-md text-on-surface">Senha criada! Entrando…</p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg space-y-md"
          >
            <div>
              <label htmlFor="password" className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                Nova senha
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
                placeholder="mínimo 8 caracteres"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                Confirme a senha
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
                placeholder="repita a senha"
              />
            </div>

            {error && (
              <p className="rounded bg-error-container px-md py-sm font-label-md text-label-md text-on-error-container">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-primary py-sm font-title-md text-title-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Salvando…' : 'Salvar senha e entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
