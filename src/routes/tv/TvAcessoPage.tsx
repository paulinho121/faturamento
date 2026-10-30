import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

// Endereço que vai na TV da filial: /tv/acesso?chave=… . Troca a chave por uma
// sessão da conta "tv" (só enxerga o painel) e abre o Modo TV.
export function TvAcessoPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [erro, setErro] = useState<string | null>(null)
  const chave = params.get('chave') ?? ''

  useEffect(() => {
    if (!chave) {
      setErro('Link incompleto. Peça o link do Modo TV de novo.')
      return
    }
    let ativo = true
    async function entrar() {
      try {
        const resposta = await fetch('/api/tv-sessao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chave }),
        })
        const corpo = (await resposta.json().catch(() => null)) as
          | { error?: string; access_token?: string; refresh_token?: string }
          | null
        if (!resposta.ok || !corpo?.access_token || !corpo.refresh_token) {
          throw new Error(corpo?.error ?? `erro ${resposta.status}`)
        }
        const { error } = await supabase.auth.setSession({ access_token: corpo.access_token, refresh_token: corpo.refresh_token })
        if (error) throw new Error(error.message)
        // replace: a chave não fica no histórico do navegador da TV.
        if (ativo) navigate('/tv', { replace: true })
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não consegui abrir o Modo TV.')
      }
    }
    void entrar()
    return () => {
      ativo = false
    }
  }, [chave, navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#070d1a] px-6 text-center text-white">
      <img src="/logo.png" alt="MCI" className="mb-8 h-24 w-auto object-contain" />
      {erro ? (
        <p className="max-w-xl text-2xl text-rose-300">{erro}</p>
      ) : (
        <>
          <span className="material-symbols-outlined animate-spin text-[48px] text-[#00b499]">progress_activity</span>
          <p className="mt-4 text-2xl text-white/70">Abrindo o painel da TV…</p>
        </>
      )}
    </div>
  )
}
