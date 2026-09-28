import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { baixarTitulo, carregarCandidatos, criarComprovante, type BoletoAbertoRow } from '../../lib/conciliacaoDados'
import type { ConciliacaoBancaria } from '../../types/domain'

interface Candidato {
  key: string
  tipo: 'nota' | 'titulo'
  id: string
  invoiceId: string
  numeroNf: string
  cliente: string
  estado: string | null
  meio: string
  saldo: number
  data: string
  documento: string | null
  dataEmissao: string
}

type Tolerancia = '5' | '10' | '25' | 'ate'

const CHAVE_ESTADOS = 'conciliacao_estado_por_codigo'

// Código do estabelecimento na Rede (CD0094712751): cada maquininha/filial
// tem o seu — quando o financeiro escolhe um estado pra ele uma vez, lembra
// nas próximas.
function codigoEstabelecimento(memo: string): string | null {
  return memo.match(/\bCD\d{6,}\b/)?.[0] ?? null
}

function lerEstadosSalvos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ESTADOS) ?? '{}')
  } catch {
    return {}
  }
}

function meioSugerido(memo: string): string {
  const m = memo.toUpperCase()
  if (/REDE/.test(m)) return 'REDE'
  if (/PAGAR\.?ME/.test(m)) return 'PAGARME'
  if (/^PIX/.test(m)) return 'PIX'
  return ''
}

