import { useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { formatCurrency, formatDate } from '../../lib/format'
import type { RetornoTitulo } from '../../lib/retornoCnab400Parser'
import type { Boleto } from '../../types/domain'

// Não casa automaticamente: o "Nosso Número" do banco ainda não tem
// correspondência confirmada com numero_titulo no nosso cadastro, então
// cada registro do .RET é vinculado manualmente ao título certo na hora da
// primeira importação — evita baixar o título errado por engano.
export function ImportarRetornoModal({
  registros,
  boletosAbertos,
  onVincular,
  onClose,
}: {
  registros: RetornoTitulo[]
  boletosAbertos: Boleto[]
  onVincular: (boleto: Boleto, registro: RetornoTitulo) => Promise<boolean>
  onClose: () => void
}) {
  const [indiceAtivo, setIndiceAtivo] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const [vinculando, setVinculando] = useState(false)
  const [vinculados, setVinculados] = useState<Set<number>>(new Set())

  const registroAtivo = indiceAtivo !== null ? registros[indiceAtivo] : null

  const sugestoes = useMemo(() => {
    if (!registroAtivo) return []
    const termo = busca.trim().toLowerCase()
    return boletosAbertos
      .filter(
        (b) =>
          !termo ||
          b.numero_titulo?.toLowerCase().includes(termo) ||
          b.cliente_nome_importado?.toLowerCase().includes(termo) ||
          b.invoices?.numero_nf?.toLowerCase().includes(termo) ||
          b.invoices?.cliente?.toLowerCase().includes(termo)
      )
      .sort((a, b) => Math.abs(Number(a.valor) - registroAtivo.valorTitulo) - Math.abs(Number(b.valor) - registroAtivo.valorTitulo))
      .slice(0, 30)
  }, [boletosAbertos, busca, registroAtivo])

  async function handleVincular(boleto: Boleto) {
    if (indiceAtivo === null) return
    setVinculando(true)
    const ok = await onVincular(boleto, registros[indiceAtivo])
    setVinculando(false)
    if (ok) {
      setVinculados((atual) => new Set(atual).add(indiceAtivo))
      setIndiceAtivo(null)
      setBusca('')
    }
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl">
      <div className="p-lg">
        <div className="mb-md">
          <h3 className="font-title-md text-title-md text-on-surface">Retorno bancário (.RET)</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {registros.length} registro{registros.length === 1 ? '' : 's'} no arquivo — vincule cada um ao título
            certo pra dar baixa.
          </p>
        </div>

        <div className="max-h-[60vh] divide-y divide-outline-variant overflow-y-auto rounded-lg border border-outline-variant">
          {registros.map((r, i) => {
            const feito = vinculados.has(i)
            return (
              <div key={i} className="p-md">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      <span className="font-label-md text-label-md text-on-surface-variant">
                        Nosso Nº {r.nossoNumero}
                      </span>{' '}
                      {r.nomePagador || '—'}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {r.ocorrenciaLabel} · {formatDate(r.dataOcorrencia)}
                      {r.vencimento ? ` · venc. ${formatDate(r.vencimento)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-sm">
                    <div className="text-right">
                      <p className="font-body-md text-body-md text-on-surface">{formatCurrency(r.valorTitulo)}</p>
                      {r.jurosMulta > 0 && (
                        <p className="font-label-md text-label-md text-on-surface-variant">
                          + {formatCurrency(r.jurosMulta)} juros/multa
                        </p>
                      )}
                    </div>
                    {feito ? (
                      <span className="flex items-center gap-xs rounded-full bg-tertiary/10 px-md py-xs font-label-md text-label-md text-tertiary">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        Baixado
                      </span>
                    ) : r.liquidacao ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIndiceAtivo(i)
                          setBusca('')
                        }}
                        className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
                      >
                        <span className="material-symbols-outlined text-[16px]">link</span>
                        Vincular título
                      </button>
                    ) : (
                      <span className="font-label-md text-label-md text-on-surface-variant">Sem ação</span>
                    )}
                  </div>
                </div>

                {indiceAtivo === i && (
                  <div className="mt-md rounded-lg bg-surface-container-low p-md">
                    <input
                      autoFocus
                      type="text"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por NF, cliente ou número do título…"
                      className="mb-sm w-full rounded-full border border-outline-variant bg-surface-container-lowest px-md py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
                    />
                    {sugestoes.length === 0 ? (
                      <p className="p-sm font-label-md text-label-md text-on-surface-variant">
                        Nenhum título em aberto encontrado.
                      </p>
                    ) : (
                      <div className="max-h-52 space-y-xs overflow-y-auto">
                        {sugestoes.map((b) => {
                          const dif = Math.round((Number(b.valor) - (registroAtivo?.valorTitulo ?? 0)) * 100) / 100
                          const exato = Math.abs(dif) < 0.005
                          return (
                            <button
                              key={b.id}
                              type="button"
                              disabled={vinculando}
                              onClick={() => handleVincular(b)}
                              className="flex w-full items-center justify-between gap-sm rounded-lg border border-outline-variant p-sm text-left transition-colors hover:bg-surface-container-high disabled:opacity-50"
                            >
                              <span className="min-w-0 truncate font-body-md text-body-md text-on-surface">
                                {b.invoices?.numero_nf ? `NF ${b.invoices.numero_nf} · ` : ''}
                                {b.invoices?.cliente ?? b.cliente_nome_importado ?? b.numero_titulo}
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block font-body-md text-body-md text-on-surface">
                                  {formatCurrency(Number(b.valor))}
                                </span>
                                <span
                                  className={`block font-label-md text-label-md ${exato ? 'text-tertiary' : 'text-error'}`}
                                >
                                  {exato ? 'valor exato' : `diferença de ${formatCurrency(Math.abs(dif))}`}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setIndiceAtivo(null)}
                      className="mt-sm font-label-md text-label-md text-on-surface-variant hover:underline"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-md flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
          >
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  )
}
