// Gerenciamento do certificado digital A1 pela tela (só o diretor). O perfil da contabilidade só LÊ as notas capturadas
// e baixa os XMLs (recurso=notas, xml e zip); certificado, busca na SEFAZ, período e Ciência da Operação são só do diretor.
//
//   GET     /api/dfe-certificado   situação: certificado (CNPJ, titular, validade), captura por CNPJ e avisos
//   POST    /api/dfe-certificado   { pfxBase64, senha } valida o .pfx, criptografa e guarda
//   POST    /api/dfe-certificado   { acao: "consultar", ciencia?: boolean } busca as notas na SEFAZ agora
//   POST    /api/dfe-certificado   { acao: "periodo", dataInicio, dataFim } define a janela de datas da captura
//   POST    /api/dfe-certificado   { acao: "reiniciar" } volta a leitura da SEFAZ para o início (relê tudo na janela)
//   GET     /api/dfe-certificado?recurso=notas&de=&ate=&q=&situacao=&xml=sim|nao&limit=&offset=   lista as notas capturadas
//   GET     /api/dfe-certificado?recurso=xml&chave=<44 dígitos>     baixa o XML de uma nota
//   GET     /api/dfe-certificado?recurso=zip&de=&ate=&q=&situacao=  baixa os XMLs do filtro em um .zip
//   POST    /api/dfe-certificado   { acao: "ciencia", chaves: [...] } registra a Ciência da Operação das notas (libera o XML)
//   DELETE  /api/dfe-certificado   remove o certificado guardado
//
// Autenticação: o token de sessão do usuário (header Authorization: Bearer <token>), conferido no Supabase; só o
// perfil diretor passa. O certificado e a senha NUNCA são devolvidos nem registrados: a resposta só tem metadados.
// Guia: docs/CAPTURA_NFE_ENTRADA.md.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { zipSync, strToU8 } from 'fflate'
import { abrirPfx, capturarNotas, carregarCertificadoConfigurado, carregarJanela, cifrarSegredo, cnpjsParaConsultar, registrarCiencias } from './dfe-sync.js'

const TAMANHO_MAXIMO_BASE64 = 300_000 // um A1 tem poucos KB; isso é folga de sobra
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

function descreverErro(e: unknown): string {
  return e instanceof Error ? e.message : 'erro desconhecido'
}

