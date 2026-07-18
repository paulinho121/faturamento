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
import { formatCurrency, formatDateTime } from '../../lib/format'
import { ReviewForm, type InvoiceDraft } from './ReviewForm'
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
  const [chaveAcesso, setChaveAcesso] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [recent, setRecent] = useState<Invoice[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  async function loadRecent() {
    if (!session) return
    setLoadingRecent(true)
    const { data, error } = await supabase
      .from('invoices')
      .select('*, filiais(nome), vendedores(nome)')
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

      const matchedFilial = matchFilialByCnpj(parsed.emitCnpj, filiais)
      setFilialAutoDetected(Boolean(matchedFilial))
      if (!matchedFilial) {
        push('info', 'Não reconheci o CNPJ emissor — selecione a filial manualmente.')
      }

      setDraft({
        filialId: matchedFilial?.id ?? '',
        estado: parsed.uf,
        numeroNf: parsed.numeroNf,
        dataEmissao: parsed.dataEmissao,
        tipoOperacao: bestMatch(parsed.naturezaOperacao, tiposOperacao) ?? '',
        modalidadePagamento: 'Simples',
        meioPagamento: bestMatch(parsed.formaPagamento, meiosPagamento) ?? '',
        parcelas: 1,
        cliente: parsed.cliente,
        valor: parsed.valorTotal,
        vendedorId: '',
        valorTransferencia: 0,
        valorAFaturar: 0,
        frete: parsed.frete,
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

  async function handleSubmit(form: InvoiceDraft) {
    if (!session) return
    setSubmitting(true)
    const { error } = await supabase.from('invoices').insert({
      filial_id: form.filialId,
      estado: form.estado || null,
      numero_nf: form.numeroNf,
      data_emissao: form.dataEmissao,
      tipo_operacao: form.tipoOperacao,
      modalidade_pagamento: form.modalidadePagamento,
      meio_pagamento: form.meioPagamento,
      parcelas: form.parcelas,
      cliente: form.cliente,
      valor: form.valor,
      vendedor_id: form.vendedorId,
      valor_transferencia: form.valorTransferencia,
      valor_a_faturar: form.valorAFaturar,
      frete: form.frete,
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
    if (fileInputRef.current) fileInputRef.current.value = ''
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
              submitting={submitting}
              onCancel={closeDraft}
              onSubmit={handleSubmit}
            />
          )}
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
            {recent.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-sm">
                <div>
                  <p className="font-body-md text-body-md text-on-surface">
                    #{inv.numero_nf} · {inv.cliente}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {inv.filiais?.nome} · {inv.vendedores?.nome} · {formatDateTime(inv.created_at)}
                  </p>
                </div>
                <span className="font-tabular-nums text-on-surface">{formatCurrency(inv.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
