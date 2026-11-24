import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { diretorNavItems } from './nav'

interface CertificadoInfo {
  cnpj: string | null
  titular: string | null
  validoAte: string
  enviadoEm: string | null
  enviadoPor: string | null
}

interface Situacao {
  cnpjsConsulta: { cnpj: string; nome: string | null }[]
  periodo: { dataInicio: string | null; dataFim: string | null }
  configurado: boolean
  origem: 'painel' | 'variavel' | null
  certificado: CertificadoInfo | null
  avisos: string[]
  erroCertificado: string | null
  cienciaAutomatica: boolean
  captura: {
    cnpjs: {
      cnpj: string
      ultimaConsulta: string | null
      proximaConsulta: string | null
      status: string | null
      mensagem: string | null
      errosSeguidos: number
    }[]
    notas: { total: number; completas: number; soResumo: number; ultimaCaptura: string | null }
    ultimasNotas: {
      chave: string
      emitente_nome: string | null
      emitente_cnpj: string | null
      numero: string | null
      data_emissao: string | null
      valor: number | null
      situacao: string
      completa: boolean
      manifestacao: string | null
    }[]
  }
}

interface ResultadoBusca {
  ok: boolean
  aviso?: string
  cnpjs: { cnpj: string; consultas: number; resumos: number; completas: number; eventos: number; ignoradas: number; situacao: string; ciencia?: { tentadas: number; registradas: number; erros: string[] } }[]
}

function dataHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

function formataCnpj(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c ?? '—')
}

// Explicação em português dos retornos mais comuns da SEFAZ (a mensagem original continua visível).
function explicarRetorno(codigoOuTexto: string | null | undefined): { texto: string; tipo: 'ok' | 'espera' | 'erro' } | null {
  const t = (codigoOuTexto ?? '').toLowerCase()
  const codigo = t.match(/\b(\d{3})\b/)?.[1]
  if (codigo === '656') {
    return {
      tipo: 'espera',
      texto:
        'Bloqueio temporário da SEFAZ: ela limita quantas vezes cada CNPJ pode consultar as notas e pede cerca de 1 hora de intervalo. ' +
        'Não é problema do certificado. O sistema espera sozinho e tenta de novo depois do horário indicado; não adianta clicar antes. ' +
        'Se voltar a acontecer sempre, outro sistema (ERP, software da contabilidade ou serviço de captura de notas) pode estar consultando o mesmo CNPJ.',
    }
  }
  if (codigo === '137') {
    return { tipo: 'ok', texto: 'Tudo certo: a SEFAZ não tem notas novas para este CNPJ agora. A próxima consulta é liberada em cerca de 1 hora.' }
  }
  if (codigo === '138') return { tipo: 'ok', texto: 'Tudo certo: notas localizadas e gravadas.' }
  if (codigo === '593') {
    return {
      tipo: 'erro',
      texto: 'A SEFAZ recusou: o CNPJ consultado não tem a mesma raiz (8 primeiros dígitos) do CNPJ do certificado. Confira o CNPJ cadastrado na filial ou envie o certificado correto.',
    }
  }
  if (codigo === '632' || codigo === '589') {
    return { tipo: 'erro', texto: 'A SEFAZ não reconheceu o ponto de leitura. Use "Reler desde o início" e busque de novo.' }
  }
  if (t.includes('sem conexão') || t.includes('timeout') || t.includes('não respondeu')) {
    return { tipo: 'erro', texto: 'Não foi possível falar com a SEFAZ agora (instabilidade ou bloqueio de conexão). O sistema tenta de novo sozinho em alguns minutos.' }
  }
  if (t.includes('unable_to_verify') || t.includes('certificate')) {
    return { tipo: 'erro', texto: 'A conexão segura com a SEFAZ falhou por causa da cadeia de certificados. Avise o suporte: existe uma configuração para isso.' }
  }
  return null
}

async function arquivoParaBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

