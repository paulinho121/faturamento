// Link de acesso do Modo TV: a TV da filial abre /tv/acesso?chave=<segredo> e
// entra direto, sem digitar login, numa conta que só enxerga o painel da TV
// (perfil com papel "tv"). Aqui a gente confere o segredo do link e abre uma
// sessão dessa conta.
//
//   POST { chave }   ->   { access_token, refresh_token }
//
// Segredo do link em TV_LINK_SECRET (Vercel). Pra cancelar o link, troque o valor
// e faça Redeploy. A conta "tv" é a única com papel "tv" em profiles.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'

function chaveConfere(recebida: string, esperada: string): boolean {
  const a = new Uint8Array(createHash('sha256').update(recebida).digest())
  const b = new Uint8Array(createHash('sha256').update(esperada).digest())
  return timingSafeEqual(a, b)
}

function lerChave(req: VercelRequest): string {
  const bruto: unknown = req.body
  let corpo: unknown = bruto
  if (typeof bruto === 'string') {
    try {
      corpo = JSON.parse(bruto)
    } catch {
      return ''
    }
  }
  const chave = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>).chave : ''
  return typeof chave === 'string' ? chave.trim() : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const segredo = process.env.TV_LINK_SECRET
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!segredo || !supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(500).json({ error: 'Link da TV não configurado no servidor (variável TV_LINK_SECRET ausente).' })
    return
  }

  const chave = lerChave(req)
  if (!chave || !chaveConfere(chave, segredo)) {
    res.status(401).json({ error: 'Link inválido ou cancelado. Peça um link novo.' })
    return
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: perfil } = await admin.from('profiles').select('id').eq('role', 'tv').limit(1).maybeSingle()
  if (!perfil) {
    res.status(404).json({ error: 'Ainda não existe a conta da TV (perfil com papel "tv").' })
    return
  }
  const { data: usuario } = await admin.auth.admin.getUserById(perfil.id)
  const email = usuario.user?.email
  if (!email) {
    res.status(404).json({ error: 'A conta da TV não tem e-mail no login.' })
    return
  }

  // Sem senha: gera o link mágico da conta e já troca por uma sessão aqui mesmo.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const hash = link?.properties?.hashed_token
  if (linkError || !hash) {
    res.status(502).json({ error: `Não consegui abrir a sessão da TV: ${linkError?.message ?? 'sem token'}` })
    return
  }
  const publico = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verificado, error: verifyError } = await publico.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
  const sessao = verificado?.session
  if (verifyError || !sessao) {
    res.status(502).json({ error: `Não consegui abrir a sessão da TV: ${verifyError?.message ?? 'sem sessão'}` })
    return
  }

  console.log('[tv-sessao] sessão da TV aberta')
  res.status(200).json({ access_token: sessao.access_token, refresh_token: sessao.refresh_token })
}
