// Andamento automático dos pedidos de Santa Catarina: consulta o WMS do CD
// (API Escalasoft) pelo número do pedido no ERP (pedidos.numero_pedido_cd,
// digitado pelo faturista ao iniciar o processo) e avança a etapa do pedido.
//
//   GET/POST             sincroniza todos os pedidos SC em andamento
//   GET ?pedido=123456   só consulta esse número no CD e mostra a situação
//                        (não altera nada) — pra conferir credenciais e nomes
//
// Chamada por um agendador (a cada ~5 min) com o header x-sync-secret. Exemplo
// com pg_cron + pg_net no Supabase:
//   select cron.schedule('escala-sync', '*/5 * * * *', $$
//     select net.http_get('https://faturamentomcit.vercel.app/api/escala-sync',
//                         headers := '{"x-sync-secret": "<ESCALA_SYNC_SECRET>"}'::jsonb) $$);
//
// Faturar continua manual: o CD diz onde o pedido está na separação, não que
// a nota foi emitida.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'

type Etapa = 'em_processo' | 'enviado_sanco' | 'em_separacao' | 'preparando_embarque'

const ORDEM_ETAPAS: Etapa[] = ['em_processo', 'enviado_sanco', 'em_separacao', 'preparando_embarque']

// Situações do WMS (painel Sanco): Encerrada, Em execução, Ag gerar embarque,
// Ag embarque, Ag gerar devolução. Em execução = separando; separação
// terminada (Ag gerar embarque / Ag embarque / Encerrada) = preparando embarque.
// Pedido já cadastrado no CD e ainda sem execução (ex.: "Cadastrada") conta
// como "enviado para a Sanco".
function etapaDaSituacao(situacao: string): Etapa | 'devolucao' {
  const s = situacao.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (s.includes('devolu')) return 'devolucao'
  if (s.includes('encerrada') || s.includes('ag gerar embarque') || s.includes('ag embarque')) {
    return 'preparando_embarque'
  }
  if (s.includes('em execu')) return 'em_separacao'
  return 'enviado_sanco'
}

// Pedidos só da Sanco (tabela pedidos_sanco): sem faturamento pra "faturar", então
// Encerrada = finalizado (sai da TV) em vez de "preparando embarque".
function etapaDoPedidoSanco(situacao: string): Etapa | 'devolucao' | 'encerrada' {
  const s = situacao.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return s.includes('encerrada') && !s.includes('devolu') ? 'encerrada' : etapaDaSituacao(situacao)
}

function segredoConfere(recebido: string | string[] | undefined, esperado: string): boolean {
  if (typeof recebido !== 'string') return false
  const a = new Uint8Array(createHash('sha256').update(recebido).digest())
  const b = new Uint8Array(createHash('sha256').update(esperado).digest())
  return timingSafeEqual(a, b)
}

// token null = login recusado; `detalhe` é a resposta do CD (sem credenciais) pra diagnóstico.
async function obterToken(base: string, usuario: string, senha: string): Promise<{ token: string | null; detalhe: string }> {
  const credenciais = Buffer.from(`${usuario}:${senha}`).toString('base64')
  const res = await fetch(`${base}/Authorization`, {
    headers: { Authorization: `Basic ${credenciais}`, Accept: 'application/json' },
  })
  const texto = await res.text()
  const detalhe = `HTTP ${res.status}: ${texto.replace(/\s+/g, ' ').trim().slice(0, 300)}`
  if (!res.ok) return { token: null, detalhe }
  try {
    const dados = JSON.parse(texto) as Record<string, unknown>
    // API pública: { token }; servidor WMS da Sanco: { retorno: [{ token }] }.
    const retorno = Array.isArray(dados.retorno) ? (dados.retorno[0] as Record<string, unknown> | undefined) : undefined
    const token = dados.token ?? dados.Token ?? dados.access_token ?? retorno?.token
    return { token: typeof token === 'string' && token ? token : texto.trim(), detalhe }
  } catch {
    return { token: texto.trim(), detalhe }
  }
}

