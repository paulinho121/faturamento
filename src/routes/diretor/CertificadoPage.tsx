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
  }
}

function dataHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

function formataCnpj(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c ?? '—')
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
  const inputArquivo = useRef<HTMLInputElement>(null)

  async function carregar() {
    setCarregando(true)
    setErroCarga(null)
    try {
      const { status, json } = await chamarApi('GET')
      if (status === 200) setSituacao(json as unknown as Situacao)
      else setErroCarga(String(json.erro ?? `Erro ${status} ao carregar.`))
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
                      </div>
                      <span
                        className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${
                          c.errosSeguidos > 0 ? 'bg-error/10 text-error' : 'bg-tertiary/10 text-tertiary'
                        }`}
                      >
                        {c.errosSeguidos > 0 ? `${c.errosSeguidos} erro${c.errosSeguidos === 1 ? '' : 's'} seguido${c.errosSeguidos === 1 ? '' : 's'}` : 'Funcionando'}
                      </span>
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
