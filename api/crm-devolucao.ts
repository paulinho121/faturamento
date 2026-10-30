// Faturamento -> CRM: avisa o CRM quando o escritório devolve um pedido que
// veio de lá, pra ele mostrar o popup pro vendedor (o motivo da devolução vem
// junto). Quem chama aqui é a nossa tela, logo depois do "Devolver pedido",
// com o login de quem devolveu; a gente confere quem é, lê o pedido do banco
// (nada do corpo é confiável além do id) e repassa ao CRM com o segredo dele.
//
//   POST { pedido_id }   Authorization: Bearer <token do usuário logado>
//
// Sem CRM_CALLBACK_URL/CRM_CALLBACK_SECRET, ou com pedido que não veio do CRM
// (sem id_externo), não envia nada e responde { ok: true, enviado: false }.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const PERFIS_DO_ESCRITORIO = ['faturista', 'financeiro', 'diretor']

function lerPedidoId(req: VercelRequest): string {
  const bruto: unknown = req.body
  let corpo: unknown = bruto
  if (typeof bruto === 'string') {
    try {
      corpo = JSON.parse(bruto)
    } catch {
      return ''
    }
  }
  const id = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>).pedido_id : ''
  return typeof id === 'string' ? id.trim() : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis de ambiente ausentes).' })
    return
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const cabecalho = req.headers.authorization
  const token = typeof cabecalho === 'string' && cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : ''
  const { data: sessao } = token ? await supabase.auth.getUser(token) : { data: { user: null } }
  if (!sessao.user) {
    res.status(401).json({ error: 'Faça login para avisar o CRM.' })
    return
  }
  const { data: perfil } = await supabase.from('profiles').select('role').eq('id', sessao.user.id).maybeSingle()
  if (!perfil || !PERFIS_DO_ESCRITORIO.includes(perfil.role)) {
    res.status(403).json({ error: 'Só o escritório pode avisar o CRM sobre devoluções.' })
    return
  }

  const pedidoId = lerPedidoId(req)
  if (!pedidoId) {
    res.status(400).json({ error: 'Campo "pedido_id" é obrigatório.' })
    return
  }

  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('numero, cliente, status, id_externo, revisao, devolvido_motivo, devolvido_em, vendedores(nome, profile_id, email_crm)')
    .eq('id', pedidoId)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: `Erro ao buscar o pedido: ${error.message}` })
    return
  }
  if (!pedido) {
    res.status(404).json({ error: 'Pedido não encontrado.' })
    return
  }
  if (pedido.status !== 'devolvido') {
    res.status(409).json({ error: 'Esse pedido não está devolvido.' })
    return
  }

  const url = process.env.CRM_CALLBACK_URL
  const segredo = process.env.CRM_CALLBACK_SECRET
  if (!pedido.id_externo || !url || !segredo) {
    const motivo = !pedido.id_externo ? 'sem_vinculo_crm' : 'crm_nao_configurado'
    console.log(`[crm-devolucao] PED-${pedido.numero}: não enviado (${motivo})`)
    res.status(200).json({ ok: true, enviado: false, motivo })
    return
  }

  type VendedorRef = { nome?: string; profile_id?: string | null; email_crm?: string | null }
  const vendedorRaw = (pedido.vendedores as VendedorRef | VendedorRef[] | null) ?? null
  const vendedor = Array.isArray(vendedorRaw) ? vendedorRaw[0] : vendedorRaw

  // E-mail do vendedor no CRM: o CRM usa como alternativa pra achar o destinatário
  // quando o dono do orçamento não resolve. Vale o cadastrado em vendedores.email_crm;
  // sem ele, o e-mail do login (auth.users). Sem nenhum dos dois, vai sem e-mail.
  let emailDoVendedor: string | null = vendedor?.email_crm?.trim() || null
  if (!emailDoVendedor && vendedor?.profile_id) {
    const { data: usuario } = await supabase.auth.admin.getUserById(vendedor.profile_id)
    emailDoVendedor = usuario.user?.email ?? null
  }

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      // A função do CRM lê o segredo em x-crm-callback-secret; o outro fica por compatibilidade.
      headers: { 'Content-Type': 'application/json', 'x-crm-callback-secret': segredo, 'x-webhook-secret': segredo },
      body: JSON.stringify({
        // A função do CRM só reconhece nomes com "devolu", "return", "reprov" ou "recus".
        evento: 'pedido_devolucao',
        // id_externo é o UUID do orçamento no CRM; a função de lá o lê como quote_id.
        quote_id: pedido.id_externo,
        id_externo: pedido.id_externo,
        numero: pedido.numero,
        cliente: pedido.cliente,
        vendedor: vendedor?.nome ?? null,
        recipient_email: emailDoVendedor,
        motivo: pedido.devolvido_motivo,
        devolvido_em: pedido.devolvido_em,
        revisao: pedido.revisao,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!resposta.ok) {
      // O corpo do erro do CRM costuma dizer o que ele recusou (campo faltando etc.).
      const detalhe = (await resposta.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300)
      console.log(`[crm-devolucao] PED-${pedido.numero}: CRM respondeu ${resposta.status} ${detalhe}`)
      res.status(502).json({ error: `O CRM respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : '.'}` })
      return
    }
    console.log(`[crm-devolucao] PED-${pedido.numero}: enviado ao CRM (quote_id ${pedido.id_externo}, HTTP ${resposta.status})`)
    res.status(200).json({ ok: true, enviado: true })
  } catch (e) {
    console.log(`[crm-devolucao] PED-${pedido.numero}: falha de rede (${e instanceof Error ? e.message : 'erro'})`)
    res.status(502).json({ error: e instanceof Error ? `Não consegui falar com o CRM: ${e.message}` : 'Não consegui falar com o CRM.' })
  }
}
