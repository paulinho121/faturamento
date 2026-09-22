import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { KpiCard } from '../../components/kpi/KpiCard'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { nomeArquivoSeguro } from '../../lib/storage'
import { parseTitulosXml, TitulosParseError } from '../../lib/titulosParser'
import { getModuleSwitcherItems } from '../../lib/modules'
import { useLookups } from '../../hooks/useLookups'
import { MeioPagamentoInlineEdit } from '../../components/invoices/MeioPagamentoInlineEdit'
import { DemonstrativoModal } from '../../components/financeiro/DemonstrativoModal'
import { financeiroNavItems } from './nav'
import type { Boleto, Invoice, Pedido } from '../../types/domain'

type Aba = 'todos' | 'pendentes' | 'vencidos' | 'pagos'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

function ontem(): string {
  const d = new Date(`${hoje()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function diasAtraso(vencimento: string): number {
  const venc = new Date(`${vencimento}T00:00:00Z`).getTime()
  const agora = new Date(`${hoje()}T00:00:00Z`).getTime()
  return Math.round((agora - venc) / 86_400_000)
}

// "pago" tem valor_pago == valor + juros (garantido no registro do pagamento
// e no backfill da migration) — saldo em aberto é sempre
// (valor + juros) - valor_pago, pra juros de atraso continuarem contando.
function saldoPendente(boleto: Boleto): number {
  if (boleto.status === 'pago') return 0
  return Number(boleto.valor) + Number(boleto.juros ?? 0) - Number(boleto.valor_pago ?? 0)
}

// Aplica um valor já pago em sequência às parcelas sendo cadastradas: quita a
// primeira por completo, sobra vira pagamento parcial da próxima, e assim por
// diante — cobre tanto "pagou menos" (fica saldo a descoberto) quanto "pagou
// mais" (abate na parcela seguinte) sem precisar de tela separada pra isso.
function distribuirPagamento(
  valores: number[],
  valorPago: number
): { status: 'pendente' | 'pago' | 'parcial'; valor_pago: number }[] {
  let restante = Math.max(valorPago, 0)
  return valores.map((valor) => {
    if (restante <= 0) return { status: 'pendente', valor_pago: 0 }
    if (restante >= valor) {
      restante -= valor
      return { status: 'pago', valor_pago: valor }
    }
    const pago = restante
    restante = 0
    return { status: 'parcial', valor_pago: pago }
  })
}

function situacao(boleto: Boleto): { texto: string; classe: string; diasAtraso: number | null } {
  if (boleto.status === 'pago') return { texto: 'Pago', classe: 'bg-tertiary/10 text-tertiary', diasAtraso: null }
  if (boleto.vencimento < hoje()) {
    return { texto: 'Vencido', classe: 'bg-error/10 text-error', diasAtraso: diasAtraso(boleto.vencimento) }
  }
  if (boleto.status === 'parcial') {
    return {
      texto: `Parcial · saldo ${formatCurrency(saldoPendente(boleto))}`,
      classe: 'bg-blue-100 text-blue-700',
      diasAtraso: null,
    }
  }
  return { texto: 'A pagar', classe: 'bg-amber-100 text-amber-700', diasAtraso: null }
}

// Só notas pagas via Boleto precisam de um título vinculado — as demais
// formas de pagamento (PIX, Cartão Rede, Pagarme…) precisam é de um
// comprovante anexado provando que o pagamento aconteceu.
function precisaDeBoleto(meioPagamento: string | null | undefined): boolean {
  return (meioPagamento?.trim().toUpperCase() ?? '') === 'BOLETO'
}

function combinaComBusca(busca: string, ...campos: (string | null | undefined)[]): boolean {
  const alvo = busca.trim().toLowerCase()
  if (!alvo) return true
  return campos.some((campo) => campo?.toLowerCase().includes(alvo))
}

interface GrupoCliente {
  cliente: string
  vendedorNome: string | null
  total: number
  itens: Boleto[]
}

// Quem cobra pensa em "o cliente X me deve R$ Y" e não em títulos soltos —
// agrupar por cliente (maior dívida primeiro) deixa a tela de cobrança
// direto ao ponto.
function agruparPorCliente(lista: Boleto[]): GrupoCliente[] {
  const grupos = new Map<string, GrupoCliente>()
  for (const boleto of lista) {
    const cliente = boleto.invoices?.cliente ?? boleto.cliente_nome_importado ?? 'Cliente não identificado'
    if (!grupos.has(cliente)) {
      grupos.set(cliente, { cliente, vendedorNome: boleto.invoices?.vendedores?.nome ?? null, total: 0, itens: [] })
    }
    const grupo = grupos.get(cliente)!
    grupo.total += saldoPendente(boleto)
    grupo.itens.push(boleto)
  }
  return Array.from(grupos.values()).sort((a, b) => b.total - a.total)
}

interface GrupoNota {
  key: string
  numeroNf: string | null
  cliente: string
  vendedorNome: string | null
  total: number
  itens: Boleto[]
}

// A tela mostrava um título solto por linha (a mesma NF repetida várias
// vezes quando tinha mais de uma parcela) — o usuário pediu pra ver a nota
// como uma linha só, entrando nela pra ver os títulos/parcelas.
function agruparPorNota(lista: Boleto[]): GrupoNota[] {
  const grupos = new Map<string, GrupoNota>()
  for (const boleto of lista) {
    const key = boleto.invoice_id ?? `solto-${boleto.id}`
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        numeroNf: boleto.invoices?.numero_nf ?? null,
        cliente: boleto.invoices?.cliente ?? boleto.cliente_nome_importado ?? 'Cliente não identificado',
        vendedorNome: boleto.invoices?.vendedores?.nome ?? null,
        total: 0,
        itens: [],
      })
    }
    const grupo = grupos.get(key)!
    grupo.total += Number(boleto.valor)
    grupo.itens.push(boleto)
  }
  return Array.from(grupos.values())
}

function resumoGrupo(itens: Boleto[]): { texto: string; classe: string } {
  const vencidosItens = itens.filter((b) => b.status !== 'pago' && b.vencimento < hoje())
  if (vencidosItens.length > 0) {
    const piorAtraso = Math.max(...vencidosItens.map((b) => diasAtraso(b.vencimento)))
    return { texto: `Vencido há ${piorAtraso}d`, classe: 'bg-error/10 text-error' }
  }
  if (itens.some((b) => b.status === 'parcial')) return { texto: 'Parcial', classe: 'bg-blue-100 text-blue-700' }
  if (itens.some((b) => b.status === 'pendente')) return { texto: 'A pagar', classe: 'bg-amber-100 text-amber-700' }
  return { texto: 'Pago', classe: 'bg-tertiary/10 text-tertiary' }
}

type FaixaAtraso = '0-30' | '31-60' | '61-90' | '90+'
// Data que a pessoa quer ver antes de abrir a nota: o vencimento do título
// (ou, com vários, o próximo ainda em aberto — o mais atrasado se já venceu).
function vencimentoDoGrupo(itens: Boleto[]): string {
  const ordenados = [...itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  if (ordenados.length === 1) return `Vencimento ${formatDate(ordenados[0].vencimento)}`
  const emAberto = ordenados.filter((b) => b.status !== 'pago')
  if (emAberto.length > 0) return `Próx. vencimento ${formatDate(emAberto[0].vencimento)}`
  return `Último vencimento ${formatDate(ordenados[ordenados.length - 1].vencimento)}`
}

const FAIXAS: { chave: FaixaAtraso; label: string }[] = [
  { chave: '0-30', label: '0-30 dias' },
  { chave: '31-60', label: '31-60 dias' },
  { chave: '61-90', label: '61-90 dias' },
  { chave: '90+', label: '90+ dias' },
]

function faixaDe(dias: number): FaixaAtraso {
  if (dias <= 30) return '0-30'
  if (dias <= 60) return '31-60'
  if (dias <= 90) return '61-90'
  return '90+'
}

function BoletoRow({
  boleto,
  onRegistrarPagamento,
  onDownload,
  onAttach,
  onDelete,
}: {
  boleto: Boleto
  onRegistrarPagamento: (boleto: Boleto, novoValorPago: number, novoJuros: number, dataPagamento: string) => void
  onDownload: (boleto: Boleto) => void
  onAttach: (boleto: Boleto) => void
  onDelete: (boleto: Boleto) => void
}) {
  const { texto, classe, diasAtraso: atraso } = situacao(boleto)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false)
  const [valorPagoInput, setValorPagoInput] = useState('')
  const [jurosParaRegistro, setJurosParaRegistro] = useState(0)
  const [dataPagamentoParaRegistro, setDataPagamentoParaRegistro] = useState(hoje())
  const [perguntandoJuros, setPerguntandoJuros] = useState(false)
  const [informandoJuros, setInformandoJuros] = useState(false)
  const [jurosInput, setJurosInput] = useState('')
  const [dataPagamentoInput, setDataPagamentoInput] = useState(hoje())

  function iniciarRegistroPagamento() {
    setConfirmandoExclusao(false)
    // Título vencido pode ter juros/multa cobrado no pagamento — pergunta
    // antes de abrir o formulário de valor pra não deixar isso passar batido,
    // e já aproveita pra pedir a data em que o pagamento entrou.
    if (atraso !== null) {
      setJurosInput(boleto.juros ? formatCurrency(boleto.juros).replace('R$', '').trim() : '')
      setDataPagamentoInput(boleto.data_pagamento ?? hoje())
      setInformandoJuros(false)
      setPerguntandoJuros(true)
      return
    }
    abrirFormularioPagamento(boleto.juros ?? 0, boleto.data_pagamento ?? hoje())
  }

  function abrirFormularioPagamento(juros: number, dataPagamento: string) {
    // Pré-preenche com o valor total (+ juros) — confirmar sem editar
    // equivale ao antigo "marcar como pago" de um clique; editar pra baixo
    // registra pagamento parcial.
    setValorPagoInput(formatCurrency(Number(boleto.valor) + juros).replace('R$', '').trim())
    setJurosParaRegistro(juros)
    setDataPagamentoParaRegistro(dataPagamento)
    setRegistrandoPagamento(true)
  }

  function confirmarJuros(juros: number) {
    setPerguntandoJuros(false)
    abrirFormularioPagamento(Math.max(juros, 0), dataPagamentoInput)
  }

  function confirmarPagamento() {
    const novoValorPago = Number(valorPagoInput.replace(/\./g, '').replace(',', '.'))
    if (Number.isNaN(novoValorPago) || novoValorPago < 0) return
    onRegistrarPagamento(boleto, novoValorPago, jurosParaRegistro, dataPagamentoParaRegistro)
    setRegistrandoPagamento(false)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-sm p-lg">
      <div className="min-w-0">
        <p className="font-body-md text-body-md text-on-surface">
          {boleto.invoices ? (
            <>NF #{boleto.invoices.numero_nf} · {boleto.invoices.cliente}</>
          ) : (
            <span className="text-on-surface-variant" title="Não vinculado a nenhuma nota lançada">
              {boleto.cliente_nome_importado ?? '—'} (sem NF vinculada)
            </span>
          )}
          {' · '}Parcela {boleto.numero_parcela} · {formatCurrency(boleto.valor)}
          {boleto.juros > 0 && (
            <span className="text-on-surface-variant"> + juros {formatCurrency(boleto.juros)}</span>
          )}
          {boleto.status === 'parcial' && (
            <span className="text-on-surface-variant"> (pago {formatCurrency(boleto.valor_pago)})</span>
          )}
        </p>
        <p className="font-label-md text-label-md text-on-surface-variant">
          Vencimento {formatDate(boleto.vencimento)}
          {boleto.status !== 'pendente' && boleto.data_pagamento && (
            <> · Pago em {formatDate(boleto.data_pagamento)}</>
          )}
          {boleto.carteira ? ` · ${boleto.carteira}` : ''}
          {boleto.invoices?.vendedores?.nome && (
            <>
              {' · '}
              <span className={texto === 'Vencido' ? 'font-medium text-error' : undefined}>
                Vendedor: {boleto.invoices.vendedores.nome}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap shrink-0 items-center justify-end gap-xs">
        {registrandoPagamento ? (
          <span className="inline-flex items-center gap-xs" onClick={(e) => e.stopPropagation()}>
            <span className="font-label-md text-label-md text-on-surface-variant">Pago R$</span>
            <input
              autoFocus
              inputMode="decimal"
              value={valorPagoInput}
              onChange={(e) => setValorPagoInput(e.target.value)}
              className="w-24 rounded border border-outline-variant bg-surface-container-lowest px-xs py-0.5 text-right font-body-md text-body-md text-on-surface outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={confirmarPagamento}
              title="Confirmar pagamento"
              className="flex h-8 w-8 items-center justify-center rounded-full text-tertiary hover:bg-tertiary/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">check</span>
            </button>
            <button
              type="button"
              onClick={() => setRegistrandoPagamento(false)}
              title="Cancelar"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={iniciarRegistroPagamento}
            title="Clique para registrar pagamento (total ou parcial)"
            className={`rounded-full px-sm py-0.5 font-label-md text-label-md transition-opacity hover:opacity-80 ${classe}`}
          >
            {atraso !== null ? `Vencido há ${atraso}d` : texto}
          </button>
        )}
        {perguntandoJuros && (
          <Modal onClose={() => setPerguntandoJuros(false)} maxWidthClassName="max-w-sm">
            <div className="space-y-md p-lg">
              <div>
                <h3 className="font-title-md text-title-md text-on-surface">Título vencido há {atraso}d</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  Houve cobrança de juros ou multa nesse pagamento?
                </p>
              </div>
              <label className="block">
                <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                  Data do pagamento
                </span>
                <input
                  type="date"
                  value={dataPagamentoInput}
                  onChange={(e) => setDataPagamentoInput(e.target.value)}
                  className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
                />
              </label>
              {informandoJuros ? (
                <>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                      Valor dos juros/multa (R$)
                    </span>
                    <input
                      autoFocus
                      inputMode="decimal"
                      placeholder="Ex.: 50,00"
                      value={jurosInput}
                      onChange={(e) => setJurosInput(e.target.value)}
                      className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
                    />
                  </label>
                  <div className="flex justify-end gap-sm">
                    <button
                      type="button"
                      onClick={() => setInformandoJuros(false)}
                      className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmarJuros(Number(jurosInput.replace(/\./g, '').replace(',', '.')) || 0)
                      }
                      className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:bg-primary/90"
                    >
                      Continuar
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex justify-end gap-sm">
                  <button
                    type="button"
                    onClick={() => confirmarJuros(boleto.juros ?? 0)}
                    className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => setInformandoJuros(true)}
                    className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:bg-primary/90"
                  >
                    Sim
                  </button>
                </div>
              )}
            </div>
          </Modal>
        )}
        {boleto.arquivo_path ? (
          <button
            type="button"
            onClick={() => onDownload(boleto)}
            title="Baixar boleto"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAttach(boleto)}
            disabled={!boleto.invoice_id}
            title={boleto.invoice_id ? 'Anexar PDF' : 'Vincule a uma nota antes de anexar'}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
          </button>
        )}
        {confirmandoExclusao ? (
          <>
            <span className="font-label-md text-label-md text-on-surface-variant">Excluir?</span>
            <button
              type="button"
              onClick={() => {
                onDelete(boleto)
                setConfirmandoExclusao(false)
              }}
              title="Confirmar exclusão"
              className="flex h-8 w-8 items-center justify-center rounded-full text-error hover:bg-error/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">check</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoExclusao(false)}
              title="Cancelar"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmandoExclusao(true)}
            title="Remover título"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        )}
      </div>
    </div>
  )
}

export function FinanceiroPage() {
  const { session, profile } = useAuth()
  // Só pra badge do item "Pedidos" no menu — a gestão em si mora na
  // própria página de Pedidos.
  const [pedidosParaAprovarCount, setPedidosParaAprovarCount] = useState(0)
  const { meiosPagamento } = useLookups()
  const { push } = useToast()
  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [boletos, setBoletos] = useState<Boleto[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('todos')
  const [busca, setBusca] = useState('')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showVencidosModal, setShowVencidosModal] = useState(false)
  const [faixaFiltro, setFaixaFiltro] = useState<FaixaAtraso | null>(null)
  const [dataReferenciaVencidos, setDataReferenciaVencidos] = useState(hoje())
  const [demonstrativoCliente, setDemonstrativoCliente] = useState<string | null>(null)
  const [notaAberta, setNotaAberta] = useState<string | null>(null)
  const [dataConciliacao, setDataConciliacao] = useState(ontem())

  // Notas dos últimos 90 dias, cruzadas com boletos/comprovantes já
  // registrados, pra saber quais ainda precisam de ação do financeiro.
  const [invoicesRecentes, setInvoicesRecentes] = useState<Invoice[]>([])
  const [loadingPendencias, setLoadingPendencias] = useState(true)
  const [enviandoComprovanteId, setEnviandoComprovanteId] = useState<string | null>(null)
  const comprovanteInputRef = useRef<HTMLInputElement>(null)

  // Anexar/trocar PDF numa linha existente
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)

  // Cadastro manual (sem import) — sempre vinculado a uma nota existente
  const manualFormRef = useRef<HTMLDivElement>(null)
  const [showManual, setShowManual] = useState(false)
  const [buscaNf, setBuscaNf] = useState('')
  const [notaEncontrada, setNotaEncontrada] = useState<Invoice | null>(null)
  const [buscandoNota, setBuscandoNota] = useState(false)
  const [manualParcela, setManualParcela] = useState(1)
  const [manualQtdParcelas, setManualQtdParcelas] = useState(1)
  const [manualParcelasDetalhe, setManualParcelasDetalhe] = useState<{ valor: string; vencimento: string }[]>([
    { valor: '', vencimento: '' },
  ])
  const [manualValorPago, setManualValorPago] = useState('')
  const [manualArquivo, setManualArquivo] = useState<File | null>(null)
  const [salvandoManual, setSalvandoManual] = useState(false)

  // Calcular parcelas automaticamente: valor total (+ entrada opcional) do
  // pedido vira o valor e o vencimento de cada parcela — cobre o caso de
  // locação/venda com N parcelas iguais mensais, como no controle da
  // planilha, sem precisar digitar cada linha na mão.
  const [mostrarCalculoAuto, setMostrarCalculoAuto] = useState(false)
  const [autoValorTotal, setAutoValorTotal] = useState('')
  const [autoQtdParcelas, setAutoQtdParcelas] = useState(1)
  const [autoComEntrada, setAutoComEntrada] = useState(false)
  const [autoEntradaValor, setAutoEntradaValor] = useState('')
  const [autoEntradaVencimento, setAutoEntradaVencimento] = useState('')
  const [autoVencimentoInicial, setAutoVencimentoInicial] = useState('')
  const [autoIntervaloMeses, setAutoIntervaloMeses] = useState(1)

  async function loadBoletos() {
    setLoading(true)
    const { data, error } = await supabase
      .from('boletos')
      .select('*, invoices(numero_nf, cliente, valor, tipo_operacao, clientes(cnpj_cpf), vendedores(nome))')
      .eq('excluido', false)
      .order('vencimento')
    if (!error) setBoletos((data as Boleto[]) ?? [])
    setLoading(false)
  }

  async function loadPendencias() {
    setLoadingPendencias(true)
    const desde = new Date()
    desde.setDate(desde.getDate() - 90)
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome)')
      .eq('excluida', false)
      .eq('afeta_faturamento', true)
      .neq('meio_pagamento', 'N/A')
      .gte('data_emissao', desde.toISOString().slice(0, 10))
      .order('data_emissao', { ascending: false })
    if (!error) setInvoicesRecentes((data as Invoice[]) ?? [])
    setLoadingPendencias(false)
  }

  async function loadPedidosParaAprovarCount() {
    const { count } = await supabase
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente')
      .eq('aprovado_financeiro', false)
    setPedidosParaAprovarCount(count ?? 0)
  }

  async function loadAll() {
    await Promise.all([loadBoletos(), loadPendencias(), loadPedidosParaAprovarCount()])
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Registrar título" numa pendência abre o formulário lá embaixo, no card
  // de importação — sem isso, o clique parecia não fazer nada.
  useEffect(() => {
    if (showManual) manualFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showManual])

  async function handleImportFile(file: File) {
    setImporting(true)
    try {
      const titulos = await parseTitulosXml(file)
      const numerosNf = Array.from(new Set(titulos.map((t) => t.numeroNf).filter((n): n is string => Boolean(n))))

      const { data: invoicesMatch } = await supabase
        .from('invoices')
        .select('id, numero_nf')
        .in('numero_nf', numerosNf.length > 0 ? numerosNf : ['—'])
        .eq('excluida', false)

      const invoiceByNf = new Map<string, string>()
      for (const inv of invoicesMatch ?? []) {
        if (!invoiceByNf.has(inv.numero_nf)) invoiceByNf.set(inv.numero_nf, inv.id)
      }

      const rows = titulos.map((t) => ({
        invoice_id: t.numeroNf ? (invoiceByNf.get(t.numeroNf) ?? null) : null,
        tipo: 'boleto' as const,
        numero_titulo: t.numeroTitulo,
        numero_parcela: t.numeroParcela,
        cliente_nome_importado: t.nomeCliente,
        carteira: t.carteira || null,
        valor: t.valor,
        vencimento: t.vencimento,
        status: t.pago ? 'pago' : 'pendente',
        created_by: session!.user.id,
      }))

      const { data, error } = await supabase
        .from('boletos')
        .upsert(rows, { onConflict: 'numero_titulo' })
        .select('id, invoice_id')

      if (error) {
        push('error', `Erro ao importar títulos: ${error.message}`)
        return
      }

      const vinculados = data?.filter((r) => r.invoice_id).length ?? 0
      push(
        'success',
        `${rows.length} título${rows.length === 1 ? '' : 's'} importado${rows.length === 1 ? '' : 's'} (${vinculados} vinculado${vinculados === 1 ? '' : 's'} a notas).`
      )
      loadAll()
    } catch (err) {
      push('error', err instanceof TitulosParseError ? err.message : 'Não foi possível ler este XML de títulos.')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRegistrarPagamento(
    boleto: Boleto,
    novoValorPagoInput: number,
    novoJurosInput: number,
    dataPagamento: string
  ) {
    const juros = Math.max(novoJurosInput, 0)
    const valorTotal = Number(boleto.valor) + juros
    const valorPago = Math.min(Math.max(novoValorPagoInput, 0), valorTotal)
    const novoStatus = valorPago <= 0 ? 'pendente' : valorPago >= valorTotal ? 'pago' : 'parcial'
    const { error } = await supabase
      .from('boletos')
      .update({
        status: novoStatus,
        valor_pago: valorPago,
        juros,
        data_pagamento: valorPago > 0 ? dataPagamento : null,
      })
      .eq('id', boleto.id)
    if (error) {
      push('error', `Erro ao registrar pagamento: ${error.message}`)
      return
    }
    loadBoletos()
  }

  // Soft-delete: marca excluído (com quem/quando) em vez de apagar de
  // verdade — dado financeiro precisa ficar rastreável mesmo depois de
  // removido da tela (auditoria, disputa com cliente). O PDF anexado
  // também é mantido no Storage por segurança.
  async function handleDelete(boleto: Boleto) {
    if (!session) return
    const { error } = await supabase
      .from('boletos')
      .update({ excluido: true, excluido_em: new Date().toISOString(), excluido_por: session.user.id })
      .eq('id', boleto.id)
    if (error) {
      push('error', `Erro ao remover título: ${error.message}`)
      return
    }
    push('success', 'Título removido.')
    loadAll()
  }

  async function handleDownload(boleto: Boleto) {
    if (!boleto.arquivo_path) return
    const { data, error } = await supabase.storage.from('boletos').download(boleto.arquivo_path)
    if (error || !data) {
      push('error', `Erro ao baixar boleto: ${error?.message ?? 'arquivo não encontrado'}`)
      return
    }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = boleto.arquivo_nome ?? 'boleto.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleAttachFile(boleto: Boleto, file: File) {
    if (!boleto.invoice_id) {
      push('error', 'Vincule este título a uma nota antes de anexar o PDF.')
      return
    }
    if (file.type !== 'application/pdf') {
      push('error', 'O boleto precisa ser um arquivo PDF.')
      return
    }
    const path = `${boleto.invoice_id}/${Date.now()}-${nomeArquivoSeguro(file.name)}`
    const { error: uploadError } = await supabase.storage.from('boletos').upload(path, file)
    if (uploadError) {
      push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
      return
    }
    const arquivoAntigo = boleto.arquivo_path
    const { error } = await supabase
      .from('boletos')
      .update({ arquivo_path: path, arquivo_nome: file.name })
      .eq('id', boleto.id)
    if (error) {
      await supabase.storage.from('boletos').remove([path])
      push('error', `Erro ao salvar o boleto: ${error.message}`)
      return
    }
    if (arquivoAntigo) await supabase.storage.from('boletos').remove([arquivoAntigo])
    push('success', 'PDF anexado.')
    loadBoletos()
  }

  // Nota paga por PIX/Cartão/Pagarme — não gera título, só precisa do
  // comprovante do pagamento. Já nasce com status "pago".
  async function handleAnexarComprovante(invoice: Invoice, file: File) {
    if (file.type !== 'application/pdf') {
      push('error', 'O comprovante precisa ser um arquivo PDF.')
      return
    }
    const path = `${invoice.id}/comprovante-${Date.now()}-${nomeArquivoSeguro(file.name)}`
    const { error: uploadError } = await supabase.storage.from('boletos').upload(path, file)
    if (uploadError) {
      push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
      return
    }
    const { error } = await supabase.from('boletos').insert({
      invoice_id: invoice.id,
      tipo: 'comprovante',
      numero_parcela: 1,
      cliente_nome_importado: invoice.cliente,
      valor: invoice.valor,
      vencimento: invoice.data_emissao,
      status: 'pago',
      arquivo_path: path,
      arquivo_nome: file.name,
      created_by: session!.user.id,
    })
    if (error) {
      await supabase.storage.from('boletos').remove([path])
      push('error', `Erro ao salvar comprovante: ${error.message}`)
      return
    }
    push('success', 'Comprovante anexado.')
    loadAll()
  }

  function handleRegistrarBoletoPara(invoice: Invoice) {
    setNotaEncontrada(invoice)
    setShowManual(true)
  }

  async function handleBuscarNota(e: FormEvent) {
    e.preventDefault()
    if (!buscaNf.trim()) return
    setBuscandoNota(true)
    setNotaEncontrada(null)
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome)')
      .eq('numero_nf', buscaNf.trim())
      .eq('excluida', false)
      .limit(1)
      .maybeSingle()
    setBuscandoNota(false)
    if (error) {
      push('error', `Erro ao buscar nota: ${error.message}`)
      return
    }
    if (!data) {
      push('info', 'Nenhuma nota encontrada com esse número.')
      return
    }
    setNotaEncontrada(data as Invoice)
  }

  function atualizarDetalheParcela(indice: number, campo: 'valor' | 'vencimento', valor: string) {
    setManualParcelasDetalhe((prev) => prev.map((d, i) => (i === indice ? { ...d, [campo]: valor } : d)))
  }

  function atualizarQtdParcelas(novaQtd: number) {
    const qtd = Math.min(Math.max(Math.round(novaQtd) || 1, 1), 60)
    setManualQtdParcelas(qtd)
    setManualParcelasDetalhe((prev) => {
      const next = prev.slice(0, qtd)
      while (next.length < qtd) next.push({ valor: '', vencimento: '' })
      return next
    })
  }

  function limparCalculoAuto() {
    setMostrarCalculoAuto(false)
    setAutoValorTotal('')
    setAutoQtdParcelas(1)
    setAutoComEntrada(false)
    setAutoEntradaValor('')
    setAutoEntradaVencimento('')
    setAutoVencimentoInicial('')
    setAutoIntervaloMeses(1)
  }

  // Soma `meses` a uma data (yyyy-mm-dd) mantendo o dia do mês sempre que
  // possível — vencimento todo dia 20, por exemplo — e cai pro último dia
  // válido do mês de destino quando ele não existe (ex.: dia 31 num mês de 30).
  function adicionarMeses(dataIso: string, meses: number): string {
    const [y, m, d] = dataIso.split('-').map(Number)
    const alvo = new Date(Date.UTC(y, m - 1 + meses, 1))
    const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
    alvo.setUTCDate(Math.min(d, ultimoDia))
    return alvo.toISOString().slice(0, 10)
  }

  // Reparte um valor em N parcelas iguais (em centavos, pra não perder
  // centavo por arredondamento) — a última parcela absorve a diferença.
  function repartirValor(valor: number, n: number): number[] {
    const centavos = Math.round(valor * 100)
    const base = Math.floor(centavos / n)
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? centavos - base * (n - 1) : base) / 100)
  }

  function handleCalcularParcelasAuto() {
    const total = Number(autoValorTotal.replace(/\./g, '').replace(',', '.'))
    if (!total || total <= 0) {
      push('error', 'Informe o valor total do pedido.')
      return
    }
    if (!autoVencimentoInicial) {
      push('error', 'Informe o vencimento da 1ª parcela.')
      return
    }
    const entrada = autoComEntrada ? Number(autoEntradaValor.replace(/\./g, '').replace(',', '.')) || 0 : 0
    if (autoComEntrada && (!autoEntradaValor || !autoEntradaVencimento)) {
      push('error', 'Informe o valor e o vencimento da entrada.')
      return
    }
    if (entrada > total) {
      push('error', 'A entrada não pode ser maior que o valor total.')
      return
    }

    const restante = total - entrada
    const valoresRecorrentes = repartirValor(restante, autoQtdParcelas)
    const recorrentes = valoresRecorrentes.map((v, i) => ({
      valor: formatCurrency(v).replace('R$', '').trim(),
      vencimento: adicionarMeses(autoVencimentoInicial, i * autoIntervaloMeses),
    }))
    const novoDetalhe = autoComEntrada
      ? [{ valor: formatCurrency(entrada).replace('R$', '').trim(), vencimento: autoEntradaVencimento }, ...recorrentes]
      : recorrentes

    setManualQtdParcelas(novoDetalhe.length)
    setManualParcelasDetalhe(novoDetalhe)
    push('success', 'Parcelas calculadas — confira e ajuste os valores antes de salvar, se precisar.')
  }

  async function handleSalvarManual(e: FormEvent) {
    e.preventDefault()
    if (!session || !notaEncontrada) return

    const valores = manualParcelasDetalhe.map((d) => Number(d.valor.replace(/\./g, '').replace(',', '.')))
    if (valores.some((v) => !v || v <= 0)) {
      push('error', 'Informe o valor de todas as parcelas.')
      return
    }
    if (manualParcelasDetalhe.some((d) => !d.vencimento)) {
      push('error', 'Informe o vencimento de todas as parcelas.')
      return
    }

    setSalvandoManual(true)
    let arquivoPath: string | null = null
    let arquivoNome: string | null = null
    // PDF só faz sentido quando é uma única parcela — quando são várias, cada
    // uma recebe o próprio PDF depois, direto na lista de títulos.
    if (manualQtdParcelas === 1 && manualArquivo) {
      if (manualArquivo.type !== 'application/pdf') {
        setSalvandoManual(false)
        push('error', 'O boleto precisa ser um arquivo PDF.')
        return
      }
      arquivoPath = `${notaEncontrada.id}/${Date.now()}-${nomeArquivoSeguro(manualArquivo.name)}`
      const { error: uploadError } = await supabase.storage.from('boletos').upload(arquivoPath, manualArquivo)
      if (uploadError) {
        setSalvandoManual(false)
        push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
        return
      }
      arquivoNome = manualArquivo.name
    }

    const valorPagoTotal = Number(manualValorPago.replace(/\./g, '').replace(',', '.')) || 0
    const distribuicao = distribuirPagamento(valores, valorPagoTotal)

    const rows = manualParcelasDetalhe.map((detalhe, i) => ({
      invoice_id: notaEncontrada.id,
      tipo: 'boleto' as const,
      numero_parcela: manualParcela + i,
      cliente_nome_importado: notaEncontrada.cliente,
      valor: valores[i],
      vencimento: detalhe.vencimento,
      status: distribuicao[i].status,
      valor_pago: distribuicao[i].valor_pago,
      arquivo_path: i === 0 ? arquivoPath : null,
      arquivo_nome: i === 0 ? arquivoNome : null,
      created_by: session.user.id,
    }))

    const { error } = await supabase.from('boletos').insert(rows)
    setSalvandoManual(false)

    if (error) {
      if (arquivoPath) await supabase.storage.from('boletos').remove([arquivoPath])
      push('error', `Erro ao salvar título(s): ${error.message}`)
      return
    }

    push('success', rows.length === 1 ? 'Título cadastrado.' : `${rows.length} títulos cadastrados.`)
    // Mantém a nota selecionada e o formulário aberto — fechar tudo aqui era
    // o "bug" relatado: parecia que o título tinha sumido quando na verdade
    // só precisava buscar de novo pra cadastrar a próxima parcela da mesma NF.
    setManualParcela((p) => p + rows.length)
    setManualQtdParcelas(1)
    setManualParcelasDetalhe([{ valor: '', vencimento: '' }])
    setManualValorPago('')
    setManualArquivo(null)
    limparCalculoAuto()
    loadAll()
  }

  const boletoInvoiceIds = new Set(boletos.filter((b) => b.tipo === 'boleto' && b.invoice_id).map((b) => b.invoice_id))
  const comprovanteInvoiceIds = new Set(
    boletos.filter((b) => b.tipo === 'comprovante' && b.invoice_id).map((b) => b.invoice_id)
  )

  const pendencias = invoicesRecentes
    .map((inv) => {
      if (precisaDeBoleto(inv.meio_pagamento)) {
        return boletoInvoiceIds.has(inv.id) ? null : { invoice: inv, tipo: 'boleto' as const }
      }
      return comprovanteInvoiceIds.has(inv.id) ? null : { invoice: inv, tipo: 'comprovante' as const }
    })
    .filter((p): p is { invoice: Invoice; tipo: 'boleto' | 'comprovante' } => p !== null)
    .filter(({ invoice }) => combinaComBusca(busca, invoice.numero_nf, invoice.cliente))

  const totalAberto = boletos.filter((b) => b.status !== 'pago').reduce((acc, b) => acc + saldoPendente(b), 0)
  const totalVencido = boletos
    .filter((b) => b.status !== 'pago' && b.vencimento < hoje())
    .reduce((acc, b) => acc + saldoPendente(b), 0)
  const totalPago = boletos.reduce((acc, b) => {
    if (b.status === 'pago') return acc + Number(b.valor)
    if (b.status === 'parcial') return acc + Number(b.valor_pago ?? 0)
    return acc
  }, 0)
  const vencidos = boletos.filter((b) => b.status !== 'pago' && b.vencimento < hoje())

  // Modal de Vencidos tem seu próprio filtro de data (até quando considerar
  // o vencimento), independente do KPI "Vencido" acima que sempre reflete
  // hoje via `vencidos` — só entram títulos ainda em aberto (nunca um já
  // pago, mesmo que tenha sido pago recentemente).
  const vencidosNaData = boletos.filter((b) => b.status !== 'pago' && b.vencimento < dataReferenciaVencidos)
  const agingNaData = FAIXAS.map(({ chave, label }) => {
    const itens = vencidosNaData.filter((b) => faixaDe(diasAtraso(b.vencimento)) === chave)
    return { chave, label, count: itens.length, total: itens.reduce((acc, b) => acc + saldoPendente(b), 0) }
  })
  const vencidosFiltradosNaData = faixaFiltro
    ? vencidosNaData.filter((b) => faixaDe(diasAtraso(b.vencimento)) === faixaFiltro)
    : vencidosNaData
  const gruposVencidosNaData = agruparPorCliente(vencidosFiltradosNaData)

  const filtrados = boletos.filter((b) => {
    if (aba === 'pagos' && b.status !== 'pago') return false
    if (aba === 'vencidos' && !(b.status !== 'pago' && b.vencimento < hoje())) return false
    if (aba === 'pendentes' && b.status === 'pago') return false
    return combinaComBusca(busca, b.invoices?.numero_nf, b.invoices?.cliente, b.cliente_nome_importado)
  })

  const gruposNotas = agruparPorNota(filtrados)
  const grupoNotaAberta = gruposNotas.find((g) => g.key === notaAberta) ?? null

  // Conciliação diária: financeiro chega de manhã, confere no banco quem
  // pagou o que venceu no dia anterior e já marca como pago aqui — a
  // contagem "X/Y confirmados" existe pra dar a sensação de "checklist
  // completo" e puxar o hábito de abrir o app todo dia.
  const titulosConciliacao = boletos
    .filter((b) => b.vencimento === dataConciliacao)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'pendente' ? -1 : 1))
  const pagosConciliacao = titulosConciliacao.filter((b) => b.status === 'pago').length

  return (
    <AppShell title={`${saudacao}, Financeiro`} navItems={financeiroNavItems(profile, pedidosParaAprovarCount)} onRefresh={loadAll}>
      <div className="mb-lg grid grid-cols-2 gap-md sm:grid-cols-3">
        <KpiCard label="Em Aberto" value={formatCurrency(totalAberto)} icon="account_balance_wallet" loading={loading} />
        <KpiCard
          label="Vencido"
          value={formatCurrency(totalVencido)}
          subValue={
            <span className="font-label-md text-label-md text-error">
              {vencidos.length} título{vencidos.length === 1 ? '' : 's'}
            </span>
          }
          icon="error"
          loading={loading}
          onClick={() => {
            setFaixaFiltro(null)
            setShowVencidosModal(true)
          }}
        />
        <KpiCard label="Pago" value={formatCurrency(totalPago)} icon="task_alt" loading={loading} />
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex flex-wrap items-center justify-between gap-sm">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Conciliação Diária</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Confira no banco quem pagou e marque como pago aqui.
            </p>
          </div>
          <div className="flex items-center gap-sm">
            {titulosConciliacao.length > 0 && (
              <span
                className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${
                  pagosConciliacao === titulosConciliacao.length ? 'bg-tertiary/10 text-tertiary' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {pagosConciliacao}/{titulosConciliacao.length} confirmados
              </span>
            )}
            <input
              type="date"
              value={dataConciliacao}
              onChange={(e) => setDataConciliacao(e.target.value)}
              className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : titulosConciliacao.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="event_available" title={`Nenhum título venceu em ${formatDate(dataConciliacao)}`} />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {titulosConciliacao.map((boleto) => (
              <BoletoRow
                key={boleto.id}
                boleto={boleto}
                onRegistrarPagamento={handleRegistrarPagamento}
                onDownload={handleDownload}
                onAttach={(b) => {
                  setAttachingId(b.id)
                  attachInputRef.current?.click()
                }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-md">
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
            search
          </span>
          <input
            type="text"
            placeholder="Buscar por número da NF ou nome do cliente…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-full border border-outline-variant bg-surface-container-lowest py-sm pl-11 pr-11 font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              title="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
      </div>

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex flex-wrap items-center gap-sm">
          {(['todos', 'pendentes', 'vencidos', 'pagos'] as Aba[]).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                aba === a ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {a === 'todos' ? 'Todos' : a === 'pendentes' ? 'A pagar' : a === 'vencidos' ? 'Vencidos' : 'Pagos'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : gruposNotas.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="request_quote" title="Nenhum título encontrado" />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {gruposNotas.map((grupo) => {
              const { texto, classe } = resumoGrupo(grupo.itens)
              return (
                <button
                  key={grupo.key}
                  type="button"
                  onClick={() => setNotaAberta(grupo.key)}
                  className="flex w-full flex-wrap items-center justify-between gap-sm p-lg text-left transition-colors hover:bg-surface-container-low"
                >
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      {grupo.numeroNf ? `NF #${grupo.numeroNf}` : 'Sem NF vinculada'} · {grupo.cliente} ·{' '}
                      {formatCurrency(grupo.total)}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {grupo.itens.length} título{grupo.itens.length === 1 ? '' : 's'} ·{' '}
                      {vencimentoDoGrupo(grupo.itens)}
                      {grupo.vendedorNome ? ` · Vendedor: ${grupo.vendedorNome}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-sm">
                    <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${classe}`}>{texto}</span>
                    <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {notaAberta && (
        <Modal onClose={() => setNotaAberta(null)} maxWidthClassName="max-w-2xl">
          <div className="p-lg">
            <div className="mb-lg flex items-start justify-between gap-sm">
              <div className="min-w-0">
                <h3 className="font-title-md text-title-md text-on-surface">
                  {grupoNotaAberta?.numeroNf ? `NF #${grupoNotaAberta.numeroNf}` : 'Sem NF vinculada'}
                </h3>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  {grupoNotaAberta?.cliente}
                  {grupoNotaAberta && (
                    <>
                      {' · '}
                      {grupoNotaAberta.itens.length} título{grupoNotaAberta.itens.length === 1 ? '' : 's'} ·{' '}
                      {formatCurrency(grupoNotaAberta.total)}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => setNotaAberta(null)}
                className="shrink-0 rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
                aria-label="Fechar"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {grupoNotaAberta ? (
              <div className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
                {grupoNotaAberta.itens.map((boleto) => (
                  <BoletoRow
                    key={boleto.id}
                    boleto={boleto}
                    onRegistrarPagamento={handleRegistrarPagamento}
                    onDownload={handleDownload}
                    onAttach={(b) => {
                      setAttachingId(b.id)
                      attachInputRef.current?.click()
                    }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon="task_alt" title="Nenhum título nesta nota" />
            )}
          </div>
        </Modal>
      )}

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">
            Pendências
            {pendencias.length > 0 && (
              <span className="ml-sm rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-700">
                {pendencias.length}
              </span>
            )}
          </h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Notas dos últimos 90 dias sem título (Boleto) ou comprovante (PIX/Cartão/Pagarme) registrado.
          </p>
        </div>
        {loadingPendencias ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : pendencias.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="task_alt" title={busca ? 'Nenhuma pendência encontrada' : 'Tudo conciliado'} />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {pendencias.map(({ invoice, tipo }) => (
              <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                <div className="min-w-0">
                  <p className="font-body-md text-body-md text-on-surface">
                    NF #{invoice.numero_nf} · {invoice.cliente} · {formatCurrency(invoice.valor)}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {formatDate(invoice.data_emissao)} ·{' '}
                    <MeioPagamentoInlineEdit
                      invoiceId={invoice.id}
                      meioPagamento={invoice.meio_pagamento}
                      meiosPagamento={meiosPagamento}
                      onSaved={loadPendencias}
                    />
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-sm">
                  <span className="rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-700">
                    {tipo === 'boleto' ? 'Pendente de Boleto' : 'Pendente de Comprovante'}
                  </span>
                  {tipo === 'boleto' ? (
                    <button
                      type="button"
                      onClick={() => handleRegistrarBoletoPara(invoice)}
                      className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      Registrar título
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEnviandoComprovanteId(invoice.id)
                        comprovanteInputRef.current?.click()
                      }}
                      className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[16px]">upload_file</span>
                      Anexar comprovante
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={manualFormRef} className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg scroll-mt-lg">
        <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Importar Títulos (XML)</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Exporte do sistema de contas a receber e envie aqui — reimportar não duplica.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-sm">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Cadastrar manualmente
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing ? (
                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
              )}
              {importing ? 'Importando…' : 'Importar XML'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImportFile(file)
              }}
            />
          </div>
        </div>

        {showManual && (
          <div className="rounded-lg bg-primary/5 p-md space-y-md">
            {!notaEncontrada ? (
              <form onSubmit={handleBuscarNota} className="flex gap-sm">
                <input
                  type="text"
                  placeholder="Número da NF…"
                  value={buscaNf}
                  onChange={(e) => setBuscaNf(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={buscandoNota || !buscaNf.trim()}
                  className="flex shrink-0 items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary hover:bg-primary/90 disabled:opacity-50"
                >
                  {buscandoNota ? 'Buscando…' : 'Buscar nota'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSalvarManual} className="space-y-md">
                <div className="flex flex-wrap items-start justify-between gap-sm rounded-lg border border-outline-variant p-sm">
                  <span className="min-w-0 flex-1 font-label-md text-label-md text-on-surface">
                    NF #{notaEncontrada.numero_nf} · {notaEncontrada.cliente}
                  </span>
                  <span className="flex shrink-0 items-center gap-md">
                    <button
                      type="button"
                      onClick={() => {
                        setNotaEncontrada(null)
                        setManualParcela(1)
                        setManualQtdParcelas(1)
                        setManualParcelasDetalhe([{ valor: '', vencimento: '' }])
                        setManualValorPago('')
                        limparCalculoAuto()
                      }}
                      className="font-label-md text-label-md text-primary"
                    >
                      Trocar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBuscaNf('')
                        setNotaEncontrada(null)
                        setManualParcela(1)
                        setManualQtdParcelas(1)
                        setManualParcelasDetalhe([{ valor: '', vencimento: '' }])
                        setManualValorPago('')
                        setManualArquivo(null)
                        limparCalculoAuto()
                        setShowManual(false)
                      }}
                      className="font-label-md text-label-md text-on-surface-variant"
                    >
                      Concluir
                    </button>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                      Parcela inicial
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={manualParcela}
                      onChange={(e) => setManualParcela(Number(e.target.value))}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                      Nº de parcelas
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={manualQtdParcelas}
                      onChange={(e) => atualizarQtdParcelas(Number(e.target.value))}
                      className={inputClass}
                    />
                  </label>
                  <label className="col-span-2 block sm:col-span-2">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                      Valor já pago pelo cliente (opcional)
                    </span>
                    <input
                      inputMode="decimal"
                      placeholder="Ex.: 1.000,00"
                      value={manualValorPago}
                      onChange={(e) => setManualValorPago(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>

                {!mostrarCalculoAuto ? (
                  <button
                    type="button"
                    onClick={() => setMostrarCalculoAuto(true)}
                    className="flex items-center gap-xs font-label-md text-label-md text-primary"
                  >
                    <span className="material-symbols-outlined text-[16px]">calculate</span>
                    Calcular parcelas automaticamente
                  </button>
                ) : (
                  <div className="space-y-md rounded-lg border border-primary/30 bg-primary/5 p-md">
                    <div className="flex items-center justify-between gap-sm">
                      <p className="font-label-md text-label-md font-medium text-on-surface">
                        Calcular parcelas automaticamente
                      </p>
                      <button
                        type="button"
                        onClick={limparCalculoAuto}
                        className="font-label-md text-label-md text-on-surface-variant"
                      >
                        Cancelar
                      </button>
                    </div>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      Informe o valor total do pedido — se tiver entrada, ela é descontada do total e o restante é
                      dividido igualmente entre as parcelas recorrentes abaixo, um vencimento a cada{' '}
                      {autoIntervaloMeses} mês{autoIntervaloMeses === 1 ? '' : 'es'}. Ao calcular, preenche
                      automaticamente o "Nº de parcelas" e as linhas do formulário.
                    </p>
                    <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Valor total do pedido
                        </span>
                        <input
                          inputMode="decimal"
                          placeholder="Ex.: 48.213,90"
                          value={autoValorTotal}
                          onChange={(e) => setAutoValorTotal(e.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Vencimento da 1ª parcela
                        </span>
                        <input
                          type="date"
                          value={autoVencimentoInicial}
                          onChange={(e) => setAutoVencimentoInicial(e.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Repetir a cada (meses)
                        </span>
                        <input
                          type="number"
                          min={1}
                          value={autoIntervaloMeses}
                          onChange={(e) => setAutoIntervaloMeses(Math.max(1, Number(e.target.value) || 1))}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Nº de parcelas a calcular
                        </span>
                        <input
                          type="number"
                          min={1}
                          value={autoQtdParcelas}
                          onChange={(e) => setAutoQtdParcelas(Math.max(1, Number(e.target.value) || 1))}
                          className={inputClass}
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-xs font-label-md text-label-md text-on-surface">
                      <input
                        type="checkbox"
                        checked={autoComEntrada}
                        onChange={(e) => setAutoComEntrada(e.target.checked)}
                      />
                      Tem entrada (parcela inicial com valor e vencimento à parte)
                    </label>
                    {autoComEntrada && (
                      <div className="grid grid-cols-2 gap-md">
                        <label className="block">
                          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                            Valor da entrada
                          </span>
                          <input
                            inputMode="decimal"
                            placeholder="Ex.: 14.319,58"
                            value={autoEntradaValor}
                            onChange={(e) => setAutoEntradaValor(e.target.value)}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                            Vencimento da entrada
                          </span>
                          <input
                            type="date"
                            value={autoEntradaVencimento}
                            onChange={(e) => setAutoEntradaVencimento(e.target.value)}
                            className={inputClass}
                          />
                        </label>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleCalcularParcelasAuto}
                      className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90"
                    >
                      Calcular e preencher parcelas
                    </button>
                  </div>
                )}

                <div className="space-y-sm">
                  {manualParcelasDetalhe.map((detalhe, i) => (
                    <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-end gap-md">
                      <span className="pb-xs font-label-md text-label-md text-on-surface-variant">
                        Parcela {manualParcela + i}
                      </span>
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Valor (R$)
                        </span>
                        <input
                          inputMode="decimal"
                          placeholder="Ex.: 1.000,00"
                          value={detalhe.valor}
                          onChange={(e) => atualizarDetalheParcela(i, 'valor', e.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                          Vencimento
                        </span>
                        <input
                          type="date"
                          value={detalhe.vencimento}
                          onChange={(e) => atualizarDetalheParcela(i, 'vencimento', e.target.value)}
                          className={inputClass}
                        />
                      </label>
                    </div>
                  ))}
                </div>

                {manualQtdParcelas === 1 && (
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                      PDF (opcional)
                    </span>
                    <input
                      key={manualParcela}
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => setManualArquivo(e.target.files?.[0] ?? null)}
                      className="w-full text-body-md text-on-surface file:mr-sm file:rounded-full file:border-0 file:bg-primary file:px-md file:py-xs file:text-on-primary"
                    />
                  </label>
                )}
                {manualQtdParcelas > 1 && (
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    PDFs podem ser anexados depois, direto na lista de títulos.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={salvandoManual}
                  className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {salvandoManual ? 'Salvando…' : manualQtdParcelas === 1 ? 'Salvar título' : 'Salvar títulos'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {showVencidosModal && (
        <Modal onClose={() => setShowVencidosModal(false)} maxWidthClassName="max-w-2xl">
          <div className="p-lg">
            <div className="mb-lg flex items-start justify-between gap-sm">
              <div>
                <h3 className="font-title-md text-title-md text-on-surface">Títulos Vencidos</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  {vencidosFiltradosNaData.length} título{vencidosFiltradosNaData.length === 1 ? '' : 's'} ·{' '}
                  {formatCurrency(vencidosFiltradosNaData.reduce((acc, b) => acc + saldoPendente(b), 0))}
                  {faixaFiltro && ' · filtrado'}
                </p>
              </div>
              <button
                onClick={() => setShowVencidosModal(false)}
                className="shrink-0 rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
                aria-label="Fechar"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <label className="mb-md flex flex-wrap items-center gap-sm">
              <span className="font-label-md text-label-md text-on-surface-variant">
                Títulos Vencidos em:
              </span>
              <input
                type="date"
                value={dataReferenciaVencidos}
                onChange={(e) => setDataReferenciaVencidos(e.target.value || hoje())}
                className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
              />
              {dataReferenciaVencidos !== hoje() && (
                <button
                  type="button"
                  onClick={() => setDataReferenciaVencidos(hoje())}
                  className="font-label-md text-label-md text-primary"
                >
                  Voltar para hoje
                </button>
              )}
            </label>

            {vencidosNaData.length === 0 ? (
              <EmptyState icon="task_alt" title="Nenhum título vencido nessa data" />
            ) : (
              <>
                <div className="mb-md flex flex-wrap gap-sm">
                  {agingNaData.map(({ chave, label, count, total }) => (
                    <button
                      key={chave}
                      type="button"
                      onClick={() => setFaixaFiltro((atual) => (atual === chave ? null : chave))}
                      disabled={count === 0}
                      className={`rounded-lg border px-md py-sm text-left transition-colors disabled:cursor-default disabled:opacity-40 ${
                        faixaFiltro === chave
                          ? 'border-error bg-error/10'
                          : 'border-outline-variant hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="font-label-md text-label-md text-on-surface-variant">{label}</div>
                      <div className="font-title-md text-title-md text-on-surface">{count}</div>
                      <div className="font-label-md text-label-md text-on-surface-variant">{formatCurrency(total)}</div>
                    </button>
                  ))}
                </div>

                <div className="max-h-[60vh] space-y-md overflow-y-auto">
                  {gruposVencidosNaData.map((grupo) => (
                    <div key={grupo.cliente} className="rounded-lg border border-outline-variant overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-sm bg-surface-container-low p-md">
                        <div className="min-w-0">
                          <p className="font-body-md font-semibold text-body-md text-on-surface">{grupo.cliente}</p>
                          {grupo.vendedorNome && (
                            <p className="font-label-md text-label-md text-on-surface-variant">
                              Vendedor: {grupo.vendedorNome}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-sm">
                          <button
                            type="button"
                            onClick={() => setDemonstrativoCliente(grupo.cliente)}
                            className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                          >
                            <span className="material-symbols-outlined text-[16px]">description</span>
                            Demonstrativo
                          </button>
                          <p className="font-title-md text-title-md text-error">{formatCurrency(grupo.total)}</p>
                        </div>
                      </div>
                      <div className="divide-y divide-outline-variant">
                        {grupo.itens.map((boleto) => (
                          <BoletoRow
                            key={boleto.id}
                            boleto={boleto}
                            onRegistrarPagamento={handleRegistrarPagamento}
                            onDownload={handleDownload}
                            onAttach={(b) => {
                              setAttachingId(b.id)
                              attachInputRef.current?.click()
                            }}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {demonstrativoCliente && (
        <DemonstrativoModal
          cliente={demonstrativoCliente}
          boletos={boletos.filter(
            (b) =>
              (b.invoices?.cliente ?? b.cliente_nome_importado ?? 'Cliente não identificado') === demonstrativoCliente
          )}
          onClose={() => setDemonstrativoCliente(null)}
        />
      )}

      <input
        ref={attachInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const boleto = boletos.find((b) => b.id === attachingId)
          if (file && boleto) handleAttachFile(boleto, file)
          setAttachingId(null)
          if (attachInputRef.current) attachInputRef.current.value = ''
        }}
      />

      <input
        ref={comprovanteInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const invoice = invoicesRecentes.find((i) => i.id === enviandoComprovanteId)
          if (file && invoice) handleAnexarComprovante(invoice, file)
          setEnviandoComprovanteId(null)
          if (comprovanteInputRef.current) comprovanteInputRef.current.value = ''
        }}
      />
    </AppShell>
  )
}

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors'