async function chamarApi(metodo: 'GET' | 'POST' | 'DELETE', corpo?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { data } = await supabase.auth.getSession()
  const resposta = await fetch('/api/dfe-certificado', {
    method: metodo,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await resposta.json()) as Record<string, unknown>
  } catch {
    /* resposta sem corpo */
  }
  return { status: resposta.status, json }
}

export function CertificadoPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const [situacao, setSituacao] = useState<Situacao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [substituindo, setSubstituindo] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [registrarCiencia, setRegistrarCiencia] = useState(false)
  const [resultadoBusca, setResultadoBusca] = useState<ResultadoBusca | null>(null)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [cnpjBusca, setCnpjBusca] = useState('') // vazio = todos os CNPJs
  const [periodoInicio, setPeriodoInicio] = useState('')
  const [periodoFim, setPeriodoFim] = useState('')
  const [salvandoPeriodo, setSalvandoPeriodo] = useState(false)
  const [confirmandoReinicio, setConfirmandoReinicio] = useState(false)
  const inputArquivo = useRef<HTMLInputElement>(null)
  const buscandoRef = useRef(false)

  async function carregar() {
    setCarregando(true)
    setErroCarga(null)
    try {
      const { status, json } = await chamarApi('GET')
      if (status === 200) {
        const dados = json as unknown as Situacao
        setSituacao(dados)
        setPeriodoInicio(dados.periodo?.dataInicio ?? '')
        setPeriodoFim(dados.periodo?.dataFim ?? '')
      } else setErroCarga(String(json.erro ?? `Erro ${status} ao carregar.`))
    } catch {
      setErroCarga('Não foi possível falar com o servidor.')
    }
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErroEnvio(null)
    if (!arquivo) {
      setErroEnvio('Escolha o arquivo do certificado (.pfx ou .p12).')
      return
    }
    if (!senha) {
      setErroEnvio('Informe a senha do certificado.')
      return
    }
    setEnviando(true)
    try {
      const pfxBase64 = await arquivoParaBase64(arquivo)
      const { status, json } = await chamarApi('POST', { pfxBase64, senha })
      if (status === 200) {
        push('success', 'Certificado guardado com segurança.')
        setArquivo(null)
        setSenha('')
        if (inputArquivo.current) inputArquivo.current.value = ''
        setSubstituindo(false)
        await carregar()
      } else {
        setErroEnvio(String(json.erro ?? `Erro ${status} ao enviar o certificado.`))
      }
    } catch {
      setErroEnvio('Não foi possível enviar o certificado. Tente de novo.')
    }
    setSenha('') // a senha não fica na tela depois do envio
    setEnviando(false)
  }

  async function salvarPeriodo() {
    setSalvandoPeriodo(true)
    const { status, json } = await chamarApi('POST', { acao: 'periodo', dataInicio: periodoInicio || null, dataFim: periodoFim || null })
    setSalvandoPeriodo(false)
    if (status === 200) {
      push('success', periodoInicio || periodoFim ? 'Período salvo. A busca só vai gravar notas dessa janela.' : 'Período removido: a busca grava todas as notas.')
      await carregar()
    } else {
      push('error', String(json.erro ?? 'Não foi possível salvar o período.'))
    }
  }

  async function reiniciarLeitura() {
    setConfirmandoReinicio(false)
    const { status, json } = await chamarApi('POST', { acao: 'reiniciar' })
    if (status === 200) {
      push('success', 'Leitura reiniciada. Clique em "Buscar notas agora" para reler a SEFAZ.')
      await carregar()
    } else {
      push('error', String(json.erro ?? 'Não foi possível reiniciar a leitura.'))
    }
  }

  async function buscarAgora() {
    // Trava contra clique duplo: duas buscas simultâneas fariam a SEFAZ bloquear o CNPJ.
    if (buscandoRef.current) return
    buscandoRef.current = true
    setBuscando(true)
    setErroBusca(null)
    setResultadoBusca(null)
    try {
      const { status, json } = await chamarApi('POST', { acao: 'consultar', ciencia: registrarCiencia, cnpj: cnpjBusca || undefined })
      if (status === 200) setResultadoBusca(json as unknown as ResultadoBusca)
      else setErroBusca(String(json.erro ?? `Erro ${status} ao buscar as notas.`))
      await carregar()
    } catch {
      setErroBusca('Não foi possível falar com o servidor. A busca pode ter continuado; atualize a página em instantes.')
    }
    buscandoRef.current = false
    setBuscando(false)
  }

  async function remover() {
    const { status, json } = await chamarApi('DELETE')
    setConfirmandoRemocao(false)
    if (status === 200) {
      push('success', 'Certificado removido. A captura de notas foi pausada.')
      await carregar()
    } else {
      push('error', String(json.erro ?? 'Não foi possível remover o certificado.'))
    }
  }

  const diasParaVencer = situacao?.certificado ? Math.round((new Date(`${situacao.certificado.validoAte}T00:00:00`).getTime() - Date.now()) / 86_400_000) : null
  const mostrarFormulario = !situacao?.configurado || substituindo || situacao.origem === 'variavel'

  return (
    <AppShell title="Certificado digital" navItems={diretorNavItems(profile)} onRefresh={carregar}>
      {carregando ? (
        <div className="space-y-sm">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : erroCarga ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-lg font-body-md text-body-md text-error">{erroCarga}</div>
      ) : (
        situacao && (
          <>
            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Certificado A1 da empresa</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  Usado para buscar automaticamente na SEFAZ as notas emitidas contra a empresa. O arquivo e a senha ficam
                  guardados criptografados no servidor e nunca são exibidos.
                </p>
              </div>

              {situacao.certificado && (
                <div className="space-y-xs p-lg">
                  <div className="flex flex-wrap items-center gap-sm">
                    <span className="material-symbols-outlined text-[22px] text-tertiary">verified_user</span>
                    <p className="font-body-md font-semibold text-body-md text-on-surface">{situacao.certificado.titular ?? 'Certificado'}</p>
                    {diasParaVencer !== null && (
                      <span
                        className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${
                          diasParaVencer < 0
                            ? 'bg-error/10 text-error'
                            : diasParaVencer <= 30
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-tertiary/10 text-tertiary'
                        }`}
                      >
                        {diasParaVencer < 0 ? 'Vencido' : `Vence em ${diasParaVencer} dia${diasParaVencer === 1 ? '' : 's'}`}
                      </span>
                    )}
                  </div>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    CNPJ {formataCnpj(situacao.certificado.cnpj)} · válido até{' '}
                    {new Date(`${situacao.certificado.validoAte}T00:00:00`).toLocaleDateString('pt-BR')}
                    {situacao.certificado.enviadoEm &&
                      ` · enviado em ${dataHora(situacao.certificado.enviadoEm)}${situacao.certificado.enviadoPor ? ` por ${situacao.certificado.enviadoPor}` : ''}`}
                  </p>
                  {situacao.origem === 'variavel' && (
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      Este certificado está configurado por variável de ambiente na Vercel. Enviar um certificado aqui passa a usar o enviado pela tela.
                    </p>
                  )}
                  {situacao.avisos.map((a) => (
                    <p key={a} className="flex items-start gap-xs font-label-md text-label-md text-amber-800">
                      <span className="material-symbols-outlined text-[16px]">warning</span>
                      {a}
                    </p>
                  ))}
                  {situacao.erroCertificado && <p className="font-label-md text-label-md text-error">{situacao.erroCertificado}</p>}
                </div>
              )}
              {!situacao.certificado && (
                <div className="p-lg">
                  <p className="flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
                    <span className="material-symbols-outlined text-[20px]">info</span>
                    Nenhum certificado enviado ainda. Sem ele a captura de notas fica desligada.
                  </p>
                  {situacao.erroCertificado && <p className="mt-xs font-label-md text-label-md text-error">{situacao.erroCertificado}</p>}
                </div>
              )}

              {mostrarFormulario ? (
                <form onSubmit={enviar} className="space-y-md border-t border-outline-variant p-lg">
                  <p className="font-label-md font-semibold text-label-md text-on-surface">
                    {situacao.configurado ? 'Enviar um novo certificado' : 'Enviar o certificado'}
                  </p>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Arquivo do certificado (.pfx ou .p12)</span>
                    <input
                      ref={inputArquivo}
                      type="file"
                      accept=".pfx,.p12,application/x-pkcs12"
                      onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                      className="block w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface file:mr-md file:rounded-full file:border-0 file:bg-primary/10 file:px-md file:py-xs file:text-primary"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Senha do certificado</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none sm:w-80"
                    />
                  </label>
                  {erroEnvio && <p className="rounded-lg bg-error/5 p-sm font-label-md text-label-md text-error">{erroEnvio}</p>}
                  <div className="flex flex-wrap items-center gap-sm">
                    <button
                      type="submit"
                      disabled={enviando}
                      className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">upload</span>
                      {enviando ? 'Validando e guardando…' : 'Enviar certificado'}
                    </button>
                    {substituindo && (
                      <button
                        type="button"
                        onClick={() => {
                          setSubstituindo(false)
                          setErroEnvio(null)
                        }}
                        className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-sm border-t border-outline-variant p-lg">
                  <button
                    type="button"
                    onClick={() => setSubstituindo(true)}
                    className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined text-[16px]">sync</span>
                    Substituir certificado
                  </button>
                  {confirmandoRemocao ? (
                    <span className="flex items-center gap-xs">
                      <span className="font-label-md text-label-md text-error">Remover e pausar a captura?</span>
                      <button type="button" onClick={remover} className="rounded-full bg-error px-md py-xs font-label-md text-label-md text-on-error hover:opacity-90">
                        Remover
                      </button>
                      <button type="button" onClick={() => setConfirmandoRemocao(false)} className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoRemocao(true)}
                      className="rounded-full px-md py-xs font-label-md text-label-md text-error hover:bg-error/5"
                    >
                      Remover
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Captura de notas de entrada</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  A consulta à SEFAZ roda sozinha; a SEFAZ pede cerca de 1 hora de intervalo quando não há notas novas.
                  Ciência da operação automática: <b>{situacao.cienciaAutomatica ? 'ligada' : 'desligada'}</b>.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-md p-lg sm:grid-cols-4">
                {[
                  ['Notas capturadas', String(situacao.captura.notas.total)],
                  ['Com XML completo', String(situacao.captura.notas.completas)],
                  ['Só resumo', String(situacao.captura.notas.soResumo)],
                  ['Última captura', dataHora(situacao.captura.notas.ultimaCaptura)],
                ].map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <p className="font-label-md text-label-md text-on-surface-variant">{rotulo}</p>
                    <p className="font-title-md text-title-md text-on-surface">{valor}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-sm border-t border-outline-variant p-lg">
                <p className="font-label-md font-semibold text-label-md text-on-surface">Período das notas</p>
                <div className="flex flex-wrap items-end gap-sm">
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Emitidas a partir de</span>
                    <input
                      type="date"
                      value={periodoInicio}
                      onChange={(e) => setPeriodoInicio(e.target.value)}
                      className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">até</span>
                    <input
                      type="date"
                      value={periodoFim}
                      onChange={(e) => setPeriodoFim(e.target.value)}
                      className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={salvarPeriodo}
                    disabled={salvandoPeriodo}
                    className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                  >
                    {salvandoPeriodo ? 'Salvando…' : 'Salvar período'}
                  </button>
                  {(periodoInicio || periodoFim) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPeriodoInicio('')
                        setPeriodoFim('')
                      }}
                      className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  A SEFAZ não filtra por data: ela entrega tudo em ordem. A busca lê normalmente, mas <b>só grava as notas emitidas dentro deste
                  período</b> (deixe um dos campos vazio para não limitar aquele lado). Notas já gravadas não são apagadas. Se você <b>ampliar</b> o
                  período para trás, use "Reler desde o início" para trazer as que foram descartadas antes.
                </p>
                {situacao.periodo && (situacao.periodo.dataInicio || situacao.periodo.dataFim) && (
                  <p className="font-label-md text-label-md text-tertiary">
                    Período em vigor: {situacao.periodo.dataInicio ? new Date(`${situacao.periodo.dataInicio}T00:00:00`).toLocaleDateString('pt-BR') : 'sem início'}
                    {' → '}
                    {situacao.periodo.dataFim ? new Date(`${situacao.periodo.dataFim}T00:00:00`).toLocaleDateString('pt-BR') : 'sem fim'}
                  </p>
                )}
              </div>
              <div className="space-y-sm border-t border-outline-variant p-lg">
                <div className="flex flex-wrap items-center gap-sm">
                  <button
                    type="button"
                    onClick={buscarAgora}
                    disabled={buscando || !situacao.configurado}
                    className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">{buscando ? 'hourglass_top' : 'travel_explore'}</span>
                    {buscando ? 'Consultando a SEFAZ…' : 'Buscar notas agora'}
                  </button>
                  {situacao.cnpjsConsulta.length > 1 && (
                    <select
                      value={cnpjBusca}
                      onChange={(e) => setCnpjBusca(e.target.value)}
                      className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                    >
                      <option value="">Todos os CNPJs</option>
                      {situacao.cnpjsConsulta.map((c) => (
                        <option key={c.cnpj} value={c.cnpj}>
                          {formataCnpj(c.cnpj)}
                          {c.nome ? ` — ${c.nome}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                    <input type="checkbox" checked={registrarCiencia} onChange={(e) => setRegistrarCiencia(e.target.checked)} />
                    Registrar a "Ciência da Operação" nas notas encontradas (libera o XML completo)
                  </label>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  A SEFAZ só entrega as notas que ainda mantém disponíveis. Sem a ciência, chega apenas o resumo de cada nota; a ciência é um
                  evento fiscal que a contabilidade precisa autorizar.
                </p>
                <div className="flex flex-wrap items-center gap-xs">
                  {confirmandoReinicio ? (
                    <>
                      <span className="font-label-md text-label-md text-on-surface-variant">
                        Reler tudo na próxima busca? Use só em último caso: reler do zero pode causar bloqueio de 1 hora na SEFAZ. O intervalo de espera continua valendo.
                      </span>
                      <button type="button" onClick={reiniciarLeitura} className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90">
                        Reiniciar
                      </button>
                      <button type="button" onClick={() => setConfirmandoReinicio(false)} className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmandoReinicio(true)} className="font-label-md text-label-md text-primary hover:underline">
                      Reler desde o início
                    </button>
                  )}
                </div>
                {erroBusca && <p className="rounded-lg bg-error/5 p-sm font-label-md text-label-md text-error">{erroBusca}</p>}
                {resultadoBusca && (
                  <div className="space-y-xs rounded-lg bg-surface-container-low p-sm">
                    {resultadoBusca.aviso && <p className="font-label-md text-label-md text-on-surface">{resultadoBusca.aviso}</p>}
                    {resultadoBusca.cnpjs.some((c) => /\b656\b/.test(c.situacao)) && (
                      <p className="rounded-lg bg-amber-50 p-sm font-label-md text-label-md text-amber-900">{explicarRetorno('656')?.texto}</p>
                    )}
                    {resultadoBusca.cnpjs.map((c) => (
                      <p key={c.cnpj} className={`font-label-md text-label-md ${/\b656\b/.test(c.situacao) ? 'text-amber-900' : c.situacao.startsWith('erro') ? 'text-error' : 'text-on-surface'}`}>
                        {formataCnpj(c.cnpj)}: {c.situacao}
                        {!c.situacao.startsWith('erro') && !c.situacao.startsWith('aguardando') &&
                          ` — ${c.resumos} resumo${c.resumos === 1 ? '' : 's'}, ${c.completas} completa${c.completas === 1 ? '' : 's'}, ${c.eventos} evento${c.eventos === 1 ? '' : 's'}`}
                        {c.ignoradas > 0 && ` — ${c.ignoradas} fora do período (não gravadas)`}
                        {c.ciencia && ` — ciência: ${c.ciencia.registradas}/${c.ciencia.tentadas}${c.ciencia.erros.length ? ` (${c.ciencia.erros[0]})` : ''}`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              {situacao.captura.cnpjs.length > 0 && (
                <div className="divide-y divide-outline-variant border-t border-outline-variant">
                  {situacao.captura.cnpjs.map((c) => (
                    <div key={c.cnpj} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                      <div className="min-w-0">
                        <p className="font-body-md font-semibold text-body-md text-on-surface">{formataCnpj(c.cnpj)}</p>
                        <p className="font-label-md text-label-md text-on-surface-variant">
                          Última consulta {dataHora(c.ultimaConsulta)} · próxima a partir de {dataHora(c.proximaConsulta)}
                        </p>
                        {c.mensagem && <p className="font-label-md text-label-md text-on-surface-variant">{c.status}: {c.mensagem}</p>}
                        {(() => {
                          const e = explicarRetorno(`${c.status ?? ''} ${c.mensagem ?? ''}`)
                          return e ? (
                            <p
                              className={`mt-xs rounded-lg p-sm font-label-md text-label-md ${
                                e.tipo === 'ok' ? 'bg-tertiary/10 text-tertiary' : e.tipo === 'espera' ? 'bg-amber-50 text-amber-900' : 'bg-error/5 text-error'
                              }`}
                            >
                              {e.texto}
                            </p>
                          ) : null
                        })()}
                      </div>
                      <span
                        className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${
                          c.status === '656' ? 'bg-amber-100 text-amber-800' : c.errosSeguidos > 0 ? 'bg-error/10 text-error' : 'bg-tertiary/10 text-tertiary'
                        }`}
                      >
                        {c.status === '656'
                          ? 'Aguardando liberação da SEFAZ'
                          : c.errosSeguidos > 0
                            ? `${c.errosSeguidos} erro${c.errosSeguidos === 1 ? '' : 's'} seguido${c.errosSeguidos === 1 ? '' : 's'}`
                            : 'Funcionando'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Últimas notas emitidas contra a empresa</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">As 20 mais recentes capturadas da SEFAZ.</p>
              </div>
              {situacao.captura.ultimasNotas.length === 0 ? (
                <p className="p-lg font-body-md text-body-md text-on-surface-variant">Nenhuma nota capturada ainda. Clique em "Buscar notas agora".</p>
              ) : (
                <div className="divide-y divide-outline-variant">
                  {situacao.captura.ultimasNotas.map((n) => (
                    <div key={n.chave} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                      <div className="min-w-0">
                        <p className="font-body-md font-semibold text-body-md text-on-surface">
                          {n.emitente_nome ?? 'Emitente não identificado'}
                          {n.numero ? ` · NF ${n.numero}` : ''}
                        </p>
                        <p className="font-label-md text-label-md text-on-surface-variant">
                          {n.emitente_cnpj ? formataCnpj(n.emitente_cnpj) : '—'} · emitida em {dataHora(n.data_emissao)}
                        </p>
                      </div>
                      <div className="flex items-center gap-sm">
                        <span className="font-body-md font-semibold text-body-md text-on-surface">
                          {n.valor === null ? '—' : Number(n.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                        <span
                          className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${
                            n.situacao === 'cancelada' ? 'bg-error/10 text-error' : n.situacao === 'denegada' ? 'bg-amber-100 text-amber-800' : 'bg-tertiary/10 text-tertiary'
                          }`}
                        >
                          {n.situacao}
                        </span>
                        <span className="rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant">
                          {n.completa ? 'XML completo' : 'só resumo'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </AppShell>
  )
}
