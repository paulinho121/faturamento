import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'
import {
  filtrarTitulosRelatorio,
  gerarRelatorioConciliacaoPdf,
  type TipoDataRelatorio,
} from '../../lib/relatorioConciliacaoPdf'
import type { Boleto } from '../../types/domain'

const inputClass =
  'rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors'

export function RelatorioConciliacaoModal({
  boletos,
  dataInicial,
  onClose,
}: {
  boletos: Boleto[]
  dataInicial: string
  onClose: () => void
}) {
  const { push } = useToast()
  const [tipo, setTipo] = useState<TipoDataRelatorio>('vencimento')
  const [de, setDe] = useState(dataInicial)
  const [ate, setAte] = useState(dataInicial)
  const [gerando, setGerando] = useState(false)

  const intervaloValido = !!de && !!ate && de <= ate
  const titulos = intervaloValido ? filtrarTitulosRelatorio(boletos, tipo, de, ate) : []
  const total = titulos.reduce(
    (acc, b) => acc + (tipo !== 'vencimento' ? Number(b.valor_pago ?? 0) : Number(b.valor) + Number(b.juros ?? 0)),
    0
  )

  async function handleGerar() {
    setGerando(true)
    try {
      await gerarRelatorioConciliacaoPdf(tipo, de, ate, titulos)
    } catch (err) {
      push('error', `Erro ao gerar o PDF: ${err instanceof Error ? err.message : 'tente de novo'}`)
    } finally {
      setGerando(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-md">
      <div className="p-lg">
        <div className="mb-md flex items-start justify-between gap-md">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Relatório em PDF</h3>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Pagamento é a data do arquivo do banco; compensação é o dia útil seguinte, quando o dinheiro cai.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mb-md flex flex-wrap gap-sm">
          {(
            [
              ['vencimento', 'Data de vencimento'],
              ['pagamento', 'Data de pagamento'],
              ['compensacao', 'Data de compensação'],
            ] as const
          ).map(([chave, label]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setTipo(chave)}
              className={`rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                tipo === chave
                  ? 'bg-primary text-on-primary'
                  : 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-md flex flex-wrap items-center gap-sm">
          <label className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
            De
            <input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
            até
            <input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} className={inputClass} />
          </label>
        </div>

        <p className="mb-lg font-label-md text-label-md text-on-surface-variant">
          {!intervaloValido
            ? 'Informe um período válido.'
            : titulos.length === 0
              ? tipo === 'vencimento'
                ? 'Nenhum título vence nesse período.'
                : tipo === 'compensacao'
                  ? 'Nenhum pagamento compensou nesse período.'
                  : 'Nenhum pagamento registrado nesse período.'
              : `${titulos.length} título${titulos.length === 1 ? '' : 's'} · ${formatCurrency(total)}${
                  tipo !== 'vencimento' ? ' recebidos' : ''
                }`}
        </p>

        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGerar}
            disabled={gerando || titulos.length === 0}
            className="flex items-center gap-xs rounded-full bg-primary px-lg py-xs font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
            {gerando ? 'Gerando…' : 'Gerar PDF'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