export function SugestoesConciliacaoModal({
  conciliacao,
  onClose,
  onDone,
}: {
  conciliacao: ConciliacaoBancaria
  onClose: () => void
  onDone: () => void
}) {
  const { session } = useAuth()
  const { push } = useToast()
  const valor = Number(conciliacao.valor)
  const codigo = codigoEstabelecimento(conciliacao.memo)

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null)
  const [linhasTitulos, setLinhasTitulos] = useState<Map<string, BoletoAbertoRow>>(new Map())
  const [estado, setEstado] = useState('')
  const [meio, setMeio] = useState('')
  const [tolerancia, setTolerancia] = useState<Tolerancia>(conciliacao.categoria === 'cartao' ? 'ate' : '10')
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [quitarCompleto, setQuitarCompleto] = useState(conciliacao.categoria === 'cartao')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarCandidatos().then(({ titulos, notas, linhasTitulos: linhas }) => {
      const lista: Candidato[] = [
        ...notas.map((n) => ({
          key: `n:${n.invoiceId}`,
          tipo: 'nota' as const,
          id: n.invoiceId,
          invoiceId: n.invoiceId,
          numeroNf: n.numeroNf,
          cliente: n.cliente,
          estado: n.estado,
          meio: n.meio,
          saldo: n.saldo,
          data: n.dataEmissao,
          documento: n.documento,
          dataEmissao: n.dataEmissao,
        })),
        ...titulos.map((t) => ({
          key: `t:${t.id}`,
          tipo: 'titulo' as const,
          id: t.id,
          invoiceId: t.invoiceId,
          numeroNf: t.numeroNf,
          cliente: t.cliente,
          estado: t.estado,
          meio: t.meio,
          saldo: t.saldo,
          data: t.vencimento,
          documento: t.documento,
          dataEmissao: t.vencimento,
        })),
      ]
      setCandidatos(lista)
      setLinhasTitulos(linhas)
      const salvo = codigo ? lerEstadosSalvos()[codigo] : undefined
      const doPagador = conciliacao.documento
        ? lista.find((c) => c.documento === conciliacao.documento && c.estado)?.estado
        : undefined
      setEstado(salvo ?? doPagador ?? '')
      const palavra = meioSugerido(conciliacao.memo)
      const nomeMeio = palavra ? lista.find((c) => c.meio.toUpperCase().includes(palavra))?.meio : undefined
      if (nomeMeio) setMeio(nomeMeio.toUpperCase())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const estados = useMemo(
    () => Array.from(new Set((candidatos ?? []).map((c) => c.estado).filter((e): e is string => Boolean(e)))).sort(),
    [candidatos]
  )
  const meios = useMemo(
    () => Array.from(new Set((candidatos ?? []).map((c) => c.meio))).sort((a, b) => a.localeCompare(b)),
    [candidatos]
  )

  const sugestoes = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const limite = tolerancia === 'ate' ? valor * 1.005 : valor * (1 + Number(tolerancia) / 100)
    const piso = tolerancia === 'ate' ? 0 : valor * (1 - Number(tolerancia) / 100)
    return (candidatos ?? [])
      .filter((c) => (estado ? c.estado === estado : true))
      .filter((c) => (meio ? c.meio.toUpperCase().includes(meio) : true))
      .filter((c) => c.saldo <= limite && c.saldo >= piso)
      .filter((c) => !termo || `${c.numeroNf} ${c.cliente}`.toLowerCase().includes(termo))
      .sort((a, b) => Math.abs(a.saldo - valor) - Math.abs(b.saldo - valor))
      .slice(0, 80)
  }, [candidatos, estado, meio, tolerancia, busca, valor])

  const escolhidos = (candidatos ?? []).filter((c) => selecionados.has(c.key))
  const totalEscolhido = escolhidos.reduce((acc, c) => acc + c.saldo, 0)
  const diferenca = Math.round((valor - totalEscolhido) * 100) / 100

  function alternar(key: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(key)) novo.delete(key)
      else novo.add(key)
      return novo
    })
  }

  async function handleBaixar() {
    if (!session || escolhidos.length === 0) return
    setSalvando(true)
    const snapshot: NonNullable<ConciliacaoBancaria['snapshot']> = { titulos: [], comprovantes: [] }
    let restante = valor
    let erro: string | null = null
    const aplicadas: string[] = []

    for (const c of escolhidos) {
      const aplicar = quitarCompleto ? c.saldo : Math.min(c.saldo, restante)
      if (aplicar <= 0.004) continue
      restante -= aplicar
      if (c.tipo === 'titulo') {
        const res = await baixarTitulo(linhasTitulos.get(c.id)!, aplicar, conciliacao.data, conciliacao.id)
        snapshot.titulos.push(res.antes)
        if (res.erro) erro = res.erro
      } else {
        const res = await criarComprovante(c, aplicar, conciliacao.data, conciliacao.id, session.user.id)
        if (res.id) snapshot.comprovantes.push(res.id)
        if (res.erro) erro = res.erro
      }
      aplicadas.push(c.numeroNf)
    }

    if (erro) {
      setSalvando(false)
      push('error', `Erro ao baixar: ${erro}`)
      return
    }

    const sobra = !quitarCompleto && restante > 0.004 ? ` · sobrou ${formatCurrency(restante)}` : ''
    const { error } = await supabase
      .from('conciliacoes_bancarias')
      .update({
        status: 'conciliado',
        detalhe: `Baixa manual: NF ${aplicadas.join(', ')}${sobra}`,
        snapshot,
        conciliado_em: new Date().toISOString(),
      })
      .eq('id', conciliacao.id)
    setSalvando(false)
    if (error) {
      push('error', `Baixa feita, mas falhou ao registrar a conciliação: ${error.message}`)
      return
    }

    const estadosEscolhidos = new Set(escolhidos.map((c) => c.estado))
    if (codigo && estadosEscolhidos.size === 1) {
      const unico = escolhidos[0].estado
      if (unico) localStorage.setItem(CHAVE_ESTADOS, JSON.stringify({ ...lerEstadosSalvos(), [codigo]: unico }))
    }
    push('success', `Baixa feita em ${aplicadas.length} nota${aplicadas.length === 1 ? '' : 's'}/título${aplicadas.length === 1 ? '' : 's'}.`)
    onDone()
  }

  const selectClass =
    'rounded-full border border-outline-variant bg-surface-container-lowest px-md py-xs font-label-md text-label-md text-on-surface outline-none focus:border-primary'

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl">
      <div className="p-lg">
        <div className="mb-md">
          <h3 className="font-title-md text-title-md text-on-surface">
            Sugestões para {formatCurrency(valor)}
          </h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {formatDate(conciliacao.data)} · {conciliacao.memo}
          </p>
        </div>

        <div className="mb-md flex flex-wrap items-center gap-sm">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={selectClass}>
            <option value="">Todos os estados</option>
            {estados.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <select value={meio} onChange={(e) => setMeio(e.target.value)} className={selectClass}>
            <option value="">Qualquer forma de pagamento</option>
            {meios.map((m) => (
              <option key={m} value={m.toUpperCase()}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={tolerancia}
            onChange={(e) => setTolerancia(e.target.value as Tolerancia)}
            className={selectClass}
          >
            <option value="5">Valor ±5%</option>
            <option value="10">Valor ±10%</option>
            <option value="25">Valor ±25%</option>
            <option value="ate">Qualquer valor até o do pagamento</option>
          </select>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="NF ou cliente…"
            className={`${selectClass} w-40`}
          />
        </div>
        {codigo && (
          <p className="mb-sm font-label-md text-label-md text-on-surface-variant">
            Estabelecimento {codigo}: o estado que você escolher aqui fica lembrado pras próximas.
          </p>
        )}

        {candidatos === null ? (
          <Skeleton className="h-32 w-full" />
        ) : sugestoes.length === 0 ? (
          <p className="rounded-lg bg-surface-container-low p-md font-body-md text-body-md text-on-surface-variant">
            Nenhuma nota ou título em aberto com esses filtros. Amplie o valor ou tire o filtro de estado.
          </p>
        ) : (
          <div className="max-h-[45vh] divide-y divide-outline-variant overflow-y-auto rounded-lg border border-outline-variant">
            {sugestoes.map((c) => {
              const dif = Math.round((c.saldo - valor) * 100) / 100
              return (
                <label
                  key={c.key}
                  className={`flex cursor-pointer items-center gap-sm p-md transition-colors hover:bg-surface-container-low ${
                    selecionados.has(c.key) ? 'bg-primary/5' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selecionados.has(c.key)}
                    onChange={() => alternar(c.key)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body-md text-body-md text-on-surface">
                      <span className="font-label-md text-label-md text-on-surface-variant">NF {c.numeroNf}</span>{' '}
                      {c.cliente}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {c.estado ?? '—'} · {c.meio} · {c.tipo === 'titulo' ? 'vence' : 'emitida'} {formatDate(c.data)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-body-md text-body-md text-on-surface">{formatCurrency(c.saldo)}</p>
                    <p
                      className={`font-label-md text-label-md ${
                        Math.abs(dif) < 0.005 ? 'text-tertiary' : 'text-on-surface-variant'
                      }`}
                    >
                      {Math.abs(dif) < 0.005 ? 'valor exato' : `${dif > 0 ? '+' : '−'}${formatCurrency(Math.abs(dif))}`}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        )}

        <div className="mt-md space-y-sm">
          <p className="font-label-md text-label-md text-on-surface">
            Selecionado: <b>{formatCurrency(totalEscolhido)}</b> de {formatCurrency(valor)}
            {escolhidos.length > 0 && (
              <span className="text-on-surface-variant">
                {' '}
                · diferença {diferenca >= 0 ? '' : '−'}
                {formatCurrency(Math.abs(diferenca))}
              </span>
            )}
          </p>
          <label className="flex items-start gap-xs font-label-md text-label-md text-on-surface-variant">
            <input
              type="checkbox"
              checked={quitarCompleto}
              onChange={(e) => setQuitarCompleto(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            Quitar as notas por completo (a diferença é taxa da operadora ou juros). Desmarcado, o pagamento é
            distribuído na ordem e a última pode ficar parcial.
          </label>
        </div>

        <div className="mt-md flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleBaixar}
            disabled={salvando || escolhidos.length === 0}
            className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">check</span>
            {salvando ? 'Baixando…' : 'Baixar selecionadas'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
