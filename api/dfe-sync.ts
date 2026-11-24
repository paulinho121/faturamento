// Captura automática das NF-e emitidas CONTRA a empresa (Distribuição DF-e da SEFAZ).
//
//   GET/POST /api/dfe-sync                  consulta a SEFAZ para cada CNPJ da empresa e grava as notas novas
//   ?cnpj=12345678000190                    só esse CNPJ
//   ?ciencia=1|0                            liga/desliga o registro da "Ciência da Operação" nesta chamada
//   ?diagnostico=1                          só valida o certificado e lista os CNPJs (não consulta a SEFAZ)
//
// Chamada por agendador (pg_cron + pg_net) com o header x-sync-secret. Guia: docs/CAPTURA_NFE_ENTRADA.md.
// O certificado A1 vem da tela (tabela dfe_certificado, criptografado) ou, se não houver, das variáveis
// DFE_CERT_PFX_BASE64 + DFE_CERT_SENHA. Variáveis de ambiente (nunca no código): DFE_SYNC_SECRET,
// VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; opcionais: DFE_CNPJS, DFE_UF_AUTOR, DFE_AMBIENTE,
// DFE_CIENCIA_AUTOMATICA, DFE_ACEITAR_CADEIA_ICP, DFE_CHAVE_CRIPTOGRAFIA, DFE_URL_DISTRIBUICAO, DFE_URL_EVENTO.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import https from 'node:https'
import http from 'node:http'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

// ---------- utilidades ----------

function segredoConfere(recebido: string | string[] | undefined, esperado: string): boolean {
  if (typeof recebido !== 'string') return false
  const a = new Uint8Array(createHash('sha256').update(recebido).digest())
  const b = new Uint8Array(createHash('sha256').update(esperado).digest())
  return timingSafeEqual(a, b)
}

function descreverErro(e: unknown): string {
  if (!(e instanceof Error)) return 'erro desconhecido'
  const cause = (e as Error & { cause?: unknown }).cause
  const code = (e as Error & { code?: string }).code
  const base = cause instanceof Error ? `${e.message} (${cause.message})` : e.message
  return code ? `${base} [${code}]` : base
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const tag = (xml: string, nome: string): string | null => xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([^<]*)</${nome}>`))?.[1]?.trim() || null
const bloco = (xml: string, nome: string): string | null => xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`))?.[1] ?? null
const NSU_ZERO = '000000000000000'
const nsuFmt = (n: string | null | undefined) => String(n ?? '0').replace(/\D/g, '').padStart(15, '0')

function dhBrasilia(d = new Date()): string {
  return `${new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19)}-03:00`
}

// ---------- certificado A1 ----------

export interface Certificado {
  chavePem: string
  certPem: string
  certBase64: string // só o corpo, sem as linhas BEGIN/END (vai no XML assinado)
  cnpj: string | null
  validoAte: Date
  titular: string
}

// Lê o .pfx com node-forge (o Node moderno recusa os algoritmos antigos dos A1 brasileiros, como RC2-40).
export function abrirPfx(pfxB64: string, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const der = forge.util.decode64(pfxB64.replace(/\s+/g, ''))
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha)
  } catch (e) {
    throw new Error(`Não foi possível abrir o certificado (arquivo corrompido ou senha incorreta): ${descreverErro(e)}`)
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const chave = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined
  if (!chave) throw new Error('O arquivo do certificado não tem chave privada.')
  // O certificado da empresa é o que casa com a chave privada (o arquivo também traz a cadeia da autoridade).
  const modulo = (chave as forge.pki.rsa.PrivateKey).n.toString(16)
  const cert = certs.map((c) => c.cert).find((c): c is forge.pki.Certificate => !!c && (c.publicKey as forge.pki.rsa.PublicKey).n.toString(16) === modulo)
  if (!cert) throw new Error('Certificado correspondente à chave privada não encontrado no arquivo.')
  const certPem = forge.pki.certificateToPem(cert)
  const cn = String(cert.subject.getField('CN')?.value ?? '')
  const cnpjNoNome = cn.match(/:(\d{14})\b/)?.[1] ?? null
  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem,
    certBase64: certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
    cnpj: cnpjNoNome,
    validoAte: cert.validity.notAfter,
    titular: cn,
  }
}

