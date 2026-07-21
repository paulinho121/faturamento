import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { roleHome } from '../lib/roleHome'

export function LoginPage() {
  const { session, profile, loading, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [forgotSent, setForgotSent] = useState(false)

  if (!loading && session && profile) {
    return <Navigate to={roleHome(profile.role)} replace />
  }

  // Login funcionou (existe sessão) mas não achamos um perfil vinculado a
  // essa conta — antes disso a tela só ficava parada sem explicar nada.
  if (!loading && session && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile">
        <div className="w-full max-w-sm text-center">
          <span className="material-symbols-outlined text-error text-[40px]">error</span>
          <h1 className="mt-md font-headline-lg text-headline-lg text-on-surface">Acesso não configurado</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Seu login funcionou, mas essa conta ainda não tem um perfil de acesso vinculado (papel
            faturista/diretor/vendedor). Fale com o administrador do sistema.
          </p>
          <button
            onClick={() => signOut()}
            className="mt-lg rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            Voltar para o login
          </button>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await signIn(email, password)
    setSubmitting(false)
    if (error) {
      setError('E-mail ou senha inválidos.')
      return
    }
    navigate('/', { replace: true })
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/definir-senha`,
    })
    setSubmitting(false)
    if (error) {
      setError('Não foi possível enviar o e-mail: ' + error.message)
      return
    }
    setForgotSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile">
      <div className="w-full max-w-sm">
        <div className="mb-xl text-center">
          <div className="mx-auto mb-md flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-tertiary-fixed-dim">
            <span className="material-symbols-outlined text-on-primary text-[28px]">payments</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">MCI Faturamento</h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            {mode === 'login' ? 'Entre com sua conta para continuar' : 'Recuperar acesso'}
          </p>
        </div>

        {mode === 'login' ? (
          <form
            onSubmit={handleSubmit}
            className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg space-y-md"
          >
            <div>
              <label htmlFor="email" className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
                placeholder="voce@empresa.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                Senha
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
                placeholder="••••••••"
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
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError(null)
              }}
              className="w-full text-center font-label-md text-label-md text-primary hover:underline"
            >
              Esqueci minha senha
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleForgot}
            className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg space-y-md"
          >
            {forgotSent ? (
              <div className="text-center">
                <span className="material-symbols-outlined text-tertiary text-[32px]">mark_email_read</span>
                <p className="mt-sm font-body-md text-body-md text-on-surface">
                  Se esse e-mail estiver cadastrado, enviamos um link para criar uma nova senha.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="forgot-email" className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                    E-mail
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
                    placeholder="voce@empresa.com"
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
                  {submitting ? 'Enviando…' : 'Enviar link'}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setMode('login')
                setForgotSent(false)
                setError(null)
              }}
              className="w-full text-center font-label-md text-label-md text-on-surface-variant hover:underline"
            >
              Voltar para o login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
