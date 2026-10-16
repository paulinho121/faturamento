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

function pago(b: Boleto): number {
  return Number(b.valor_pago ?? 0)
}

function descricao(b: Boleto): string {
  if (b.invoices) return `NF #${b.invoices.numero_nf} · ${b.invoices.cliente}`
  return `${b.cliente_nome_importado ?? '—'} (sem NF vinculada)`
}

function periodoTexto(de: string, ate: string): string {
  return de === ate ? `em ${formatDate(de)}` : `de ${formatDate(de)} a ${formatDate(ate)}`
}

export type TipoDataRelatorio = 'vencimento' | 'pagamento' | 'compensacao'

// Quando o dinheiro caiu na conta: a compensação do .RET (dia útil seguinte
// ao pagamento) ou, se não houver (pagamento lançado na mão / extrato), a
// própria data de pagamento.
function dataEntrada(b: Boleto): string | null {
  return b.data_compensacao ?? b.data_pagamento
}

// Títulos que entram no relatório: pelo vencimento (a conferência do dia),
// pela data em que o cliente pagou (a do arquivo de retorno) ou pela data em
// que o dinheiro compensou no banco.
export function filtrarTitulosRelatorio(boletos: Boleto[], tipo: TipoDataRelatorio, de: string, ate: string): Boleto[] {
  const dentro = (data: string | null | undefined) => !!data && data >= de && data <= ate
  const dataDoTitulo = (b: Boleto) =>
    tipo === 'vencimento' ? b.vencimento : tipo === 'pagamento' ? b.data_pagamento : dataEntrada(b)
  const lista = boletos.filter((b) => dentro(dataDoTitulo(b)))
  if (tipo !== 'vencimento') {
    return lista.sort(
      (a, b) => (dataDoTitulo(a) ?? '').localeCompare(dataDoTitulo(b) ?? '') || descricao(a).localeCompare(descricao(b))
    )
  }
  return lista
}

interface Secao {
  titulo: string
  lista: Boleto[]
  // Soma exibida no cabeçalho da seção: o que era devido ou o que foi pago.
  total: (b: Boleto) => number
}

interface Relatorio {
  subtitulo: string
  resumo: [string, string][]
  secoes: Secao[]
  arquivo: string
}

export async function gerarRelatorioConciliacaoPdf(
  tipo: TipoDataRelatorio,
  de: string,
  ate: string,
  titulos: Boleto[]
) {
  const relatorio: Relatorio =
    tipo === 'vencimento' ? relatorioPorVencimento(de, ate, titulos) : relatorioPorPagamento(tipo, de, ate, titulos)
  await desenharPdf(relatorio)
}

function relatorioPorVencimento(de: string, ate: string, titulos: Boleto[]): Relatorio {
  const confirmados = titulos.filter((b) => b.status === 'pago')
  const pendentes = titulos.filter((b) => b.status !== 'pago')
  const totalDevido = titulos.reduce((acc, b) => acc + devido(b), 0)
  const totalConfirmado = confirmados.reduce((acc, b) => acc + devido(b), 0)
  return {
    subtitulo: `Vencimento ${periodoTexto(de, ate)}`,
    resumo: [
      ['Títulos', `${confirmados.length}/${titulos.length} confirmados`],
      ['Valor total', moeda(totalDevido)],
      ['Confirmado', moeda(totalConfirmado)],
      ['Pendente', moeda(totalDevido - totalConfirmado)],
    ],
    secoes: [
      { titulo: 'Pendentes', lista: pendentes, total: devido },
      { titulo: 'Confirmados', lista: confirmados, total: devido },
    ],
    arquivo: de === ate ? `Conciliacao-vencimento-${de}.pdf` : `Conciliacao-vencimento-${de}_a_${ate}.pdf`,
  }
}

function relatorioPorPagamento(tipo: 'pagamento' | 'compensacao', de: string, ate: string, titulos: Boleto[]): Relatorio {
  const totalRecebido = titulos.reduce((acc, b) => acc + pago(b), 0)
  const juros = titulos.reduce((acc, b) => acc + Number(b.juros ?? 0), 0)
  const parciais = titulos.filter((b) => b.status === 'parcial').length
  const compensacao = tipo === 'compensacao'
  return {
    subtitulo: `${compensacao ? 'Compensados no banco' : 'Pagamentos efetuados'} ${periodoTexto(de, ate)}`,
    resumo: [
      ['Títulos pagos', String(titulos.length)],
      ['Total recebido', moeda(totalRecebido)],
      ['Juros', moeda(juros)],
      ['Pagamentos parciais', String(parciais)],
    ],
    secoes: [{ titulo: compensacao ? 'Pagamentos compensados' : 'Pagamentos efetuados', lista: titulos, total: pago }],
    arquivo: `Conciliacao-${tipo}-${de === ate ? de : `${de}_a_${ate}`}.pdf`,
  }
}

async function desenharPdf(relatorio: Relatorio) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const largura = pdf.internal.pageSize.getWidth()
  const altura = pdf.internal.pageSize.getHeight()
  const margem = 12
  let y = margem

  // Colunas: título/NF, parcela, vencimento, valor, pago, pago em.
  const colunas = [
    { titulo: 'Cliente / NF', x: margem, w: 70 },
    { titulo: 'Parc.', x: margem + 72, w: 10 },
    { titulo: 'Venc.', x: margem + 84, w: 20 },
    { titulo: 'Valor', x: margem + 104, w: 26, direita: true },
    { titulo: 'Pago', x: margem + 134, w: 28, direita: true },
    { titulo: 'Pago em', x: margem + 164, w: 22 },
  ]

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

  function secao({ titulo, lista, total }: Secao) {
    if (y + 20 > altura - margem - 6) {
      pdf.addPage()
      y = margem
    }
    const soma = lista.reduce((acc, b) => acc + total(b), 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(20)
    pdf.text(`${titulo} (${lista.length})`, margem, y)
    pdf.text(moeda(soma), largura - margem, y, { align: 'right' })
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
      pdf.text(formatDate(b.vencimento), colunas[2].x, y)
      pdf.text(moeda(devido(b)), colunas[3].x + colunas[3].w, y, { align: 'right' })
      pdf.text(moeda(pago(b)), colunas[4].x + colunas[4].w, y, { align: 'right' })
      pdf.text(b.data_pagamento ? formatDate(b.data_pagamento) : '—', colunas[5].x, y)
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
  pdf.text(relatorio.subtitulo, margem, y)
  pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, largura - margem, y, { align: 'right' })
  y += 9

  pdf.setDrawColor(200)
  pdf.roundedRect(margem, y - 4, largura - margem * 2, 14, 2, 2)
  const passo = (largura - margem * 2) / relatorio.resumo.length
  relatorio.resumo.forEach(([rotulo, valor], i) => {
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

  for (const s of relatorio.secoes) secao(s)

  const paginas = pdf.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(130)
    pdf.text(`Página ${p} de ${paginas}`, largura / 2, altura - 6, { align: 'center' })
  }

  pdf.save(relatorio.arquivo)
}
