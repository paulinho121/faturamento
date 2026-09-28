import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { OfxParseError, parseOfx } from '../../lib/ofxParser'
import {
  apenasDigitos,
  casar,
  classificar,
  type NotaSemComprovante,
  type TituloAberto,
} from '../../lib/conciliacao'
import { financeiroNavItems } from './nav'
import type { ConciliacaoBancaria } from '../../types/domain'

type Aba = 'conciliados' | 'revisar' | 'sem_identificacao'

interface BoletoAbertoRow {
  id: string
  invoice_id: string
  valor: number
  juros: number | null
  valor_pago: number | null
  status: 'pendente' | 'pago' | 'parcial'
  data_pagamento: string | null
  vencimento: string
  invoices: { numero_nf: string; cliente: string; clientes: { cnpj_cpf: string | null } | null } | null
}

interface InvoiceRow {
  id: string
  numero_nf: string
  cliente: string
  valor: number
  data_emissao: string
  meio_pagamento: string
  clientes: { cnpj_cpf: string | null } | null
}

interface ComprovanteRow {
  invoice_id: string
  valor: number
}

// Título ou nota já usados por uma baixa desse mesmo lote não podem casar de
// novo com outro crédito.
async function carregarCandidatos(): Promise<{
  titulos: TituloAberto[]
  notas: NotaSemComprovante[]
  linhasTitulos: Map<string, BoletoAbertoRow>
}> {
  const desde = new Date()
  desde.setDate(desde.getDate() - 180)

  const [boletosRes, invoicesRes, comprovantesRes] = await Promise.all([
    supabase
      .from('boletos')
      .select(
        'id, invoice_id, valor, juros, valor_pago, status, data_pagamento, vencimento, invoices(numero_nf, cliente, clientes(cnpj_cpf))'
      )
      .eq('tipo', 'boleto')
      .eq('excluido', false)
      .neq('status', 'pago')
      .not('invoice_id', 'is', null),
    supabase
      .from('invoices')
      .select('id, numero_nf, cliente, valor, data_emissao, meio_pagamento, clientes(cnpj_cpf)')
      .eq('excluida', false)
      .eq('afeta_faturamento', true)
      .neq('meio_pagamento', 'N/A')
      .gte('data_emissao', desde.toISOString().slice(0, 10)),
    supabase.from('boletos').select('invoice_id, valor').eq('tipo', 'comprovante').eq('excluido', false),
  ])

  const linhasTitulos = new Map<string, BoletoAbertoRow>()
  const titulos: TituloAberto[] = []
  for (const b of (boletosRes.data as unknown as BoletoAbertoRow[]) ?? []) {
    linhasTitulos.set(b.id, b)
    titulos.push({
      id: b.id,
      invoiceId: b.invoice_id,
      documento: apenasDigitos(b.invoices?.clientes?.cnpj_cpf),
      saldo: Math.round((Number(b.valor) + Number(b.juros ?? 0) - Number(b.valor_pago ?? 0)) * 100) / 100,
      vencimento: b.vencimento,
      numeroNf: b.invoices?.numero_nf ?? '—',
      cliente: b.invoices?.cliente ?? '',
    })
  }

  const comprovado = new Map<string, number>()
  for (const c of (comprovantesRes.data as ComprovanteRow[]) ?? []) {
    comprovado.set(c.invoice_id, (comprovado.get(c.invoice_id) ?? 0) + Number(c.valor))
  }
  const notas: NotaSemComprovante[] = []
  for (const inv of (invoicesRes.data as unknown as InvoiceRow[]) ?? []) {
    if (inv.meio_pagamento.trim().toUpperCase() === 'BOLETO') continue
    const saldo = Math.round((Number(inv.valor) - (comprovado.get(inv.id) ?? 0)) * 100) / 100
    if (saldo <= 0.004) continue
    notas.push({
      invoiceId: inv.id,
      documento: apenasDigitos(inv.clientes?.cnpj_cpf),
      saldo,
      numeroNf: inv.numero_nf,
      cliente: inv.cliente,
      dataEmissao: inv.data_emissao,
    })
  }
  return { titulos, notas, linhasTitulos }
}

