import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { NfeMirrorModal } from '../invoices/NfeMirrorModal'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency, formatDate } from '../../lib/format'
import { BRASIL_ESTADOS } from './brasilMapaData'
import type { Invoice } from '../../types/domain'

interface CidadeLinha {
  cidade: string
  estado: string
  faturamento: number
  nf_count: number
}

interface OperacaoLinha {
  id: string
  numero_nf: string
  data_emissao: string
  cliente: string
  cidade: string
  estado: string
  tipo_operacao: string
  valor: number
}

const LIMITE_OPERACOES = 300

export function OperacoesModal({
  estado,
  dataInicio,
  dataFim,
  filialFiltro,
  vendedorFiltro,
  tipoFiltro,
  onClose,
}: {
  estado: string
  dataInicio: string
  dataFim: string
  filialFiltro?: string | null
  vendedorFiltro?: string | null
  tipoFiltro?: string | null
  onClose: () => void
}) {
  const [cidadeFiltro, setCidadeFiltro] = useState<string | null>(null)
  const [cidades, setCidades] = useState<CidadeLinha[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoLinha[]>([])
  const [loadingCidades, setLoadingCidades] = useState(true)
  const [loadingOperacoes, setLoadingOperacoes] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)

  const nomeEstado = BRASIL_ESTADOS.find((e) => e.uf === estado)?.nome ?? estado

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingCidades(true)
      const { data } = await supabase.rpc('bi_faturamento_por_cidade', {
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_estado: estado,
        p_filial_id: filialFiltro ?? null,
        p_vendedor_id: vendedorFiltro ?? null,
        p_tipo_operacao: tipoFiltro ?? null,
      })
      if (!cancelled) {
        setCidades((data as CidadeLinha[]) ?? [])
        setLoadingCidades(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [estado, dataInicio, dataFim, filialFiltro, vendedorFiltro, tipoFiltro])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingOperacoes(true)
      const { data } = await supabase.rpc('bi_operacoes', {
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_estado: estado,
        p_cidade: cidadeFiltro,
        p_filial_id: filialFiltro ?? null,
        p_vendedor_id: vendedorFiltro ?? null,
        p_tipo_operacao: tipoFiltro ?? null,
        p_limit: LIMITE_OPERACOES,
      })
      if (!cancelled) {
        setOperacoes((data as OperacaoLinha[]) ?? [])
        setLoadingOperacoes(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [estado, dataInicio, dataFim, cidadeFiltro, filialFiltro, vendedorFiltro, tipoFiltro])

  async function abrirEspelho(id: string) {
    const { data } = await supabase.from('invoices').select('*').eq('id', id).single()
    if (data) setSelectedInvoice(data as Invoice)
  }

  const faturamentoTotal = cidades.reduce((acc, c) => acc + c.faturamento, 0)

  return (
    <>
      <Modal onClose={onClose} maxWidthClassName="max-w-3xl">
        <div className="p-lg">
          <div className="mb-lg flex items-start justify-between gap-md">
            <div>
              <h3 className="font-title-md text-title-md text-on-surface">Operações — {nomeEstado}</h3>
              <p className="font-label-md text-label-md text-on-secondary-container">
                {formatDate(dataInicio)} a {formatDate(dataFim)}
                {cidadeFiltro && ` · ${cidadeFiltro}`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
              aria-label="Fechar"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="mb-lg">
            <p className="mb-sm font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Cidades
            </p>
            {loadingCidades ? (
              <Skeleton className="h-10 w-full" />
            ) : cidades.length === 0 ? (
              <p className="font-body-md text-body-md text-on-surface-variant">Sem cidades no período.</p>
            ) : (
              <div className="flex flex-wrap gap-xs">
                <button
                  type="button"
                  onClick={() => setCidadeFiltro(null)}
                  className={`rounded-full px-sm py-0.5 font-label-md text-label-md transition-colors ${
                    cidadeFiltro === null
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  Todas ({formatCurrency(faturamentoTotal)})
                </button>
                {cidades.map((c) => (
                  <button
                    key={c.cidade}
                    type="button"
                    onClick={() => setCidadeFiltro(c.cidade === cidadeFiltro ? null : c.cidade)}
                    className={`rounded-full px-sm py-0.5 font-label-md text-label-md transition-colors ${
                      cidadeFiltro === c.cidade
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {c.cidade} ({formatCurrency(c.faturamento)})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-outline-variant">
            {loadingOperacoes ? (
              <div className="space-y-sm p-md">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : operacoes.length === 0 ? (
              <div className="p-lg">
                <EmptyState
                  icon="receipt_long"
                  title="Sem operações"
                  description="Não há notas nesse recorte de estado/cidade e período."
                />
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-surface-container-low">
                  <tr>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">NF</th>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Data</th>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Cliente</th>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Cidade</th>
                    <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Tipo</th>
                    <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {operacoes.map((op) => (
                    <tr
                      key={op.id}
                      onClick={() => abrirEspelho(op.id)}
                      title="Ver espelho da nota"
                      className="cursor-pointer transition-colors hover:bg-surface-container-low"
                    >
                      <td className="px-md py-sm font-tabular-nums font-medium text-primary">#{op.numero_nf}</td>
                      <td className="px-md py-sm font-label-md text-label-md text-on-surface-variant">
                        {formatDate(op.data_emissao)}
                      </td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface">{op.cliente}</td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{op.cidade}</td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">
                        {op.tipo_operacao}
                      </td>
                      <td className="px-md py-sm text-right font-tabular-nums font-semibold text-on-surface">
                        {formatCurrency(op.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {operacoes.length === LIMITE_OPERACOES && (
            <p className="mt-sm font-label-md text-label-md text-on-surface-variant">
              Mostrando as {LIMITE_OPERACOES} operações mais recentes — estreite o período ou a cidade pra ver o
              resto.
            </p>
          )}
        </div>
      </Modal>
      {selectedInvoice && <NfeMirrorModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </>
  )
}
