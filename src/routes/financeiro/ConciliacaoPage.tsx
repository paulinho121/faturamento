import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { OfxParseError, parseOfx } from '../../lib/ofxParser'
import { casar, classificar } from '../../lib/conciliacao'
import { baixarTitulo, carregarCandidatos, criarComprovante } from '../../lib/conciliacaoDados'
import { carregarBoletosParaImportacao, registrarPagamentoDireto } from '../../lib/boletosImportacao'
import { parseTitulosXml, TitulosParseError } from '../../lib/titulosParser'
import { parseRetornoCnab400, RetornoParseError, type RetornoTitulo } from '../../lib/retornoCnab400Parser'
import { parseTitulosBancoTxt, TitulosBancoParseError, type TituloBanco } from '../../lib/titulosBancoParser'
import { SugestoesConciliacaoModal } from '../../components/financeiro/SugestoesConciliacaoModal'
import { ImportarRetornoModal } from '../../components/financeiro/ImportarRetornoModal'
import { financeiroNavItems } from './nav'
import type { Boleto, ConciliacaoBancaria } from '../../types/domain'

type Aba = 'conciliados' | 'revisar' | 'sem_identificacao'

export function ConciliacaoPage() {
  const { session, profile } = useAuth()
  const { push } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [linhas, setLinhas] = useState<ConciliacaoBancaria[]>([])
  const [loading, setLoading] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [aba, setAba] = useState<Aba>('conciliados')
  const [desfazendoId, setDesfazendoId] = useState<string | null>(null)
  const [comSugestoes, setComSugestoes] = useState<ConciliacaoBancaria | null>(null)

  // Importação de títulos (XML), retorno bancário (.RET) e lista de títulos
  // em aberto (.txt) — antes ficava no Financeiro, mas é tudo conciliação de
  // título com o banco, então mora aqui junto com o extrato OFX.
  const [importingXml, setImportingXml] = useState(false)
  const xmlInputRef = useRef<HTMLInputElement>(null)
  const [importingRetorno, setImportingRetorno] = useState(false)
  const retornoInputRef = useRef<HTMLInputElement>(null)
  const [retornoRegistros, setRetornoRegistros] = useState<RetornoTitulo[] | null>(null)
  const [boletosParaVincular, setBoletosParaVincular] = useState<Boleto[]>([])
  const [importingTitulosBanco, setImportingTitulosBanco] = useState(false)
  const titulosBancoInputRef = useRef<HTMLInputElement>(null)

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
          const aplicar = t.saldo
          const res = await baixarTitulo(linha, aplicar, c.data, c.id)
          snapshot.titulos.push(res.antes)
          if (res.erro) erro = res.erro
        }
      } else {
        const res = await criarComprovante(r.nota, Number(c.valor), c.data, c.id, session.user.id)
        if (res.id) snapshot.comprovantes.push(res.id)
        if (res.erro) erro = res.erro
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

  async function handleImportTitulosXml(file: File) {
    if (!session) return
    setImportingXml(true)
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
        created_by: session.user.id,
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
    } catch (err) {
      push('error', err instanceof TitulosParseError ? err.message : 'Não foi possível ler este XML de títulos.')
    } finally {
      setImportingXml(false)
      if (xmlInputRef.current) xmlInputRef.current.value = ''
    }
  }

  async function handleImportRetorno(file: File) {
    setImportingRetorno(true)
    try {
      const texto = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
      const registros = parseRetornoCnab400(texto)
      const todosBoletos = await carregarBoletosParaImportacao()

      // Casa sozinho quando o Nosso Número (núcleo + DAC) do .RET bate com o
      // que foi gravado pela importação do .txt de títulos em aberto — só
      // baixa automático se for exatamente um título candidato, nunca no chute.
      let baixadosAuto = 0
      const restantes: RetornoTitulo[] = []
      for (const registro of registros) {
        const candidatos = registro.liquidacao
          ? todosBoletos.filter(
              (b) => b.tipo === 'boleto' && b.status !== 'pago' && b.nosso_numero === registro.nossoNumeroCompleto
            )
          : []
        if (candidatos.length === 1) {
          const { ok } = await registrarPagamentoDireto(
            candidatos[0],
            registro.valorPago,
            registro.jurosMulta,
            registro.dataOcorrencia
          )
          if (ok) {
            baixadosAuto++
            continue
          }
        }
        restantes.push(registro)
      }

      if (baixadosAuto > 0) {
        push(
          'success',
          `${baixadosAuto} título${baixadosAuto === 1 ? '' : 's'} baixado${baixadosAuto === 1 ? '' : 's'} automaticamente pelo Nosso Número.`
        )
      }
      if (restantes.length > 0) {
        setBoletosParaVincular(todosBoletos.filter((b) => b.tipo === 'boleto' && b.status !== 'pago'))
        setRetornoRegistros(restantes)
      }
    } catch (err) {
      push('error', err instanceof RetornoParseError ? err.message : 'Não foi possível ler este arquivo de retorno.')
    } finally {
      setImportingRetorno(false)
      if (retornoInputRef.current) retornoInputRef.current.value = ''
    }
  }

  async function handleVincularRetorno(boleto: Boleto, registro: RetornoTitulo): Promise<boolean> {
    const { ok, erro } = await registrarPagamentoDireto(boleto, registro.valorPago, registro.jurosMulta, registro.dataOcorrencia)
    if (ok) push('success', `Título vinculado e baixado (Nosso Nº ${registro.nossoNumero}).`)
    else push('error', `Erro ao registrar pagamento: ${erro}`)
    return ok
  }

  // Acha o boleto certo pro "Seu Número" da lista do banco — que às vezes
  // vem truncado (sem o "-N/M" final). Se mais de um título bater com o
  // prefixo, não arrisca escolher sozinho (fica pra revisão manual). O
  // vencimento (que o .txt também traz) desempata entre parcelas da mesma
  // série ("000010564-1/5", "-2/5"...), que o banco trunca de forma idêntica.
  function encontrarBoletoPorSeuNumero(registro: TituloBanco, boletosLista: Boleto[]): Boleto | null {
    const alvo = registro.seuNumero.trim()
    if (!alvo) return null
    const exatos = boletosLista.filter((b) => b.tipo === 'boleto' && b.numero_titulo === alvo)
    if (exatos.length === 1) return exatos[0]
    if (exatos.length > 1) return null
    const prefixados = boletosLista.filter((b) => b.tipo === 'boleto' && b.numero_titulo?.startsWith(alvo))
    if (prefixados.length === 1) return prefixados[0]
    const porVencimento = prefixados.filter((b) => b.vencimento === registro.vencimento)
    if (porVencimento.length === 1) return porVencimento[0]
    const porValor = porVencimento.filter((b) => Math.abs(Number(b.valor) - registro.valor) < 0.005)
    return porValor.length === 1 ? porValor[0] : null
  }

  async function handleImportTitulosBanco(file: File) {
    setImportingTitulosBanco(true)
    try {
      const texto = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
      const registros = parseTitulosBancoTxt(texto)
      const todosBoletos = await carregarBoletosParaImportacao()

      const casados = registros.map((r) => ({ registro: r, boleto: encontrarBoletoPorSeuNumero(r, todosBoletos) }))
      const naoEncontrados = casados.filter((x) => !x.boleto).length
      const paraAtualizar = casados.filter(
        (x): x is { registro: TituloBanco; boleto: Boleto } =>
          x.boleto !== null && x.boleto.nosso_numero !== x.registro.nossoNumero
      )

      let erros = 0
      for (const { registro, boleto } of paraAtualizar) {
        const { error } = await supabase
          .from('boletos')
          .update({ nosso_numero: registro.nossoNumero })
          .eq('id', boleto.id)
        if (error) erros++
      }

      const vinculados = paraAtualizar.length - erros
      push(
        erros > 0 ? 'error' : 'success',
        `${vinculados} vinculado${vinculados === 1 ? '' : 's'} ao Nosso Número` +
          (naoEncontrados > 0 ? ` · ${naoEncontrados} sem título correspondente no sistema` : '') +
          (erros > 0 ? ` · ${erros} erro${erros === 1 ? '' : 's'}` : '')
      )
    } catch (err) {
      push(
        'error',
        err instanceof TitulosBancoParseError ? err.message : 'Não foi possível ler esse arquivo de títulos do banco.'
      )
    } finally {
      setImportingTitulosBanco(false)
      if (titulosBancoInputRef.current) titulosBancoInputRef.current.value = ''
    }
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
          <span className="font-label-md text-label-md text-on-surface-variant">Títulos:</span>
          <button
            type="button"
            onClick={() => xmlInputRef.current?.click()}
            disabled={importingXml}
            className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {importingXml ? (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[16px]">upload_file</span>
            )}
            {importingXml ? 'Importando…' : 'Importar XML'}
          </button>
          <input
            ref={xmlInputRef}
            type="file"
            accept=".xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportTitulosXml(file)
            }}
          />
          <button
            type="button"
            onClick={() => retornoInputRef.current?.click()}
            disabled={importingRetorno}
            className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {importingRetorno ? (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[16px]">account_balance</span>
            )}
            {importingRetorno ? 'Lendo…' : 'Importar Retorno (.RET)'}
          </button>
          <input
            ref={retornoInputRef}
            type="file"
            accept=".ret,.RET,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportRetorno(file)
            }}
          />
          <button
            type="button"
            onClick={() => titulosBancoInputRef.current?.click()}
            disabled={importingTitulosBanco}
            title="Lista de títulos em aberto que o banco manda — usa pra guardar o Nosso Número de cada título"
            className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {importingTitulosBanco ? (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[16px]">link</span>
            )}
            {importingTitulosBanco ? 'Lendo…' : 'Importar Nosso Número (.txt)'}
          </button>
          <input
            ref={titulosBancoInputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportTitulosBanco(file)
            }}
          />
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
                    <>
                      <button
                        type="button"
                        onClick={() => setComSugestoes(l)}
                        className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
                      >
                        <span className="material-symbols-outlined text-[16px]">search</span>
                        Sugestões
                      </button>
                      <button
                        type="button"
                        onClick={() => handleIgnorar(l)}
                        className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
                      >
                        Ignorar
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {comSugestoes && (
        <SugestoesConciliacaoModal
          conciliacao={comSugestoes}
          onClose={() => setComSugestoes(null)}
          onDone={() => {
            setComSugestoes(null)
            load()
          }}
        />
      )}

      {retornoRegistros && (
        <ImportarRetornoModal
          registros={retornoRegistros}
          boletosAbertos={boletosParaVincular}
          onVincular={handleVincularRetorno}
          onClose={() => setRetornoRegistros(null)}
        />
      )}
    </AppShell>
  )
}