// ---------- certificado guardado no banco (criptografado) ----------

// Chave AES-256 derivada de um segredo do servidor: DFE_CHAVE_CRIPTOGRAFIA, se definida, ou a chave de serviço
// do Supabase. O banco sozinho não basta para abrir o certificado. (Se a chave de serviço for trocada e não
// houver DFE_CHAVE_CRIPTOGRAFIA, é preciso enviar o certificado de novo.)
function chaveDeCriptografia(): Uint8Array {
  const base = process.env.DFE_CHAVE_CRIPTOGRAFIA || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('Sem segredo do servidor para criptografar o certificado.')
  return new Uint8Array(hkdfSync('sha256', base, 'mci-dfe-certificado-v1', 'aes-256-gcm', 32))
}

export function cifrarSegredo(texto: string): string {
  const iv = new Uint8Array(randomBytes(12))
  const cifra = createCipheriv('aes-256-gcm', chaveDeCriptografia(), iv)
  const dados = new Uint8Array(Buffer.concat([cifra.update(texto, 'utf8') as unknown as Uint8Array, cifra.final() as unknown as Uint8Array]))
  const tag = new Uint8Array(cifra.getAuthTag())
  return Buffer.concat([iv, tag, dados] as unknown as Uint8Array[]).toString('base64')
}

export function decifrarSegredo(cifrado: string): string {
  const tudo = new Uint8Array(Buffer.from(cifrado, 'base64'))
  const decifra = createDecipheriv('aes-256-gcm', chaveDeCriptografia(), tudo.slice(0, 12))
  decifra.setAuthTag(tudo.slice(12, 28))
  return Buffer.concat([decifra.update(tudo.slice(28)) as unknown as Uint8Array, decifra.final() as unknown as Uint8Array] as unknown as Uint8Array[]).toString('utf8')
}

// Certificado enviado pela tela (tem prioridade) ou, na falta dele, o das variáveis de ambiente.
export async function carregarCertificadoConfigurado(
  supabase: SupabaseClient
): Promise<{ cert: Certificado; origem: 'painel' | 'variavel' } | null> {
  const { data, error } = await supabase.from('dfe_certificado').select('cifrado').eq('id', 1).maybeSingle()
  if (error && !/relation .* does not exist|does not exist/i.test(error.message)) throw new Error(`Erro ao ler o certificado: ${error.message}`)
  if (data?.cifrado) {
    let dados: { pfx: string; senha: string }
    try {
      dados = JSON.parse(decifrarSegredo(data.cifrado)) as { pfx: string; senha: string }
    } catch {
      throw new Error('Não foi possível abrir o certificado guardado (a chave do servidor mudou?). Envie o certificado de novo pela tela.')
    }
    return { cert: abrirPfx(dados.pfx, dados.senha), origem: 'painel' }
  }
  if (process.env.DFE_CERT_PFX_BASE64) {
    return { cert: abrirPfx(process.env.DFE_CERT_PFX_BASE64, process.env.DFE_CERT_SENHA ?? ''), origem: 'variavel' }
  }
  return null
}

// ---------- chamadas SOAP à SEFAZ ----------

