// Roda no PC do faturista. Observa a pasta configurada pelo faturista no
// app (Operações > engrenagem da Caixa de Entrada) e manda cada XML novo pro
// endpoint api/nfe-watcher.ts assim que aparece. A pasta não fica fixa aqui:
// esse script busca no servidor a cada checagem, então trocar a pasta no app
// é o suficiente — não precisa editar nada nem reiniciar o watcher (ele
// troca de pasta sozinho na checagem seguinte).
//
// Não precisa de npm install — só Node.js 18+ (fetch e fs.watch nativos).
// Uso: copie config.example.json para config.json, preencha apiUrl/secret
// (a pasta é configurada pelo app, não aqui) e rode `node watch-nfe.js` (ou
// dê 2 cliques em iniciar.bat).
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const ENVIADOS_PATH = path.join(__dirname, '.enviados.json')
const CHECAGEM_MS = 60_000

function carregarConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(
      'config.json não encontrado. Copie config.example.json para config.json e preencha apiUrl/secret.'
    )
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

function carregarEnviados() {
  try {
    return new Set(JSON.parse(fs.readFileSync(ENVIADOS_PATH, 'utf-8')))
  } catch {
    return new Set()
  }
}

function salvarEnviados(set) {
  fs.writeFileSync(ENVIADOS_PATH, JSON.stringify(Array.from(set)))
}

const config = carregarConfig()
const enviados = carregarEnviados()
const apiUrl = config.apiUrl.replace(/\/$/, '') + '/api/nfe-watcher'

function log(msg) {
  console.log(`[${new Date().toLocaleString('pt-BR')}] ${msg}`)
}

async function buscarPastaConfigurada() {
  try {
    const resposta = await fetch(apiUrl, { headers: { 'x-watcher-secret': config.secret } })
    const json = await resposta.json().catch(() => ({}))
    if (!resposta.ok) {
      log(`Erro ao buscar configuração: ${json.error ?? resposta.status}`)
      return undefined
    }
    return json.pasta || null
  } catch (err) {
    log(`Falha de conexão ao buscar configuração: ${err.message}`)
    return undefined
  }
}

async function enviarArquivo(caminho) {
  const nome = path.basename(caminho)
  let stat
  try {
    stat = fs.statSync(caminho)
  } catch {
    return
  }
  const chave = `${caminho}:${stat.size}`
  if (enviados.has(chave)) return

  let conteudo
  try {
    conteudo = fs.readFileSync(caminho)
  } catch (err) {
    // Arquivo ainda sendo gravado pelo emissor — tenta de novo no próximo evento.
    log(`Ainda não consegui ler ${nome} (${err.message}), tento de novo depois.`)
    return
  }
  if (conteudo.length === 0) return

  try {
    const resposta = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-watcher-secret': config.secret },
      body: JSON.stringify({ arquivo_nome: nome, xml_base64: conteudo.toString('base64') }),
    })
    const json = await resposta.json().catch(() => ({}))
    if (!resposta.ok) {
      log(`Erro ao enviar ${nome}: ${json.error ?? resposta.status}`)
      return
    }
    enviados.add(chave)
    salvarEnviados(enviados)
    log(json.duplicado ? `${nome} já tinha sido capturado antes.` : `${nome} capturado (NF ${json.numero_nf ?? '?'}).`)
  } catch (err) {
    log(`Falha de conexão ao enviar ${nome}: ${err.message}`)
  }
}

function ehXml(nome) {
  return nome.toLowerCase().endsWith('.xml')
}

function varrerPasta(pasta) {
  for (const nome of fs.readdirSync(pasta)) {
    if (ehXml(nome)) enviarArquivo(path.join(pasta, nome))
  }
}

// Debounce: o emissor pode disparar vários eventos pro mesmo arquivo
// enquanto grava — espera meio segundo sem eventos novos antes de ler.
let watcherAtual = null
let pastaAtual = null
const pendentes = new Map()

function pararDeObservar() {
  if (watcherAtual) {
    watcherAtual.close()
    watcherAtual = null
  }
  for (const timeout of pendentes.values()) clearTimeout(timeout)
  pendentes.clear()
}

function observarPasta(pasta) {
  pararDeObservar()
  pastaAtual = pasta
  log(`Observando ${pasta}`)
  try {
    varrerPasta(pasta) // pega o que já estava na pasta antes do watcher iniciar
  } catch (err) {
    log(`Não consegui ler a pasta ${pasta}: ${err.message}`)
    return
  }
  watcherAtual = fs.watch(pasta, { recursive: true }, (_evento, nome) => {
    if (!nome || !ehXml(nome)) return
    const caminho = path.join(pasta, nome)
    clearTimeout(pendentes.get(caminho))
    pendentes.set(
      caminho,
      setTimeout(() => {
        pendentes.delete(caminho)
        if (fs.existsSync(caminho)) enviarArquivo(caminho)
      }, 500)
    )
  })
}

async function checarConfiguracao() {
  const pasta = await buscarPastaConfigurada()
  if (pasta === undefined) return // erro de rede/servidor — mantém observando o que já tinha
  if (!pasta) {
    if (pastaAtual) log('Nenhuma pasta configurada no app ainda (Operações > engrenagem da Caixa de Entrada).')
    pararDeObservar()
    pastaAtual = null
    return
  }
  if (pasta !== pastaAtual) {
    observarPasta(pasta)
    return
  }
  // Mesma pasta de sempre: revarre por garantia. fs.watch do Windows às
  // vezes perde evento (rajada de arquivos, antivírus, pasta de rede) — essa
  // varredura periódica pega o que passou batido; o set de já-enviados evita
  // reenviar o que já foi capturado.
  try {
    varrerPasta(pasta)
  } catch (err) {
    log(`Não consegui revarrer ${pasta}: ${err.message}`)
  }
}

log(`Iniciando — buscando pasta configurada em ${apiUrl}`)
checarConfiguracao()
setInterval(checarConfiguracao, CHECAGEM_MS)
