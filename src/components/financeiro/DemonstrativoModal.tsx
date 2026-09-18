import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Boleto } from '../../types/domain'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Linha {
  boleto: Boleto
  pago: number
  vencido: number
  aVencer: number
  atraso: number
}

// Posição do título numa data de referência: um pagamento só conta se já
// tinha acontecido até a data (sem data_pagamento — registros antigos —
// considera que já tinha), e o que sobra é "vencido" ou "à vencer" conforme
// o vencimento em relação à data.
function posicaoEm(boleto: Boleto, ref: string): Linha {
  const total = Number(boleto.valor) + Number(boleto.juros ?? 0)
  const pagamentoConta = boleto.status !== 'pendente' && (!boleto.data_pagamento || boleto.data_pagamento <= ref)
  const pago = pagamentoConta ? Number(boleto.valor_pago ?? 0) : 0
  const saldo = Math.max(total - pago, 0)
  const vencido = boleto.vencimento < ref
  const dias = Math.round(
    (new Date(`${ref}T00:00:00Z`).getTime() - new Date(`${boleto.vencimento}T00:00:00Z`).getTime()) / 86_400_000
  )
  return {
    boleto,
    pago,
    vencido: vencido ? saldo : 0,
    aVencer: vencido ? 0 : saldo,
    atraso: vencido && saldo > 0 ? dias : 0,
  }
}

interface BlocoNota {
  key: string
  titulo: string
  linhas: Linha[]
}

function montarBlocos(boletos: Boleto[], ref: string): BlocoNota[] {
  const porNota = new Map<string, Boleto[]>()
  for (const b of boletos) {
    const key = b.invoice_id ?? `sem-nf-${b.id}`
    porNota.set(key, [...(porNota.get(key) ?? []), b])
  }
  return Array.from(porNota.entries()).map(([key, itens]) => {
    const tipo = itens[0].invoices?.tipo_operacao ?? ''
    const locacao = tipo.toLowerCase().includes('loca')
    return {
      key,
      titulo: `NF-e (${locacao ? 'Locação' : 'venda'})`,
      linhas: itens.sort((a, b) => a.numero_parcela - b.numero_parcela).map((b) => posicaoEm(b, ref)),
    }
  })
}

function soma(linhas: Linha[], campo: 'pago' | 'vencido' | 'aVencer'): number {
  return linhas.reduce((acc, l) => acc + l[campo], 0)
}

function Caixa({ marcada, cor }: { marcada: boolean; cor: string }) {
  return (
    <span
      style={{ borderColor: cor, color: marcada ? '#fff' : cor, background: marcada ? cor : 'transparent' }}
      className="inline-block h-4 w-4 rounded-sm border-2 text-center text-[11px] leading-[12px]"
    >
      {marcada ? '✓' : ''}
    </span>
  )
}

const VERDE = '#2e9d3e'
const VERMELHO = '#e02020'
const CINZA = '#555555'