const URLS = {
  producao: {
    distribuicao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    evento: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  homologacao: {
    distribuicao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    evento: 'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
}

function ambiente(): { tpAmb: 1 | 2; urls: { distribuicao: string; evento: string } } {
  const homolog = (process.env.DFE_AMBIENTE ?? '').toLowerCase().startsWith('homolog')
  const base = homolog ? URLS.homologacao : URLS.producao
  return {
    tpAmb: homolog ? 2 : 1,
    urls: {
      distribuicao: process.env.DFE_URL_DISTRIBUICAO || base.distribuicao,
      evento: process.env.DFE_URL_EVENTO || base.evento,
    },
  }
}

function postarSoap(url: string, acao: string, envelope: string, cert: Certificado): Promise<string> {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url)
    const usaTls = alvo.protocol === 'https:'
    const opcoes: https.RequestOptions = {
      method: 'POST',
      hostname: alvo.hostname,
      port: alvo.port || (usaTls ? 443 : 80),
      path: alvo.pathname + alvo.search,
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${acao}"`,
        'Content-Length': Buffer.byteLength(envelope),
      },
      timeout: 25000,
      ...(usaTls
        ? {
            key: cert.chavePem,
            cert: cert.certPem,
            // A cadeia ICP-Brasil da SEFAZ não vem no repositório de confiança padrão do Node. Só desligue a
            // verificação (DFE_ACEITAR_CADEIA_ICP=1) se a conexão falhar por isso.
            rejectUnauthorized: process.env.DFE_ACEITAR_CADEIA_ICP !== '1',
          }
        : {}),
    }
    const req = (usaTls ? https : http).request(opcoes, (res) => {
      let texto = ''
      res.setEncoding('utf-8')
      res.on('data', (c: string) => (texto += c))
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}: ${texto.replace(/\s+/g, ' ').slice(0, 300)}`))
        else resolve(texto)
      })
    })
    req.on('timeout', () => req.destroy(new Error('SEFAZ não respondeu a tempo (timeout)')))
    req.on('error', reject)
    req.write(envelope)
    req.end()
  })
}

const NS_SOAP = 'http://www.w3.org/2003/05/soap-envelope'

function envelopeDistribuicao(cnpj: string, ultNsu: string, tpAmb: number, cUF: string): string {
  const msg =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tpAmb}</tpAmb><cUFAutor>${cUF}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ultNsu}</ultNSU></distNSU></distDFeInt>`
  return (
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${NS_SOAP}"><soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${msg}</nfeDadosMsg></nfeDistDFeInteresse>` +
    `</soap12:Body></soap12:Envelope>`
  )
}

interface DocZip {
  nsu: string
  schema: string
  xml: string
}
interface RetornoDistribuicao {
  cStat: string
  motivo: string
  ultNsu: string
  maxNsu: string
  docs: DocZip[]
}

function lerRetornoDistribuicao(resposta: string): RetornoDistribuicao {
  const ret = resposta.match(/<retDistDFeInt[\s\S]*?<\/retDistDFeInt>/)?.[0]
  if (!ret) throw new Error(`Resposta inesperada da SEFAZ: ${resposta.replace(/\s+/g, ' ').slice(0, 300)}`)
  const docs: DocZip[] = []
  for (const m of ret.matchAll(/<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/g)) {
    const nsu = m[1].match(/NSU="(\d+)"/)?.[1] ?? ''
    const schema = m[1].match(/schema="([^"]+)"/)?.[1] ?? ''
    docs.push({ nsu, schema, xml: new TextDecoder('utf-8').decode(gunzipSync(new Uint8Array(Buffer.from(m[2].replace(/\s+/g, ''), 'base64')))) })
  }
  return { cStat: tag(ret, 'cStat') ?? '', motivo: tag(ret, 'xMotivo') ?? '', ultNsu: nsuFmt(tag(ret, 'ultNSU')), maxNsu: nsuFmt(tag(ret, 'maxNSU')), docs }
}

// ---------- gravação das notas ----------

interface Contagem {
  resumos: number
  completas: number
  eventos: number
  ignoradas: number // fora do período configurado
}

// Período de captura (a SEFAZ não filtra por data: a rotina lê tudo e só grava o que cai na janela).
export interface Janela {
  inicio: string | null // AAAA-MM-DD
  fim: string | null
}

export async function carregarJanela(supabase: SupabaseClient): Promise<Janela> {
  const { data, error } = await supabase.from('dfe_config').select('data_inicio, data_fim').eq('id', 1).maybeSingle()
  if (error && !/does not exist/i.test(error.message)) throw new Error(`Erro ao ler o período de captura: ${error.message}`)
  return { inicio: data?.data_inicio ?? null, fim: data?.data_fim ?? null }
}

