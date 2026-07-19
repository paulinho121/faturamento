import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { NFeParseError, parseNFeXml } from '../../lib/nfeParser'
import { bestMatch, matchFilialByCnpj } from '../../lib/match'
import { useLookups } from '../../hooks/useLookups'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDateTime, isCanceladaTipo } from '../../lib/format'
import { ReviewForm, type InvoiceDraft } from './ReviewForm'
import { EditInvoiceModal } from './EditInvoiceModal'
import type { Invoice } from '../../types/domain'

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/operacoes', icon: 'receipt_long', label: 'Operações' },
]

export function UploadPage() {
  const { session } = useAuth()
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

  async function loadRecent() {
    if (!session) return
    setLoadingRecent(true)
    const { data, error } = await supabase
      .from('invoices')
      // invoices tem 2 FKs pra filiais (filial_id e filial_destino_id) — sem o
      // "!filial_id" o PostgREST não sabe qual delas usar e a query inteira falha.
      .select('*, filiais!filial_id(nome), vendedores(nome)')
      .eq('created_by', session.user.id)
      .order('created_at', { ascending: false })
      .limit(10)
    if (!error) setRecent((data as Invoice[]) ?? [])
    setLoadingRecent(false)
  }

  useEffect(() => {
    loadRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      push('error', 'Selecione um arquivo .xml de NF-e.')
      return
    }
    try {
      const text = await file.text()
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
        afetaFaturamento: true,
      })
    } catch (err) {
      const message = err instanceof NFeParseError ? err.message : 'Não foi possível ler este XML.'
      push('error', message)
    }
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
    const { error } = await supabase.from('invoices').insert({
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
      afeta_faturamento: form.afetaFaturamento,
      xml_raw: xmlRaw,
      xml_chave_acesso: chaveAcesso,
      created_by: session.user.id,
    })
    setSubmitting(false)

    if (error) {
      if (error.code === '23505') {
        push('error', 'Esta nota já foi lançada anteriormente (NF ou chave de acesso duplicada).')
      } else {
        push('error', `Erro ao salvar: ${error.message}`)
      }
      return
    }

    push('success', `Lançamento da NF #${form.numeroNf} salvo com sucesso.`)
    closeDraft()
    loadRecent()
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
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSaveEdit(
    id: string,
    tipoOperacao: string,
    meioPagamento: string,
    afetaFaturamento: boolean,
    vendedorId: string | null
  ) {
    const { error } = await supabase
      .from('invoices')
      .update({
        tipo_operacao: tipoOperacao,
        meio_pagamento: meioPagamento,
        afeta_faturamento: afetaFaturamento,
        vendedor_id: vendedorId,
      })
      .eq('id', id)

    if (error) {
      push('error', `Erro ao salvar edição: ${error.message}`)
      return
    }

    push('success', 'Lançamento atualizado com sucesso.')
    setEditingInvoice(null)
    loadRecent()
  }

  return (
    <AppShell title="Operações" navItems={NAV_ITEMS}>
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

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <h3 className="mb-md font-title-md text-title-md text-on-surface">Seus últimos lançamentos</h3>
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
                  <button
                    onClick={() => setEditingInvoice(inv)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
                    title="Editar lançamento"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
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
