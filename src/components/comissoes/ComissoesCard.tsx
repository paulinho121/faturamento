import { useEffect, useState, MouseEvent } from 'react'
import { Skeleton } from '../ui/Skeleton'
import { ExtratoVendedorModal } from './ExtratoVendedorModal'
import { EmptyState } from '../ui/EmptyState'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'

interface ComissaoRow {
  vendedor_id: string
  vendedor_nome: string
  percentual_comissao: number
  faturamento_periodo: number
  valor_comissao: number
}

export function ComissoesCard() {
  const { push } = useToast()
  
  // Define default dates: start of current month to today
  const today = new Date()
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
  const formatForInput = (d: Date) => d.toISOString().split('T')[0]
  
  const [dataInicio, setDataInicio] = useState(formatForInput(firstDay))
  const [dataFim, setDataFim] = useState(formatForInput(today))
  const [isEditingDate, setIsEditingDate] = useState(false)
  const [selectedVendedor, setSelectedVendedor] = useState<{ id: string; nome: string } | null>(null)
  
  const [rows, setRows] = useState<ComissaoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!dataInicio || !dataFim) return
    setLoading(true)
    const { data, error } = await supabase.rpc('dashboard_comissoes', { p_data_inicio: dataInicio, p_data_fim: dataFim })
    if (!error) setRows((data as ComissaoRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <div className="lg:col-span-12 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-level2">
      <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
        <div>
          <h3 className="font-title-md text-title-md text-on-surface">Comissão de Vendedores</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">Selecione o período de apuração</p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <input 
            type="date"
            value={dataInicio}
            onChange={e => setDataInicio(e.target.value)}
            disabled={!isEditingDate}
            className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-on-surface font-body-md focus:border-primary focus:outline-none disabled:opacity-60"
          />
          <span className="text-on-surface-variant">até</span>
          <input 
            type="date"
            value={dataFim}
            onChange={e => setDataFim(e.target.value)}
            disabled={!isEditingDate}
            className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-on-surface font-body-md focus:border-primary focus:outline-none disabled:opacity-60"
          />
          
          {!isEditingDate ? (
            <button
              onClick={() => setIsEditingDate(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Editar período"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsEditingDate(false)
                load()
              }}
              className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:bg-primary/90 transition-colors"
            >
              Calcular
            </button>
          )}
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
              <div 
                key={r.vendedor_id} 
                className="flex flex-wrap items-center justify-between gap-sm p-md hover:bg-surface-container-high cursor-pointer transition-colors"
                onClick={() => setSelectedVendedor({ id: r.vendedor_id, nome: r.vendedor_nome })}
              >
                <div className="min-w-0">
                  <p className="font-body-md text-body-md font-medium text-on-surface">{r.vendedor_nome}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    Faturamento no período: {formatCurrency(r.faturamento_periodo)}
                  </p>
                </div>

                <div 
                  className="flex items-center gap-lg"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                >
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

      {selectedVendedor && (
        <ExtratoVendedorModal
          vendedorId={selectedVendedor.id}
          vendedorNome={selectedVendedor.nome}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onClose={() => setSelectedVendedor(null)}
        />
      )}
    </div>
  )
}
