import { formatCurrency, formatDate } from './format'
import { ROTULO_ENCARGOS } from './encargosAtraso'
import { rotuloParcela, soma, type BlocoNota } from './demonstrativo'

// PDF do demonstrativo desenhado direto (texto e linhas), no lugar de uma "foto" da tela fatiada em
// páginas: as linhas nunca são cortadas no meio, o cabeçalho da tabela se repete quando a nota passa
// de uma página, o arquivo fica leve (KB, não MB) e o texto continua selecionável.

type Cor = [number, number, number]
const VERDE: Cor = [46, 157, 62]
const VERMELHO: Cor = [224, 32, 32]
const CINZA: Cor = [85, 85, 85]
const PRETO: Cor = [17, 17, 17]
const AZUL: Cor = [26, 86, 219]
const VERDE_ESCURO: Cor = [46, 125, 50]
const AZUL_TITULO: Cor = [26, 92, 158]
const FUNDO_BLOCO: Cor = [232, 245, 233]
const LINHA_CLARA: Cor = [215, 215, 215]

// Margens e colunas (mm, A4 retrato 210 x 297).
const ML = 12
const MR = 198
const TOPO = 14
const RODAPE_Y = 288
const LIMITE_Y = 282
const ALTURA_LINHA = 6.2
const COL = { titulo: ML + 2, vencimento: 88, dias: 112, pago: 142, vencido: 172, aVencer: MR - 2 }

function moeda(valor: number): string {
  // Helvetica do jsPDF (WinAnsi): o espaço sem quebra do Intl vira espaço comum.
  return formatCurrency(valor).replace(/ /g, ' ')
}

export interface DadosDemonstrativo {
  cliente: string
  cnpj: string
  vendedor: string
  dataRef: string // AAAA-MM-DD
  nfFaturadas: number
  blocos: BlocoNota[]
}

async function carregarLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const resp = await fetch('/logo.png')
    if (!resp.ok) return null
    const blob = await resp.blob()
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = reject
      r.readAsDataURL(blob)
    })
    const dim = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = reject
      img.src = data
    })
    return { data, ...dim }
  } catch {
    return null
  }
}

