import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'
import { baixarXlsx, serialDaData, type Celula } from '../../lib/xlsx'
import {
  LINHAS,
  MESES_DO_TRIMESTRE,
  NOME_MES,
  NOME_TRIMESTRE,
  PARAMETROS_PADRAO,
  calcularTrimestre,
  vencimentoDaCota,
  zeraMes,
  type ChaveLinha,
  type Parametros,
  type ValoresMes,
} from '../../lib/apuracaoPresumido'
import { navFiscal } from './nav'

interface DadosIrpj {
  ano: number
  trimestre: number
  meses: number[]
  parametros: Parametros
  cfopsMercadoria: string[]
  divergencias: { numero: string; cliente: string; data: string; valor: number; tipo: string; afetaFaturamento: boolean; filial: string }[]
  duplicadas: { cliente: string; a: { numero: string; data: string; valor: number }; b: { numero: string; data: string; valor: number } }[]
  semXml: { total: number; valor: number; notas: { numero: string; cliente: string; data: string; valor: number; tipo: string; filial: string }[] }
  parametrosPadrao: boolean
  auto: Record<string, Partial<Record<ChaveLinha, number>>>
  manual: Record<string, Partial<Record<ChaveLinha, { valor: number; observacao: string | null }>>>
  porFilial: { mes: number; filial: string; mercadorias: number; servicos: number }[]
  fechamentos: { id: string; fechadoEm: string; fechadoPor: string | null; irpjDevido: number | null; csllDevido: number | null; observacao: string | null }[]
  pendentes: number
  geradoEm: string
}

const CAMPO = 'rounded-xl border border-outline-variant bg-surface px-md py-xs font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none'

const ROTULO_PARAMETRO: { chave: keyof Parametros; rotulo: string; sufixo: string }[] = [
  { chave: 'limiteTrimestre', rotulo: 'Limite de receita por trimestre', sufixo: 'R$' },
  { chave: 'percMercIrpj', rotulo: 'Presunção IRPJ — mercadorias', sufixo: '%' },
  { chave: 'percMercIrpjExcedente', rotulo: 'Presunção IRPJ — mercadorias (acima do limite)', sufixo: '%' },
  { chave: 'percServ', rotulo: 'Presunção — serviços', sufixo: '%' },
  { chave: 'percServExcedente', rotulo: 'Presunção — serviços (acima do limite)', sufixo: '%' },
  { chave: 'percMercCsll', rotulo: 'Presunção CSLL — mercadorias', sufixo: '%' },
  { chave: 'percMercCsllExcedente', rotulo: 'Presunção CSLL — mercadorias (acima do limite)', sufixo: '%' },
  { chave: 'aliquotaIrpj', rotulo: 'Alíquota do IRPJ', sufixo: '%' },
  { chave: 'adicionalAliquota', rotulo: 'Alíquota do adicional de IRPJ', sufixo: '%' },
  { chave: 'adicionalLimite', rotulo: 'Base do adicional (por trimestre)', sufixo: 'R$' },
  { chave: 'aliquotaCsll', rotulo: 'Alíquota da CSLL', sufixo: '%' },
  { chave: 'cotas', rotulo: 'Número máximo de cotas', sufixo: 'un.' },
  { chave: 'cotaMinima', rotulo: 'Valor mínimo de cada cota', sufixo: 'R$' },
]

const dataBr = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')

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

function trimestreAtual(): { ano: number; trimestre: number } {
  const agora = new Date(Date.now() - 3 * 3600 * 1000)
  return { ano: agora.getUTCFullYear(), trimestre: Math.floor(agora.getUTCMonth() / 3) + 1 }
}

