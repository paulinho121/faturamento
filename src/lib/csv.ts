import type { Invoice } from '../types/domain'

export function invoicesToCsv(rows: Invoice[]): string {
  const header = ['NF', 'Data', 'Cliente', 'Filial', 'Estado', 'Vendedor', 'Tipo Operação', 'Meio Pagamento', 'Valor', 'Frete']
  const lines = rows.map((r) =>
    [
      r.numero_nf,
      r.data_emissao,
      csvEscape(r.cliente),
      r.filiais?.nome ?? '',
      r.estado,
      csvEscape(r.vendedores?.nome ?? ''),
      csvEscape(r.tipo_operacao),
      csvEscape(r.meio_pagamento),
      r.valor.toFixed(2).replace('.', ','),
      r.frete.toFixed(2).replace('.', ','),
    ].join(';')
  )
  return [header.join(';'), ...lines].join('\n')
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const BOM = '﻿'

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