export function DemonstrativoModal({
  cliente,
  boletos,
  onClose,
}: {
  cliente: string
  boletos: Boleto[]
  onClose: () => void
}) {
  const { push } = useToast()
  const [dataRef, setDataRef] = useState(hoje())
  const [gerando, setGerando] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)

  const blocos = montarBlocos(boletos, dataRef)
  const todas = blocos.flatMap((b) => b.linhas)
  const notas = new Map<string, number>()
  for (const b of boletos) if (b.invoice_id) notas.set(b.invoice_id, Number(b.invoices?.valor ?? 0))
  const nfFaturadas = Array.from(notas.values()).reduce((acc, v) => acc + v, 0)
  const cnpj = boletos.find((b) => b.invoices?.clientes?.cnpj_cpf)?.invoices?.clientes?.cnpj_cpf ?? '—'
  const vendedor = boletos.find((b) => b.invoices?.vendedores?.nome)?.invoices?.vendedores?.nome ?? '—'

  async function handleBaixarPdf() {
    if (gerando || !areaRef.current) return
    setGerando(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const canvas = await html2canvas(areaRef.current, { scale: 2, backgroundColor: '#ffffff' })
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgHeight = (canvas.height * pageWidth) / canvas.width
      const imgData = canvas.toDataURL('image/png')

      let heightLeft = imgHeight
      let position = 0
      pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight)
      heightLeft -= pageHeight
      while (heightLeft > 0.5) {
        position -= pageHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight)
        heightLeft -= pageHeight
      }

      const nomeArquivo = `Demonstrativo-${cliente.replace(/[^\w]+/g, '_')}-${dataRef}.pdf`
      const url = URL.createObjectURL(pdf.output('blob'))
      const a = document.createElement('a')
      a.href = url
      a.download = nomeArquivo
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      push('error', 'Não foi possível gerar o PDF.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-3xl">
      <div className="p-lg">
        <div className="mb-md flex flex-wrap items-center justify-between gap-sm">
          <label className="flex items-center gap-sm">
            <span className="font-label-md text-label-md text-on-surface-variant">Data do demonstrativo:</span>
            <input
              type="date"
              value={dataRef}
              onChange={(e) => setDataRef(e.target.value || hoje())}
              className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md text-on-surface outline-none focus:border-primary"
            />
          </label>
          <div className="flex items-center gap-sm">
            <button
              type="button"
              onClick={handleBaixarPdf}
              disabled={gerando}
              className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:bg-primary/90 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              {gerando ? 'Gerando…' : 'Baixar PDF'}
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
              aria-label="Fechar"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div ref={areaRef} style={{ background: '#fff', color: '#111', minWidth: 640 }} className="p-md text-[12px]">
            <div className="mb-md flex items-center gap-sm">
              <div style={{ borderTop: '3px solid #2e7d32' }} className="flex-1" />
              <img src="/logo.png" alt="MCI" className="h-8 w-auto object-contain" />
              <span style={{ color: '#1a5c9e' }} className="text-[15px] font-bold">
                DEMONSTRATIVO FINANCEIRO
              </span>
              <div style={{ borderTop: '3px solid #2e7d32' }} className="flex-1" />
            </div>

            <div className="mb-md flex justify-between gap-md">
              <div className="space-y-1">
                <p><b>CNPJ/CPF:</b> {cnpj}</p>
                <p><b>Cliente:</b> <span style={{ color: CINZA }}>{cliente}</span></p>
                <p><b>Data:</b> {formatDate(dataRef)}</p>
              </div>
              <table className="text-right">
                <tbody>
                  <tr><td colSpan={3} className="pb-1 text-right"><b>Vendedor:</b> {vendedor}</td></tr>
                  <tr>
                    <td className="pr-2 font-bold">NF Faturadas</td>
                    <td className="pr-2"><Caixa marcada cor="#1a56db" /></td>
                    <td className="font-bold">{formatCurrency(nfFaturadas)}</td>
                  </tr>
                  <tr>
                    <td className="pr-2 font-bold">Total Pago</td>
                    <td className="pr-2"><Caixa marcada cor={VERDE} /></td>
                    <td style={{ color: VERDE }} className="font-bold">{formatCurrency(soma(todas, 'pago'))}</td>
                  </tr>
                  <tr>
                    <td className="pr-2 font-bold">Total vencido</td>
                    <td className="pr-2"><Caixa marcada cor={VERMELHO} /></td>
                    <td style={{ color: VERMELHO }} className="font-bold">{formatCurrency(soma(todas, 'vencido'))}</td>
                  </tr>
                  <tr>
                    <td className="pr-2 font-bold">Total a vencer</td>
                    <td className="pr-2"><Caixa marcada cor="#111" /></td>
                    <td className="font-bold">{formatCurrency(soma(todas, 'aVencer'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {blocos.map((bloco) => (
              <table
                key={bloco.key}
                style={{ border: '2px solid #2e7d32' }}
                className="mb-md w-full border-collapse"
              >
                <thead>
                  <tr className="text-center font-bold">
                    <th className="p-1">{bloco.titulo}</th>
                    <th className="p-1">Cliente</th>
                    <th className="p-1">Vencimento</th>
                    <th className="p-1">Dias de atraso</th>
                    <th className="p-1" colSpan={2}>Pago</th>
                    <th className="p-1" colSpan={2}>Vencido</th>
                    <th className="p-1" colSpan={2}>À vencer</th>
                  </tr>
                </thead>
                <tbody>
                  {bloco.linhas.map((l) => {
                    const cor = l.vencido > 0 ? VERMELHO : l.aVencer > 0 ? CINZA : VERDE
                    const numeroNf = l.boleto.invoices?.numero_nf ?? '—'
                    return (
                      <tr key={l.boleto.id} style={{ color: cor }}>
                        <td className="px-1">
                          {numeroNf.padStart(9, '0')}-{l.boleto.numero_parcela}/{bloco.linhas.length}
                        </td>
                        <td className="px-1 text-center">{cliente}</td>
                        <td className="px-1 text-center">{formatDate(l.boleto.vencimento)}</td>
                        <td className="px-1 text-center">{l.atraso}</td>
                        <td className="px-1"><Caixa marcada={l.pago > 0 && l.vencido + l.aVencer === 0} cor={VERDE} /></td>
                        <td className="whitespace-nowrap px-1 text-right">{l.pago > 0 ? formatCurrency(l.pago) : ''}</td>
                        <td className="px-1"><Caixa marcada={l.vencido > 0} cor={VERMELHO} /></td>
                        <td className="whitespace-nowrap px-1 text-right">{l.vencido > 0 ? formatCurrency(l.vencido) : ''}</td>
                        <td className="px-1"><Caixa marcada={l.aVencer > 0} cor={CINZA} /></td>
                        <td className="whitespace-nowrap px-1 text-right">{l.aVencer > 0 ? formatCurrency(l.aVencer) : ''}</td>
                      </tr>
                    )
                  })}
                  <tr className="font-bold" style={{ borderTop: '2px solid #111' }}>
                    <td colSpan={4} />
                    <td colSpan={2} style={{ color: VERDE }} className="whitespace-nowrap px-1 text-right">
                      {formatCurrency(soma(bloco.linhas, 'pago'))}
                    </td>
                    <td colSpan={2} style={{ color: VERMELHO }} className="whitespace-nowrap px-1 text-right">
                      {formatCurrency(soma(bloco.linhas, 'vencido'))}
                    </td>
                    <td colSpan={2} className="whitespace-nowrap px-1 text-right">
                      {formatCurrency(soma(bloco.linhas, 'aVencer'))}
                    </td>
                  </tr>
                </tbody>
              </table>
            ))}

            <div style={{ borderTop: '2px solid #111' }} className="pt-sm text-center text-[11px]">
              Multi Comercial &amp; Importadora LTDA
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