// "1.234,56" ou "1234.56" -> 1234.56 (null se vazio ou inválido)
function lerNumero(texto: string): number | null {
  const t = texto.trim()
  if (t === '') return null
  const limpo = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

const paraCampo = (n: number) => n.toFixed(2).replace('.', ',')

function Linha({ rotulo, valor, forte, negativo }: { rotulo: string; valor: string; forte?: boolean; negativo?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-md py-1 ${forte ? 'border-t border-outline-variant pt-sm font-semibold' : ''}`}>
      <span className="font-body-md text-body-md text-on-surface-variant">{rotulo}</span>
      <span className={`whitespace-nowrap font-body-md text-body-md ${negativo ? 'text-error' : 'text-on-surface'} ${forte ? 'font-bold' : ''}`}>{valor}</span>
    </div>
  )
}

export function ApuracaoIrpjPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const inicio = trimestreAtual()
  const [ano, setAno] = useState(inicio.ano)
  const [trimestre, setTrimestre] = useState(inicio.trimestre)
  const [dados, setDados] = useState<DadosIrpj | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Record<string, string>>({}) // texto em edição, por "mes|linha"
  const [salvando, setSalvando] = useState<string | null>(null)
  const [mostraParametros, setMostraParametros] = useState(false)
  const [formParametros, setFormParametros] = useState<Record<string, string>>({})
  const [formCfops, setFormCfops] = useState('')
  const [salvandoParametros, setSalvandoParametros] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [fechando, setFechando] = useState(false)
  const sequencia = useRef(0)

  const carregar = useCallback(
    async (silencioso = false) => {
      const minha = ++sequencia.current
      if (!silencioso) setCarregando(true)
      setErro(null)
      try {
        const { status, json } = await chamar('GET', `/api/impostometro?recurso=irpj&ano=${ano}&trimestre=${trimestre}`)
        if (minha !== sequencia.current) return
        if (status === 200) setDados(json as unknown as DadosIrpj)
        else setErro(String(json.erro ?? `Erro ${status} ao carregar a apuração.`))
      } catch {
        if (minha === sequencia.current) setErro('Não foi possível falar com o servidor.')
      }
      if (minha === sequencia.current) setCarregando(false)
    },
    [ano, trimestre]
  )

  useEffect(() => {
    setEdicao({})
    carregar()
  }, [carregar])

  useEffect(() => {
    if (!dados) return
    const f: Record<string, string> = {}
    for (const p of ROTULO_PARAMETRO) f[p.chave] = String(dados.parametros[p.chave]).replace('.', ',')
    setFormParametros(f)
    setFormCfops((dados.cfopsMercadoria ?? []).join(', '))
  }, [dados])

  const meses = MESES_DO_TRIMESTRE(trimestre)

  // Valor final de cada linha em cada mês: o digitado, se houver; senão o do sistema.
  const valores: ValoresMes[] = useMemo(() => {
    return meses.map((m) => {
      const v = zeraMes()
      for (const l of LINHAS) {
        const manual = dados?.manual?.[m]?.[l.chave]
        const auto = dados?.auto?.[m]?.[l.chave]
        v[l.chave] = manual ? manual.valor : (auto ?? 0)
      }
      return v
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, trimestre])

  const parametros = dados?.parametros ?? PARAMETROS_PADRAO
  const resultado = useMemo(() => calcularTrimestre(valores, parametros), [valores, parametros])

  async function salvarCelula(mes: number, chave: ChaveLinha) {
    const k = `${mes}|${chave}`
    const texto = edicao[k]
    if (texto === undefined) return
    const valor = lerNumero(texto)
    if (texto.trim() !== '' && valor === null) {
      push('error', 'Número inválido.')
      return
    }
    const atual = dados?.manual?.[mes]?.[chave]
    if (valor === null && !atual) {
      setEdicao((e) => {
        const { [k]: _descartado, ...resto } = e
        return resto
      })
      return
    }
    if (valor !== null && atual && Math.abs(atual.valor - valor) < 0.005) {
      setEdicao((e) => {
        const { [k]: _descartado, ...resto } = e
        return resto
      })
      return
    }
    setSalvando(k)
    const { status, json } = await chamar('POST', '/api/impostometro', { acao: 'lancamento', ano, mes, linha: chave, valor })
    setSalvando(null)
    if (status === 200) {
      setEdicao((e) => {
        const { [k]: _descartado, ...resto } = e
        return resto
      })
      carregar(true)
    } else {
      push('error', String(json.erro ?? 'Não foi possível salvar o valor.'))
    }
  }

  async function salvarParametros() {
    const corpo: Record<string, number> = {}
    for (const p of ROTULO_PARAMETRO) {
      const n = lerNumero(formParametros[p.chave] ?? '')
      if (n === null || n < 0) {
        push('error', `Valor inválido em "${p.rotulo}".`)
        return
      }
      corpo[p.chave] = n
    }
    if (!Number.isInteger(corpo.cotas) || corpo.cotas < 1 || corpo.cotas > 3) {
      push('error', 'O número de cotas deve ser 1, 2 ou 3.')
      return
    }
    setSalvandoParametros(true)
    const { status, json } = await chamar('POST', '/api/impostometro', { acao: 'parametros', ano, parametros: { ...corpo, cfopsMercadoria: formCfops } })
    setSalvandoParametros(false)
    if (status === 200) {
      push('success', `Parâmetros de ${ano} salvos.`)
      carregar(true)
    } else {
      push('error', String(json.erro ?? 'Não foi possível salvar os parâmetros.'))
    }
  }

  async function fecharTrimestre() {
    if (!dados) return
    if (!window.confirm(`Guardar uma foto do ${NOME_TRIMESTRE[trimestre - 1]} de ${ano} com os valores e o resultado de agora?`)) return
    setFechando(true)
    const { status, json } = await chamar('POST', '/api/impostometro', {
      acao: 'fechar',
      ano,
      trimestre,
      irpjDevido: resultado.irpj.devido,
      csllDevido: resultado.csll.devido,
      observacao: observacao.trim() || null,
      dados: { meses, valores, parametros, resultado },
    })
    setFechando(false)
    if (status === 200) {
      push('success', 'Trimestre guardado no histórico.')
      setObservacao('')
      carregar(true)
    } else {
      push('error', String(json.erro ?? 'Não foi possível guardar o fechamento.'))
    }
  }

  function exportarExcel() {
    if (!dados) return
    const cab = (v: string): Celula => ({ v, s: 'cabecalho' })
    const moeda = (v: number): Celula => ({ v, s: 'moeda' })
    const moedaN = (v: number): Celula => ({ v, s: 'moedaNegrito' })
    const neg = (v: string): Celula => ({ v, s: 'negrito' })
    const titulo = `${NOME_TRIMESTRE[trimestre - 1]} de ${ano}`

    const irpj: Celula[][] = [
      [{ v: `Apuração de IRPJ — ${titulo} (Lucro Presumido)`, s: 'titulo' }],
      [],
      [cab('Linha'), ...meses.map((m) => cab(NOME_MES[m - 1])), cab('Trimestre')],
    ]
    const grupos: { id: 'receita' | 'outras' | 'deducoes'; nome: string }[] = [
      { id: 'receita', nome: 'Receita' },
      { id: 'outras', nome: 'Outras receitas' },
      { id: 'deducoes', nome: 'Deduções do imposto' },
    ]
    for (const g of grupos) {
      irpj.push([neg(g.nome)])
      for (const l of LINHAS.filter((x) => x.grupo === g.id)) {
        irpj.push([l.rotulo, ...valores.map((v) => moeda(v[l.chave])), moedaN(resultado.somas[l.chave])])
      }
      if (g.id === 'receita') irpj.push([neg('Receita total (mercadorias + serviços)'), ...resultado.receitaTotalMes.map(moedaN), moedaN(resultado.receitaTotal)])
    }
    irpj.push([])
    const quadro: [string, number][] = [
      ['Receita presumida do trimestre', resultado.receitaPresumida],
      ['Receita bruta de mercadorias (líquida)', resultado.receitaBrutaMercadorias],
      [`Parte da receita até o limite (${formatCurrency(parametros.limiteTrimestre)})`, resultado.dentroLimite],
      ['Parte da receita acima do limite', resultado.excedente],
      [`Mercadorias (${parametros.percMercIrpj}%)`, resultado.irpj.mercadorias],
      [`Mercadorias acima do limite (${parametros.percMercIrpjExcedente}%)`, resultado.irpj.mercadoriasExcedente],
      [`Serviços (${parametros.percServ}%)`, resultado.irpj.servicos],
      [`Serviços acima do limite (${parametros.percServExcedente}%)`, resultado.irpj.servicosExcedente],
      ['Outras receitas tributáveis', resultado.irpj.outrasReceitas],
      ['Base de cálculo do IRPJ', resultado.irpj.base],
      [`IRPJ ${parametros.aliquotaIrpj}%`, resultado.irpj.imposto15],
      [`Adicional ${parametros.adicionalAliquota}% (sobre o que passa de ${formatCurrency(parametros.adicionalLimite)})`, resultado.irpj.adicional],
      ['(−) Deduções (IRRF e outros)', resultado.irpj.deducoes],
    ]
    for (const [r, v] of quadro) irpj.push([r, moeda(v)])
    irpj.push([neg('IRPJ devido'), moedaN(resultado.irpj.devido)])
    if (resultado.irpj.saldoACompensar > 0) irpj.push(['Saldo de IRRF a compensar', moeda(resultado.irpj.saldoACompensar)])

    const csll: Celula[][] = [
      [{ v: `Apuração de CSLL — ${titulo} (Lucro Presumido)`, s: 'titulo' }],
      [],
      [cab('Item'), cab('Valor')],
      [`Mercadorias (${parametros.percMercCsll}%)`, moeda(resultado.csll.mercadorias)],
      [`Mercadorias acima do limite (${parametros.percMercCsllExcedente}%)`, moeda(resultado.csll.mercadoriasExcedente)],
      [`Serviços (${parametros.percServ}%)`, moeda(resultado.csll.servicos)],
      [`Serviços acima do limite (${parametros.percServExcedente}%)`, moeda(resultado.csll.servicosExcedente)],
      ['Outras receitas tributáveis', moeda(resultado.irpj.outrasReceitas)],
      [neg('Base de cálculo da CSLL'), moedaN(resultado.csll.base)],
      [`CSLL ${parametros.aliquotaCsll}%`, moeda(resultado.csll.devido)],
      [neg('CSLL devida'), moedaN(resultado.csll.devido)],
    ]

    const pagamento: Celula[][] = [
      [{ v: `Valores a pagar — ${titulo}`, s: 'titulo' }],
      [],
      [cab('Tributo'), cab('Valor')],
      ['IRPJ', moeda(resultado.irpj.devido)],
      ['CSLL', moeda(resultado.csll.devido)],
      [neg('Total a pagar'), moedaN(resultado.totalAPagar)],
      [],
      [cab('Cota'), cab('Vencimento'), cab('Valor')],
      ...resultado.cotas.map((c): Celula[] => [
        `${c.numero}ª cota`,
        { v: serialDaData(vencimentoDaCota(ano, trimestre, c.numero)), s: 'data' },
        moeda(c.valor),
      ]),
      [],
      ['As cotas seguintes à primeira levam juros pela Selic, que não estão incluídos aqui.'],
    ]

    const porFilial: Celula[][] = [
      [cab('Mês'), cab('Filial'), cab('Mercadorias'), cab('Serviços'), cab('Total')],
      ...dados.porFilial.map((f): Celula[] => [NOME_MES[f.mes - 1], f.filial, moeda(f.mercadorias), moeda(f.servicos), moeda(f.mercadorias + f.servicos)]),
    ]

    baixarXlsx(`apuracao_irpj_csll_${ano}_T${trimestre}.xlsx`, [
      { nome: 'IRPJ', linhas: irpj, larguras: [78, 16, 16, 16, 16] },
      { nome: 'CSLL', linhas: csll, larguras: [58, 18] },
      { nome: 'Pagamento', linhas: pagamento, larguras: [28, 16, 16] },
      { nome: 'Por filial', linhas: porFilial, larguras: [8, 34, 16, 16, 16], congelarLinhas: 1, filtroAutomatico: true },
      {
        nome: 'Conferência',
        linhas: [
          [cab('Situação'), cab('NF'), cab('Emissão'), cab('Cliente'), cab('Valor'), cab('Marcação no lançamento')],
          ...dados.divergencias.map((d): Celula[] => [
            'Contada pelo CFOP',
            d.numero,
            { v: serialDaData(d.data.slice(0, 10)), s: 'data' },
            d.cliente,
            moeda(d.valor),
            `${d.tipo}${d.afetaFaturamento ? '' : ' · não afeta faturamento'}`,
          ]),
          ...dados.duplicadas.flatMap((d): Celula[][] => [
            ['Possível duplicidade', d.a.numero, { v: serialDaData(d.a.data.slice(0, 10)), s: 'data' }, d.cliente, moeda(d.a.valor), ''],
            ['Possível duplicidade', d.b.numero, { v: serialDaData(d.b.data.slice(0, 10)), s: 'data' }, d.cliente, moeda(d.b.valor), ''],
          ]),
        ],
        larguras: [24, 12, 12, 44, 16, 36],
        congelarLinhas: 1,
        filtroAutomatico: true,
      },
    ])
    push('success', 'Planilha gerada.')
  }

  const hoje = trimestreAtual()
  const proximoBloqueado = ano > hoje.ano || (ano === hoje.ano && trimestre >= hoje.trimestre)

  function deslocar(delta: number) {
    let t = trimestre + delta
    let a = ano
    if (t < 1) {
      t = 4
      a -= 1
    } else if (t > 4) {
      t = 1
      a += 1
    }
    setAno(a)
    setTrimestre(t)
  }

  return (
    <AppShell title="Apuração de IRPJ e CSLL" navItems={navFiscal(profile)} onRefresh={() => carregar()}>
      <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-xs">
          <button type="button" onClick={() => deslocar(-1)} aria-label="Trimestre anterior" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <p className="min-w-[200px] text-center font-title-md text-title-md text-on-surface">
            {NOME_TRIMESTRE[trimestre - 1]} de {ano}
          </p>
          <button type="button" onClick={() => deslocar(1)} disabled={proximoBloqueado} aria-label="Próximo trimestre" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high disabled:opacity-40">
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" onClick={exportarExcel} disabled={!dados} className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50">
            <span className="material-symbols-outlined text-[18px]">download</span>
            Exportar para Excel
          </button>
          <button type="button" onClick={() => setMostraParametros((v) => !v)} className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-[18px]">tune</span>
            Parâmetros de {ano}
          </button>
          <span className="rounded-full bg-primary/10 px-md py-xs font-label-md text-label-md text-primary">Lucro Presumido</span>
        </div>
      </div>

      {erro && <div className="mb-md rounded-xl border border-error/40 bg-error/10 p-md font-body-md text-body-md text-error">{erro}</div>}

      {dados?.parametrosPadrao && (
        <div className="mb-md rounded-xl border border-outline-variant bg-surface-container-low p-md font-body-md text-body-md text-on-surface-variant">
          Os parâmetros de {ano} ainda não foram salvos: a tela usa os valores padrão (limite de R$ 1,25 milhão por trimestre, presunção de 8% / 32% e alíquotas de 15%, 10% e 9%). Confira em “Parâmetros de {ano}”.
        </div>
      )}
      {dados && dados.pendentes > 0 && (
        <div className="mb-md rounded-xl border border-outline-variant bg-surface-container-low p-md font-body-md text-body-md text-on-surface-variant">
          Ainda há {dados.pendentes} nota{dados.pendentes === 1 ? '' : 's'} com XML por ler; IPI e devoluções podem mudar nos próximos instantes. Atualize a tela em alguns segundos.
        </div>
      )}

      {mostraParametros && (
        <div className="mb-lg rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
          <h3 className="mb-sm font-title-md text-title-md text-on-surface">Parâmetros de {ano}</h3>
          <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 lg:grid-cols-3">
            {ROTULO_PARAMETRO.map((p) => (
              <label key={p.chave} className="block">
                <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                  {p.rotulo} ({p.sufixo})
                </span>
                <input
                  inputMode="decimal"
                  value={formParametros[p.chave] ?? ''}
                  onChange={(e) => setFormParametros((f) => ({ ...f, [p.chave]: e.target.value }))}
                  className={`${CAMPO} w-full`}
                />
              </label>
            ))}
          </div>
          <label className="mt-sm block">
            <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">CFOPs de venda que formam a receita de mercadorias (separe por vírgula)</span>
            <input value={formCfops} onChange={(e) => setFormCfops(e.target.value)} placeholder="5102, 6102, 5108, 6108, 5403, 5405" className={`${CAMPO} w-full`} />
            <span className="mt-xs block font-label-md text-[11px] text-on-surface-variant">
              Vale o CFOP dos itens do XML, independente do tipo ou do "afeta faturamento" marcados na entrada da nota. Notas ainda sem XML lido seguem o tipo e o "afeta faturamento".
            </span>
          </label>
          <div className="mt-md flex justify-end">
            <button type="button" onClick={salvarParametros} disabled={salvandoParametros} className="rounded-full bg-primary px-lg py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50">
              {salvandoParametros ? 'Salvando…' : 'Salvar parâmetros'}
            </button>
          </div>
        </div>
      )}

      {carregando && !dados ? (
        <div className="space-y-sm">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {/* Cartões de resultado */}
          <div className="mb-lg grid grid-cols-1 gap-md md:grid-cols-3">
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
              <p className="font-label-md text-label-md text-on-surface-variant">IRPJ devido</p>
              <p className="font-display text-[28px] font-bold leading-tight text-on-surface">{formatCurrency(resultado.irpj.devido)}</p>
              <p className="mt-xs font-label-md text-[11px] text-on-surface-variant">Base {formatCurrency(resultado.irpj.base)} · adicional {formatCurrency(resultado.irpj.adicional)}</p>
            </div>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
              <p className="font-label-md text-label-md text-on-surface-variant">CSLL devida</p>
              <p className="font-display text-[28px] font-bold leading-tight text-on-surface">{formatCurrency(resultado.csll.devido)}</p>
              <p className="mt-xs font-label-md text-[11px] text-on-surface-variant">Base {formatCurrency(resultado.csll.base)}</p>
            </div>
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
              <p className="font-label-md text-label-md text-on-surface-variant">Total a pagar no trimestre</p>
              <p className="font-display text-[28px] font-bold leading-tight text-error">{formatCurrency(resultado.totalAPagar)}</p>
              <p className="mt-xs font-label-md text-[11px] text-on-surface-variant">
                Receita presumida {formatCurrency(resultado.receitaPresumida)}
                {resultado.excedente > 0 && ` · ${formatCurrency(resultado.excedente)} acima do limite`}
              </p>
            </div>
          </div>

          {/* Entradas por mês */}
          <div className="mb-lg overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="bg-surface-container-low text-left">
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Linha</th>
                  {meses.map((m) => (
                    <th key={m} className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">
                      {NOME_MES[m - 1]}
                    </th>
                  ))}
                  <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Trimestre</th>
                </tr>
              </thead>
              <tbody>
                {(['receita', 'outras', 'deducoes'] as const).map((grupo) => (
                  <GrupoLinhas
                    key={grupo}
                    grupo={grupo}
                    meses={meses}
                    dados={dados}
                    valores={valores}
                    somas={resultado.somas}
                    edicao={edicao}
                    setEdicao={setEdicao}
                    salvando={salvando}
                    onSalvar={salvarCelula}
                    receitaTotalMes={resultado.receitaTotalMes}
                    receitaTotal={resultado.receitaTotal}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mb-lg font-label-md text-[11px] text-on-surface-variant">
            Valores em azul vêm do sistema; os destacados em amarelo foram digitados por você e prevalecem. Para voltar ao valor do sistema, apague o campo e saia dele.
          </p>

          <div className="mb-lg grid grid-cols-1 gap-md lg:grid-cols-2">
            {/* Cálculo do IRPJ */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
              <h3 className="mb-sm font-title-md text-title-md text-on-surface">Cálculo do IRPJ</h3>
              <Linha rotulo="Receita presumida" valor={formatCurrency(resultado.receitaPresumida)} />
              <Linha rotulo={`Até o limite de ${formatCurrency(parametros.limiteTrimestre)}`} valor={formatCurrency(resultado.dentroLimite)} />
              <Linha rotulo="Acima do limite" valor={formatCurrency(resultado.excedente)} />
              <Linha rotulo={`Mercadorias (${parametros.percMercIrpj}%)`} valor={formatCurrency(resultado.irpj.mercadorias)} />
              <Linha rotulo={`Mercadorias acima do limite (${parametros.percMercIrpjExcedente}%)`} valor={formatCurrency(resultado.irpj.mercadoriasExcedente)} />
              <Linha rotulo={`Serviços (${parametros.percServ}%)`} valor={formatCurrency(resultado.irpj.servicos)} />
              <Linha rotulo={`Serviços acima do limite (${parametros.percServExcedente}%)`} valor={formatCurrency(resultado.irpj.servicosExcedente)} />
              <Linha rotulo="Outras receitas tributáveis" valor={formatCurrency(resultado.irpj.outrasReceitas)} />
              <Linha rotulo="Base de cálculo" valor={formatCurrency(resultado.irpj.base)} forte />
              <Linha rotulo={`IRPJ ${parametros.aliquotaIrpj}%`} valor={formatCurrency(resultado.irpj.imposto15)} />
              <Linha rotulo={`Adicional ${parametros.adicionalAliquota}% (acima de ${formatCurrency(parametros.adicionalLimite)})`} valor={formatCurrency(resultado.irpj.adicional)} />
              <Linha rotulo="(−) IRRF e outras deduções" valor={formatCurrency(resultado.irpj.deducoes)} />
              <Linha rotulo="IRPJ devido" valor={formatCurrency(resultado.irpj.devido)} forte />
              {resultado.irpj.saldoACompensar > 0 && <Linha rotulo="Saldo de IRRF a compensar" valor={formatCurrency(resultado.irpj.saldoACompensar)} />}
            </div>

            {/* Cálculo da CSLL + cotas */}
            <div className="space-y-md">
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <h3 className="mb-sm font-title-md text-title-md text-on-surface">Cálculo da CSLL</h3>
                <Linha rotulo={`Mercadorias (${parametros.percMercCsll}%)`} valor={formatCurrency(resultado.csll.mercadorias)} />
                <Linha rotulo={`Mercadorias acima do limite (${parametros.percMercCsllExcedente}%)`} valor={formatCurrency(resultado.csll.mercadoriasExcedente)} />
                <Linha rotulo={`Serviços (${parametros.percServ}%)`} valor={formatCurrency(resultado.csll.servicos)} />
                <Linha rotulo={`Serviços acima do limite (${parametros.percServExcedente}%)`} valor={formatCurrency(resultado.csll.servicosExcedente)} />
                <Linha rotulo="Outras receitas tributáveis" valor={formatCurrency(resultado.irpj.outrasReceitas)} />
                <Linha rotulo="Base de cálculo" valor={formatCurrency(resultado.csll.base)} forte />
                <Linha rotulo={`CSLL devida (${parametros.aliquotaCsll}%)`} valor={formatCurrency(resultado.csll.devido)} forte />
              </div>

              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <h3 className="mb-sm font-title-md text-title-md text-on-surface">Pagamento em cotas</h3>
                {resultado.cotas.length === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">Sem imposto a pagar neste trimestre.</p>
                ) : (
                  <>
                    {resultado.cotas.map((c) => (
                      <Linha key={c.numero} rotulo={`${c.numero}ª cota — vence em ${dataBr(vencimentoDaCota(ano, trimestre, c.numero))}`} valor={formatCurrency(c.valor)} />
                    ))}
                    <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">
                      Até {parametros.cotas} cotas de no mínimo {formatCurrency(parametros.cotaMinima)}. A 1ª vence no último dia útil do mês seguinte ao trimestre; as demais levam juros pela Selic (não calculados aqui). Datas consideram só fins de semana e feriados nacionais.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Conferência das notas contadas pelo CFOP */}
          {dados && (dados.divergencias.length > 0 || dados.duplicadas.length > 0 || dados.semXml.total > 0) && (
            <div className="mb-lg rounded-xl border border-amber-300 bg-amber-50 p-lg shadow-level2">
              <h3 className="mb-xs font-title-md text-title-md text-amber-900">Conferência das notas do trimestre</h3>
              <p className="mb-sm font-body-md text-body-md text-amber-900">
                A receita de mercadorias segue o CFOP do XML. Estas notas merecem uma olhada do faturamento ou da contabilidade.
              </p>
              {dados.duplicadas.length > 0 && (
                <div className="mb-md">
                  <p className="mb-xs font-label-md text-label-md font-semibold text-amber-900">Possíveis notas em duplicidade ({dados.duplicadas.length})</p>
                  <p className="mb-xs font-label-md text-[11px] text-amber-900">Mesmo cliente e valor com diferença de até R$ 1,00 no mês. Se uma delas foi refeita, cancele a original no sistema para não contar duas vezes.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse">
                      <tbody>
                        {dados.duplicadas.map((d, i) => (
                          <tr key={i} className="border-t border-amber-200">
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface">{d.cliente}</td>
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface">NF {d.a.numero} · {dataBr(d.a.data)} · {formatCurrency(d.a.valor)}</td>
                            <td className="py-xs font-body-md text-body-md text-on-surface">NF {d.b.numero} · {dataBr(d.b.data)} · {formatCurrency(d.b.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {dados.divergencias.length > 0 && (
                <div className="mb-md">
                  <p className="mb-xs font-label-md text-label-md font-semibold text-amber-900">
                    Contadas pelo CFOP, mas marcadas de outro jeito no lançamento ({dados.divergencias.length}) · {formatCurrency(dados.divergencias.reduce((a, d) => a + d.valor, 0))}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <tbody>
                        {dados.divergencias.map((d, i) => (
                          <tr key={i} className="border-t border-amber-200">
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface">NF {d.numero}</td>
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface">{dataBr(d.data)}</td>
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface">{d.cliente}</td>
                            <td className="py-xs pr-md font-body-md text-body-md text-on-surface-variant">
                              {d.tipo}
                              {!d.afetaFaturamento ? ' · não afeta faturamento' : ''}
                            </td>
                            <td className="py-xs text-right font-body-md text-body-md text-on-surface">{formatCurrency(d.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {dados.semXml.total > 0 && (
                <p className="font-body-md text-body-md text-amber-900">
                  {dados.semXml.total} nota{dados.semXml.total === 1 ? '' : 's'} ({formatCurrency(dados.semXml.valor)}) sem XML lido {dados.semXml.total === 1 ? 'foi contada' : 'foram contadas'} pelo tipo e pelo "afeta faturamento" do lançamento, porque o CFOP não está disponível.
                </p>
              )}
            </div>
          )}

          {/* Por filial */}
          {dados && dados.porFilial.length > 0 && (
            <div className="mb-lg overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="px-lg pt-md">
                <h3 className="font-title-md text-title-md text-on-surface">Receita por filial (do sistema)</h3>
              </div>
              <table className="mt-sm w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-left">
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Mês</th>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Filial</th>
                    <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Mercadorias</th>
                    <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Serviços</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porFilial.map((f) => (
                    <tr key={`${f.mes}|${f.filial}`} className="border-t border-outline-variant">
                      <td className="px-md py-xs font-body-md text-body-md text-on-surface">{NOME_MES[f.mes - 1]}</td>
                      <td className="px-md py-xs font-body-md text-body-md text-on-surface">{f.filial}</td>
                      <td className="px-md py-xs text-right font-body-md text-body-md text-on-surface">{formatCurrency(f.mercadorias)}</td>
                      <td className="px-md py-xs text-right font-body-md text-body-md text-on-surface">{formatCurrency(f.servicos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Fechamento */}
          <div className="mb-lg rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
            <h3 className="mb-xs font-title-md text-title-md text-on-surface">Fechar o trimestre</h3>
            <p className="mb-sm font-body-md text-body-md text-on-surface-variant">
              Guarda uma foto dos valores e do resultado de agora, para consultar depois mesmo que as notas ou os parâmetros mudem. Pode ser feita mais de uma vez.
            </p>
            <div className="flex flex-wrap items-end gap-sm">
              <label className="block min-w-[260px] flex-1">
                <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Observação (opcional)</span>
                <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} className={`${CAMPO} w-full`} />
              </label>
              <button type="button" onClick={fecharTrimestre} disabled={fechando || !dados} className="rounded-full bg-primary px-lg py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50">
                {fechando ? 'Guardando…' : 'Guardar fechamento'}
              </button>
            </div>
            {dados && dados.fechamentos.length > 0 && (
              <div className="mt-md overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse">
                  <thead>
                    <tr className="text-left">
                      <th className="py-xs font-label-md text-label-md text-on-surface-variant">Guardado em</th>
                      <th className="py-xs font-label-md text-label-md text-on-surface-variant">Por</th>
                      <th className="py-xs text-right font-label-md text-label-md text-on-surface-variant">IRPJ</th>
                      <th className="py-xs text-right font-label-md text-label-md text-on-surface-variant">CSLL</th>
                      <th className="py-xs pl-md font-label-md text-label-md text-on-surface-variant">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.fechamentos.map((f) => (
                      <tr key={f.id} className="border-t border-outline-variant">
                        <td className="py-xs font-body-md text-body-md text-on-surface">{new Date(f.fechadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="py-xs font-body-md text-body-md text-on-surface">{f.fechadoPor ?? '—'}</td>
                        <td className="py-xs text-right font-body-md text-body-md text-on-surface">{f.irpjDevido === null ? '—' : formatCurrency(f.irpjDevido)}</td>
                        <td className="py-xs text-right font-body-md text-body-md text-on-surface">{f.csllDevido === null ? '—' : formatCurrency(f.csllDevido)}</td>
                        <td className="py-xs pl-md font-body-md text-body-md text-on-surface-variant">{f.observacao ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}

interface GrupoProps {
  grupo: 'receita' | 'outras' | 'deducoes'
  meses: number[]
  dados: DadosIrpj | null
  valores: ValoresMes[]
  somas: ValoresMes
  edicao: Record<string, string>
  setEdicao: React.Dispatch<React.SetStateAction<Record<string, string>>>
  salvando: string | null
  onSalvar: (mes: number, chave: ChaveLinha) => void
  receitaTotalMes: number[]
  receitaTotal: number
}

const NOME_GRUPO = { receita: 'Receita', outras: 'Outras receitas', deducoes: 'Deduções do imposto' }

function GrupoLinhas({ grupo, meses, dados, valores, somas, edicao, setEdicao, salvando, onSalvar, receitaTotalMes, receitaTotal }: GrupoProps) {
  return (
    <>
      <tr className="bg-surface-container-low/60">
        <td colSpan={meses.length + 2} className="px-md py-xs font-label-md text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">
          {NOME_GRUPO[grupo]}
        </td>
      </tr>
      {LINHAS.filter((l) => l.grupo === grupo).map((l) => (
        <tr key={l.chave} className="border-t border-outline-variant">
          <td className="px-md py-xs font-body-md text-body-md text-on-surface" title={l.ajuda}>
            {l.rotulo}
            {l.auto && <span className="ml-xs rounded-full bg-primary/10 px-xs font-label-md text-[10px] text-primary">sistema</span>}
          </td>
          {meses.map((m, i) => {
            const k = `${m}|${l.chave}`
            const manual = dados?.manual?.[m]?.[l.chave]
            const emEdicao = edicao[k]
            const valor = emEdicao !== undefined ? emEdicao : valores[i][l.chave] === 0 && !manual ? '' : paraCampo(valores[i][l.chave])
            return (
              <td key={m} className="px-sm py-1 text-right">
                <input
                  inputMode="decimal"
                  value={valor}
                  placeholder="0,00"
                  disabled={!dados || salvando === k}
                  title={manual ? 'Valor digitado (prevalece sobre o do sistema)' : l.auto ? 'Valor do sistema — digite para substituir' : 'Digite o valor'}
                  onChange={(e) => setEdicao((ed) => ({ ...ed, [k]: e.target.value }))}
                  onBlur={() => onSalvar(m, l.chave)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  className={`w-32 rounded-lg border px-sm py-1 text-right font-body-md text-body-md focus:border-primary focus:outline-none ${
                    manual ? 'border-amber-400 bg-amber-50 text-on-surface' : l.auto ? 'border-outline-variant bg-surface text-primary' : 'border-outline-variant bg-surface text-on-surface'
                  }`}
                />
              </td>
            )
          })}
          <td className="px-md py-xs text-right font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(somas[l.chave])}</td>
        </tr>
      ))}
      {grupo === 'receita' && (
        <tr className="border-t border-outline-variant bg-surface-container-low/40">
          <td className="px-md py-xs font-body-md font-semibold text-body-md text-on-surface">Receita total (mercadorias + serviços)</td>
          {receitaTotalMes.map((v, i) => (
            <td key={meses[i]} className="px-md py-xs text-right font-body-md font-semibold text-body-md text-on-surface">
              {formatCurrency(v)}
            </td>
          ))}
          <td className="px-md py-xs text-right font-body-md font-bold text-body-md text-on-surface">{formatCurrency(receitaTotal)}</td>
        </tr>
      )}
    </>
  )
}
