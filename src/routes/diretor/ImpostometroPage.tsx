import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'
import { baixarXlsx, serialDaData, type Celula } from '../../lib/xlsx'
import { navFiscal } from './nav'

type Efeito = 'debito' | 'credito' | 'estorno_debito' | 'estorno_credito' | 'nenhum'

interface Fechamento {
  debito: number
  credito: number
  saldo: number
  estornoDebito: number
  estornoCredito: number
}

interface TotaisOrigem {
  notas: number
  valorNf: number
  valorProdutos: number
  icms: number
  ipi: number
  pis: number
  cofins: number
  cbs: number
  ibs: number
}

interface LinhaCfop {
  origem: 'saida' | 'entrada'
  cfop: string
  itens: number
  icms: number
  ipi: number
  efeitoIcms: Efeito
  efeitoIpi: Efeito
  comRegra: boolean
}

interface NotaLinha {
  origem: 'saida' | 'entrada'
  chave: string
  numero: string | null
  serie: string | null
  dataEmissao: string
  participante: string | null
  participanteCnpj: string | null
  valorNf: number
  cfops: string[]
  icms: number
  ipi: number
  pis: number
  cofins: number
  cbs: number
  ibs: number
  icmsNaConta: number
  ipiNaConta: number
}

interface Apuracao {
  mes: string
  periodo: { de: string; ate: string }
  filtros: { de: string; ate: string; origem: string | null; cfop: string; q: string; impostos: string[] }
  regime: string
  icms: Fechamento
  ipi: Fechamento
  totais: { vendas: TotaisOrigem; compras: TotaisOrigem; geral: TotaisOrigem }
  pisCofins: { valido: boolean; receitaBruta: number; icmsExcluido: number; base: number; pis: number; cofins: number; observacao: string }
  cbsIbs: { debitoCbs: number; debitoIbs: number; creditoCbs: number; creditoIbs: number; notasComGrupo: number; observacao: string }
  porCfop: LinhaCfop[]
  semRegra: LinhaCfop[]
  notas: { itens: NotaLinha[]; total: number; pagina: number; limite: number; totalPaginas: number }
  notasConsideradas: number
  pendentes: number
  geradoEm: string
  regras: { cfop: string; efeitoIcms: Efeito; efeitoIpi: Efeito; descricao: string | null }[]
}

const ROTULO_EFEITO: Record<Efeito, string> = {
  debito: 'Débito',
  credito: 'Crédito',
  estorno_debito: 'Reduz débito',
  estorno_credito: 'Reduz crédito',
  nenhum: 'Fora da conta',
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function mesAtual(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)
}

function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number)
  return { de: `${mes}-01`, ate: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }
}

function deslocaMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${NOMES_MES[m - 1]} de ${a}`
}

const dataBr = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')

function formataCnpj(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return c ?? ''
}

// +R$ = pesa no imposto a pagar; −R$ = abate (crédito).
function comSinal(v: number): string {
  if (v === 0) return '—'
  return `${v > 0 ? '+' : '−'} ${formatCurrency(Math.abs(v))}`
}

async function chamar(metodo: 'GET' | 'POST', url: string, corpo?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { data } = await supabase.auth.getSession()
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await resposta.json()) as Record<string, unknown>
  } catch {
    /* sem corpo */
  }
  return { status: resposta.status, json }
}

function CartaoImposto({ titulo, f, dica }: { titulo: string; f: Fechamento; dica: string }) {
  const aRecolher = f.saldo >= 0
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
      <div className="mb-sm flex items-center justify-between gap-sm">
        <h3 className="font-title-md text-title-md text-on-surface">{titulo}</h3>
        <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${aRecolher ? 'bg-error/10 text-error' : 'bg-tertiary/10 text-tertiary'}`}>
          {aRecolher ? 'A recolher' : 'Saldo credor'}
        </span>
      </div>
      <p className={`font-display text-[28px] font-bold leading-tight ${aRecolher ? 'text-error' : 'text-tertiary'}`}>{formatCurrency(Math.abs(f.saldo))}</p>
      <div className="mt-sm grid grid-cols-2 gap-sm">
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Débitos (vendas)</p>
          <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(f.debito)}</p>
          {f.estornoDebito > 0 && <p className="font-label-md text-[11px] text-on-surface-variant">já abatidas devoluções de {formatCurrency(f.estornoDebito)}</p>}
        </div>
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Créditos (compras)</p>
          <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(f.credito)}</p>
          {f.estornoCredito > 0 && <p className="font-label-md text-[11px] text-on-surface-variant">já abatidas devoluções de {formatCurrency(f.estornoCredito)}</p>}
        </div>
      </div>
      <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">{dica}</p>
    </div>
  )
}