// `dhEmi` vem como 2026-11-20T10:00:00-03:00: vale o dia que está escrito nele (dia da emissão, no fuso do emitente).
function dentroDaJanela(dhEmi: string | null, janela: Janela): boolean {
  if (!janela.inicio && !janela.fim) return true
  const dia = dhEmi?.slice(0, 10)
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return true // sem data legível: não descarta
  if (janela.inicio && dia < janela.inicio) return false
  if (janela.fim && dia > janela.fim) return false
  return true
}

const SITUACAO_RESUMO: Record<string, 'autorizada' | 'denegada' | 'cancelada'> = { '1': 'autorizada', '2': 'denegada', '3': 'cancelada' }

async function gravarDocumento(supabase: SupabaseClient, cnpj: string, doc: DocZip, contagem: Contagem, janela: Janela): Promise<void> {
  const base = doc.schema.toLowerCase()
  if (base.startsWith('resnfe')) {
    const chave = tag(doc.xml, 'chNFe')
    if (!chave) return
    if (!dentroDaJanela(tag(doc.xml, 'dhEmi'), janela)) {
      contagem.ignoradas++
      return
    }
    const { error } = await supabase.from('nfe_entrada').upsert(
      {
        chave,
        cnpj_destinatario: cnpj,
        nsu: doc.nsu,
        emitente_cnpj: tag(doc.xml, 'CNPJ') ?? tag(doc.xml, 'CPF'),
        emitente_nome: tag(doc.xml, 'xNome'),
        emitente_ie: tag(doc.xml, 'IE'),
        data_emissao: tag(doc.xml, 'dhEmi'),
        valor: Number(tag(doc.xml, 'vNF') ?? 0),
        tipo_operacao: Number(tag(doc.xml, 'tpNF') ?? 1),
        situacao: SITUACAO_RESUMO[tag(doc.xml, 'cSitNFe') ?? '1'] ?? 'autorizada',
      },
      // Se já temos a nota (resumo ou completa), o resumo não sobrescreve nada.
      { onConflict: 'chave', ignoreDuplicates: true }
    )
    if (error) throw new Error(`gravar resumo: ${error.message}`)
    contagem.resumos++
    return
  }
  if (base.startsWith('procnfe')) {
    const chave = doc.xml.match(/\bId="NFe(\d{44})"/)?.[1] ?? tag(doc.xml, 'chNFe')
    if (!chave) return
    const emit = bloco(doc.xml, 'emit') ?? ''
    const ide = bloco(doc.xml, 'ide') ?? ''
    if (!dentroDaJanela(tag(ide, 'dhEmi') ?? tag(ide, 'dEmi'), janela)) {
      contagem.ignoradas++
      return
    }
    const cStat = doc.xml.match(/<protNFe[\s\S]*?<cStat>(\d+)<\/cStat>/)?.[1]
    const situacao = cStat === '110' || cStat === '301' || cStat === '302' ? 'denegada' : cStat === '101' ? 'cancelada' : 'autorizada'
    const { error } = await supabase.from('nfe_entrada').upsert(
      {
        chave,
        cnpj_destinatario: cnpj,
        nsu: doc.nsu,
        emitente_cnpj: tag(emit, 'CNPJ') ?? tag(emit, 'CPF'),
        emitente_nome: tag(emit, 'xNome'),
        emitente_ie: tag(emit, 'IE'),
        numero: tag(ide, 'nNF'),
        serie: tag(ide, 'serie'),
        data_emissao: tag(ide, 'dhEmi') ?? tag(ide, 'dEmi'),
        natureza_operacao: tag(ide, 'natOp'),
        tipo_operacao: Number(tag(ide, 'tpNF') ?? 1),
        valor: Number(tag(bloco(doc.xml, 'ICMSTot') ?? '', 'vNF') ?? tag(doc.xml, 'vNF') ?? 0),
        situacao,
        xml: doc.xml,
        completa: true,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'chave' }
    )
    if (error) throw new Error(`gravar nota completa: ${error.message}`)
    // Um cancelamento que chegou antes da nota continua valendo.
    const { data: cancel } = await supabase.from('nfe_entrada_eventos').select('id').eq('chave', chave).eq('tipo_evento', '110111').limit(1)
    if (cancel && cancel.length > 0) await supabase.from('nfe_entrada').update({ situacao: 'cancelada' }).eq('chave', chave)
    contagem.completas++
    return
  }
  if (base.startsWith('resevento') || base.startsWith('proceventonfe')) {
    const chave = tag(doc.xml, 'chNFe')
    const tipo = tag(doc.xml, 'tpEvento')
    if (!chave || !tipo) return
    if (janela.inicio || janela.fim) {
      // Com período definido, só guarda evento de nota que está no banco (as de fora da janela foram descartadas).
      const { data: existe } = await supabase.from('nfe_entrada').select('chave').eq('chave', chave).limit(1)
      if (!existe || existe.length === 0) {
        contagem.ignoradas++
        return
      }
    }
    const { error } = await supabase.from('nfe_entrada_eventos').upsert(
      {
        chave,
        nsu: doc.nsu,
        tipo_evento: tipo,
        sequencia: Number(tag(doc.xml, 'nSeqEvento') ?? 1),
        descricao: tag(doc.xml, 'xEvento') ?? tag(doc.xml, 'descEvento'),
        data_evento: tag(doc.xml, 'dhEvento'),
        xml: base.startsWith('proceventonfe') ? doc.xml : null,
      },
      { onConflict: 'chave,tipo_evento,sequencia', ignoreDuplicates: true }
    )
    if (error) throw new Error(`gravar evento: ${error.message}`)
    if (tipo === '110111') await supabase.from('nfe_entrada').update({ situacao: 'cancelada' }).eq('chave', chave)
    contagem.eventos++
  }
}

