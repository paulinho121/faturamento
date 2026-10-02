import { supabase } from './supabaseClient'
import { apenasDigitos, type NotaSemComprovante, type TituloAberto } from './conciliacao'
import type { ConciliacaoBancaria } from '../types/domain'

export interface BoletoAbertoRow {
  id: string
  invoice_id: string
  valor: number
  juros: number | null
  valor_pago: number | null
  status: 'pendente' | 'pago' | 'parcial'
  data_pagamento: string | null
  vencimento: string
  invoices: {
    numero_nf: string
    cliente: string
    estado: string | null
    clientes: { cnpj_cpf: string | null } | null
  } | null
}

interface InvoiceRow {
  id: string
  numero_nf: string
  cliente: string
  valor: number
  data_emissao: string
  estado: string | null
  meio_pagamento: string
  clientes: { cnpj_cpf: string | null } | null
}

const arredonda = (v: number) => Math.round(v * 100) / 100

// Títulos em aberto (boleto) e notas pagas por outro meio que ainda não têm
// comprovante cobrindo o valor — tudo que um crédito do banco pode quitar.
export async function carregarCandidatos(): Promise<{
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
        'id, invoice_id, valor, juros, valor_pago, status, data_pagamento, vencimento, invoices!invoice_id(numero_nf, cliente, estado, clientes(cnpj_cpf))'
      )
      .eq('tipo', 'boleto')
      .eq('excluido', false)
      .neq('status', 'pago')
      .not('invoice_id', 'is', null),
    supabase
      .from('invoices')
      .select('id, numero_nf, cliente, valor, data_emissao, estado, meio_pagamento, clientes(cnpj_cpf)')
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
      saldo: arredonda(Number(b.valor) + Number(b.juros ?? 0) - Number(b.valor_pago ?? 0)),
      vencimento: b.vencimento,
      numeroNf: b.invoices?.numero_nf ?? '—',
      cliente: b.invoices?.cliente ?? '',
      estado: b.invoices?.estado ?? null,
      meio: 'Boleto',
    })
  }

  const comprovado = new Map<string, number>()
  for (const c of (comprovantesRes.data as { invoice_id: string; valor: number }[]) ?? []) {
    comprovado.set(c.invoice_id, (comprovado.get(c.invoice_id) ?? 0) + Number(c.valor))
  }
  const notas: NotaSemComprovante[] = []
  for (const inv of (invoicesRes.data as unknown as InvoiceRow[]) ?? []) {
    if (inv.meio_pagamento.trim().toUpperCase() === 'BOLETO') continue
    const saldo = arredonda(Number(inv.valor) - (comprovado.get(inv.id) ?? 0))
    if (saldo <= 0.004) continue
    notas.push({
      invoiceId: inv.id,
      documento: apenasDigitos(inv.clientes?.cnpj_cpf),
      saldo,
      numeroNf: inv.numero_nf,
      cliente: inv.cliente,
      dataEmissao: inv.data_emissao,
      estado: inv.estado,
      meio: inv.meio_pagamento,
    })
  }
  return { titulos, notas, linhasTitulos }
}

type Snapshot = NonNullable<ConciliacaoBancaria['snapshot']>

// Aplica `valor` num título (quita ou deixa parcial) e devolve o estado
// anterior pra poder desfazer.
export async function baixarTitulo(
  linha: BoletoAbertoRow,
  valor: number,
  data: string,
  conciliacaoId: string
): Promise<{ antes: Snapshot['titulos'][number]; erro: string | null }> {
  const antes = {
    id: linha.id,
    status: linha.status,
    valor_pago: Number(linha.valor_pago ?? 0),
    data_pagamento: linha.data_pagamento,
  }
  const total = Number(linha.valor) + Number(linha.juros ?? 0)
  const novoPago = arredonda(Math.min(antes.valor_pago + valor, total))
  const { error } = await supabase
    .from('boletos')
    .update({
      status: novoPago >= total - 0.005 ? 'pago' : 'parcial',
      valor_pago: novoPago,
      data_pagamento: data,
      conciliacao_id: conciliacaoId,
    })
    .eq('id', linha.id)
  return { antes, erro: error?.message ?? null }
}

// Nota paga por PIX/cartão: o "comprovante" é o próprio lançamento do banco.
export async function criarComprovante(
  nota: { invoiceId: string; cliente: string; dataEmissao: string },
  valor: number,
  data: string,
  conciliacaoId: string,
  userId: string
): Promise<{ id: string | null; erro: string | null }> {
  const { count } = await supabase
    .from('boletos')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'comprovante')
    .eq('invoice_id', nota.invoiceId)
  const { data: novo, error } = await supabase
    .from('boletos')
    .insert({
      invoice_id: nota.invoiceId,
      tipo: 'comprovante',
      numero_parcela: (count ?? 0) + 1,
      cliente_nome_importado: nota.cliente,
      valor: arredonda(valor),
      vencimento: nota.dataEmissao,
      status: 'pago',
      data_pagamento: data,
      conciliacao_id: conciliacaoId,
      created_by: userId,
    })
    .select('id')
    .single()
  return { id: novo?.id ?? null, erro: error?.message ?? (novo ? null : 'falha ao criar comprovante') }
}
