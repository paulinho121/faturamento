// Gerenciamento do certificado digital A1 pela tela (só o diretor).
//
//   GET     /api/dfe-certificado   situação: certificado (CNPJ, titular, validade), captura por CNPJ e avisos
//   POST    /api/dfe-certificado   { pfxBase64, senha } valida o .pfx, criptografa e guarda
//   POST    /api/dfe-certificado   { acao: "consultar", ciencia?: boolean } busca as notas na SEFAZ agora
//   POST    /api/dfe-certificado   { acao: "periodo", dataInicio, dataFim } define a janela de datas da captura
//   POST    /api/dfe-certificado   { acao: "reiniciar" } volta a leitura da SEFAZ para o início (relê tudo na janela)
//   DELETE  /api/dfe-certificado   remove o certificado guardado
//
// Autenticação: o token de sessão do usuário (header Authorization: Bearer <token>), conferido no Supabase; só o
// perfil diretor passa. O certificado e a senha NUNCA são devolvidos nem registrados: a resposta só tem metadados.
// Guia: docs/CAPTURA_NFE_ENTRADA.md.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { abrirPfx, capturarNotas, carregarCertificadoConfigurado, carregarJanela, cifrarSegredo, cnpjsParaConsultar } from './dfe-sync.js'

const TAMANHO_MAXIMO_BASE64 = 300_000 // um A1 tem poucos KB; isso é folga de sobra
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

function descreverErro(e: unknown): string {
  return e instanceof Error ? e.message : 'erro desconhecido'
}

async function usuarioDiretor(supabase: SupabaseClient, req: VercelRequest): Promise<{ id: string; nome: string | null } | null> {
  const auth = req.headers.authorization
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const { data: usuario, error } = await supabase.auth.getUser(token)
  if (error || !usuario?.user) return null
  const { data: perfil } = await supabase.from('profiles').select('role, full_name').eq('id', usuario.user.id).maybeSingle()
  if (!perfil || perfil.role !== 'diretor') return null
  return { id: usuario.user.id, nome: perfil.full_name ?? null }
}

// Avisos úteis na tela: validade próxima e CNPJ do certificado diferente do das filiais.
async function avisosDoCertificado(supabase: SupabaseClient, cnpj: string | null, validoAte: Date): Promise<string[]> {
  const avisos: string[] = []
  const dias = Math.round((validoAte.getTime() - Date.now()) / 86_400_000)
  if (dias < 0) avisos.push('O certificado está vencido.')
  else if (dias <= 30) avisos.push(`O certificado vence em ${dias} dia${dias === 1 ? '' : 's'}.`)
  const { data } = await supabase.from('filiais').select('nome, cnpj').eq('ativo', true)
  const filiais = ((data ?? []) as { nome: string; cnpj: string | null }[]).filter((f) => soDigitos(f.cnpj).length === 14)
  if (!cnpj) {
    avisos.push('Não foi possível identificar o CNPJ no certificado.')
  } else if (filiais.length === 0) {
    avisos.push('Nenhuma filial ativa tem CNPJ cadastrado: a captura não terá o que consultar.')
  } else {
    const fora = filiais.filter((f) => soDigitos(f.cnpj).slice(0, 8) !== cnpj.slice(0, 8))
    if (fora.length > 0) avisos.push(`O CNPJ do certificado tem raiz diferente de: ${fora.map((f) => f.nome).join(', ')}. A SEFAZ pode recusar a consulta dessas filiais.`)
  }
  return avisos
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await executar(req, res)
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ erro: `Falha inesperada: ${descreverErro(e)}` })
  }
}