// ---------- Ciência da Operação (evento 210210) ----------

function assinarEvento(infEventoXml: string, cert: Certificado): string {
  const xml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEventoXml}</evento>`
  const sig = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  })
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infEvento']", action: 'after' } })
  return sig.getSignedXml()
}

export function montarEnvioCiencia(chave: string, cnpj: string, tpAmb: number, cert: Certificado, agora = new Date()): string {
  const id = `ID210210${chave}01`
  const infEvento =
    `<infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe>` +
    `<dhEvento>${dhBrasilia(agora)}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`
  const evento = assinarEvento(infEvento, cert)
  const env = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${evento.replace(/^<\?xml[^>]*\?>/, '').replace(/ xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"/, '')}</envEvento>`
  return (
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${NS_SOAP}"><soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${env}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  )
}

// cStat 135 = evento registrado; 136 = registrado sem vincular; 573 = já havia sido registrado (duplicidade).
const CSTAT_EVENTO_OK = new Set(['135', '136', '573'])

async function registrarCiencias(supabase: SupabaseClient, cnpj: string, cert: Certificado, limite: number) {
  const { tpAmb, urls } = ambiente()
  const { data } = await supabase
    .from('nfe_entrada')
    .select('chave')
    .eq('cnpj_destinatario', cnpj)
    .eq('completa', false)
    .is('manifestacao', null)
    .eq('situacao', 'autorizada')
    .order('data_emissao', { ascending: false })
    .limit(limite)
  const resultado = { tentadas: 0, registradas: 0, erros: [] as string[] }
  for (const { chave } of (data ?? []) as { chave: string }[]) {
    resultado.tentadas++
    try {
      const resposta = await postarSoap(urls.evento, 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento', montarEnvioCiencia(chave, cnpj, tpAmb, cert), cert)
      const retEvento = resposta.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? resposta
      const cStat = tag(retEvento, 'cStat')
      if (cStat && CSTAT_EVENTO_OK.has(cStat)) {
        await supabase.from('nfe_entrada').update({ manifestacao: 'ciencia', manifestada_em: new Date().toISOString() }).eq('chave', chave)
        resultado.registradas++
      } else {
        resultado.erros.push(`${chave}: cStat ${cStat ?? '?'} ${tag(retEvento, 'xMotivo') ?? resposta.slice(0, 120)}`)
      }
    } catch (e) {
      resultado.erros.push(`${chave}: ${descreverErro(e)}`)
      break // falha de conexão: não insiste nas demais
    }
  }
  return resultado
}

// ---------- consulta por CNPJ ----------

export interface ResumoCnpj {
  cnpj: string
  consultas: number
  resumos: number
  completas: number
  eventos: number
  ignoradas: number
  ultNsu?: string
  maxNsu?: string
  situacao: string
  ciencia?: { tentadas: number; registradas: number; erros: string[] }
}

const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Trava ATÔMICA antes de consultar: só uma execução por vez consulta um CNPJ (botão e agendador não se atropelam)
// e nunca antes do horário liberado. Consulta repetida é o que a SEFAZ pune com o bloqueio 656.
async function reservarConsulta(supabase: SupabaseClient, cnpj: string): Promise<{ reservou: boolean; controle: Record<string, unknown> | null }> {
  const { error: erroLinha } = await supabase.from('dfe_controle').upsert({ cnpj }, { onConflict: 'cnpj', ignoreDuplicates: true })
  if (erroLinha) throw new Error(`controle da consulta: ${erroLinha.message}`)
  const agora = new Date()
  const { data, error } = await supabase
    .from('dfe_controle')
    .update({ proxima_consulta: new Date(agora.getTime() + 3 * 60_000).toISOString() }) // reserva curta; o fim da consulta grava a definitiva
    .eq('cnpj', cnpj)
    .or(`proxima_consulta.is.null,proxima_consulta.lte.${agora.toISOString()}`)
    .select('cnpj')
  if (error) throw new Error(`reservar consulta: ${error.message}`)
  const { data: controle } = await supabase.from('dfe_controle').select('*').eq('cnpj', cnpj).maybeSingle()
  return { reservou: (data?.length ?? 0) > 0, controle: (controle as Record<string, unknown> | null) ?? null }
}

async function consultarCnpj(supabase: SupabaseClient, alvo: Alvo, cert: Certificado, ciencia: boolean, fim: number, janela: Janela): Promise<ResumoCnpj> {
  const cnpj = alvo.cnpj
  const resumo: ResumoCnpj = { cnpj, consultas: 0, resumos: 0, completas: 0, eventos: 0, ignoradas: 0, situacao: '' }
  const { reservou, controle } = await reservarConsulta(supabase, cnpj)
  if (!reservou) {
    resumo.situacao = `aguardando até ${String(controle?.proxima_consulta ?? '?')} (intervalo exigido pela SEFAZ ou outra consulta em andamento)`
    resumo.ultNsu = controle?.ult_nsu as string | undefined
    return resumo
  }
  // O NSU é o NOSSO ponteiro: só avança depois de gravar os documentos. Nunca adotamos o NSU que a SEFAZ devolve em erro.
  let ultNsu = nsuFmt((controle?.ult_nsu as string | undefined) ?? NSU_ZERO)
  const { tpAmb, urls } = ambiente()
  const contagem: Contagem = { resumos: 0, completas: 0, eventos: 0, ignoradas: 0 }
  let proxima: Date | null = null
  let statusFinal = ''
  let mensagem = ''
  let erro = false
  let maxNsu = (controle?.max_nsu as string | null | undefined) ?? null

  try {
    for (let i = 0; i < 20 && Date.now() < fim - 5000; i++) {
      if (i > 0) await pausa(1000) // continuação (ainda há notas): sem rajada de pedidos
      const resposta = await postarSoap(urls.distribuicao, 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse', envelopeDistribuicao(cnpj, ultNsu, tpAmb, alvo.uf), cert)
      const ret = lerRetornoDistribuicao(resposta)
      resumo.consultas++
      statusFinal = ret.cStat
      mensagem = ret.motivo
      if (ret.cStat === '138') {
        for (const doc of ret.docs) await gravarDocumento(supabase, cnpj, doc, contagem, janela)
        const progrediu = ret.ultNsu > ultNsu
        ultNsu = ret.ultNsu
        maxNsu = ret.maxNsu
        if (ret.ultNsu >= ret.maxNsu || !progrediu) {
          // Em dia (ou sem avanço, o que seria repetir o mesmo pedido): espera o intervalo da SEFAZ.
          proxima = new Date(Date.now() + 61 * 60_000)
          break
        }
        continue // ainda há documentos: segue direto, como a SEFAZ permite
      }
      if (ret.cStat === '137') {
        ultNsu = ret.ultNsu > ultNsu ? ret.ultNsu : ultNsu
        maxNsu = ret.maxNsu
        proxima = new Date(Date.now() + 61 * 60_000)
        break
      }
      if (ret.cStat === '656') {
        // Consumo indevido: bloqueio de cerca de 1 hora. Mantém o NSU próprio e espera mais do que o pedido.
        proxima = new Date(Date.now() + 70 * 60_000)
        erro = true
        break
      }
      erro = true
      proxima = new Date(Date.now() + 15 * 60_000)
      break
    }
  } catch (e) {
    erro = true
    mensagem = descreverErro(e)
    statusFinal = 'erro'
    proxima = new Date(Date.now() + 10 * 60_000)
  }

  if (resumo.consultas === 0 && !erro) {
    // Acabou o tempo antes de consultar: só devolve a reserva, sem registrar uma consulta que não houve.
    await supabase.from('dfe_controle').update({ proxima_consulta: null }).eq('cnpj', cnpj)
    resumo.situacao = 'adiado: sem tempo nesta chamada (tenta na próxima)'
    return resumo
  }

  await supabase.from('dfe_controle').upsert(
    {
      cnpj,
      ult_nsu: ultNsu,
      max_nsu: maxNsu,
      ultima_consulta: new Date().toISOString(),
      proxima_consulta: proxima?.toISOString() ?? null,
      ultimo_status: statusFinal,
      ultima_mensagem: mensagem.slice(0, 300),
      erros_seguidos: erro ? (Number(controle?.erros_seguidos ?? 0) || 0) + 1 : 0,
    },
    { onConflict: 'cnpj' }
  )

  Object.assign(resumo, contagem)
  resumo.ultNsu = ultNsu
  resumo.maxNsu = maxNsu ?? undefined
  resumo.situacao = erro ? `erro: ${statusFinal} ${mensagem}`.trim() : `ok: ${statusFinal} ${mensagem}`.trim()
  if (ciencia && !erro && Date.now() < fim) resumo.ciencia = await registrarCiencias(supabase, cnpj, cert, 20)
  return resumo
}

// ---------- handler ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await executar(req, res)
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: `Falha inesperada na captura de NF-e: ${descreverErro(e)}` })
  }
}