export async function gerarDemonstrativoPdf(dados: DadosDemonstrativo): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const logo = await carregarLogo()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const todas = dados.blocos.flatMap((b) => b.linhas)
  let y = TOPO

  const cor = (c: Cor) => {
    doc.setTextColor(c[0], c[1], c[2])
  }
  const traco = (c: Cor, largura = 0.2) => {
    doc.setDrawColor(c[0], c[1], c[2])
    doc.setLineWidth(largura)
  }
  const texto = (
    t: string,
    x: number,
    yy: number,
    opts: { bold?: boolean; size?: number; color?: Cor; align?: 'left' | 'right' | 'center' } = {}
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 9)
    cor(opts.color ?? PRETO)
    doc.text(t, x, yy, { align: opts.align ?? 'left' })
  }

  // ---------- Cabeçalho (primeira página) ----------
  if (logo) {
    const h = 10
    const w = Math.min((logo.w / logo.h) * h, 40)
    doc.addImage(logo.data, 'PNG', ML, y - 1, w, h)
  }
  texto('DEMONSTRATIVO FINANCEIRO', MR, y + 5.5, { bold: true, size: 14, color: AZUL_TITULO, align: 'right' })
  traco(VERDE_ESCURO, 0.8)
  doc.line(ML, y + 11, MR, y + 11)
  y += 19

  const yInfo = y
  texto(`CNPJ/CPF: ${dados.cnpj}`, ML, y, { bold: true })
  y += 5.5
  const linhasCliente = doc.splitTextToSize(`Cliente: ${dados.cliente}`, 100) as string[]
  texto(linhasCliente[0], ML, y, { bold: true })
  for (const extra of linhasCliente.slice(1)) {
    y += 4.6
    texto(extra, ML, y, { bold: true })
  }
  y += 5.5
  texto(`Data: ${formatDate(dados.dataRef)}`, ML, y, { bold: true })

  // Resumo à direita.
  let yr = yInfo
  texto(`Vendedor: ${dados.vendedor}`, MR, yr, { bold: true, align: 'right' })
  yr += 6
  const resumo: { rotulo: string; valor: number; cor: Cor }[] = [
    { rotulo: 'NF Faturadas', valor: dados.nfFaturadas, cor: AZUL },
    { rotulo: 'Total Pago', valor: soma(todas, 'pago'), cor: VERDE },
    { rotulo: 'Vencido + juros', valor: soma(todas, 'vencidoJuros'), cor: VERMELHO },
    { rotulo: 'À vencer', valor: soma(todas, 'aVencer'), cor: PRETO },
  ]
  for (const r of resumo) {
    texto(r.rotulo, 128, yr, { bold: true })
    doc.setFillColor(r.cor[0], r.cor[1], r.cor[2])
    doc.rect(160, yr - 3, 3.2, 3.2, 'F')
    texto(moeda(r.valor), MR, yr, { bold: true, color: r.cor, align: 'right' })
    yr += 5.8
  }
  y = Math.max(y, yr) + 4

  // ---------- Tabelas por NF ----------
  const cabecalhoTabela = (titulo: string) => {
    doc.setFillColor(FUNDO_BLOCO[0], FUNDO_BLOCO[1], FUNDO_BLOCO[2])
    doc.rect(ML, y, MR - ML, ALTURA_LINHA + 0.8, 'F')
    const base = y + 4.5
    texto(titulo, COL.titulo, base, { bold: true, size: 8.5 })
    texto('Vencimento', COL.vencimento, base, { bold: true, size: 8.5, align: 'center' })
    texto('Dias de atraso', COL.dias, base, { bold: true, size: 8.5, align: 'center' })
    texto('Pago', COL.pago, base, { bold: true, size: 8.5, align: 'right' })
    texto('Vencido + juros', COL.vencido, base, { bold: true, size: 8.5, align: 'right' })
    texto('À vencer', COL.aVencer, base, { bold: true, size: 8.5, align: 'right' })
    y += ALTURA_LINHA + 0.8
  }

  const novaPagina = () => {
    doc.addPage()
    y = TOPO
  }

  for (const bloco of dados.blocos) {
    // Cabeçalho + pelo menos duas linhas (ou o bloco todo, se for menor) juntos: não deixa o título da
    // NF sozinho no fim da página. Se o bloco inteiro cabe numa página, ele vai inteiro pra próxima.
    const alturaBloco = ALTURA_LINHA + 0.8 + bloco.linhas.length * ALTURA_LINHA + ALTURA_LINHA + 4
    const alturaPagina = LIMITE_Y - TOPO
    const minimo = alturaBloco <= alturaPagina ? alturaBloco : ALTURA_LINHA + 0.8 + ALTURA_LINHA * 2
    if (y + minimo > LIMITE_Y) novaPagina()

    cabecalhoTabela(bloco.titulo)
    bloco.linhas.forEach((l, i) => {
      if (y + ALTURA_LINHA > LIMITE_Y) {
        novaPagina()
        cabecalhoTabela(`${bloco.titulo} (continuação)`)
      }
      const c = l.vencido > 0 ? VERMELHO : l.aVencer > 0 ? CINZA : VERDE
      const base = y + 4.4
      texto(rotuloParcela(l, bloco.linhas.length), COL.titulo, base, { color: c })
      texto(formatDate(l.boleto.vencimento), COL.vencimento, base, { color: c, align: 'center' })
      texto(String(l.atraso), COL.dias, base, { color: c, align: 'center' })
      if (l.pago > 0) texto(moeda(l.pago), COL.pago, base, { color: VERDE, align: 'right' })
      if (l.vencido > 0) texto(moeda(l.vencidoJuros), COL.vencido, base, { color: VERMELHO, align: 'right' })
      if (l.aVencer > 0) texto(moeda(l.aVencer), COL.aVencer, base, { color: CINZA, align: 'right' })
      y += ALTURA_LINHA
      if (i < bloco.linhas.length - 1) {
        traco(LINHA_CLARA, 0.15)
        doc.line(ML, y, MR, y)
      }
    })

    // Subtotal da NF.
    if (y + ALTURA_LINHA > LIMITE_Y) {
      novaPagina()
      cabecalhoTabela(`${bloco.titulo} (continuação)`)
    }
    traco(PRETO, 0.4)
    doc.line(ML, y, MR, y)
    const base = y + 4.6
    texto('Total da NF', COL.titulo, base, { bold: true })
    texto(moeda(soma(bloco.linhas, 'pago')), COL.pago, base, { bold: true, color: VERDE, align: 'right' })
    texto(moeda(soma(bloco.linhas, 'vencidoJuros')), COL.vencido, base, { bold: true, color: VERMELHO, align: 'right' })
    texto(moeda(soma(bloco.linhas, 'aVencer')), COL.aVencer, base, { bold: true, align: 'right' })
    y += ALTURA_LINHA + 5
  }

  // Nota sobre juros e multa.
  if (soma(todas, 'encargos') > 0) {
    if (y + 8 > LIMITE_Y) novaPagina()
    const nota = doc.splitTextToSize(
      `Juros e multa calculados sobre o saldo vencido até ${formatDate(dados.dataRef)}: ${ROTULO_ENCARGOS}.`,
      MR - ML
    ) as string[]
    texto(nota[0], ML, y, { size: 8, color: CINZA })
  }

  // ---------- Rodapé em todas as páginas ----------
  const paginas = doc.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    traco(PRETO, 0.4)
    doc.line(ML, RODAPE_Y - 4, MR, RODAPE_Y - 4)
    texto('Multi Comercial & Importadora LTDA', 105, RODAPE_Y, { size: 8.5, align: 'center' })
    texto(`Página ${p} de ${paginas}`, MR, RODAPE_Y, { size: 8, color: CINZA, align: 'right' })
  }

  return doc.output('blob')
}
