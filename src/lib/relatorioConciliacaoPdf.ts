import { formatCurrency, formatDate } from './format'
import type { Boleto } from '../types/domain'

// jsPDF usa Helvetica (WinAnsi): troca o espaço sem quebra do Intl por um
// espaço comum pra não sair caractere estranho no PDF.
function moeda(valor: number): string {
  return formatCurrency(valor).replace(/ /g, ' ')
}

function devido(b: Boleto): number {
  return Number(b.valor) + Number(b.juros ?? 0)
}

function descricao(b: Boleto): string {
  if (b.invoices) return `NF #${b.invoices.numero_nf} · ${b.invoices.cliente}`
  return `${b.cliente_nome_importado ?? '—'} (sem NF vinculada)`
}

// Relatório da Conciliação Diária de uma data de vencimento: resumo + lista
// de pendentes + lista de confirmados, pra guardar/imprimir.
export async function gerarRelatorioConciliacaoPdf(dataIso: string, pendentes: Boleto[], confirmados: Boleto[]) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const largura = pdf.internal.pageSize.getWidth()
  const altura = pdf.internal.pageSize.getHeight()
  const margem = 12
  let y = margem

  // Colunas: título/NF, parcela, valor, pago, pago em.
  const colunas = [
    { titulo: 'Cliente / NF', x: margem, w: 84 },
    { titulo: 'Parc.', x: margem + 86, w: 12 },
    { titulo: 'Valor', x: margem + 100, w: 30, direita: true },
    { titulo: 'Pago', x: margem + 132, w: 30, direita: true },
    { titulo: 'Pago em', x: margem + 164, w: 22 },
  ]

  function novaPaginaSe(necessario: number) {
    if (y + necessario > altura - margem - 6) {
      pdf.addPage()
      y = margem
    }
  }

  function cabecalhoTabela() {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(90)
    for (const c of colunas) {
      pdf.text(c.titulo, c.direita ? c.x + c.w : c.x, y, { align: c.direita ? 'right' : 'left' })
    }
    y += 1.5
    pdf.setDrawColor(190)
    pdf.line(margem, y, largura - margem, y)
    y += 4
  }

  function secao(titulo: string, lista: Boleto[]) {
    novaPaginaSe(20)
    const total = lista.reduce((acc, b) => acc + devido(b), 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(20)
    pdf.text(`${titulo} (${lista.length})`, margem, y)
    pdf.text(moeda(total), largura - margem, y, { align: 'right' })
    y += 5
    if (lista.length === 0) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(110)
      pdf.text('Nenhum título.', margem, y)
      y += 8
      return
    }
    cabecalhoTabela()
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    for (const b of lista) {
      const linhas = pdf.splitTextToSize(descricao(b), colunas[0].w).slice(0, 2) as string[]
      const alturaLinha = linhas.length * 4 + 2
      if (y + alturaLinha > altura - margem - 6) {
        pdf.addPage()
        y = margem
        cabecalhoTabela()
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
      }
      pdf.setTextColor(30)
      pdf.text(linhas, colunas[0].x, y)
      pdf.text(String(b.numero_parcela), colunas[1].x, y)
      pdf.text(moeda(devido(b)), colunas[2].x + colunas[2].w, y, { align: 'right' })
      pdf.text(moeda(Number(b.valor_pago ?? 0)), colunas[3].x + colunas[3].w, y, { align: 'right' })
      pdf.text(b.data_pagamento ? formatDate(b.data_pagamento) : '—', colunas[4].x, y)
      y += alturaLinha
      pdf.setDrawColor(235)
      pdf.line(margem, y - 3.5, largura - margem, y - 3.5)
    }
    y += 6
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.setTextColor(20)
  pdf.text('Conciliação Diária', margem, y)
  y += 7
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(80)
  pdf.text(`Vencimento em ${formatDate(dataIso)}`, margem, y)
  pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, largura - margem, y, { align: 'right' })
  y += 9

  const todos = [...pendentes, ...confirmados]
  const totalDevido = todos.reduce((acc, b) => acc + devido(b), 0)
  const totalConfirmado = confirmados.reduce((acc, b) => acc + devido(b), 0)
  const resumo: [string, string][] = [
    ['Títulos', `${confirmados.length}/${todos.length} confirmados`],
    ['Valor total', moeda(totalDevido)],
    ['Confirmado', moeda(totalConfirmado)],
    ['Pendente', moeda(totalDevido - totalConfirmado)],
  ]
  pdf.setDrawColor(200)
  pdf.roundedRect(margem, y - 4, largura - margem * 2, 14, 2, 2)
  const passo = (largura - margem * 2) / resumo.length
  resumo.forEach(([rotulo, valor], i) => {
    const x = margem + 4 + i * passo
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(110)
    pdf.text(rotulo.toUpperCase(), x, y)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(20)
    pdf.text(valor, x, y + 5)
  })
  y += 18

  secao('Pendentes', pendentes)
  secao('Confirmados', confirmados)

  const paginas = pdf.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(130)
    pdf.text(`Página ${p} de ${paginas}`, largura / 2, altura - 6, { align: 'center' })
  }

  pdf.save(`Conciliacao-${dataIso}.pdf`)
}