async function executar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Use GET ou POST.' })
    return
  }
  const secretEsperado = process.env.DFE_SYNC_SECRET
  if (!secretEsperado || !segredoConfere(req.headers['x-sync-secret'], secretEsperado)) {
    res.status(401).json({ error: 'Segredo ausente ou inválido (header x-sync-secret).' })
    return
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Integração não configurada no servidor (variáveis do Supabase ausentes).' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  let configurado: Awaited<ReturnType<typeof carregarCertificadoConfigurado>>
  try {
    configurado = await carregarCertificadoConfigurado(supabase)
  } catch (e) {
    res.status(500).json({ error: descreverErro(e) })
    return
  }
  if (!configurado) {
    // Sem certificado ainda: não é erro (o agendador pode já estar criado antes do envio do certificado).
    res.status(200).json({ ok: true, desligado: true, motivo: 'Nenhum certificado A1 configurado (envie pela tela de Certificado digital).' })
    return
  }
  const cert = configurado.cert
  if (cert.validoAte.getTime() < Date.now()) {
    res.status(500).json({ error: `O certificado A1 venceu em ${cert.validoAte.toISOString().slice(0, 10)}. Envie o certificado renovado.` })
    return
  }

  let alvos: Alvo[]
  try {
    alvos = await cnpjsParaConsultar(supabase, typeof req.query.cnpj === 'string' ? soDigitos(req.query.cnpj) : '')
  } catch (e) {
    res.status(500).json({ error: descreverErro(e) })
    return
  }

  if (req.query.diagnostico === '1') {
    res.status(200).json({
      ok: true,
      diagnostico: true,
      certificado: { origem: configurado.origem, cnpj: cert.cnpj, validoAte: cert.validoAte.toISOString().slice(0, 10) },
      ambiente: ambiente().tpAmb === 1 ? 'producao' : 'homologacao',
      cnpjs: alvos,
      cienciaAutomatica: process.env.DFE_CIENCIA_AUTOMATICA === '1',
    })
    return
  }
  const ciencia = req.query.ciencia === '1' ? true : req.query.ciencia === '0' ? false : process.env.DFE_CIENCIA_AUTOMATICA === '1'
  const resultado = await capturarNotas(supabase, cert, alvos, ciencia)
  res.status(resultado.ok ? 200 : 502).json(resultado)
}

