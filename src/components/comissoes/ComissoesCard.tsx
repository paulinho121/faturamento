import { useEffect, useState } from 'react'
import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

interface ComissaoRow {
  vendedor_id: string
  vendedor_nome: string
  percentual_comissao: number
  faturamento_periodo: number
  valor_comissao: number
}

// Período de apuração vai do dia 21 de um mês até o dia 20 do mês seguinte.
// mesFim/anoFim identificam o mês em que cai o dia 20 (o fechamento).
function periodoAtualFechamento(): { mes: number; ano: number } {
  const now = new Date()
  let mes = now.getMonth() + 1
  let ano = now.getFullYear()
  if (now.getDate() >= 21) {
    mes += 1
    if (mes > 12) {
      mes = 1
      ano += 1
    }
  }
  return { mes, ano }
}

function periodoLabel(mes: number, ano: number): string {
  const inicioMes = mes === 1 ? 12 : mes - 1
  const inicioAno = mes === 1 ? ano - 1 : ano
  return `21/${String(inicioMes).padStart(2, '0')} a 20/${String(mes).padStart(2, '0')}/${ano} · início em ${inicioAno !== ano ? inicioAno : ano}`
}

export function ComissoesCard() {
  const { push } = useToast()
  const [{ mes, ano }, setPeriodo] = useState(periodoAtualFechamento)
  const [rows, setRows] = useState<ComissaoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.rpc('dashboard_comissoes', { p_mes: mes, p_ano: ano })
    if (!error) setRows((data as ComissaoRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, ano])

  function mudarPeriodo(delta: number) {
    setPeriodo((prev) => {
      let novoMes = prev.mes + delta
      let novoAno = prev.ano
      if (novoMes > 12) {
        novoMes = 1
        novoAno += 1
      } else if (novoMes < 1) {
        novoMes = 12
        novoAno -= 1
      }
      return { mes: novoMes, ano: novoAno }
    })
  }

  async function salvarPercentual(vendedorId: string) {
    const valor = Number(editValue.replace(',', '.'))
    if (Number.isNaN(valor) || valor < 0 || valor > 100) {
      push('error', 'Informe um percentual entre 0 e 100.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('vendedores').update({ percentual_comissao: valor }).eq('id', vendedorId)
    setSaving(false)
    if (error) {
      push('error', `Erro ao salvar percentual: ${error.message}`)
      return
    }
    setEditingId(null)
    push('success', 'Percentual de comissão atualizado.')
    load()
  }

  const totalComissao = rows.reduce((acc, r) => acc + Number(r.valor_comissao), 0)
  const isPeriodoAtual = (() => {
    const atual = periodoAtualFechamento()
    return atual.mes === mes && atual.ano === ano
  })()

  return (
    <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">Comissão de Vendedores</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">{periodoLabel(mes, ano)}</p>
        </div>
        <div className="flex items-center gap-sm">
          <button
            onClick={() => mudarPeriodo(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
            aria-label="Período anterior"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <span className="min-w-[5rem] text-center font-title-md text-title-md text-on-surface">
            {MESES_CURTOS[mes - 1]}/{ano}
          </span>
          <button
            onClick={() => mudarPeriodo(1)}
            disabled={isPeriodoAtual}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-30"
            aria-label="Próximo período"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-sm">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="payments" title="Nenhum vendedor cadastrado" />
      ) : (
        <>
          <div className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
            {rows.map((r) => (
              <div key={r.vendedor_id} className="flex flex-wrap items-center justify-between gap-sm p-md">
                <div className="min-w-0">
                  <p className="font-body-md text-body-md font-medium text-on-surface">{r.vendedor_nome}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    Faturamento no período: {formatCurrency(r.faturamento_periodo)}
                  </p>
                </div>

                <div className="flex items-center gap-lg">
                  {editingId === r.vendedor_id ? (
                    <div className="flex items-center gap-xs">
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        disabled={saving}
                        className="w-20 rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-right font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
                      />
                      <span className="font-label-md text-label-md text-on-surface-variant">%</span>
                      <button
                        type="button"
                        onClick={() => salvarPercentual(r.vendedor_id)}
                        disabled={saving}
                        aria-label="Salvar percentual"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-tertiary hover:bg-tertiary/10 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">check</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                        aria-label="Cancelar"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(r.vendedor_id)
                        setEditValue(String(r.percentual_comissao))
                      }}
                      title="Clique para alterar o percentual"
                      className="group flex items-center gap-xs rounded-full bg-primary/10 px-md py-xs font-label-md text-label-md text-primary"
                    >
                      {r.percentual_comissao.toLocaleString('pt-BR')}%
                      <span className="material-symbols-outlined text-[14px] opacity-0 transition-opacity group-hover:opacity-100">
                        edit
                      </span>
                    </button>
                  )}

                  <span className="w-28 text-right font-tabular-nums font-semibold text-on-surface">
                    {formatCurrency(r.valor_comissao)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-md flex items-center justify-between border-t border-outline-variant pt-md">
            <span className="font-title-md text-title-md text-on-surface">Total de comissões no período</span>
            <span className="font-display text-display text-on-surface tabular-nums">{formatCurrency(totalComissao)}</span>
          </div>
        </>
      )}
    </div>
  )
}
