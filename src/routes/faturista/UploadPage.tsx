import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { KpiCard } from '../../components/kpi/KpiCard'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { NFeParseError, parseNFeXml } from '../../lib/nfeParser'
import { bestMatch, matchFilialByCnpj } from '../../lib/match'
import { useLookups } from '../../hooks/useLookups'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { defaultAfetaFaturamento, formatCurrency, formatDate, formatDateTime, isCanceladaTipo } from '../../lib/format'
import { hasModule } from '../../lib/modules'
import { ReviewForm, type InvoiceDraft } from './ReviewForm'
import { EditInvoiceModal } from './EditInvoiceModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { faturistaNavItems } from './nav'
import type { Invoice, NfeCaptura, NfeWatcherConfig } from '../../types/domain'

// Desligado temporariamente: a captura automática (watcher + polling da
// Caixa de Entrada) sobrecarregou o banco no plano Free (conexões do SQL
// Editor + polling somados). Reativar só depois de confirmar que o projeto
// tem folga de conexão — ver conversa de 28/09/2026.
const NFE_CAPTURA_ATIVA = false

export function UploadPage() {
  const { session, profile } = useAuth()
  // Uma conta faturista que também tem o módulo financeiro (ex.: um
  // administrativo) precisa ver e gerenciar as notas lançadas por todos os
  // faturistas, não só as próprias — diferente do faturista comum, que só
  // acompanha o que ele mesmo lançou.
  const vendoTudo = hasModule(profile, 'financeiro')
  const { vendedores, filiais, tiposOperacao, meiosPagamento, loading: lookupsLoading } = useLookups()
  const { push } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dragOver, setDragOver] = useState(false)
  const [xmlRaw, setXmlRaw] = useState<string | null>(null)
  const [draft, setDraft] = useState<InvoiceDraft | null>(null)
  const [filialAutoDetected, setFilialAutoDetected] = useState(false)
  const [filialLocalDetectada, setFilialLocalDetectada] = useState<string | undefined>(undefined)
  const [filialDestinoId, setFilialDestinoId] = useState<string | null>(null)
  const [filialDestinoNome, setFilialDestinoNome] = useState<string | undefined>(undefined)
  const [chaveAcesso, setChaveAcesso] = useState<string | null>(null)
  const [clienteInfo, setClienteInfo] = useState<{ cnpjCpf: string | null; cidade: string }>({
    cnpjCpf: null,
    cidade: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [recent, setRecent] = useState<Invoice[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [summary, setSummary] = useState<{ count: number; faturamento: number }>({ count: 0, faturamento: 0 })
  const [loadingSummary, setLoadingSummary] = useState(true)

  // Caixa de Entrada: XMLs que o watcher capturou automaticamente da pasta
  // do emissor, ainda sem vendedor/tipo confirmados (não vêm no XML).
  const [capturas, setCapturas] = useState<NfeCaptura[]>([])
  const [loadingCapturas, setLoadingCapturas] = useState(true)
  const [capturaEmRevisao, setCapturaEmRevisao] = useState<NfeCaptura | null>(null)

  // Configuração da pasta observada pelo watcher — em vez de editar um
  // arquivo local, o faturista define aqui e o script no PC busca esse valor.
  const [watcherConfig, setWatcherConfig] = useState<NfeWatcherConfig | null>(null)
  const [mostrarConfig, setMostrarConfig] = useState(false)
  const [pastaInput, setPastaInput] = useState('')
  const [dataCorteInput, setDataCorteInput] = useState('')
  const [salvandoConfig, setSalvandoConfig] = useState(false)

  // Contagem pra badge de "Pedidos" no menu — a lista em si mora na própria
  // página de Pedidos, separada pra não poluir a tela principal de Operações.
  const [pedidosPendentesCount, setPedidosPendentesCount] = useState(0)

  // Busca e exclusão
  const [searchNumeroNf, setSearchNumeroNf] = useState('')
  const [searchedInvoice, setSearchedInvoice] = useState<Invoice | null>(null)
  const [searchingInvoice, setSearchingInvoice] = useState(false)

  async function loadSummary() {
    if (!session) return
    setLoadingSummary(true)
    const now = new Date()
    const todayLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    // Filtra por data_emissao (data da nota no XML), não por created_at (data
    // do lançamento no sistema) — senão, um XML atrasado lançado hoje mas
    // emitido dias atrás contaria erroneamente como faturamento de hoje.
    let summaryQuery = supabase
      .from('invoices')
      .select('valor, tipo_operacao, afeta_faturamento')
      .eq('excluida', false)
      .eq('data_emissao', todayLocal)
    if (!vendoTudo) summaryQuery = summaryQuery.eq('created_by', session.user.id)
    const { data, error } = await summaryQuery
    if (!error) {
      const rows = data ?? []
      const faturamento = rows.reduce((acc, r) => {
        if (isCanceladaTipo(r.tipo_operacao) || !r.afeta_faturamento) return acc
        return acc + Number(r.valor)
      }, 0)
      setSummary({ count: rows.length, faturamento })
    }
    setLoadingSummary(false)
  }

  async function loadRecent() {
    if (!session) return
    setLoadingRecent(true)
    let recentQuery = supabase
      .from('invoices')
      // invoices tem 2 FKs pra filiais (filial_id e filial_destino_id) — sem o
      // "!filial_id" o PostgREST não sabe qual delas usar e a query inteira falha.
      .select('*, filiais!filial_id(nome), vendedores(nome)')
      .eq('excluida', false)
      .order('created_at', { ascending: false })
      .limit(10)
    if (!vendoTudo) recentQuery = recentQuery.eq('created_by', session.user.id)
    const { data, error } = await recentQuery
    if (!error) setRecent((data as Invoice[]) ?? [])
    setLoadingRecent(false)
  }

  async function loadPedidosPendentesCount() {
    const { count } = await supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('status', 'pendente')
    setPedidosPendentesCount(count ?? 0)
  }

  async function loadWatcherConfig() {
    const { data } = await supabase.from('nfe_watcher_config').select('*').eq('id', 1).single()
    const config = data as NfeWatcherConfig | null
    setWatcherConfig(config)
    setPastaInput(config?.pasta ?? '')
    setDataCorteInput(config?.data_corte ?? '')
  }

  async function loadCapturas() {
    setLoadingCapturas(true)
    const { data, error } = await supabase
      .from('nfe_capturas')
      .select('*')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
    if (!error) setCapturas((data as NfeCaptura[]) ?? [])
    setLoadingCapturas(false)
  }

  useEffect(() => {
    loadRecent()
    loadSummary()
    // vendoTudo só fica correto depois que o profile termina de carregar
    // (chega depois da session) — sem isso no dep array, a primeira carga
    // roda com o escopo errado (só as próprias notas) e nunca se corrige
    // sozinha até um refresh manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, vendoTudo])

  useEffect(() => {
    loadPedidosPendentesCount()
  }, [])

  useEffect(() => {
    if (!NFE_CAPTURA_ATIVA) return
    loadCapturas()
    loadWatcherConfig()
    // Watcher roda em segundo plano — sem uma tela aberta olhando, o jeito de
    // a Caixa de Entrada parecer "automática" de verdade é reconferir sozinha
    // de vez em quando, não só quando o faturista dá refresh manual.
    const intervalo = setInterval(loadCapturas, 30_000)
    return () => clearInterval(intervalo)
  }, [])

  async function handleSalvarConfig() {
    if (!session) return
    if (!dataCorteInput) {
      push('error', 'Informe a data de corte.')
      return
    }
    setSalvandoConfig(true)
    const { error } = await supabase
      .from('nfe_watcher_config')
      .update({
        pasta: pastaInput.trim() || null,
        data_corte: dataCorteInput,
        atualizado_em: new Date().toISOString(),
        atualizado_por: session.user.id,
      })
      .eq('id', 1)
    setSalvandoConfig(false)
    if (error) {
      push('error', `Erro ao salvar configuração: ${error.message}`)
      return
    }
    push('success', 'Configuração salva — o watcher pega a mudança na próxima checagem.')
    setMostrarConfig(false)
    loadWatcherConfig()
  }

  function carregarXmlTexto(text: string) {
      const parsed = parseNFeXml(text)
      setXmlRaw(text)
      setChaveAcesso(parsed.chaveAcesso)
      setClienteInfo({ cnpjCpf: parsed.clienteCnpjCpf, cidade: parsed.clienteCidade })

      const matchedFilial = matchFilialByCnpj(parsed.emitCnpj, filiais)
      setFilialAutoDetected(Boolean(matchedFilial))
      setFilialLocalDetectada(
        parsed.emitMunicipio && parsed.emitUf ? `${parsed.emitMunicipio}/${parsed.emitUf}` : undefined
      )
      if (!matchedFilial) {
        push('info', 'Não reconheci o CNPJ emissor — selecione a filial manualmente.')
      }

      // Se o destinatário da nota é o CNPJ de uma das nossas próprias filiais
      // (ou a matriz), é uma transferência interna — não é venda, não precisa
      // de vendedor, e não deve contar como faturamento.
      const matchedFilialDestino = matchFilialByCnpj(parsed.clienteCnpjCpf, filiais)
      const isTransferenciaInterna = Boolean(matchedFilialDestino)
      setFilialDestinoId(matchedFilialDestino?.id ?? null)
      setFilialDestinoNome(matchedFilialDestino?.nome)

      // natOp é texto livre e nem sempre bate com nossas categorias — quando não
      // encontra nada, usa tpNF (campo padronizado da NFe: 1 = saída) como último recurso.
      // Transferência interna detectada pelo CNPJ tem prioridade sobre os dois.
      const tipoOperacao = isTransferenciaInterna
        ? (tiposOperacao.find((t) => t.toUpperCase().includes('TRANSFER')) ?? 'Transferência')
        : (bestMatch(parsed.naturezaOperacao, tiposOperacao) ?? (parsed.tpNF === '1' ? 'Saída' : ''))

      if (isTransferenciaInterna) {
        push('info', `Transferência interna detectada para ${matchedFilialDestino?.nome} — não conta como faturamento.`)
      }

      setDraft({
        filialId: matchedFilial?.id ?? '',
        estado: parsed.uf,
        numeroNf: parsed.numeroNf,
        dataEmissao: parsed.dataEmissao,
        tipoOperacao,
        modalidadePagamento: 'Simples',
        meioPagamento: bestMatch(parsed.formaPagamento, meiosPagamento) ?? parsed.formaPagamento,
        parcelas: 1,
        cliente: parsed.cliente,
        valor: parsed.valorTotal,
        vendedorId: '',
        valorTransferencia: 0,
        valorAFaturar: 0,
        frete: parsed.frete,
        valorDifal: parsed.valorDifal,
        valorFcp: parsed.valorFcp,
        valorIcms: parsed.valorIcms,
        valorIpi: parsed.valorIpi,
        afetaFaturamento: defaultAfetaFaturamento(tipoOperacao),
        transportadora: '',
      })
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      push('error', 'Selecione um arquivo .xml de NF-e.')
      return
    }
    try {
      const text = await file.text()
      setXmlRaw(text)
      carregarXmlTexto(text)
    } catch (err) {
      const message = err instanceof NFeParseError ? err.message : 'Não foi possível ler este XML.'
      push('error', message)
    }
  }

  function handleRevisarCaptura(captura: NfeCaptura) {
    try {
      setXmlRaw(captura.xml_raw)
      carregarXmlTexto(captura.xml_raw)
      setCapturaEmRevisao(captura)
    } catch (err) {
      const message = err instanceof NFeParseError ? err.message : 'Não foi possível ler este XML.'
      push('error', message)
    }
  }

  async function handleDescartarCaptura(captura: NfeCaptura) {
    const { error } = await supabase.from('nfe_capturas').update({ status: 'descartada' }).eq('id', captura.id)
    if (error) {
      push('error', `Erro ao descartar: ${error.message}`)
      return
    }
    loadCapturas()
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  async function resolveClienteId(form: InvoiceDraft): Promise<string | null> {
    if (!form.cliente) return null

    const payload = {
      nome: form.cliente,
      estado: form.estado || null,
      cidade: clienteInfo.cidade || null,
    }

    // Com CNPJ/CPF, atualiza o cadastro existente (mesmo cliente, dados mais
    // recentes); sem documento, cadastra um registro novo mesmo — melhor ter
    // um cliente "solto" pra pesquisa do que não cadastrar nada.
    const query = clienteInfo.cnpjCpf
      ? supabase.from('clientes').upsert({ ...payload, cnpj_cpf: clienteInfo.cnpjCpf }, { onConflict: 'cnpj_cpf' })
      : supabase.from('clientes').insert(payload)

    const { data, error } = await query.select('id').single()
    if (error) {
      console.error('Falha ao cadastrar cliente:', error.message)
      return null
    }
    return data.id
  }

  async function handleSubmit(form: InvoiceDraft) {
    if (!session) return
    setSubmitting(true)
    const clienteId = await resolveClienteId(form)
    // Só grava a filial de destino se o tipo ainda for transferência — se o
    // faturista trocou manualmente para outra operação, o dado não se aplica mais.
    const tipoUpper = form.tipoOperacao.toUpperCase()
    const isTransferencia = tipoUpper.includes('TRANSFERÊNCIA') || tipoUpper.includes('TRANSFERENCIA')
    const { data: novaInvoice, error } = await supabase
      .from('invoices')
      .insert({
      filial_id: form.filialId,
      filial_destino_id: isTransferencia ? filialDestinoId : null,
      cliente_id: clienteId,
      estado: form.estado || null,
      numero_nf: form.numeroNf,
      data_emissao: form.dataEmissao,
      tipo_operacao: form.tipoOperacao,
      modalidade_pagamento: form.modalidadePagamento,
      meio_pagamento: form.meioPagamento,
      parcelas: form.parcelas,
      cliente: form.cliente,
      valor: form.valor,
      vendedor_id: form.vendedorId || null,
      valor_transferencia: form.valorTransferencia,
      valor_a_faturar: form.valorAFaturar,
      frete: form.frete,
      valor_difal: form.valorDifal,
      valor_fcp: form.valorFcp,
      valor_icms: form.valorIcms,
      valor_ipi: form.valorIpi,
      afeta_faturamento: form.afetaFaturamento,
      transportadora: form.transportadora || null,
      xml_raw: xmlRaw,
      xml_chave_acesso: chaveAcesso,
      created_by: session.user.id,
      })
      .select('id')
      .single()
    setSubmitting(false)

    if (error) {
      if (error.code === '23505') {
        push('error', 'Esta nota já foi lançada anteriormente (NF ou chave de acesso duplicada).')
      } else {
        push('error', `Erro ao salvar: ${error.message}`)
      }
      return
    }

    if (capturaEmRevisao) {
      await supabase
        .from('nfe_capturas')
        .update({ status: 'lancada', invoice_id: novaInvoice?.id ?? null })
        .eq('id', capturaEmRevisao.id)
      loadCapturas()
    }

    push('success', `Lançamento da NF #${form.numeroNf} salvo com sucesso.`)
    closeDraft()
    loadRecent()
    loadSummary()
  }

  function closeDraft() {
    setDraft(null)
    setXmlRaw(null)
    setChaveAcesso(null)
    setFilialAutoDetected(false)
    setFilialLocalDetectada(undefined)
    setFilialDestinoId(null)
    setFilialDestinoNome(undefined)
    setClienteInfo({ cnpjCpf: null, cidade: '' })
    setCapturaEmRevisao(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSaveEdit(
    id: string,
    tipoOperacao: string,
    meioPagamento: string,
    afetaFaturamento: boolean,
    vendedorId: string | null,
    transportadora: string | null
  ) {
    const { error } = await supabase
      .from('invoices')
      .update({
        tipo_operacao: tipoOperacao,
        meio_pagamento: meioPagamento,
        afeta_faturamento: afetaFaturamento,
        vendedor_id: vendedorId,
        transportadora,
      })
      .eq('id', id)

    if (error) {
      push('error', `Erro ao salvar edição: ${error.message}`)
      return
    }

    push('success', 'Lançamento atualizado com sucesso.')
    setEditingInvoice(null)
    loadRecent()
    loadSummary()
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    const { error } = await supabase.from('invoices').update({ excluida: true }).eq('id', id)
    setDeleting(false)

    if (error) {
      push('error', `Erro ao excluir nota: ${error.message}`)
      return
    }

    push('success', 'Nota excluída.')
    setDeletingId(null)
    loadRecent()
    loadSummary()
  }

  async function handleSearchInvoice(e: React.FormEvent) {
    e.preventDefault()
    if (!searchNumeroNf.trim() || !session) return
    
    setSearchingInvoice(true)
    setSearchedInvoice(null)
    
    let searchQuery = supabase
      .from('invoices')
      .select('*, filiais!filial_id(nome), vendedores(nome)')
      .eq('numero_nf', searchNumeroNf.trim())
      .order('created_at', { ascending: false })
      .limit(1)
    if (!vendoTudo) searchQuery = searchQuery.eq('created_by', session.user.id)
    const { data, error } = await searchQuery.maybeSingle()
      
    setSearchingInvoice(false)
    
    if (error) {
      push('error', `Erro ao buscar nota: ${error.message}`)
      return
    }
    
    if (!data) {
      push('info', 'Nenhuma nota encontrada com esse número.')
      return
    }
    
    setSearchedInvoice(data as Invoice)
  }

  return (
    <AppShell
      title="Operações"
      navItems={faturistaNavItems(profile, pedidosPendentesCount)}
      onRefresh={async () => {
        await Promise.all([loadRecent(), loadSummary(), loadPedidosPendentesCount()])
      }}
    >
      <div className="mb-lg grid grid-cols-2 gap-md">
        <KpiCard label="Notas Hoje" value={String(summary.count)} icon="receipt_long" loading={loadingSummary} />
        <KpiCard label="Faturamento Hoje" value={formatCurrency(summary.faturamento)} icon="payments" loading={loadingSummary} />
      </div>

      {NFE_CAPTURA_ATIVA && (
      <>
      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="flex items-start justify-between gap-sm p-lg border-b border-outline-variant">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">
              Caixa de Entrada
              {capturas.length > 0 && (
                <span className="ml-sm rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-700">
                  {capturas.length}
                </span>
              )}
            </h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              XMLs capturados automaticamente da pasta do emissor — confira e lance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMostrarConfig(true)}
            title="Configurar pasta observada"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
        </div>
        {loadingCapturas ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : capturas.length === 0 ? (
          <div className="p-lg">
            <EmptyState
              icon="mark_email_read"
              title={watcherConfig?.pasta ? 'Nenhum XML novo por aqui' : 'Nenhuma pasta configurada ainda'}
            />
          </div>
        ) : (
            <div className="divide-y divide-outline-variant">
              {capturas.map((c) => {
                let preview: { numeroNf: string; cliente: string; valorTotal: number } | null = null
                try {
                  const p = parseNFeXml(c.xml_raw)
                  preview = { numeroNf: p.numeroNf, cliente: p.cliente, valorTotal: p.valorTotal }
                } catch {
                  preview = null
                }
                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                    <div className="min-w-0">
                      <p className="font-body-md text-body-md text-on-surface">
                        {preview ? (
                          <>
                            <span className="font-label-md text-label-md text-on-surface-variant">
                              NF {preview.numeroNf}
                            </span>{' '}
                            {preview.cliente}
                          </>
                        ) : (
                          <span className="text-error">XML não pôde ser lido — {c.arquivo_nome}</span>
                        )}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">
                        {c.arquivo_nome}
                        {preview ? ` · ${formatCurrency(preview.valorTotal)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-sm">
                      <button
                        type="button"
                        onClick={() => handleDescartarCaptura(c)}
                        className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                      >
                        Descartar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevisarCaptura(c)}
                        className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
                      >
                        <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                        Revisar e lançar
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      {mostrarConfig && (
        <Modal onClose={() => setMostrarConfig(false)} maxWidthClassName="max-w-md">
          <div className="space-y-md p-lg">
            <div>
              <h3 className="font-title-md text-title-md text-on-surface">Captura automática de XML</h3>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Pasta observada pelo watcher rodando no PC do faturista. Copie o caminho completo direto da barra de
                endereço do Explorer.
              </p>
            </div>
            <label className="block">
              <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                Caminho da pasta
              </span>
              <input
                type="text"
                value={pastaInput}
                onChange={(e) => setPastaInput(e.target.value)}
                placeholder="C:\ERP\XMLs"
                className="w-full rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                Só capturar nota emitida a partir de
              </span>
              <input
                type="date"
                value={dataCorteInput}
                onChange={(e) => setDataCorteInput(e.target.value)}
                className="w-full rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface outline-none focus:border-primary"
              />
              <span className="mt-xs block font-label-md text-label-md text-on-surface-variant">
                Nota mais antiga que isso não entra na Caixa de Entrada, mesmo que ainda esteja na pasta.
              </span>
            </label>
            {watcherConfig?.atualizado_em && (
              <p className="font-label-md text-label-md text-on-surface-variant">
                Última atualização: {formatDateTime(watcherConfig.atualizado_em)}
              </p>
            )}
            <p className="rounded-lg bg-surface-container-low p-md font-label-md text-label-md text-on-surface-variant">
              O watcher busca essa configuração periodicamente — não precisa reiniciar nada no PC depois de salvar
              aqui, só esperar a próxima checagem (até 1 minuto).
            </p>
            <div className="flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => setMostrarConfig(false)}
                className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarConfig}
                disabled={salvandoConfig}
                className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">check</span>
                {salvandoConfig ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      </>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`mb-lg cursor-pointer rounded-xl border-2 border-dashed p-xl text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-lowest'
        }`}
      >
        <span className="material-symbols-outlined text-primary text-[40px]">upload_file</span>
        <p className="mt-sm font-title-md text-title-md text-on-surface">Enviar XML da NF-e</p>
        <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
          Arraste o arquivo aqui ou clique para selecionar
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
      </div>

      {draft && (
        <Modal onClose={closeDraft}>
          {lookupsLoading ? (
            <div className="p-lg">
              <Skeleton className="h-96 w-full" />
            </div>
          ) : (
            <ReviewForm
              draft={draft}
              vendedores={vendedores}
              filiais={filiais}
              tiposOperacao={tiposOperacao}
              meiosPagamento={meiosPagamento}
              filialAutoDetected={filialAutoDetected}
              filialLocalDetectada={filialLocalDetectada}
              filialDestinoNome={filialDestinoNome}
              submitting={submitting}
              onCancel={closeDraft}
              onSubmit={handleSubmit}
            />
          )}
        </Modal>
      )}

      {editingInvoice && (
        <Modal onClose={() => setEditingInvoice(null)}>
          <EditInvoiceModal
            invoice={editingInvoice}
            tiposOperacao={tiposOperacao}
            meiosPagamento={meiosPagamento}
            vendedores={vendedores}
            onClose={() => setEditingInvoice(null)}
            onSave={handleSaveEdit}
          />
        </Modal>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg mb-lg">
        <h3 className="mb-md font-title-md text-title-md text-on-surface">Buscar e Cancelar Nota</h3>
        <form onSubmit={handleSearchInvoice} className="flex gap-sm">
          <input
            type="text"
            placeholder="Número da NF..."
            value={searchNumeroNf}
            onChange={(e) => setSearchNumeroNf(e.target.value)}
            className="flex-1 rounded border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-on-surface focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={searchingInvoice || !searchNumeroNf.trim()}
            className="flex items-center gap-xs rounded bg-primary px-lg py-sm font-label-lg text-label-lg text-on-primary hover:bg-primary/90 disabled:opacity-50"
          >
            {searchingInvoice ? (
              <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[20px]">search</span>
            )}
            Buscar
          </button>
        </form>

        {searchedInvoice && (
          <div className="mt-md border-t border-outline-variant pt-md">
            <div className="flex items-center justify-between">
              <div>
                <p className={`font-body-md text-body-md ${searchedInvoice.excluida || isCanceladaTipo(searchedInvoice.tipo_operacao) ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                  #{searchedInvoice.numero_nf} · {searchedInvoice.cliente}
                  {(searchedInvoice.excluida || isCanceladaTipo(searchedInvoice.tipo_operacao)) && (
                    <span className="ml-xs rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error no-underline">
                      Cancelada
                    </span>
                  )}
                </p>
                <p className="font-label-md text-label-md text-on-surface-variant">
                  {searchedInvoice.filiais?.nome} · {searchedInvoice.vendedores?.nome} · {formatDateTime(searchedInvoice.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-md">
                <span className={`font-tabular-nums ${searchedInvoice.excluida || isCanceladaTipo(searchedInvoice.tipo_operacao) ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                  {formatCurrency(searchedInvoice.valor)}
                </span>
                {!(searchedInvoice.excluida || isCanceladaTipo(searchedInvoice.tipo_operacao)) && (
                  deletingId === searchedInvoice.id ? (
                    <div className="flex items-center gap-xs">
                      <span className="font-label-md text-label-md text-on-surface-variant">Excluir?</span>
                      <button
                        onClick={async () => {
                          await handleDelete(searchedInvoice.id)
                          // Refetch to update status
                          setSearchNumeroNf(searchedInvoice.numero_nf)
                          const mockEvent = { preventDefault: () => {} } as React.FormEvent
                          handleSearchInvoice(mockEvent)
                        }}
                        disabled={deleting}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        title="Confirmar exclusão"
                      >
                        <span className="material-symbols-outlined text-[18px]">check</span>
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        disabled={deleting}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
                        title="Cancelar"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(searchedInvoice.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-error hover:bg-error/10 transition-colors"
                      title="Excluir nota"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <h3 className="mb-md font-title-md text-title-md text-on-surface">
          {vendoTudo ? 'Últimos lançamentos (todos os faturistas)' : 'Seus últimos lançamentos'}
        </h3>

        {loadingRecent ? (
          <div className="space-y-sm">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : recent.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">Nenhum lançamento ainda.</p>
        ) : (
          <div className="divide-y divide-outline-variant">
            {recent.map((inv) => {
              const cancelada = isCanceladaTipo(inv.tipo_operacao)
              return (
              <div key={inv.id} className="flex items-center justify-between py-sm">
                <div>
                  <p className={`font-body-md text-body-md ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                    #{inv.numero_nf} · {inv.cliente}
                    {cancelada && (
                      <span className="ml-xs rounded-full bg-error/10 px-xs py-0.5 font-label-md text-label-md text-error no-underline">
                        Cancelada
                      </span>
                    )}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {inv.filiais?.nome} · {inv.vendedores?.nome} · {formatDateTime(inv.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-md">
                  <span className={`font-tabular-nums ${cancelada ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>{formatCurrency(inv.valor)}</span>
                  {deletingId === inv.id ? (
                    <div className="flex items-center gap-xs">
                      <span className="font-label-md text-label-md text-on-surface-variant">Excluir?</span>
                      <button
                        onClick={() => handleDelete(inv.id)}
                        disabled={deleting}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        title="Confirmar exclusão"
                      >
                        <span className="material-symbols-outlined text-[18px]">check</span>
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        disabled={deleting}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
                        title="Cancelar"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {cancelada && (
                        <button
                          onClick={() => setDeletingId(inv.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
                          title="Excluir nota cancelada"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      )}
                      <button
                        onClick={() => setEditingInvoice(inv)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        title="Editar lançamento"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
