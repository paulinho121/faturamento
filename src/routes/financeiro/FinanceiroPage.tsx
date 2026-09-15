import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { KpiCard } from '../../components/kpi/KpiCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { parseTitulosXml, TitulosParseError } from '../../lib/titulosParser'
import { getModuleSwitcherItems } from '../../lib/modules'
import type { Boleto, Invoice } from '../../types/domain'

type Aba = 'todos' | 'pendentes' | 'vencidos' | 'pagos'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

function situacao(boleto: Boleto): { texto: string; classe: string } {
  if (boleto.status === 'pago') return { texto: 'Pago', classe: 'bg-tertiary/10 text-tertiary' }
  if (boleto.vencimento < hoje()) return { texto: 'Vencido', classe: 'bg-error/10 text-error' }
  return { texto: 'Pendente', classe: 'bg-amber-100 text-amber-700' }
}

// Só notas pagas via Boleto precisam de um título vinculado — as demais
// formas de pagamento (PIX, Cartão Rede, Pagarme…) precisam é de um
// comprovante anexado provando que o pagamento aconteceu.
function precisaDeBoleto(meioPagamento: string | null | undefined): boolean {
  return (meioPagamento?.trim().toUpperCase() ?? '') === 'BOLETO'
}

export function FinanceiroPage() {
  const { session, profile } = useAuth()
  const navItems = getModuleSwitcherItems(profile)
  const { push } = useToast()
  const now = new Date()
  const hora = now.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const [boletos, setBoletos] = useState<Boleto[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('todos')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  const [showManual, setShowManual] = useState(false)
  const [buscaNf, setBuscaNf] = useState('')
  const [notaEncontrada, setNotaEncontrada] = useState<Invoice | null>(null)
  const [buscandoNota, setBuscandoNota] = useState(false)
  const [manualParcela, setManualParcela] = useState(1)
  const [manualValor, setManualValor] = useState('')
  const [manualVencimento, setManualVencimento] = useState('')
  const [manualArquivo, setManualArquivo] = useState<File | null>(null)
  const [salvandoManual, setSalvandoManual] = useState(false)

  async function loadBoletos() {
    setLoading(true)
    const { data, error } = await supabase
      .from('boletos')
      .select('*, invoices(numero_nf, cliente)')
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

  async function loadAll() {
    await Promise.all([loadBoletos(), loadPendencias()])
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function handleToggleStatus(boleto: Boleto) {
    const novoStatus = boleto.status === 'pago' ? 'pendente' : 'pago'
    const { error } = await supabase.from('boletos').update({ status: novoStatus }).eq('id', boleto.id)
    if (error) {
      push('error', `Erro ao atualizar status: ${error.message}`)
      return
    }
    loadBoletos()
  }

  async function handleDelete(boleto: Boleto) {
    const { error } = await supabase.from('boletos').delete().eq('id', boleto.id)
    if (error) {
      push('error', `Erro ao remover título: ${error.message}`)
      return
    }
    if (boleto.arquivo_path) await supabase.storage.from('boletos').remove([boleto.arquivo_path])
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
    const path = `${boleto.invoice_id}/${Date.now()}-${file.name}`
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
    const path = `${invoice.id}/comprovante-${Date.now()}-${file.name}`
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

  async function handleSalvarManual(e: FormEvent) {
    e.preventDefault()
    if (!session || !notaEncontrada) return
    const valor = Number(manualValor.replace(/\./g, '').replace(',', '.'))
    if (!valor || valor <= 0) {
      push('error', 'Informe um valor válido.')
      return
    }
    if (!manualVencimento) {
      push('error', 'Informe a data de vencimento.')
      return
    }

    setSalvandoManual(true)
    let arquivoPath: string | null = null
    let arquivoNome: string | null = null
    if (manualArquivo) {
      if (manualArquivo.type !== 'application/pdf') {
        setSalvandoManual(false)
        push('error', 'O boleto precisa ser um arquivo PDF.')
        return
      }
      arquivoPath = `${notaEncontrada.id}/${Date.now()}-${manualArquivo.name}`
      const { error: uploadError } = await supabase.storage.from('boletos').upload(arquivoPath, manualArquivo)
      if (uploadError) {
        setSalvandoManual(false)
        push('error', `Erro ao enviar o arquivo: ${uploadError.message}`)
        return
      }
      arquivoNome = manualArquivo.name
    }

    const { error } = await supabase.from('boletos').insert({
      invoice_id: notaEncontrada.id,
      tipo: 'boleto',
      numero_parcela: manualParcela,
      cliente_nome_importado: notaEncontrada.cliente,
      valor,
      vencimento: manualVencimento,
      arquivo_path: arquivoPath,
      arquivo_nome: arquivoNome,
      created_by: session.user.id,
    })
    setSalvandoManual(false)

    if (error) {
      if (arquivoPath) await supabase.storage.from('boletos').remove([arquivoPath])
      push('error', `Erro ao salvar título: ${error.message}`)
      return
    }

    push('success', 'Título cadastrado.')
    setBuscaNf('')
    setNotaEncontrada(null)
    setManualParcela(1)
    setManualValor('')
    setManualVencimento('')
    setManualArquivo(null)
    setShowManual(false)
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

  const totalAberto = boletos.filter((b) => b.status === 'pendente').reduce((acc, b) => acc + Number(b.valor), 0)
  const totalVencido = boletos
    .filter((b) => b.status === 'pendente' && b.vencimento < hoje())
    .reduce((acc, b) => acc + Number(b.valor), 0)
  const totalPago = boletos.filter((b) => b.status === 'pago').reduce((acc, b) => acc + Number(b.valor), 0)

  const filtrados = boletos.filter((b) => {
    if (aba === 'pagos') return b.status === 'pago'
    if (aba === 'vencidos') return b.status === 'pendente' && b.vencimento < hoje()
    if (aba === 'pendentes') return b.status === 'pendente'
    return true
  })

  return (
    <AppShell title={`${saudacao}, Financeiro`} navItems={navItems} onRefresh={loadAll}>
      <div className="mb-lg grid grid-cols-2 gap-md lg:grid-cols-3">
        <KpiCard label="Em Aberto" value={formatCurrency(totalAberto)} icon="account_balance_wallet" loading={loading} />
        <KpiCard label="Vencido" value={formatCurrency(totalVencido)} icon="error" loading={loading} />
        <KpiCard label="Pago" value={formatCurrency(totalPago)} icon="task_alt" loading={loading} />
      </div>

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
            <EmptyState icon="task_alt" title="Tudo conciliado" />
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
                    {formatDate(invoice.data_emissao)} · {invoice.meio_pagamento}
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

      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 p-lg">
        <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Importar Títulos (XML)</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Exporte do sistema de contas a receber e envie aqui — reimportar não duplica.
            </p>
          </div>
          <div className="flex items-center gap-sm">
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
                <div className="flex items-center justify-between rounded-lg border border-outline-variant p-sm">
                  <span className="font-label-md text-label-md text-on-surface">
                    NF #{notaEncontrada.numero_nf} · {notaEncontrada.cliente}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNotaEncontrada(null)}
                    className="font-label-md text-label-md text-primary"
                  >
                    Trocar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Parcela</span>
                    <input
                      type="number"
                      min={1}
                      value={manualParcela}
                      onChange={(e) => setManualParcela(Number(e.target.value))}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Valor (R$)</span>
                    <input
                      inputMode="decimal"
                      placeholder="Ex.: 1.000,00"
                      value={manualValor}
                      onChange={(e) => setManualValor(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="col-span-2 block sm:col-span-1">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">Vencimento</span>
                    <input
                      type="date"
                      value={manualVencimento}
                      onChange={(e) => setManualVencimento(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="col-span-2 block sm:col-span-1">
                    <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">PDF (opcional)</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => setManualArquivo(e.target.files?.[0] ?? null)}
                      className="w-full text-body-md text-on-surface file:mr-sm file:rounded-full file:border-0 file:bg-primary file:px-md file:py-xs file:text-on-primary"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={salvandoManual}
                  className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {salvandoManual ? 'Salvando…' : 'Salvar título'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="p-lg border-b border-outline-variant flex flex-wrap items-center gap-sm">
          {(['todos', 'pendentes', 'vencidos', 'pagos'] as Aba[]).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                aba === a ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {a === 'todos' ? 'Todos' : a === 'pendentes' ? 'Pendentes' : a === 'vencidos' ? 'Vencidos' : 'Pagos'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="request_quote" title="Nenhum título encontrado" />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {filtrados.map((boleto) => {
              const { texto, classe } = situacao(boleto)
              return (
                <div key={boleto.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
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
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      Vencimento {formatDate(boleto.vencimento)}
                      {boleto.carteira ? ` · ${boleto.carteira}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-xs">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(boleto)}
                      title="Clique para alternar o status"
                      className={`rounded-full px-sm py-0.5 font-label-md text-label-md transition-opacity hover:opacity-80 ${classe}`}
                    >
                      {texto}
                    </button>
                    {boleto.arquivo_path ? (
                      <button
                        type="button"
                        onClick={() => handleDownload(boleto)}
                        title="Baixar boleto"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachingId(boleto.id)
                          attachInputRef.current?.click()
                        }}
                        disabled={!boleto.invoice_id}
                        title={boleto.invoice_id ? 'Anexar PDF' : 'Vincule a uma nota antes de anexar'}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-30"
                      >
                        <span className="material-symbols-outlined text-[18px]">upload_file</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(boleto)}
                      title="Remover título"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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
