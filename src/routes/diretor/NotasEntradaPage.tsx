import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { diretorNavItems } from './nav'

interface Nota {
  chave: string
  cnpj_destinatario: string
  emitente_nome: string | null
  emitente_cnpj: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  valor: number | null
  situacao: 'autorizada' | 'cancelada' | 'denegada'
  completa: boolean
  manifestacao: string | null
}

const POR_PAGINA = 50

function formataCnpj(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return c ?? '—'
}

function dataCurta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

async function baixarArquivo(url: string, nomeSugerido: string): Promise<{ ok: boolean; erro?: string }> {
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } })
  if (!resposta.ok) {
    let erro = `Erro ${resposta.status}`
    try {
      erro = String(((await resposta.json()) as { erro?: string }).erro ?? erro)
    } catch {
      /* sem corpo */
    }
    return { ok: false, erro }
  }
  const blob = await resposta.blob()
  const link = document.createElement('a')
  const href = URL.createObjectURL(blob)
  link.href = href
  link.download = nomeSugerido
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(href)
  return { ok: true }
}

export function NotasEntradaPage() {
  const { profile } = useAuth()
  const { push } = useToast()

  const [notas, setNotas] = useState<Nota[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState('')
  const [comXml, setComXml] = useState('')
  const [baixando, setBaixando] = useState<string | null>(null)
  const [confirmandoCiencia, setConfirmandoCiencia] = useState<string[] | null>(null)
  const [registrando, setRegistrando] = useState(false)
  const sequencia = useRef(0)

  function filtrosQuery(): string {
    const p = new URLSearchParams()
    if (de) p.set('de', de)
    if (ate) p.set('ate', ate)
    if (busca.trim()) p.set('q', busca.trim())
    if (situacao) p.set('situacao', situacao)
    if (comXml) p.set('xml', comXml)
    return p.toString()
  }

  async function carregar(paginaAlvo = pagina) {
    const minha = ++sequencia.current
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch(`/api/dfe-certificado?recurso=notas&limit=${POR_PAGINA}&offset=${paginaAlvo * POR_PAGINA}&${filtrosQuery()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      })
      const json = (await resposta.json()) as { itens?: Nota[]; total?: number; erro?: string }
      if (minha !== sequencia.current) return
      if (resposta.ok) {
        setNotas(json.itens ?? [])
        setTotal(json.total ?? 0)
      } else {
        setErro(json.erro ?? `Erro ${resposta.status} ao carregar as notas.`)
      }
    } catch {
      if (minha === sequencia.current) setErro('Não foi possível falar com o servidor.')
    }
    if (minha === sequencia.current) setCarregando(false)
  }

  // Muda o filtro: volta para a primeira página (com um pequeno atraso na digitação).
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(0)
      carregar(0)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, busca, situacao, comXml])

  async function baixarXml(n: Nota) {
    setBaixando(n.chave)
    const r = await baixarArquivo(`/api/dfe-certificado?recurso=xml&chave=${n.chave}`, `${n.chave}-nfe.xml`)
    setBaixando(null)
    if (!r.ok) push('error', r.erro ?? 'Não foi possível baixar o XML.')
  }

  async function baixarZip() {
    setBaixando('zip')
    const r = await baixarArquivo(`/api/dfe-certificado?recurso=zip&${filtrosQuery()}`, `notas-entrada-${new Date().toISOString().slice(0, 10)}.zip`)
    setBaixando(null)
    if (!r.ok) push('error', r.erro ?? 'Não foi possível baixar o arquivo.')
  }

  async function registrarCiencia(chaves: string[]) {
    setRegistrando(true)
    try {
      const resposta = await fetch('/api/dfe-certificado', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'ciencia', chaves }),
      })
      const json = (await resposta.json()) as { ok?: boolean; registradas?: number; tentadas?: number; erros?: string[]; erro?: string }
      if (resposta.ok && (json.registradas ?? 0) > 0) {
        push('success', `Ciência registrada em ${json.registradas} nota${json.registradas === 1 ? '' : 's'}. O XML chega na próxima consulta à SEFAZ (cerca de 1 hora).`)
      } else if (resposta.ok && json.tentadas === 0) {
        push('success', 'Essas notas já tinham a ciência registrada ou o XML completo.')
      } else {
        push('error', json.erro ?? json.erros?.[0] ?? 'A SEFAZ não aceitou o registro. Tente de novo mais tarde.')
      }
    } catch {
      push('error', 'Não foi possível falar com o servidor.')
    }
    setRegistrando(false)
    setConfirmandoCiencia(null)
    carregar()
  }

  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1)
  const semXml = notas.filter((n) => !n.completa && !n.manifestacao && n.situacao === 'autorizada')

  return (
    <AppShell title="Notas de entrada" navItems={diretorNavItems(profile)} onRefresh={() => carregar()}>
      <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
        <div className="flex flex-wrap items-start justify-between gap-sm border-b border-outline-variant p-lg">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Notas emitidas contra a empresa</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Capturadas automaticamente da SEFAZ. Baixe o XML de uma nota ou de todas as do filtro.
            </p>
          </div>
          <button
            type="button"
            onClick={baixarZip}
            disabled={baixando === 'zip'}
            className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">folder_zip</span>
            {baixando === 'zip' ? 'Gerando…' : 'Baixar XMLs do filtro (.zip)'}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-sm border-b border-outline-variant p-md">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Emitidas de</span>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none" />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Buscar</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Emitente, CNPJ, nº da nota ou chave de acesso…"
              className="w-full rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Situação</span>
            <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none">
              <option value="">Todas</option>
              <option value="autorizada">Autorizadas</option>
              <option value="cancelada">Canceladas</option>
              <option value="denegada">Denegadas</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">XML</span>
            <select value={comXml} onChange={(e) => setComXml(e.target.value)} className="rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none">
              <option value="">Todas</option>
              <option value="sim">Com XML completo</option>
              <option value="nao">Só resumo</option>
            </select>
          </label>
        </div>

        {semXml.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant bg-amber-50 px-lg py-sm">
            <p className="font-label-md text-label-md text-amber-900">
              {semXml.length} nota{semXml.length === 1 ? '' : 's'} desta página só tem{semXml.length === 1 ? '' : 'm'} o resumo. Para receber o XML completo é preciso registrar a Ciência da Operação.
            </p>
            <button
              type="button"
              onClick={() => setConfirmandoCiencia(semXml.slice(0, 20).map((n) => n.chave))}
              className="rounded-full border border-amber-700 px-md py-xs font-label-md text-label-md text-amber-900 hover:bg-amber-100"
            >
              Obter XML das {Math.min(semXml.length, 20)} notas
            </button>
          </div>
        )}

        {carregando ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : erro ? (
          <p className="p-lg font-body-md text-body-md text-error">{erro}</p>
        ) : notas.length === 0 ? (
          <EmptyState icon="inbox" title="Nenhuma nota encontrada" description="Ajuste os filtros ou aguarde a próxima consulta à SEFAZ." />
        ) : (
          <div className="divide-y divide-outline-variant">
            {notas.map((n) => (
              <div key={n.chave} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
                  <p className="font-body-md font-semibold text-body-md text-on-surface">
                    {n.emitente_nome ?? 'Emitente não identificado'}
                    {n.numero ? ` · NF ${n.numero}` : ''}
                    {n.serie ? ` · série ${n.serie}` : ''}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {formataCnpj(n.emitente_cnpj)} · emitida em {dataCurta(n.data_emissao)} · para {formataCnpj(n.cnpj_destinatario)}
                  </p>
                  <p className="break-all font-label-md text-[11px] text-on-surface-variant">{n.chave}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-sm">
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
                  {n.completa ? (
                    <button
                      type="button"
                      onClick={() => baixarXml(n)}
                      disabled={baixando === n.chave}
                      className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      {baixando === n.chave ? 'Baixando…' : 'Baixar XML'}
                    </button>
                  ) : n.manifestacao ? (
                    <span className="rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant" title="A ciência já foi registrada; o XML completo chega na próxima consulta à SEFAZ.">
                      XML a caminho
                    </span>
                  ) : n.situacao === 'autorizada' ? (
                    <button
                      type="button"
                      onClick={() => setConfirmandoCiencia([n.chave])}
                      className="flex items-center gap-xs rounded-full border border-amber-700 px-md py-xs font-label-md text-label-md text-amber-900 hover:bg-amber-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">key</span>
                      Obter XML
                    </button>
                  ) : (
                    <span className="rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant">sem XML</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant p-md">
          <p className="font-label-md text-label-md text-on-surface-variant">
            {total} nota{total === 1 ? '' : 's'} · página {pagina + 1} de {totalPaginas}
          </p>
          <div className="flex gap-xs">
            <button
              type="button"
              disabled={pagina === 0 || carregando}
              onClick={() => {
                setPagina(pagina - 1)
                carregar(pagina - 1)
              }}
              className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={pagina + 1 >= totalPaginas || carregando}
              onClick={() => {
                setPagina(pagina + 1)
                carregar(pagina + 1)
              }}
              className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {confirmandoCiencia && (
        <Modal onClose={() => !registrando && setConfirmandoCiencia(null)} maxWidthClassName="max-w-md">
          <div className="space-y-md p-lg">
            <h3 className="font-title-md text-title-md text-on-surface">Registrar a Ciência da Operação?</h3>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Isso informa à SEFAZ que a empresa <b>tomou conhecimento</b> de {confirmandoCiencia.length === 1 ? 'esta nota' : `estas ${confirmandoCiencia.length} notas`}. É um evento
              fiscal oficial. Ele <b>não confirma nem recusa</b> a operação, e é o que libera o XML completo.
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant">
              O XML chega na próxima consulta à SEFAZ (cerca de 1 hora). Confirme com a contabilidade antes de prosseguir.
            </p>
            <div className="flex justify-end gap-sm">
              <button type="button" onClick={() => setConfirmandoCiencia(null)} disabled={registrando} className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => registrarCiencia(confirmandoCiencia)}
                disabled={registrando}
                className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                {registrando ? 'Registrando…' : 'Registrar ciência'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