async function executar(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
    res.setHeader('Allow', 'GET, POST, DELETE')
    res.status(405).json({ erro: 'Método não permitido.' })
    return
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ erro: 'Servidor sem acesso ao banco (variáveis ausentes).' })
    return
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const usuario = await usuarioDiretor(supabase, req)
  if (!usuario) {
    res.status(401).json({ erro: 'Acesso restrito ao diretor. Entre novamente.' })
    return
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('dfe_certificado').delete().eq('id', 1)
    if (error) throw new Error(error.message)
    res.status(200).json({ ok: true })
    return
  }

  if (req.method === 'POST') {
    const corpo = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as {
      pfxBase64?: unknown
      senha?: unknown
      acao?: unknown
      ciencia?: unknown
      cnpj?: unknown
      dataInicio?: unknown
      dataFim?: unknown
    }
    if (corpo.acao === 'periodo') {
      const valida = (v: unknown): string | null | undefined => {
        if (v === null || v === undefined || v === '') return null
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : undefined
      }
      const inicio = valida(corpo.dataInicio)
      const fim = valida(corpo.dataFim)
      if (inicio === undefined || fim === undefined) {
        res.status(400).json({ erro: 'Data inválida. Use o formato AAAA-MM-DD.' })
        return
      }
      if (inicio && fim && inicio > fim) {
        res.status(400).json({ erro: 'A data inicial não pode ser depois da data final.' })
        return
      }
      const { error } = await supabase.from('dfe_config').upsert(
        { id: 1, data_inicio: inicio, data_fim: fim, atualizado_em: new Date().toISOString(), atualizado_por: usuario.id },
        { onConflict: 'id' }
      )
      if (error) throw new Error(`Erro ao guardar o período: ${error.message}`)
      res.status(200).json({ ok: true, periodo: { dataInicio: inicio, dataFim: fim } })
      return
    }
    if (corpo.acao === 'reiniciar') {
      // Volta o ponteiro (NSU) de cada CNPJ para o começo: a próxima busca relê tudo que a SEFAZ ainda mantém e
      // grava o que cai na janela de datas. Notas já gravadas não duplicam (chave única). NÃO libera o intervalo
      // de espera da SEFAZ (proxima_consulta continua valendo): reler antes da hora causaria bloqueio.
      const { error } = await supabase
        .from('dfe_controle')
        .update({ ult_nsu: '000000000000000', max_nsu: null, erros_seguidos: 0 })
        .neq('cnpj', '')
      if (error) throw new Error(`Erro ao reiniciar a leitura: ${error.message}`)
      res.status(200).json({ ok: true })
      return
    }
    if (corpo.acao === 'consultar') {
      // Botão "Buscar notas agora": mesma rotina do agendador (respeita o intervalo de 1 hora da SEFAZ).
      const configurado = await carregarCertificadoConfigurado(supabase)
      if (!configurado) {
        res.status(400).json({ erro: 'Envie o certificado antes de buscar as notas.' })
        return
      }
      if (configurado.cert.validoAte.getTime() < Date.now()) {
        res.status(400).json({ erro: 'O certificado está vencido. Envie um certificado válido.' })
        return
      }
      const so = typeof corpo.cnpj === 'string' ? soDigitos(corpo.cnpj) : ''
      const resultado = await capturarNotas(supabase, configurado.cert, await cnpjsParaConsultar(supabase, so), corpo.ciencia === true)
      res.status(200).json(resultado)
      return
    }
    const pfx = typeof corpo.pfxBase64 === 'string' ? corpo.pfxBase64.replace(/\s+/g, '') : ''
    const senha = typeof corpo.senha === 'string' ? corpo.senha : ''
    if (!pfx || !/^[A-Za-z0-9+/=]+$/.test(pfx)) {
      res.status(400).json({ erro: 'Arquivo do certificado inválido. Envie o arquivo .pfx ou .p12.' })
      return
    }
    if (pfx.length > TAMANHO_MAXIMO_BASE64) {
      res.status(400).json({ erro: 'O arquivo é grande demais para ser um certificado A1.' })
      return
    }
    let cert
    try {
      cert = abrirPfx(pfx, senha)
    } catch (e) {
      // Mensagem da abertura do .pfx (senha errada ou arquivo corrompido); nunca inclui a senha.
      res.status(400).json({ erro: descreverErro(e) })
      return
    }
    if (cert.validoAte.getTime() < Date.now()) {
      res.status(400).json({ erro: `Este certificado está vencido desde ${cert.validoAte.toISOString().slice(0, 10)}. Envie um certificado válido.` })
      return
    }
    const { error } = await supabase.from('dfe_certificado').upsert(
      {
        id: 1,
        cifrado: cifrarSegredo(JSON.stringify({ pfx, senha })),
        cnpj: cert.cnpj,
        titular: cert.titular,
        valido_ate: cert.validoAte.toISOString(),
        enviado_em: new Date().toISOString(),
        enviado_por: usuario.id,
      },
      { onConflict: 'id' }
    )
    if (error) throw new Error(`Erro ao guardar o certificado: ${error.message}`)
    res.status(200).json({
      ok: true,
      certificado: { cnpj: cert.cnpj, titular: cert.titular, validoAte: cert.validoAte.toISOString().slice(0, 10) },
      avisos: await avisosDoCertificado(supabase, cert.cnpj, cert.validoAte),
    })
    return
  }

  // GET: situação do certificado e da captura
  const { data: guardado } = await supabase
    .from('dfe_certificado')
    .select('cnpj, titular, valido_ate, enviado_em, enviado_por')
    .eq('id', 1)
    .maybeSingle()
  let origem: 'painel' | 'variavel' | null = guardado ? 'painel' : null
  let certificado: Record<string, unknown> | null = null
  let avisos: string[] = []
  let erroCertificado: string | null = null
  if (guardado) {
    const { data: quem } = guardado.enviado_por
      ? await supabase.from('profiles').select('full_name').eq('id', guardado.enviado_por).maybeSingle()
      : { data: null }
    certificado = {
      cnpj: guardado.cnpj,
      titular: guardado.titular,
      validoAte: String(guardado.valido_ate).slice(0, 10),
      enviadoEm: guardado.enviado_em,
      enviadoPor: quem?.full_name ?? null,
    }
    avisos = await avisosDoCertificado(supabase, guardado.cnpj, new Date(guardado.valido_ate))
  } else {
    try {
      const configurado = await carregarCertificadoConfigurado(supabase)
      if (configurado) {
        origem = configurado.origem
        certificado = { cnpj: configurado.cert.cnpj, titular: configurado.cert.titular, validoAte: configurado.cert.validoAte.toISOString().slice(0, 10), enviadoEm: null, enviadoPor: null }
        avisos = await avisosDoCertificado(supabase, configurado.cert.cnpj, configurado.cert.validoAte)
      }
    } catch (e) {
      erroCertificado = descreverErro(e)
    }
  }

  const [{ data: controle }, { count: total }, { count: completas }, { data: ultima }] = await Promise.all([
    supabase.from('dfe_controle').select('cnpj, ult_nsu, ultima_consulta, proxima_consulta, ultimo_status, ultima_mensagem, erros_seguidos').order('cnpj'),
    supabase.from('nfe_entrada').select('chave', { count: 'exact', head: true }),
    supabase.from('nfe_entrada').select('chave', { count: 'exact', head: true }).eq('completa', true),
    supabase.from('nfe_entrada').select('capturado_em').order('capturado_em', { ascending: false }).limit(1),
  ])
  const { data: ultimasNotas } = await supabase
    .from('nfe_entrada')
    .select('chave, emitente_nome, emitente_cnpj, numero, data_emissao, valor, situacao, completa, manifestacao')
    .order('data_emissao', { ascending: false })
    .limit(20)
  const periodo = await carregarJanela(supabase)
  let cnpjsConsulta: { cnpj: string; nome: string | null }[] = []
  try {
    cnpjsConsulta = (await cnpjsParaConsultar(supabase)).map((a) => ({ cnpj: a.cnpj, nome: a.nome }))
  } catch {
    /* a tela só deixa de oferecer a escolha */
  }
  res.status(200).json({
    cnpjsConsulta,
    periodo: { dataInicio: periodo.inicio, dataFim: periodo.fim },
    configurado: !!certificado,
    origem,
    certificado,
    avisos,
    erroCertificado,
    cienciaAutomatica: process.env.DFE_CIENCIA_AUTOMATICA === '1',
    captura: {
      cnpjs: (controle ?? []).map((c: Record<string, unknown>) => ({
        cnpj: c.cnpj,
        ultimaConsulta: c.ultima_consulta,
        proximaConsulta: c.proxima_consulta,
        status: c.ultimo_status,
        mensagem: c.ultima_mensagem,
        errosSeguidos: c.erros_seguidos,
      })),
      notas: { total: total ?? 0, completas: completas ?? 0, soResumo: (total ?? 0) - (completas ?? 0), ultimaCaptura: ultima?.[0]?.capturado_em ?? null },
      ultimasNotas: ultimasNotas ?? [],
    },
  })
}
