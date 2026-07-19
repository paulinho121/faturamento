import { useMemo } from 'react'
import { Modal } from '../ui/Modal'
import { parseNFeDetalhes } from '../../lib/nfeParser'
import { formatCurrency, formatDateTime } from '../../lib/format'
import type { Invoice } from '../../types/domain'

function formatChave(chave: string | null): string {
  if (!chave) return '—'
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

function baixarXml(numeroNf: string, xml: string) {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `NFe-${numeroNf}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function NfeMirrorModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const detalhes = useMemo(
    () => (invoice.xml_raw ? parseNFeDetalhes(invoice.xml_raw) : null),
    [invoice.xml_raw]
  )

  const totalNota = detalhes
    ? detalhes.valorProdutos - detalhes.valorDesconto + detalhes.valorFrete + detalhes.valorIpi
    : invoice.valor

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-3xl">
      <div className="p-lg">
        <div className="mb-lg flex items-start justify-between gap-md print:hidden">
          <div>
            <h3 className="font-title-md text-title-md text-on-surface">Espelho da NF-e #{invoice.numero_nf}</h3>
            <p className="font-label-md text-label-md text-on-secondary-container">
              {invoice.cliente} · {formatCurrency(invoice.valor)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-xs">
            {invoice.xml_raw && (
              <button
                onClick={() => baixarXml(invoice.numero_nf, invoice.xml_raw!)}
                className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                XML
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Imprimir
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

        {/* Chave de acesso */}
        <div className="mb-lg rounded-lg bg-surface-container-low p-md">
          <span className="block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
            Chave de Acesso
          </span>
          <span className="font-tabular-nums text-body-md text-on-surface">
            {formatChave(invoice.xml_chave_acesso ?? detalhes?.chaveAcesso ?? null)}
          </span>
        </div>

        {!invoice.xml_raw && (
          <p className="mb-lg rounded-lg bg-tertiary/10 p-md font-label-md text-label-md text-on-surface-variant">
            O XML original não foi salvo com este lançamento — exibindo só os dados cadastrados.
          </p>
        )}

        {/* Emitente / Destinatário */}
        <div className="mb-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <div className="rounded-lg border border-outline-variant p-md">
            <span className="mb-xs block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Emitente
            </span>
            <p className="font-body-md text-body-md font-medium text-on-surface">
              {detalhes?.emitNome || invoice.filiais?.nome || '—'}
            </p>
            {detalhes?.emitCnpj && (
              <p className="font-label-md text-label-md text-on-surface-variant">CNPJ {detalhes.emitCnpj}</p>
            )}
            {detalhes?.emitEndereco && (
              <p className="mt-xs font-label-md text-label-md text-on-surface-variant">{detalhes.emitEndereco}</p>
            )}
          </div>
          <div className="rounded-lg border border-outline-variant p-md">
            <span className="mb-xs block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Destinatário
            </span>
            <p className="font-body-md text-body-md font-medium text-on-surface">
              {detalhes?.destNome || invoice.cliente}
            </p>
            {detalhes?.destCnpjCpf && (
              <p className="font-label-md text-label-md text-on-surface-variant">Doc. {detalhes.destCnpjCpf}</p>
            )}
            {(detalhes?.destEndereco || invoice.estado) && (
              <p className="mt-xs font-label-md text-label-md text-on-surface-variant">
                {detalhes?.destEndereco || invoice.estado}
              </p>
            )}
          </div>
        </div>

        {/* Dados da operação */}
        <div className="mb-lg grid grid-cols-2 gap-md md:grid-cols-4">
          <InfoField label="Data Emissão" value={invoice.data_emissao?.split('-').reverse().join('/')} />
          <InfoField label="Tipo de Operação" value={invoice.tipo_operacao} />
          <InfoField label="Forma de Pagamento" value={invoice.meio_pagamento} />
          <InfoField label="Parcelas" value={String(invoice.parcelas)} />
          <InfoField label="Filial" value={invoice.filiais?.nome} />
          <InfoField label="Vendedor" value={invoice.vendedores?.nome ?? '—'} />
          <InfoField label="Série" value={detalhes?.serie} />
          <InfoField label="Natureza da Operação" value={detalhes?.naturezaOperacao} />
        </div>

        {/* Itens */}
        {detalhes && detalhes.itens.length > 0 && (
          <div className="mb-lg overflow-x-auto rounded-lg border border-outline-variant">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">Produto</th>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">NCM</th>
                  <th className="px-md py-sm font-label-md text-label-md text-on-surface-variant">CFOP</th>
                  <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Qtd</th>
                  <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Vlr Unit.</th>
                  <th className="px-md py-sm text-right font-label-md text-label-md text-on-surface-variant">Vlr Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {detalhes.itens.map((item, i) => (
                  <tr key={i}>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface">
                      {item.descricao}
                      <span className="ml-xs text-on-surface-variant">({item.codigo})</span>
                    </td>
                    <td className="px-md py-sm font-label-md text-label-md text-on-surface-variant">{item.ncm}</td>
                    <td className="px-md py-sm font-label-md text-label-md text-on-surface-variant">{item.cfop}</td>
                    <td className="px-md py-sm text-right font-tabular-nums text-on-surface">
                      {item.quantidade} {item.unidade}
                    </td>
                    <td className="px-md py-sm text-right font-tabular-nums text-on-surface">
                      {formatCurrency(item.valorUnitario)}
                    </td>
                    <td className="px-md py-sm text-right font-tabular-nums font-semibold text-on-surface">
                      {formatCurrency(item.valorTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totais */}
        <div className="mb-lg rounded-lg bg-primary/5 p-md">
          <div className="grid grid-cols-2 gap-x-md gap-y-xs md:grid-cols-3">
            {detalhes && (
              <>
                <TotalField label="Produtos" value={detalhes.valorProdutos} />
                <TotalField label="Desconto" value={detalhes.valorDesconto} />
                <TotalField label="IPI" value={detalhes.valorIpi} />
              </>
            )}
            <TotalField label="Frete" value={invoice.frete} />
            <TotalField label="DIFAL" value={invoice.valor_difal} />
            <TotalField label="FCP" value={invoice.valor_fcp} />
          </div>
          <div className="mt-md flex items-baseline justify-between border-t border-outline-variant pt-md">
            <span className="font-title-md text-title-md text-on-surface">Total da Nota</span>
            <span className="font-display text-display text-on-surface tabular-nums">
              {formatCurrency(detalhes ? totalNota : invoice.valor)}
            </span>
          </div>
        </div>

        {detalhes?.informacoesComplementares && (
          <div className="mb-lg">
            <span className="mb-xs block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
              Informações Complementares
            </span>
            <p className="font-body-md text-body-md text-on-surface-variant">{detalhes.informacoesComplementares}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant pt-md font-label-md text-label-md text-on-surface-variant">
          {detalhes?.protocolo && (
            <span>
              Protocolo {detalhes.protocolo} · Autorizada em {detalhes.dataAutorizacao}
            </span>
          )}
          <span>Lançado em {formatDateTime(invoice.created_at)}</span>
        </div>
      </div>
    </Modal>
  )
}

function InfoField({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <span className="block font-label-md text-label-md uppercase tracking-wider text-on-secondary-container">
        {label}
      </span>
      <span className="font-body-md text-body-md text-on-surface">{value}</span>
    </div>
  )
}

function TotalField({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between md:block">
      <span className="font-label-md text-label-md text-on-surface-variant">{label}</span>
      <span className="font-tabular-nums text-body-md text-on-surface"> {formatCurrency(value)}</span>
    </div>
  )
}