async function usuarioDiretor(supabase: SupabaseClient, req: VercelRequest): Promise<{ id: string; nome: string | null; papel: 'diretor' | 'contabilidade' } | null> {
  const auth = req.headers.authorization
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const { data: usuario, error } = await supabase.auth.getUser(token)
  if (error || !usuario?.user) return null
  const { data: perfil } = await supabase.from('profiles').select('role, full_name').eq('id', usuario.user.id).maybeSingle()
  if (!perfil || (perfil.role !== 'diretor' && perfil.role !== 'contabilidade')) return null
  return { id: usuario.user.id, nome: perfil.full_name ?? null, papel: perfil.role }
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
  const recursoPedido = typeof req.query.recurso === 'string' ? req.query.recurso : ''
  if (usuario.papel === 'contabilidade' && !(req.method === 'GET' && ['notas', 'xml', 'zip'].includes(recursoPedido))) {
    res.status(403).json({ erro: 'Este perfil só consulta e baixa as notas capturadas.' })
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
    if (corpo.acao === 'ciencia') {
      // Ação explícita do usuário nas notas escolhidas. A SEFAZ passa a liberar o XML completo na próxima consulta.
      const chaves = Array.isArray((corpo as { chaves?: unknown }).chaves)
        ? ((corpo as { chaves: unknown[] }).chaves.filter((c) => typeof c === 'string' && /^\d{44}$/.test(c)) as string[])
        : []
      if (chaves.length === 0 || chaves.length > 20) {
        res.status(400).json({ erro: 'Escolha de 1 a 20 notas por vez.' })
        return
      }
      const configurado = await carregarCertificadoConfigurado(supabase)
      if (!configurado || configurado.cert.validoAte.getTime() < Date.now()) {
        res.status(400).json({ erro: 'Certificado ausente ou vencido. Envie um certificado válido.' })
        return
      }
      const { data: notas } = await supabase.from('nfe_entrada').select('chave, cnpj_destinatario, completa, manifestacao, situacao').in('chave', chaves)
      const porCnpj = new Map<string, string[]>()
      let jaTinham = 0
      for (const n of (notas ?? []) as { chave: string; cnpj_destinatario: string; completa: boolean; manifestacao: string | null; situacao: string }[]) {
        if (n.completa || n.manifestacao || n.situacao !== 'autorizada') {
          jaTinham++
          continue
        }
        porCnpj.set(n.cnpj_destinatario, [...(porCnpj.get(n.cnpj_destinatario) ?? []), n.chave])
      }
      const total = { tentadas: 0, registradas: 0, jaTinham, erros: [] as string[] }
      for (const [cnpj, lista] of porCnpj) {
        const r = await registrarCiencias(supabase, cnpj, configurado.cert, 20, lista)
        total.tentadas += r.tentadas
        total.registradas += r.registradas
        total.erros.push(...r.erros)
      }
      res.status(200).json({ ok: total.erros.length === 0, ...total })
      return
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

  // GET: listagem e download das notas capturadas (XML individual e .zip)
  const recurso = typeof req.query.recurso === 'string' ? req.query.recurso : ''
  if (recurso === 'notas' || recurso === 'xml' || recurso === 'zip') {
    const um = (k: string) => (typeof req.query[k] === 'string' ? String(req.query[k]) : '')
    if (recurso === 'xml') {
      const chave = um('chave')
      if (!/^\d{44}$/.test(chave)) {
        res.status(400).json({ erro: 'Informe a chave de acesso (44 dígitos).' })
        return
      }
      const { data } = await supabase.from('nfe_entrada').select('xml').eq('chave', chave).maybeSingle()
      if (!data?.xml) {
        res.status(404).json({ erro: 'Esta nota ainda não tem o XML completo. Registre a ciência e aguarde a próxima consulta.' })
        return
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${chave}-nfe.xml"`)
      res.status(200).send(data.xml as string)
      return
    }
    const de = /^\d{4}-\d{2}-\d{2}$/.test(um('de')) ? um('de') : ''
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(um('ate')) ? um('ate') : ''
    const situacaoF = ['autorizada', 'cancelada', 'denegada'].includes(um('situacao')) ? um('situacao') : ''
    const xmlF = um('xml')
    const busca = um('q').replace(/[%*,()\\]/g, ' ').replace(/\s+/g, ' ').trim()
    const filtrar = <T,>(q: T): T => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let r: any = q
      if (de) r = r.gte('data_emissao', `${de}T00:00:00-03:00`)
      if (ate) r = r.lte('data_emissao', `${ate}T23:59:59-03:00`)
      if (situacaoF) r = r.eq('situacao', situacaoF)
      if (xmlF === 'sim') r = r.eq('completa', true)
      if (xmlF === 'nao') r = r.eq('completa', false)
      if (busca) {
        const digitos = busca.replace(/\D/g, '')
        r = /^\d{44}$/.test(busca)
          ? r.eq('chave', busca)
          : r.or([`emitente_nome.ilike.%${busca}%`, digitos.length >= 3 ? `emitente_cnpj.ilike.%${digitos}%` : '', digitos ? `numero.eq.${digitos.replace(/^0+/, '') || '0'}` : ''].filter(Boolean).join(','))
      }
      return r as T
    }
    if (recurso === 'zip') {
      const { data, error } = await filtrar(supabase.from('nfe_entrada').select('chave, xml').eq('completa', true).not('xml', 'is', null)).order('data_emissao', { ascending: false }).limit(301)
      if (error) throw new Error(error.message)
      const linhas = (data ?? []) as { chave: string; xml: string }[]
      if (linhas.length === 0) {
        res.status(404).json({ erro: 'Nenhuma nota com XML completo neste filtro.' })
        return
      }
      if (linhas.length > 300) {
        res.status(413).json({ erro: 'Mais de 300 notas neste filtro. Reduza o período e baixe em partes.' })
        return
      }
      const arquivos: Record<string, Uint8Array> = {}
      for (const l of linhas) arquivos[`${l.chave}-nfe.xml`] = strToU8(l.xml)
      const zip = zipSync(arquivos, { level: 6 })
      if (zip.byteLength > 4_000_000) {
        res.status(413).json({ erro: 'O arquivo ficaria grande demais. Reduza o período e baixe em partes.' })
        return
      }
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="notas-entrada-${new Date().toISOString().slice(0, 10)}.zip"`)
      res.status(200).send(Buffer.from(zip))
      return
    }
    const limite = Math.min(Math.max(Number(um('limit')) || 50, 1), 100)
    const offset = Math.max(Number(um('offset')) || 0, 0)
    const { data, error, count } = await filtrar(
      supabase
        .from('nfe_entrada')
        .select('chave, cnpj_destinatario, emitente_nome, emitente_cnpj, numero, serie, data_emissao, valor, situacao, completa, manifestacao', { count: 'exact' })
    )
      .order('data_emissao', { ascending: false })
      .order('chave')
      .range(offset, offset + limite - 1)
    if (error) throw new Error(error.message)
    res.status(200).json({ itens: data ?? [], total: count ?? 0, limite, offset })
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