async function consultarBruto(base: string, token: string, numeroPedido: string) {
  const params = new URLSearchParams({ numeropedido: numeroPedido })
  const res = await fetch(`${base}/armazem/producao/consultaNumeroPedido?${params}`, {
    // O servidor responde "Token nao informado" sem o token; manda nos dois formatos usuais.
    headers: { Authorization: `Bearer ${token}`, token, Accept: 'application/json' },
  })
  return { status: res.status, ok: res.ok, texto: await res.text() }
}

interface OrdemCd {
  situacao: string
  volumes: number | null
}

// null = o CD não conhece esse número (ainda); erro de rede/auth vira exceção.
async function consultarOrdem(base: string, token: string, numeroPedido: string): Promise<OrdemCd | null> {
  const { status, ok, texto } = await consultarBruto(base, token, numeroPedido)
  if (status === 400 || status === 404) return null
  if (!ok) throw new Error(`CD respondeu ${status}`)
  const dados = JSON.parse(texto) as Record<string, unknown>
  // Formatos vistos: { Lista: [{ Situacao }] }, { Situacao } e, no servidor da
  // Sanco, { Ordem: { idSituacao, nomeSituacao, volume } }.
  const lista = dados.Lista
  const ordem = (Array.isArray(lista) ? lista[0] : (dados.Ordem ?? dados)) as Record<string, unknown> | undefined
  const situacao = ordem?.Situacao ?? ordem?.situacao ?? ordem?.nomeSituacao ?? ordem?.Status
  if (typeof situacao !== 'string' || !situacao.trim()) return null
  // O CD manda "volume" como texto ("1"); só vale número inteiro positivo.
  const volumes = Number(ordem?.volume ?? ordem?.volumes ?? ordem?.Volume)
  return { situacao: situacao.trim(), volumes: Number.isInteger(volumes) && volumes > 0 ? volumes : null }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Use GET ou POST.' })
    return
  }

  const secretEsperado = process.env.ESCALA_SYNC_SECRET
  if (!secretEsperado || !segredoConfere(req.headers['x-sync-secret'], secretEsperado)) {
    res.status(401).json({ error: 'Segredo ausente ou inválido (header x-sync-secret).' })
    return
  }

  const usuario = process.env.ESCALA_USUARIO
  const senha = process.env.ESCALA_SENHA
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!usuario || !senha || !supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis de ambiente ausentes).' })
    return
  }
  const base = (process.env.ESCALA_API_URL || 'http://sanco.cloud.escalasoft.com.br:4034/escalasoft').replace(/\/+$/, '')

  const login = await obterToken(base, usuario, senha)
  const token = login.token
  if (!token) {
    res.status(502).json({ error: 'O CD recusou o login (confira ESCALA_USUARIO e ESCALA_SENHA).', resposta_do_cd: login.detalhe, servidor: base })
    return
  }

  const consulta = typeof req.query.pedido === 'string' ? req.query.pedido.trim() : ''
  if (consulta) {
    try {
      const ordem = await consultarOrdem(base, token, consulta)
      const situacao = ordem?.situacao ?? null
      const resposta: Record<string, unknown> = {
        pedido: consulta,
        situacao,
        volumes: ordem?.volumes ?? null,
        etapa: situacao ? etapaDaSituacao(situacao) : null,
      }
      if (!situacao) {
        // Sem situação: mostra o que o CD respondeu, pra distinguir número errado de formato diferente.
        const bruto = await consultarBruto(base, token, consulta)
        resposta.diagnostico = { servidor: base, http: bruto.status, resposta_do_cd: bruto.texto.slice(0, 500) }
      }
      res.status(200).json(resposta)
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : 'Erro ao consultar o CD.' })
    }
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, numero, etapa, numero_pedido_cd, volumes')
    .eq('origem', 'SC')
    .eq('status', 'pendente')
    // preparando_embarque segue na lista: os volumes só aparecem no fim da separação.
    .in('etapa', ['em_processo', 'enviado_sanco', 'em_separacao', 'preparando_embarque'])
    .not('numero_pedido_cd', 'is', null)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) {
    res.status(500).json({ error: `Erro ao buscar pedidos: ${error.message}` })
    return
  }

  const resumo = { total: pedidos?.length ?? 0, atualizados: 0, volumes_atualizados: 0, sem_mudanca: 0, nao_encontrados: 0, devolucoes: [] as number[], erros: [] as string[] }
  for (const pedido of pedidos ?? []) {
    try {
      const ordem = await consultarOrdem(base, token, String(pedido.numero_pedido_cd))
      if (!ordem) {
        resumo.nao_encontrados++
        continue
      }
      if (ordem.volumes && ordem.volumes !== pedido.volumes) {
        const { error: volError } = await supabase.rpc('escala_definir_volumes', { p_pedido_id: pedido.id, p_volumes: ordem.volumes })
        if (volError) throw new Error(volError.message)
        resumo.volumes_atualizados++
      }
      const alvo = etapaDaSituacao(ordem.situacao)
      if (alvo === 'devolucao') {
        resumo.devolucoes.push(pedido.numero)
        continue
      }
      // Etapa só avança, e de uma em uma (o gatilho do banco exige a sequência).
      const atual = ORDEM_ETAPAS.indexOf(pedido.etapa as Etapa)
      const destino = ORDEM_ETAPAS.indexOf(alvo)
      if (destino <= atual) {
        resumo.sem_mudanca++
        continue
      }
      for (const etapa of ORDEM_ETAPAS.slice(atual + 1, destino + 1)) {
        const { error: rpcError } = await supabase.rpc('escala_avancar_etapa', { p_pedido_id: pedido.id, p_etapa: etapa })
        if (rpcError) throw new Error(rpcError.message)
      }
      resumo.atualizados++
    } catch (e) {
      resumo.erros.push(`#${pedido.numero}: ${e instanceof Error ? e.message : 'erro'}`)
    }
  }

  // Pedidos acompanhados só no CD (aparecem na TV): guarda a situação e desde
  // quando está nela. Falha aqui não derruba a sincronização acima.
  const sanco = { total: 0, atualizados: 0, encerrados: 0, nao_encontrados: 0, erros: [] as string[] }
  const { data: daSanco, error: sancoError } = await supabase
    .from('pedidos_sanco')
    .select('id, numero_pedido_cd, etapa, situacao, volumes')
    .neq('etapa', 'encerrada')
    .order('created_at', { ascending: true })
    .limit(100)
  if (sancoError) {
    sanco.erros.push(`Erro ao buscar pedidos da Sanco: ${sancoError.message}`)
  } else {
    sanco.total = daSanco?.length ?? 0
    for (const item of daSanco ?? []) {
      try {
        const ordem = await consultarOrdem(base, token, String(item.numero_pedido_cd))
        if (!ordem) {
          sanco.nao_encontrados++
          continue
        }
        const { situacao, volumes } = ordem
        const etapa = etapaDoPedidoSanco(situacao)
        if (etapa === item.etapa && situacao === item.situacao && (volumes ?? null) === item.volumes) continue
        const agora = new Date().toISOString()
        const { error: updateError } = await supabase
          .from('pedidos_sanco')
          .update({ situacao, volumes, etapa, atualizado_em: agora, ...(etapa !== item.etapa ? { desde: agora } : {}) })
          .eq('id', item.id)
        if (updateError) throw new Error(updateError.message)
        if (etapa === 'encerrada') sanco.encerrados++
        else sanco.atualizados++
      } catch (e) {
        sanco.erros.push(`${item.numero_pedido_cd}: ${e instanceof Error ? e.message : 'erro'}`)
      }
    }
  }

  res.status(200).json({ ok: true, ...resumo, sanco })
}
