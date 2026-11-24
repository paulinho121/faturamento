import { strToU8, zipSync } from 'fflate'

// Gerador mínimo de planilha Excel (.xlsx) no navegador, sem biblioteca de planilha: um .xlsx é um zip de XMLs.
// Suporta várias abas, texto, números, moeda, datas, cabeçalho em negrito, larguras de coluna, linhas congeladas
// e filtro automático. Textos entram como "inline strings" (sem tabela de textos compartilhados).

export type Estilo = 'cabecalho' | 'titulo' | 'negrito' | 'moeda' | 'moedaNegrito' | 'data' | 'inteiro' | 'inteiroNegrito'

export interface CelulaEstilizada {
  v: string | number | null
  s?: Estilo
}

export type Celula = string | number | null | CelulaEstilizada

export interface Planilha {
  nome: string
  linhas: Celula[][]
  larguras?: number[] // em caracteres, por coluna
  congelarLinhas?: number // linhas fixas no topo (ex.: 1 = cabeçalho)
  filtroAutomatico?: boolean // filtro nas colunas da primeira linha com dados (a linha de cabeçalho informada em congelarLinhas)
}

// Índice de cada estilo em <cellXfs> (0 = padrão).
const ESTILO_INDICE: Record<Estilo, number> = {
  cabecalho: 1,
  titulo: 2,
  negrito: 3,
  moeda: 4,
  moedaNegrito: 5,
  data: 6,
  inteiro: 7,
  inteiroNegrito: 8,
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="9">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

function esc(texto: string): string {
  // Remove caracteres de controle proibidos em XML e escapa os especiais.
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function coluna(indice: number): string {
  let n = indice + 1
  let letras = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letras = String.fromCharCode(65 + resto) + letras
    n = Math.floor((n - 1) / 26)
  }
  return letras
}

// Data AAAA-MM-DD -> número de série do Excel (dias desde 30/12/1899).
export function serialDaData(dataIso: string): number | null {
  const [a, m, d] = dataIso.slice(0, 10).split('-').map(Number)
  if (!a || !m || !d) return null
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

function celulaXml(ref: string, c: Celula): string {
  const cel: CelulaEstilizada = c !== null && typeof c === 'object' ? c : { v: c }
  const estilo = cel.s ? ` s="${ESTILO_INDICE[cel.s]}"` : ''
  if (cel.v === null || cel.v === undefined || cel.v === '') return estilo ? `<c r="${ref}"${estilo}/>` : ''
  if (typeof cel.v === 'number') {
    if (!Number.isFinite(cel.v)) return ''
    return `<c r="${ref}"${estilo}><v>${cel.v}</v></c>`
  }
  return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(cel.v)}</t></is></c>`
}

function nomeDeAba(nome: string, usados: Set<string>): string {
  let base = nome.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Planilha'
  let n = 2
  while (usados.has(base.toLowerCase())) {
    const sufixo = ` ${n++}`
    base = `${base.slice(0, 31 - sufixo.length)}${sufixo}`
  }
  usados.add(base.toLowerCase())
  return base
}

function planilhaXml(p: Planilha): string {
  const largura = p.larguras ?? []
  const cols = largura.length
    ? `<cols>${largura.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(w, 4)}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const congela = p.congelarLinhas && p.congelarLinhas > 0 ? p.congelarLinhas : 0
  const vista = congela
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${congela}" topLeftCell="A${congela + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const linhasXml = p.linhas
    .map((linha, r) => {
      const celulas = linha.map((c, i) => celulaXml(`${coluna(i)}${r + 1}`, c)).join('')
      return `<row r="${r + 1}">${celulas}</row>`
    })
    .join('')
  const larguraMax = Math.max(0, ...p.linhas.map((l) => l.length))
  const filtro = p.filtroAutomatico && congela > 0 && p.linhas.length > congela && larguraMax > 0 ? `<autoFilter ref="A${congela}:${coluna(larguraMax - 1)}${p.linhas.length}"/>` : ''
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    vista +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${linhasXml}</sheetData>` +
    filtro +
    '</worksheet>'
  )
}

export function gerarXlsx(planilhas: Planilha[]): Uint8Array {
  const usados = new Set<string>()
  const abas = planilhas.map((p) => ({ ...p, nome: nomeDeAba(p.nome, usados) }))
  const arquivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        '</workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
  }
  abas.forEach((a, i) => {
    arquivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(planilhaXml(a))
  })
  return zipSync(arquivos, { level: 6 })
}

export function baixarXlsx(nomeArquivo: string, planilhas: Planilha[]): void {
  const bytes = gerarXlsx(planilhas)
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