// Código IBGE de cada UF (cUFAutor da consulta: a UF do cadastro do CNPJ).
const CODIGO_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26',
  AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}

// A UF vem da sigla no nome da filial ("... SC", "... SP", "... CE"); sem sigla, vale DFE_UF_AUTOR (padrão 42 = SC).
function ufDoNome(nome: string | null): string {
  const padrao = process.env.DFE_UF_AUTOR || '42'
  const siglas = (nome ?? '').toUpperCase().match(/\b[A-Z]{2}\b/g) ?? []
  for (const sigla of siglas.reverse()) if (CODIGO_UF[sigla]) return CODIGO_UF[sigla]
  return padrao
}

export interface Alvo {
  cnpj: string
  nome: string | null
  uf: string
}

// CNPJs a consultar: DFE_CNPJS (se informado) ou o CNPJ de cada filial ativa; `so` restringe a um deles.
export async function cnpjsParaConsultar(supabase: SupabaseClient, so = ''): Promise<Alvo[]> {
  const alvos = new Map<string, Alvo>()
  const doEnv = (process.env.DFE_CNPJS ?? '').split(',').map(soDigitos).filter((c) => c.length === 14)
  const { data, error } = await supabase.from('filiais').select('nome, cnpj').eq('ativo', true)
  if (error) throw new Error(`Erro ao ler as filiais: ${error.message}`)
  const filiais = ((data ?? []) as { nome: string | null; cnpj: string | null }[]).map((f) => ({ nome: f.nome, cnpj: soDigitos(f.cnpj) })).filter((f) => f.cnpj.length === 14)
  const origem = doEnv.length > 0 ? doEnv.map((c) => ({ cnpj: c, nome: filiais.find((f) => f.cnpj === c)?.nome ?? null })) : filiais
  for (const o of origem) if (!alvos.has(o.cnpj)) alvos.set(o.cnpj, { cnpj: o.cnpj, nome: o.nome, uf: ufDoNome(o.nome) })
  const lista = Array.from(alvos.values())
  return so ? lista.filter((a) => a.cnpj === so) : lista
}

// Consulta a SEFAZ para os CNPJs informados (usado pelo agendador e pelo botão "Buscar notas agora" da tela).
export async function capturarNotas(
  supabase: SupabaseClient,
  cert: Certificado,
  alvos: Alvo[],
  ciencia: boolean
): Promise<{ ok: boolean; aviso?: string; ciencia: boolean; cnpjs: ResumoCnpj[] }> {
  if (alvos.length === 0) {
    return { ok: true, aviso: 'Nenhum CNPJ para consultar (cadastre o CNPJ nas filiais ou defina DFE_CNPJS).', ciencia, cnpjs: [] }
  }
  const fim = Date.now() + 40_000
  const janela = await carregarJanela(supabase)
  const resultados: ResumoCnpj[] = []
  for (const alvo of alvos) {
    if (resultados.length > 0) await pausa(1500) // um CNPJ de cada vez, sem rajada
    resultados.push(await consultarCnpj(supabase, alvo, cert, ciencia, fim, janela))
  }
  return { ok: resultados.every((r) => !r.situacao.startsWith('erro')), ciencia, cnpjs: resultados }
}