export function ConciliacaoPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [linhas, setLinhas] = useState<ConciliacaoBancaria[]>([])
  const [loading, setLoading] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [aba, setAba] = useState<Aba>('conciliados')
  const [desfazendoId, setDesfazendoId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('conciliacoes_bancarias')
      .select('*')
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(600)
    if (!error) setLinhas((data as ConciliacaoBancaria[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Tenta casar cada crédito identificável ainda pendente com títulos/notas
  // em aberto e já baixa quando o casamento é certo.
  async function reprocessar(): Promise<{ baixados: number; restantes: number }> {
    if (!session) return { baixados: 0, restantes: 0 }
    const { data: pendentes } = await supabase
      .from('conciliacoes_bancarias')
      .select('*')
      .eq('status', 'pendente')
      .eq('categoria', 'identificavel')
      .order('data', { ascending: true })
    const lista = (pendentes as ConciliacaoBancaria[]) ?? []
    if (lista.length === 0) return { baixados: 0, restantes: 0 }

    const { titulos, notas, linhasTitulos } = await carregarCandidatos()
    let baixados = 0

    for (const c of lista) {
      if (!c.documento) continue
      const r = casar({ id: c.ofx_id, data: c.data, valor: Number(c.valor), memo: c.memo }, c.documento, titulos, notas)
      if (r.tipo === 'nenhum') {
        await supabase.from('conciliacoes_bancarias').update({ detalhe: r.motivo }).eq('id', c.id)
        continue
      }

      const snapshot: NonNullable<ConciliacaoBancaria['snapshot']> = { titulos: [], comprovantes: [] }
      let erro: string | null = null

      if (r.tipo === 'titulos') {
        for (const t of r.titulos) {
          const linha = linhasTitulos.get(t.id)!
          snapshot.titulos.push({
            id: t.id,
            status: linha.status,
            valor_pago: Number(linha.valor_pago ?? 0),
            data_pagamento: linha.data_pagamento,
          })
          const { error } = await supabase
            .from('boletos')
            .update({
              status: 'pago',
              valor_pago: Number(linha.valor) + Number(linha.juros ?? 0),
              data_pagamento: c.data,
              conciliacao_id: c.id,
            })
            .eq('id', t.id)
          if (error) erro = error.message
        }
      } else {
        const n = r.nota
        const { count } = await supabase
          .from('boletos')
          .select('id', { count: 'exact', head: true })
          .eq('tipo', 'comprovante')
          .eq('invoice_id', n.invoiceId)
        const { data: novo, error } = await supabase
          .from('boletos')
          .insert({
            invoice_id: n.invoiceId,
            tipo: 'comprovante',
            numero_parcela: (count ?? 0) + 1,
            cliente_nome_importado: n.cliente,
            valor: Number(c.valor),
            vencimento: n.dataEmissao,
            status: 'pago',
            data_pagamento: c.data,
            conciliacao_id: c.id,
            created_by: session.user.id,
          })
          .select('id')
          .single()
        if (error || !novo) erro = error?.message ?? 'falha ao criar comprovante'
        else snapshot.comprovantes.push(novo.id)
      }

      if (erro) {
        await supabase.from('conciliacoes_bancarias').update({ detalhe: `Erro ao baixar: ${erro}` }).eq('id', c.id)
        continue
      }

      await supabase
        .from('conciliacoes_bancarias')
        .update({
          status: 'conciliado',
          detalhe: r.detalhe,
          snapshot,
          conciliado_em: new Date().toISOString(),
        })
        .eq('id', c.id)
      baixados++

      if (r.tipo === 'titulos') {
        const usados = new Set(r.titulos.map((t) => t.id))
        for (let i = titulos.length - 1; i >= 0; i--) if (usados.has(titulos[i].id)) titulos.splice(i, 1)
      } else {
        const idx = notas.findIndex((x) => x.invoiceId === r.nota.invoiceId)
        if (idx >= 0) notas.splice(idx, 1)
      }
    }
    return { baixados, restantes: lista.length - baixados }
  }

  async function handleImportar(file: File) {
    if (!session) return
    setProcessando(true)
    try {
      const texto = new TextDecoder('windows-1252').decode(await file.arrayBuffer())
      const transacoes = parseOfx(texto)

      const classificadas = transacoes.flatMap((t) => {
        const c = classificar(t)
        return c ? [{ t, ...c }] : []
      })
      if (classificadas.length === 0) {
        push('error', 'Nenhum recebimento encontrado nesse extrato.')
        return
      }

      const { data: existentes } = await supabase
        .from('conciliacoes_bancarias')
        .select('ofx_id')
        .in('ofx_id', classificadas.map((x) => x.t.id))
      const jaImportados = new Set((existentes ?? []).map((e) => e.ofx_id as string))
      const novos = classificadas.filter((x) => !jaImportados.has(x.t.id))

      if (novos.length > 0) {
        const { error } = await supabase.from('conciliacoes_bancarias').insert(
          novos.map(({ t, categoria, documento }) => ({
            ofx_id: t.id,
            data: t.data,
            valor: t.valor,
            memo: t.memo,
            documento,
            categoria,
            created_by: session.user.id,
          }))
        )
        if (error) {
          push('error', `Erro ao importar extrato: ${error.message}`)
          return
        }
      }

      const { baixados, restantes } = await reprocessar()
      push(
        'success',
        `${novos.length} lançamento${novos.length === 1 ? '' : 's'} novo${novos.length === 1 ? '' : 's'} · ${baixados} baixa${baixados === 1 ? '' : 's'} automática${baixados === 1 ? '' : 's'} · ${restantes} para revisar.`
      )
      setAba(baixados > 0 ? 'conciliados' : 'revisar')
      await load()
    } catch (err) {
      push('error', err instanceof OfxParseError ? err.message : 'Não foi possível ler esse extrato.')
    } finally {
      setProcessando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleReprocessar() {
    setProcessando(true)
    const { baixados, restantes } = await reprocessar()
    setProcessando(false)
    push(
      baixados > 0 ? 'success' : 'info',
      baixados > 0
        ? `${baixados} baixa${baixados === 1 ? '' : 's'} automática${baixados === 1 ? '' : 's'} · ${restantes} para revisar.`
        : 'Nada novo pra baixar agora.'
    )
    await load()
  }

  async function handleDesfazer(c: ConciliacaoBancaria) {
    if (!session || !c.snapshot) return
    setDesfazendoId(c.id)
    let erro: string | null = null
    for (const t of c.snapshot.titulos) {
      const { error } = await supabase
        .from('boletos')
        .update({
          status: t.status,
          valor_pago: t.valor_pago,
          data_pagamento: t.data_pagamento,
          conciliacao_id: null,
        })
        .eq('id', t.id)
      if (error) erro = error.message
    }
    if (c.snapshot.comprovantes.length > 0) {
      const { error } = await supabase
        .from('boletos')
        .update({ excluido: true, excluido_em: new Date().toISOString(), excluido_por: session.user.id })
        .in('id', c.snapshot.comprovantes)
      if (error) erro = error.message
    }
    if (erro) {
      setDesfazendoId(null)
      push('error', `Erro ao desfazer: ${erro}`)
      return
    }
    await supabase
      .from('conciliacoes_bancarias')
      .update({ status: 'ignorado', detalhe: 'Baixa desfeita manualmente', snapshot: null, conciliado_em: null })
      .eq('id', c.id)
    setDesfazendoId(null)
    push('success', 'Baixa desfeita.')
    load()
  }

  async function handleIgnorar(c: ConciliacaoBancaria) {
    const { error } = await supabase.from('conciliacoes_bancarias').update({ status: 'ignorado' }).eq('id', c.id)
    if (error) {
      push('error', `Erro: ${error.message}`)
      return
    }
    load()
  }

  const conciliados = linhas.filter((l) => l.status === 'conciliado')
  const revisar = linhas.filter(
    (l) => l.status === 'pendente' && (l.categoria === 'identificavel' || l.categoria === 'outro')
  )
  const semIdentificacao = linhas.filter(
    (l) => l.status === 'pendente' && (l.categoria === 'cartao' || l.categoria === 'boletos_lote')
  )
  const porAba: Record<Aba, ConciliacaoBancaria[]> = {
    conciliados,
    revisar,
    sem_identificacao: semIdentificacao,
  }
  const exibidas = porAba[aba]
  const totalBaixado = conciliados.reduce((acc, l) => acc + Number(l.valor), 0)

  return (
    <AppShell title="Conciliação" navItems={financeiroNavItems(profile)} onRefresh={load}>
      <div className="mb-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant p-lg">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Conciliação Bancária</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Importe o extrato OFX do banco: PIX/TED/boleto com CNPJ ou CPF e valor iguais ao de um título ou nota em
              aberto são baixados automaticamente.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-sm">
            <button
              type="button"
              onClick={handleReprocessar}
              disabled={processando}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">sync</span>
              Reprocessar pendentes
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={processando}
              className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${processando ? 'animate-spin' : ''}`}
              >
                {processando ? 'progress_activity' : 'upload_file'}
              </span>
              {processando ? 'Processando…' : 'Importar extrato (OFX)'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".ofx,text/plain"
              onChange={(e) => e.target.files?.[0] && handleImportar(e.target.files[0])}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-sm border-b border-outline-variant p-md">
          {(
            [
              ['conciliados', 'Baixados automaticamente', conciliados.length],
              ['revisar', 'Para revisar', revisar.length],
              ['sem_identificacao', 'Sem identificação (cartão / lote de boletos)', semIdentificacao.length],
            ] as const
          ).map(([chave, label, total]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setAba(chave)}
              className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                aba === chave ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
              {total > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    aba === chave ? 'bg-on-primary/20' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {total}
                </span>
              )}
            </button>
          ))}
          {aba === 'conciliados' && conciliados.length > 0 && (
            <span className="ml-auto font-label-md text-label-md text-on-surface-variant">
              Total baixado: {formatCurrency(totalBaixado)}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : exibidas.length === 0 ? (
          <div className="p-lg">
            <EmptyState icon="account_balance" title="Nada por aqui — importe um extrato OFX" />
          </div>
        ) : (
          <div className="max-h-[70vh] divide-y divide-outline-variant overflow-y-auto">
            {exibidas.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-sm p-lg">
                <div className="min-w-0">
                  <p className="font-body-md text-body-md text-on-surface">
                    <span className="font-medium">{formatCurrency(Number(l.valor))}</span>
                    <span className="ml-sm font-label-md text-label-md text-on-surface-variant">
                      {formatDate(l.data)}
                    </span>
                  </p>
                  <p className="truncate font-label-md text-label-md text-on-surface-variant">{l.memo}</p>
                  {l.detalhe && (
                    <p
                      className={`font-label-md text-label-md ${
                        l.status === 'conciliado' ? 'text-tertiary' : 'text-amber-700'
                      }`}
                    >
                      {l.detalhe}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-sm">
                  {l.status === 'conciliado' ? (
                    <button
                      type="button"
                      onClick={() => handleDesfazer(l)}
                      disabled={desfazendoId === l.id}
                      className="flex items-center gap-xs rounded-full border border-error/40 px-md py-xs font-label-md text-label-md text-error transition-colors hover:bg-error/5 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">undo</span>
                      {desfazendoId === l.id ? 'Desfazendo…' : 'Desfazer baixa'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleIgnorar(l)}
                      className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      Ignorar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
