// Recebe o XML que o watcher (rodando no PC do faturista) manda assim que o
// emissor salva um novo arquivo na pasta observada. Só guarda em
// nfe_capturas como "pendente" — vira nota de verdade quando o faturista
// confirma na Caixa de Entrada, igual ao upload manual (vendedor não vem no
// XML, então não dá pra lançar sozinho). Roda com a service role key porque
// quem chama aqui é um script local, não um usuário logado no sistema.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function extrairChaveAcesso(xml: string): string | null {
  const porId = xml.match(/<infNFe[^>]*\bId="NFe(\d{44})"/i)
  if (porId) return porId[1]
  const porTag = xml.match(/<chNFe>(\d{44})<\/chNFe>/i)
  return porTag ? porTag[1] : null
}

function extrairNumeroNf(xml: string): string | null {
  return xml.match(/<nNF>(\d+)<\/nNF>/)?.[1] ?? null
}

function extrairDataEmissao(xml: string): string | null {
  return (xml.match(/<dhEmi>(\d{4}-\d{2}-\d{2})/) ?? xml.match(/<dEmi>(\d{4}-\d{2}-\d{2})/))?.[1] ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET ou POST.' })
    return
  }

  const secretEsperado = process.env.NFE_WATCHER_SECRET
  const secretRecebido = req.headers['x-watcher-secret']
  if (!secretEsperado || secretRecebido !== secretEsperado) {
    res.status(401).json({ error: 'Segredo do watcher ausente ou inválido (header x-watcher-secret).' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const servicoProfileId = process.env.CRM_SERVICE_PROFILE_ID
  if (!supabaseUrl || !serviceRoleKey || !servicoProfileId) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis de ambiente ausentes).' })
    return
  }

  const supabaseCfg = createClient(supabaseUrl, serviceRoleKey)

  // GET: o watcher busca aqui a pasta configurada pelo faturista no app —
  // assim ele não precisa editar arquivo nenhum no PC pra trocar de pasta.
  if (req.method === 'GET') {
    const { data, error } = await supabaseCfg
      .from('nfe_watcher_config')
      .select('pasta, data_corte')
      .eq('id', 1)
      .single()
    if (error) {
      res.status(500).json({ error: `Erro ao buscar configuração: ${error.message}` })
      return
    }
    res.status(200).json({ pasta: data?.pasta ?? null, data_corte: data?.data_corte ?? null })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const arquivoNome = typeof body.arquivo_nome === 'string' ? body.arquivo_nome.trim() : ''
  const xmlBase64 = typeof body.xml_base64 === 'string' ? body.xml_base64 : ''
  if (!arquivoNome) {
    res.status(400).json({ error: 'Campo "arquivo_nome" é obrigatório.' })
    return
  }
  if (!xmlBase64) {
    res.status(400).json({ error: 'Campo "xml_base64" é obrigatório.' })
    return
  }

  let xml: string
  try {
    xml = Buffer.from(xmlBase64, 'base64').toString('utf-8')
  } catch {
    res.status(400).json({ error: 'Campo "xml_base64" não é um base64 válido.' })
    return
  }
  if (!/<infNFe[\s>]/i.test(xml)) {
    res.status(400).json({ error: 'O arquivo enviado não parece ser um XML de NF-e.' })
    return
  }

  const chaveAcesso = extrairChaveAcesso(xml)
  const numeroNf = extrairNumeroNf(xml)
  const dataEmissao = extrairDataEmissao(xml)

  if (chaveAcesso) {
    const { data: existente } = await supabaseCfg
      .from('nfe_capturas')
      .select('id')
      .eq('chave_acesso', chaveAcesso)
      .maybeSingle()
    if (existente) {
      res.status(200).json({ ok: true, duplicado: true })
      return
    }

    // Já lançada manualmente antes de o watcher existir (ou no mesmo dia, por
    // outro faturista) — não precisa passar pela Caixa de Entrada de novo.
    const { data: jaLancada } = await supabaseCfg
      .from('invoices')
      .select('id')
      .eq('xml_chave_acesso', chaveAcesso)
      .maybeSingle()
    if (jaLancada) {
      res.status(200).json({ ok: true, ja_lancada: true })
      return
    }
  }

  // Só entra na fila nota emitida a partir da data de corte configurada —
  // sem isso, a primeira varredura da pasta traria o histórico inteiro.
  const { data: config } = await supabaseCfg.from('nfe_watcher_config').select('data_corte').eq('id', 1).single()
  if (config?.data_corte && dataEmissao && dataEmissao < config.data_corte) {
    res.status(200).json({ ok: true, antiga: true })
    return
  }

  const { error } = await supabaseCfg.from('nfe_capturas').insert({
    chave_acesso: chaveAcesso,
    arquivo_nome: arquivoNome,
    xml_raw: xml,
    created_by: servicoProfileId,
  })

  if (error) {
    if (error.code === '23505') {
      res.status(200).json({ ok: true, duplicado: true })
      return
    }
    res.status(500).json({ error: `Erro ao registrar captura: ${error.message}` })
    return
  }

  res.status(201).json({ ok: true, numero_nf: numeroNf })
}