const POR_PAGINA = 25

type Imposto = 'icms' | 'ipi' | 'pis' | 'cofins' | 'cbs' | 'ibs'
const IMPOSTOS: { chave: Imposto; rotulo: string }[] = [
  { chave: 'icms', rotulo: 'ICMS' },
  { chave: 'ipi', rotulo: 'IPI' },
  { chave: 'pis', rotulo: 'PIS' },
  { chave: 'cofins', rotulo: 'COFINS' },
  { chave: 'cbs', rotulo: 'CBS' },
  { chave: 'ibs', rotulo: 'IBS' },
]
const CAMPO = 'rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none'

export function ImpostometroPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const inicial = limitesDoMes(mesAtual())
  const [de, setDe] = useState(inicial.de)
  const [ate, setAte] = useState(inicial.ate)
  const [origem, setOrigem] = useState<'' | 'saida' | 'entrada'>('')
  const [cfop, setCfop] = useState('')
  const [busca, setBusca] = useState('')
  const [impostos, setImpostos] = useState<Imposto[]>([])
  const [exportando, setExportando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [dados, setDados] = useState<Apuracao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const sequencia = useRef(0)

  const urlConsulta = useCallback(
    (paginaAlvo: number) => {
      const p = new URLSearchParams({ de, ate, pagina: String(paginaAlvo), limite: String(POR_PAGINA) })
      if (origem) p.set('origem', origem)
      if (cfop) p.set('cfop', cfop)
      if (busca.trim()) p.set('q', busca.trim())
      if (impostos.length > 0) p.set('impostos', impostos.join(','))
      return `/api/impostometro?${p.toString()}`
    },
    [de, ate, origem, cfop, busca, impostos]
  )

  const carregar = useCallback(
    async (paginaAlvo: number, silencioso = false) => {
      const minha = ++sequencia.current
      if (!silencioso) setCarregando(true)
      setErro(null)
      try {
        const { status, json } = await chamar('GET', urlConsulta(paginaAlvo))
        if (minha !== sequencia.current) return
        if (status === 200) setDados(json as unknown as Apuracao)
        else setErro(String(json.erro ?? `Erro ${status} ao calcular.`))
      } catch {
        if (minha === sequencia.current) setErro('Não foi possível falar com o servidor.')
      }
      if (minha === sequencia.current) setCarregando(false)
    },
    [urlConsulta]
  )

  // Mudou algum filtro: volta para a primeira página (com um pequeno atraso na digitação).
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(0)
      carregar(0)
    }, 350)
    return () => clearTimeout(t)
  }, [de, ate, origem, cfop, busca, impostos, carregar])

  // Tempo real: enquanto há XMLs para ler, busca de novo em 2 s; depois, atualiza a cada minuto.
  useEffect(() => {
    const t = setTimeout(() => carregar(pagina, true), dados && dados.pendentes > 0 ? 2000 : 60_000)
    return () => clearTimeout(t)
  }, [dados, pagina, carregar])

  function irParaMes(mes: string) {
    const l = limitesDoMes(mes)
    setDe(l.de)
    setAte(l.ate)
  }

  function limpar() {
    irParaMes(mesAtual())
    setOrigem('')
    setCfop('')
    setBusca('')
    setImpostos([])
  }

  function alternaImposto(i: Imposto) {
    setImpostos((atual) => (atual.includes(i) ? atual.filter((x) => x !== i) : [...atual, i]))
  }

  // Exporta a lista inteira do filtro (não só a página) para uma planilha Excel com 3 abas: Resumo, Notas e Por CFOP.
  async function exportarExcel() {
    setExportando(true)
    try {
      const { status, json } = await chamar('GET', `${urlConsulta(0)}&todas=1`)
      if (status !== 200) {
        push('error', String(json.erro ?? 'Não foi possível gerar a planilha.'))
        return
      }
      const d = json as unknown as Apuracao
      const moeda = (v: number) => ({ v, s: 'moeda' as const })
      const moedaN = (v: number) => ({ v, s: 'moedaNegrito' as const })
      const cab = (v: string) => ({ v, s: 'cabecalho' as const })
      const filtrosTexto = [
        `Período: ${dataBr(d.filtros.de)} a ${dataBr(d.filtros.ate)}`,
        `Operação: ${d.filtros.origem === 'saida' ? 'Vendas' : d.filtros.origem === 'entrada' ? 'Compras' : 'Todas'}`,
        `CFOP: ${d.filtros.cfop || 'todos'}`,
        `Busca: ${d.filtros.q || '—'}`,
        `Impostos: ${d.filtros.impostos.length ? d.filtros.impostos.map((i) => i.toUpperCase()).join(', ') : 'todos'}`,
      ]
      const colunas = IMPOSTOS.map((i) => i.rotulo)
      const linhaTotais = (nome: string, t: TotaisOrigem): Celula[] => [
        { v: nome, s: 'negrito' },
        { v: t.notas, s: 'inteiro' },
        moeda(t.valorNf),
        ...IMPOSTOS.map((i) => moeda(t[i.chave])),
      ]
      const resumo: Celula[][] = [
        [{ v: 'Impostômetro — Lucro Presumido', s: 'titulo' }],
        [`Gerado em ${new Date().toLocaleString('pt-BR')}. Estimativa para acompanhamento: não substitui a apuração da contabilidade.`],
        ...filtrosTexto.map((t): Celula[] => [t]),
        [],
        [cab('Totais do filtro'), cab('Notas'), cab('Valor das notas'), ...colunas.map(cab)],
        linhaTotais('Vendas (notas emitidas)', d.totais.vendas),
        linhaTotais('Compras (notas recebidas)', d.totais.compras),
        linhaTotais('Total geral', d.totais.geral),
        ['Impostos destacados nas notas com XML, sem as canceladas.'],
        [],
        [cab('Apuração'), cab('Débitos'), cab('Créditos'), cab('Saldo (a recolher)')],
        ['ICMS', moeda(d.icms.debito), moeda(d.icms.credito), moedaN(d.icms.saldo)],
        ['IPI', moeda(d.ipi.debito), moeda(d.ipi.credito), moedaN(d.ipi.saldo)],
        d.pisCofins.valido
          ? ['PIS (0,65%, cumulativo, estimativa)', moeda(d.pisCofins.pis), null, moedaN(d.pisCofins.pis)]
          : ['PIS e COFINS', 'estimativa indisponível com este filtro'],
        d.pisCofins.valido ? ['COFINS (3%, cumulativo, estimativa)', moeda(d.pisCofins.cofins), null, moedaN(d.pisCofins.cofins)] : [],
        ['CBS (informativo)', moeda(d.cbsIbs.debitoCbs), moeda(d.cbsIbs.creditoCbs), null],
        ['IBS (informativo)', moeda(d.cbsIbs.debitoIbs), moeda(d.cbsIbs.creditoIbs), null],
      ]

      const notas: Celula[][] = [
        [
          cab('Data'),
          cab('Tipo'),
          cab('Nota'),
          cab('Série'),
          cab('Cliente / fornecedor'),
          cab('CNPJ'),
          cab('CFOP'),
          cab('Valor da nota'),
          ...colunas.map(cab),
          cab('ICMS na conta'),
          cab('IPI na conta'),
          cab('Chave de acesso'),
        ],
        ...d.notas.itens.map(
          (n): Celula[] => [
            { v: serialDaData(n.dataEmissao), s: 'data' },
            n.origem === 'saida' ? 'Venda' : 'Compra',
            n.numero ?? '',
            n.serie ?? '',
            n.participante ?? '',
            formataCnpj(n.participanteCnpj),
            n.cfops.join(', '),
            moeda(n.valorNf),
            ...IMPOSTOS.map((i) => moeda(n[i.chave])),
            moeda(n.icmsNaConta),
            moeda(n.ipiNaConta),
            n.chave,
          ]
        ),
      ]
      const g = d.totais.geral
      notas.push([
        { v: `Total (${d.notas.total} nota${d.notas.total === 1 ? '' : 's'})`, s: 'negrito' },
        null,
        null,
        null,
        null,
        null,
        null,
        moedaN(g.valorNf),
        ...IMPOSTOS.map((i) => moedaN(g[i.chave])),
        moedaN(d.icms.saldo),
        moedaN(d.ipi.saldo),
      ])

      const porCfop: Celula[][] = [
        [cab('Operação'), cab('CFOP'), cab('Descrição'), cab('Itens'), cab('ICMS'), cab('IPI'), cab('Efeito no ICMS'), cab('Efeito no IPI')],
        ...d.porCfop.map(
          (l): Celula[] => [
            l.origem === 'saida' ? 'Venda' : 'Compra',
            l.cfop,
            d.regras.find((r) => r.cfop === l.cfop)?.descricao ?? '',
            { v: l.itens, s: 'inteiro' },
            moeda(l.icms),
            moeda(l.ipi),
            ROTULO_EFEITO[l.efeitoIcms],
            ROTULO_EFEITO[l.efeitoIpi],
          ]
        ),
      ]

      baixarXlsx(`impostometro_${d.filtros.de}_a_${d.filtros.ate}.xlsx`, [
        { nome: 'Resumo', linhas: resumo, larguras: [38, 10, 16, 14, 14, 14, 14, 14, 14] },
        { nome: 'Notas', linhas: notas, larguras: [12, 9, 11, 7, 38, 20, 14, 16, 13, 13, 13, 13, 13, 13, 15, 15, 46], congelarLinhas: 1, filtroAutomatico: true },
        { nome: 'Por CFOP', linhas: porCfop, larguras: [11, 8, 52, 8, 14, 14, 16, 16], congelarLinhas: 1, filtroAutomatico: true },
      ])
      push('success', `Planilha gerada com ${d.notas.total} nota${d.notas.total === 1 ? '' : 's'}.`)
      if (d.notas.total > d.notas.itens.length) push('error', `A planilha tem as primeiras ${d.notas.itens.length} notas; reduza o período para exportar todas.`)
    } catch {
      push('error', 'Não foi possível gerar a planilha.')
    } finally {
      setExportando(false)
    }
  }

  async function definirRegra(l: LinhaCfop, efeitoIcms: Efeito, efeitoIpi: Efeito) {
    setSalvando(l.cfop)
    const { status, json } = await chamar('POST', '/api/impostometro', { acao: 'regra', cfop: l.cfop, efeitoIcms, efeitoIpi })
    setSalvando(null)
    if (status === 200) {
      push('success', `Regra do CFOP ${l.cfop} salva.`)
      carregar(pagina, true)
    } else {
      push('error', String(json.erro ?? 'Não foi possível salvar a regra.'))
    }
  }

  const regraDoCfop = (c: string) => dados?.regras.find((r) => r.cfop === c)
  const mesDoFiltro = de.slice(0, 7)
  const ehMesInteiro = (() => {
    const l = limitesDoMes(mesDoFiltro)
    return de === l.de && ate === l.ate
  })()
  const filtrando = origem !== '' || cfop !== '' || busca.trim() !== '' || impostos.length > 0 || !ehMesInteiro || mesDoFiltro !== mesAtual()
  // Com imposto escolhido, a tela mostra só esse(s) imposto(s); sem escolha, todos.
  const mostra = (i: Imposto) => impostos.length === 0 || impostos.includes(i)
  const colunasImposto = IMPOSTOS.filter((i) => mostra(i.chave))
  const totalEstimado = dados
    ? (mostra('icms') ? Math.max(dados.icms.saldo, 0) : 0) +
      (mostra('ipi') ? Math.max(dados.ipi.saldo, 0) : 0) +
      (dados.pisCofins.valido ? (mostra('pis') ? dados.pisCofins.pis : 0) + (mostra('cofins') ? dados.pisCofins.cofins : 0) : 0)
    : 0
  const tituloPeriodo = ehMesInteiro ? nomeDoMes(mesDoFiltro) : `${dataBr(de)} a ${dataBr(ate)}`

  return (
    <AppShell title="Impostômetro" navItems={navFiscal(profile)} onRefresh={() => carregar(pagina)}>
      <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-xs">
          <button type="button" onClick={() => irParaMes(deslocaMes(mesDoFiltro, -1))} aria-label="Mês anterior" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <p className="min-w-[190px] text-center font-title-md text-title-md capitalize text-on-surface">{tituloPeriodo}</p>
          <button type="button" onClick={() => irParaMes(deslocaMes(mesDoFiltro, 1))} disabled={mesDoFiltro >= mesAtual()} aria-label="Próximo mês" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high disabled:opacity-40">
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={exportarExcel}
            disabled={exportando || !dados}
            className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">{exportando ? 'hourglass_top' : 'download'}</span>
            {exportando ? 'Gerando…' : 'Exportar para Excel'}
          </button>
          <span className="rounded-full bg-primary/10 px-md py-xs font-label-md text-label-md text-primary">Lucro Presumido</span>
          <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
            <span className="inline-block h-2 w-2 rounded-full bg-tertiary" /> ao vivo
            {dados && ` · atualizado às ${new Date(dados.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-lg rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-level2">
        <div className="flex flex-wrap items-end gap-sm">
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">De</span>
            <input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} className={CAMPO} />
          </label>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Até</span>
            <input type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} className={CAMPO} />
          </label>
          <div className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Operação</span>
            <div className="flex overflow-hidden rounded-xl border border-outline-variant">
              {(
                [
                  ['', 'Todas'],
                  ['saida', 'Vendas'],
                  ['entrada', 'Compras'],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setOrigem(valor)}
                  className={`px-md py-xs font-label-md text-label-md transition-colors ${origem === valor ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-container-high'}`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <div className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Imposto</span>
            <div className="flex flex-wrap gap-xs">
              {IMPOSTOS.map((i) => {
                const ativo = impostos.includes(i.chave)
                return (
                  <button
                    key={i.chave}
                    type="button"
                    onClick={() => alternaImposto(i.chave)}
                    aria-pressed={ativo}
                    className={`rounded-full border px-sm py-xs font-label-md text-label-md transition-colors ${
                      ativo ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {i.rotulo}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">CFOP</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={cfop}
              onChange={(e) => setCfop(e.target.value.replace(/\D/g, ''))}
              placeholder="ex.: 5102"
              className={`${CAMPO} w-28`}
            />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Buscar nota</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº da nota, cliente/fornecedor, CNPJ ou chave…"
              className={`${CAMPO} w-full`}
            />
          </label>
          {filtrando && (
            <button type="button" onClick={limpar} className="rounded-full px-md py-xs font-label-md text-label-md text-primary hover:bg-primary/5">
              Limpar filtros
            </button>
          )}
        </div>
        <div className="mt-sm flex flex-wrap items-center gap-xs">
          <span className="font-label-md text-label-md text-on-surface-variant">Atalhos:</span>
          {[0, -1, -2].map((d) => {
            const m = deslocaMes(mesAtual(), d)
            return (
              <button key={m} type="button" onClick={() => irParaMes(m)} className="rounded-full border border-outline-variant px-sm py-0.5 font-label-md text-label-md capitalize text-on-surface-variant hover:bg-surface-container-high">
                {d === 0 ? 'mês atual' : nomeDoMes(m)}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => {
              const hoje = new Date(Date.now() - 3 * 3600 * 1000)
              setDe(`${hoje.getUTCFullYear()}-01-01`)
              setAte(hoje.toISOString().slice(0, 10))
            }}
            className="rounded-full border border-outline-variant px-sm py-0.5 font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            ano até hoje
          </button>
        </div>
      </div>

      <div className="mb-lg flex items-start gap-sm rounded-xl border border-amber-300 bg-amber-50 p-md">
        <span className="material-symbols-outlined text-[20px] text-amber-800">info</span>
        <p className="font-label-md text-label-md text-amber-900">
          <b>Estimativa para acompanhamento.</b> Os valores vêm dos impostos destacados nos XMLs das notas, conforme as regras de cada CFOP abaixo. Não substituem a apuração
          oficial da contabilidade e não incluem IRPJ, CSLL, ICMS-ST, DIFAL nem créditos de ativo imobilizado.
        </p>
      </div>

      {carregando && !dados ? (
        <div className="grid gap-md md:grid-cols-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : erro && !dados ? (
        <p className="rounded-xl border border-error/30 bg-error/5 p-lg font-body-md text-body-md text-error">{erro}</p>
      ) : (
        dados && (
          <>
            {erro && <p className="mb-md rounded-lg bg-error/5 p-sm font-label-md text-label-md text-error">{erro}</p>}
            {dados.pendentes > 0 && (
              <p className="mb-md rounded-lg bg-surface-container-low p-sm font-label-md text-label-md text-on-surface-variant">
                Lendo os XMLs das notas… faltam {dados.pendentes}. Os números abaixo já se atualizam à medida que as notas são lidas.
              </p>
            )}

            {/* Totais gerais */}
            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="flex flex-wrap items-end justify-between gap-sm border-b border-outline-variant p-lg">
                <div>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    Imposto a recolher estimado · {tituloPeriodo}
                    {filtrando && ' (com os filtros aplicados)'}
                  </p>
                  <p className="font-display text-[34px] font-bold leading-tight text-on-surface">{formatCurrency(totalEstimado)}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    ICMS + IPI + PIS + COFINS · {dados.notasConsideradas} nota{dados.notasConsideradas === 1 ? '' : 's'}. Saldo credor de um imposto não abate outro.
                    {!dados.pisCofins.valido && ' PIS e COFINS ficam de fora quando há filtro de CFOP, busca ou só compras.'}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low">
                    <tr>
                      {['Totais do filtro', 'Notas', 'Valor das notas', ...colunasImposto.map((c) => c.rotulo)].map((h, i) => (
                        <th key={h} className={`whitespace-nowrap px-md py-sm font-label-md text-label-md text-on-surface-variant ${i > 0 ? 'text-right' : ''}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {(
                      [
                        ['Vendas (notas emitidas)', dados.totais.vendas, false],
                        ['Compras (notas recebidas)', dados.totais.compras, false],
                        ['Total geral', dados.totais.geral, true],
                      ] as const
                    ).map(([nome, t, destaque]) => (
                      <tr key={nome} className={destaque ? 'bg-surface-container-low font-semibold' : ''}>
                        <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{nome}</td>
                        <td className="px-md py-sm text-right font-body-md text-body-md text-on-surface">{t.notas}</td>
                        {[t.valorNf, ...colunasImposto.map((c) => t[c.chave])].map((v, i) => (
                          <td key={i} className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">
                            {formatCurrency(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-outline-variant px-lg py-sm font-label-md text-[11px] text-on-surface-variant">
                Impostos <b>destacados nas notas</b> (somente notas com XML, sem as canceladas). A apuração de cada imposto, com os créditos e débitos, está nos cartões abaixo.
              </p>
            </div>

            <div className="mb-lg grid gap-md md:grid-cols-2 xl:grid-cols-4">
              {mostra('icms') && <CartaoImposto titulo="ICMS" f={dados.icms} dica="Débito das notas que emitimos menos o crédito das compras que geram direito (CFOPs abaixo)." />}
              {mostra('ipi') && <CartaoImposto titulo="IPI" f={dados.ipi} dica="Vale para importadora (equiparada a industrial). Confirme com a contabilidade." />}
              {(mostra('pis') || mostra('cofins')) && (
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <div className="mb-sm flex items-center justify-between gap-sm">
                  <h3 className="font-title-md text-title-md text-on-surface">PIS e COFINS</h3>
                  <span className="rounded-full bg-error/10 px-sm py-0.5 font-label-md text-label-md text-error">A recolher</span>
                </div>
                {dados.pisCofins.valido ? (
                  <>
                    <p className="font-display text-[28px] font-bold leading-tight text-error">{formatCurrency(dados.pisCofins.pis + dados.pisCofins.cofins)}</p>
                    <div className="mt-sm grid grid-cols-2 gap-sm">
                      <div>
                        <p className="font-label-md text-label-md text-on-surface-variant">PIS (0,65%)</p>
                        <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(dados.pisCofins.pis)}</p>
                      </div>
                      <div>
                        <p className="font-label-md text-label-md text-on-surface-variant">COFINS (3%)</p>
                        <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(dados.pisCofins.cofins)}</p>
                      </div>
                    </div>
                    <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">
                      Cumulativos, sem crédito. Base: receita de {formatCurrency(dados.pisCofins.receitaBruta)} menos ICMS de {formatCurrency(dados.pisCofins.icmsExcluido)}.
                    </p>
                  </>
                ) : (
                  <p className="font-body-md text-body-md text-on-surface-variant">{dados.pisCofins.observacao}</p>
                )}
              </div>
              )}
              {(mostra('cbs') || mostra('ibs')) && (
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <div className="mb-sm flex items-center justify-between gap-sm">
                  <h3 className="font-title-md text-title-md text-on-surface">CBS e IBS</h3>
                  <span className="rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant">Informativo</span>
                </div>
                {dados.cbsIbs.notasComGrupo === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">Nenhuma nota deste filtro traz o grupo de CBS/IBS no XML.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-sm">
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant">CBS débito / crédito</p>
                      <p className="font-body-md font-semibold text-body-md text-on-surface">
                        {formatCurrency(dados.cbsIbs.debitoCbs)} / {formatCurrency(dados.cbsIbs.creditoCbs)}
                      </p>
                    </div>
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant">IBS débito / crédito</p>
                      <p className="font-body-md font-semibold text-body-md text-on-surface">
                        {formatCurrency(dados.cbsIbs.debitoIbs)} / {formatCurrency(dados.cbsIbs.creditoIbs)}
                      </p>
                    </div>
                  </div>
                )}
                <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">{dados.cbsIbs.observacao}</p>
              </div>
              )}
            </div>

            {dados.semRegra.length > 0 && (
              <div className="mb-lg rounded-xl border border-amber-300 bg-amber-50 p-md">
                <p className="font-label-md font-semibold text-label-md text-amber-900">
                  {dados.semRegra.length} CFOP{dados.semRegra.length === 1 ? '' : 's'} de compra sem regra definida: {dados.semRegra.map((c) => c.cfop).join(', ')}.
                </p>
                <p className="font-label-md text-label-md text-amber-900">Compras sem regra ficam fora da conta (nenhum crédito é contado). Defina abaixo, na tabela, se geram crédito.</p>
              </div>
            )}

            {/* Lista de notas */}
            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Notas do filtro</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  Cada nota com os impostos destacados e quanto ela pesa na conta: <b>+</b> aumenta o imposto a pagar, <b>−</b> é crédito que abate.
                </p>
              </div>
              {dados.notas.itens.length === 0 ? (
                <p className="p-lg font-body-md text-body-md text-on-surface-variant">Nenhuma nota com XML para este filtro.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {[
                          'Data',
                          'Tipo',
                          'Nota',
                          'Cliente / fornecedor',
                          'CFOP',
                          'Valor da nota',
                          ...colunasImposto.map((c) => c.rotulo),
                          ...(mostra('icms') ? ['ICMS na conta'] : []),
                          ...(mostra('ipi') ? ['IPI na conta'] : []),
                        ].map((h, i) => (
                          <th key={h} className={`whitespace-nowrap px-md py-sm font-label-md text-label-md text-on-surface-variant ${i >= 5 ? 'text-right' : ''}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {dados.notas.itens.map((n) => (
                        <tr key={`${n.origem}-${n.chave}`}>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{dataBr(n.dataEmissao)}</td>
                          <td className="px-md py-sm">
                            <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${n.origem === 'saida' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'}`}>
                              {n.origem === 'saida' ? 'Venda' : 'Compra'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface" title={n.chave}>
                            {n.numero ?? '—'}
                            {n.serie ? <span className="text-on-surface-variant"> / {n.serie}</span> : null}
                          </td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface">
                            <span className="block max-w-[260px] truncate">{n.participante ?? '—'}</span>
                            {n.participanteCnpj && <span className="block font-label-md text-[11px] text-on-surface-variant">{formataCnpj(n.participanteCnpj)}</span>}
                          </td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface-variant">{n.cfops.join(', ')}</td>
                          <td className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">{formatCurrency(n.valorNf)}</td>
                          {colunasImposto.map((c) => (
                            <td key={c.chave} className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">
                              {formatCurrency(n[c.chave])}
                            </td>
                          ))}
                          {mostra('icms') && (
                            <td className={`whitespace-nowrap px-md py-sm text-right font-body-md font-semibold text-body-md ${n.icmsNaConta > 0 ? 'text-error' : n.icmsNaConta < 0 ? 'text-tertiary' : 'text-on-surface-variant'}`}>{comSinal(n.icmsNaConta)}</td>
                          )}
                          {mostra('ipi') && (
                            <td className={`whitespace-nowrap px-md py-sm text-right font-body-md font-semibold text-body-md ${n.ipiNaConta > 0 ? 'text-error' : n.ipiNaConta < 0 ? 'text-tertiary' : 'text-on-surface-variant'}`}>{comSinal(n.ipiNaConta)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-outline bg-surface-container-low">
                      <tr className="font-semibold">
                        <td colSpan={5} className="px-md py-sm font-body-md text-body-md text-on-surface">
                          Total do filtro ({dados.notas.total} nota{dados.notas.total === 1 ? '' : 's'}, todas as páginas)
                        </td>
                        <td className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">{formatCurrency(dados.totais.geral.valorNf)}</td>
                        {colunasImposto.map((c) => (
                          <td key={c.chave} className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">
                            {formatCurrency(dados.totais.geral[c.chave])}
                          </td>
                        ))}
                        {mostra('icms') && <td className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">{comSinal(dados.icms.saldo)}</td>}
                        {mostra('ipi') && <td className="whitespace-nowrap px-md py-sm text-right font-body-md text-body-md text-on-surface">{comSinal(dados.ipi.saldo)}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant p-md">
                <p className="font-label-md text-label-md text-on-surface-variant">
                  Página {dados.notas.pagina + 1} de {dados.notas.totalPaginas}
                </p>
                <div className="flex gap-xs">
                  <button
                    type="button"
                    disabled={dados.notas.pagina === 0 || carregando}
                    onClick={() => {
                      setPagina(dados.notas.pagina - 1)
                      carregar(dados.notas.pagina - 1)
                    }}
                    className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={dados.notas.pagina + 1 >= dados.notas.totalPaginas || carregando}
                    onClick={() => {
                      setPagina(dados.notas.pagina + 1)
                      carregar(dados.notas.pagina + 1)
                    }}
                    className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </div>

            {/* Regras por CFOP */}
            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Detalhe por CFOP</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">Como cada tipo de operação entra na conta. A contabilidade pode ajustar; a tela recalcula na hora.</p>
              </div>
              {dados.porCfop.length === 0 ? (
                <p className="p-lg font-body-md text-body-md text-on-surface-variant">Nenhuma nota com XML para este filtro.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {['Operação', 'CFOP', 'Itens', 'ICMS', 'IPI', 'Efeito no ICMS', 'Efeito no IPI'].map((h) => (
                          <th key={h} className="whitespace-nowrap px-md py-sm font-label-md text-label-md text-on-surface-variant">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {dados.porCfop.map((l) => (
                        <tr key={`${l.origem}-${l.cfop}`} className={l.comRegra || l.origem === 'saida' ? '' : 'bg-amber-50/60'}>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{l.origem === 'saida' ? 'Venda' : 'Compra'}</td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface" title={regraDoCfop(l.cfop)?.descricao ?? ''}>
                            {l.cfop}
                            {regraDoCfop(l.cfop)?.descricao && <span className="block max-w-[260px] truncate font-label-md text-[11px] text-on-surface-variant">{regraDoCfop(l.cfop)?.descricao}</span>}
                          </td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface">{l.itens}</td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{formatCurrency(l.icms)}</td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{formatCurrency(l.ipi)}</td>
                          {(['icms', 'ipi'] as const).map((imposto) => (
                            <td key={imposto} className="px-md py-sm">
                              <select
                                value={imposto === 'icms' ? l.efeitoIcms : l.efeitoIpi}
                                disabled={salvando === l.cfop}
                                onChange={(e) => definirRegra(l, imposto === 'icms' ? (e.target.value as Efeito) : l.efeitoIcms, imposto === 'ipi' ? (e.target.value as Efeito) : l.efeitoIpi)}
                                className="rounded-lg border border-outline-variant bg-surface px-sm py-xs font-label-md text-label-md text-on-surface focus:border-primary focus:outline-none"
                              >
                                {(Object.keys(ROTULO_EFEITO) as Efeito[]).map((e) => (
                                  <option key={e} value={e}>
                                    {ROTULO_EFEITO[e]}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}
    </AppShell>
  )
}
