import { useMemo, type ReactNode } from 'react'
import JsBarcode from 'jsbarcode'
import { parseDanfe, type Danfe } from '../../lib/danfeParser'

// DANFE completo (A4) montado a partir do XML da NF-e, no formato do documento
// que o ERP da MCI emite: canhoto, emitente com logotipo, chave de acesso com código
// de barras, destinatário, fatura, cálculo do imposto, transportador, produtos,
// ISSQN e dados adicionais. Fica escondido na tela e só aparece na impressão
// (`visible` mostra na tela, pra conferir).

const CSS = `
.dfe { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 8pt; line-height: 1.15; width: 100%; background: #fff; }
.dfe * { box-sizing: border-box; }
.dfe .row { display: flex; }
.dfe .box { border: 0.5pt solid #000; border-radius: 1.2mm; padding: 0.5mm 1.2mm 0.7mm; margin-bottom: 0.7mm; min-width: 0; overflow: hidden; }
.dfe .row > .box + .box, .dfe .row > .col + .col, .dfe .row > .box + .col, .dfe .row > .col + .box { margin-left: 0.7mm; }
.dfe .col { display: flex; flex-direction: column; min-width: 0; }
.dfe .lb { display: block; font-size: 5pt; text-transform: uppercase; color: #222; }
.dfe .v { display: block; font-size: 8pt; word-break: break-word; }
.dfe .vb { font-weight: 700; }
.dfe .sec { font-size: 6pt; font-weight: 700; text-transform: uppercase; margin: 1.2mm 0 0.3mm; }
.dfe .c { text-align: center; }
.dfe .r { text-align: right; }
.dfe table.it { width: 100%; border-collapse: collapse; font-size: 7pt; border: 0.5pt solid #000; table-layout: fixed; }
.dfe table.it th { font-size: 5pt; font-weight: 400; text-transform: uppercase; border: 0.5pt solid #000; padding: 0.5mm; }
.dfe table.it td { border-left: 0.5pt solid #000; border-right: 0.5pt solid #000; padding: 0.3mm 0.8mm; vertical-align: top; word-break: break-word; }
.dfe .barras svg { display: block; width: 100%; height: 11mm; }
@media print { .dfe { font-size: 8pt; } }
`

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const data = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

function docMask(d: string): string {
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}
const cepMask = (c: string) => (c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c)
const numeroNota = (n: string) => n.padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.')
const chaveGrupos = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ')

const FRETE: Record<string, string> = {
  '0': '0 - Emitente',
  '1': '1 - Dest/Rem',
  '2': '2 - Terceiros',
  '3': '3 - Próprio Rem.',
  '4': '4 - Próprio Dest.',
  '9': '9 - Sem Frete',
}

// Code 128 (conjunto C) da chave de acesso — o código que o leitor da portaria lê.
function barrasSvg(chave: string): string {
  if (!/^\d{44}$/.test(chave)) return ''
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, chave, { format: 'CODE128C', displayValue: false, margin: 0, height: 40, width: 1 })
  const w = parseFloat(svg.getAttribute('width') ?? '')
  const h = parseFloat(svg.getAttribute('height') ?? '')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  return svg.outerHTML
}

function Campo({ rotulo, children, className = '', style }: { rotulo: string; children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`box ${className}`} style={style}>
      <span className="lb">{rotulo}</span>
      <span className="v">{children ?? ' '}</span>
    </div>
  )
}

function PedacoPessoa({ p }: { p: Danfe['dest'] }) {
  return (
    <>
      <div className="row">
        <Campo rotulo="Nome / Razão Social" style={{ flex: 5.2 }}>
          {p.nome}
        </Campo>
        <Campo rotulo="CNPJ / CPF" style={{ flex: 1.9 }}>
          {docMask(p.doc)}
        </Campo>
      </div>
      <div className="row">
        <Campo rotulo="Endereço" style={{ flex: 5.2 }}>
          {p.logradouro}
        </Campo>
        <Campo rotulo="Bairro / Distrito" style={{ flex: 2.4 }}>
          {p.bairro}
        </Campo>
        <Campo rotulo="CEP" style={{ flex: 1.4 }}>
          {cepMask(p.cep)}
        </Campo>
      </div>
    </>
  )
}

export function DanfeNfe({ xml, visible = false }: { xml: string; visible?: boolean }) {
  const d = useMemo(() => parseDanfe(xml), [xml])
  const barras = useMemo(() => (d ? barrasSvg(d.chave) : ''), [d])
  if (!d) return null

  const emitEndereco = [d.emit.logradouro, d.emit.bairro].filter(Boolean)
  const enchimento = Math.max(0, 70 - d.itens.length * 5)
  const numero = numeroNota(d.numero)

  return (
    <div className={`dfe ${visible ? '' : 'hidden print:block'}`}>
      <style>{CSS}</style>

      {/* Canhoto */}
      <div className="row">
        <div className="col" style={{ flex: 5.6 }}>
          <div className="box" style={{ fontSize: '6pt', lineHeight: 1.25 }}>
            RECEBEMOS DE {d.emit.nome} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO.
            <br />
            DESTINATARIO: {d.dest.nome} - {[d.dest.logradouro, d.dest.bairro].filter(Boolean).join(', ')} - {d.dest.municipio}-{d.dest.uf}
            <br />
            EMISSÃO: {data(d.emissao)}, VALOR TOTAL R$: {brl(d.total.nota)}
          </div>
          <div className="row">
            <Campo rotulo="Data de referência" style={{ flex: 1 }} />
            <Campo rotulo="Identificação e assinatura do recebedor" style={{ flex: 4.2 }} />
          </div>
        </div>
        <div className="box c" style={{ flex: 1.4, marginLeft: '0.7mm' }}>
          <div className="vb" style={{ fontSize: '9pt' }}>
            NF-e
          </div>
          <div className="vb" style={{ fontSize: '10pt' }}>
            Nº {numero}
          </div>
          <div className="vb" style={{ fontSize: '8pt' }}>
            SÉRIE {d.serie}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '0.5pt dashed #000', margin: '1mm 0 1.4mm' }} />

      {/* Emitente / DANFE / chave */}
      <div className="row">
        <div className="box" style={{ flex: 3.5, display: 'flex', gap: '2mm', minHeight: '30mm', position: 'relative' }}>
          <div style={{ width: '28mm', flexShrink: 0 }}>
            <img src="/logo.png" alt="" style={{ width: '27mm', display: 'block', marginTop: '3mm' }} />
            {d.refPedido && <span className="vb" style={{ position: 'absolute', left: '1.2mm', bottom: '0.7mm', fontSize: '8pt' }}>Ch:{d.refPedido}</span>}
          </div>
          <div style={{ fontSize: '7.5pt', lineHeight: 1.1 }}>
            <div style={{ textTransform: 'uppercase' }}>{d.emit.nome}</div>
            {emitEndereco.map((l) => (
              <div key={l}>{l}</div>
            ))}
            <div>
              {d.emit.municipio} - {d.emit.uf}
            </div>
            <div>CEP: {cepMask(d.emit.cep)}</div>
            {d.emit.fone && <div>FONE: {d.emit.fone}</div>}
          </div>
        </div>
        <div className="box c" style={{ flex: 1.7, marginLeft: '0.7mm' }}>
          <div className="vb" style={{ fontSize: '12pt' }}>
            DANFE
          </div>
          <div className="vb" style={{ fontSize: '6pt' }}>
            Documento Auxiliar da
            <br />
            Nota Fiscal Eletrônica
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2mm', margin: '1mm 0', textAlign: 'left' }}>
            <div className="vb" style={{ fontSize: '7pt', lineHeight: 1.2 }}>
              0 - ENTRADA
              <br />1 - SAÍDA
            </div>
            <div className="vb" style={{ border: '0.5pt solid #000', padding: '0 2mm', fontSize: '8pt' }}>
              {d.tipo || '1'}
            </div>
          </div>
          <div className="vb" style={{ fontSize: '9pt' }}>
            Nº {numero}
          </div>
          <div className="vb" style={{ fontSize: '8pt' }}>
            SÉRIE {d.serie}
          </div>
          <div className="vb" style={{ fontSize: '8pt' }}>
            FOLHA 1/1
          </div>
        </div>
        <div className="col" style={{ flex: 3.7, marginLeft: '0.7mm' }}>
          <div className="box">
            <div className="barras" dangerouslySetInnerHTML={{ __html: barras }} />
          </div>
          <Campo rotulo="Chave de acesso">
            <span className="vb" style={{ fontSize: '8.5pt' }}>
              {chaveGrupos(d.chave)}
            </span>
          </Campo>
          <div className="box c" style={{ fontSize: '7pt', marginBottom: 0 }}>
            Consulta de autenticidade no portal nacional da NF-e
            <br />
            www.nfe.fazenda.gov.br ou no site da Sefaz Autorizadora
          </div>
        </div>
      </div>

      <div className="row">
        <Campo rotulo="Nat. Operação" style={{ flex: 5.2 }}>
          {d.naturezaOperacao}
        </Campo>
        <Campo rotulo="Dados da NFe" style={{ flex: 3.7 }}>
          {d.protocolo && (
            <span className="vb" style={{ fontSize: '7.5pt' }}>
              Prot.: {d.protocolo} Data/Hora: {d.dataProtocolo}
            </span>
          )}
        </Campo>
      </div>
      <div className="row">
        <Campo rotulo="Inscrição Estadual" style={{ flex: 2.6 }}>
          {d.emit.ie}
        </Campo>
        <Campo rotulo="Insc. Estadual do Subst. Tributário" style={{ flex: 2.6 }}>
          {d.emit.iest}
        </Campo>
        <Campo rotulo="CNPJ" style={{ flex: 3.7 }}>
          {docMask(d.emit.doc)}
        </Campo>
      </div>

      {/* Destinatário / Remetente */}
      <div className="sec">Destinatário / Remetente</div>
      <div className="row">
        <div className="col" style={{ flex: 8.5 }}>
          <PedacoPessoa p={d.dest} />
        </div>
        <div className="col" style={{ flex: 1.9, marginLeft: '0.7mm' }}>
          <Campo rotulo="Data da emissão">{data(d.emissao)}</Campo>
          <Campo rotulo="Data de saída / entrada">{data(d.saida)}</Campo>
        </div>
      </div>
      <div className="row">
        <Campo rotulo="Município" style={{ flex: 3.4 }}>
          {d.dest.municipio}
        </Campo>
        <Campo rotulo="Fone / Fax" style={{ flex: 2.2 }}>
          {d.dest.fone}
        </Campo>
        <Campo rotulo="UF" style={{ flex: 0.8 }}>
          {d.dest.uf}
        </Campo>
        <Campo rotulo="Inscrição Estadual" style={{ flex: 2.1 }}>
          {d.dest.ie}
        </Campo>
        <Campo rotulo="Hora de saída" style={{ flex: 1.9 }}>
          {d.horaSaida}
        </Campo>
      </div>

      {/* Fatura */}
      <div className="sec">Fatura</div>
      <div className="box" style={{ minHeight: '9mm', display: 'flex', flexWrap: 'wrap', gap: '1.5mm 5mm' }}>
        {d.duplicatas.map((dup, i) => (
          <span key={i} className="v" style={{ fontSize: '7.5pt' }}>
            {dup.numero} · {data(dup.vencimento)} · R$ {brl(dup.valor)}
          </span>
        ))}
      </div>

      {/* Cálculo do imposto */}
      <div className="sec">Cálculo do imposto</div>
      <div className="row">
        <Campo rotulo="Base de cálculo do ICMS" style={{ flex: 1 }}>
          {brl(d.total.baseIcms)}
        </Campo>
        <Campo rotulo="Valor do ICMS" style={{ flex: 1 }}>
          {brl(d.total.icms)}
        </Campo>
        <Campo rotulo="Base de cálc. do ICMS subst." style={{ flex: 1 }}>
          {brl(d.total.baseIcmsSt)}
        </Campo>
        <Campo rotulo="Valor do ICMS substituição" style={{ flex: 1 }}>
          {brl(d.total.icmsSt)}
        </Campo>
        <Campo rotulo="Valor total dos produtos" style={{ flex: 1.1 }}>
          {brl(d.total.produtos)}
        </Campo>
      </div>
      <div className="row">
        <Campo rotulo="Valor do frete" style={{ flex: 1 }}>
          {brl(d.total.frete)}
        </Campo>
        <Campo rotulo="Valor do seguro" style={{ flex: 1 }}>
          {brl(d.total.seguro)}
        </Campo>
        <Campo rotulo="Desconto" style={{ flex: 1 }}>
          {brl(d.total.desconto)}
        </Campo>
        <Campo rotulo="Outras despesas acessórias" style={{ flex: 1 }}>
          {brl(d.total.outras)}
        </Campo>
        <Campo rotulo="Valor do IPI" style={{ flex: 1 }}>
          {brl(d.total.ipi)}
        </Campo>
        <Campo rotulo="Valor total da nota" style={{ flex: 1.1 }}>
          <span className="vb">{brl(d.total.nota)}</span>
        </Campo>
      </div>

      {/* Transportador / volumes */}
      <div className="sec">Transportador / Volumes transportados</div>
      <div className="row">
        <Campo rotulo="Razão social" style={{ flex: 4.4 }}>
          {d.transp.nome}
        </Campo>
        <Campo rotulo="Frete por conta" style={{ flex: 1.6 }}>
          {FRETE[d.transp.modalidade] ?? d.transp.modalidade}
        </Campo>
        <Campo rotulo="Código ANTT" style={{ flex: 1.2 }}>
          {d.transp.antt}
        </Campo>
        <Campo rotulo="Placa do veículo" style={{ flex: 1.2 }}>
          {d.transp.placa}
        </Campo>
        <Campo rotulo="UF" style={{ flex: 0.6 }}>
          {d.transp.ufPlaca}
        </Campo>
        <Campo rotulo="CNPJ / CPF" style={{ flex: 1.8 }}>
          {docMask(d.transp.doc)}
        </Campo>
      </div>
      <div className="row">
        <Campo rotulo="Endereço" style={{ flex: 5 }}>
          {d.transp.endereco}
        </Campo>
        <Campo rotulo="Município" style={{ flex: 2.6 }}>
          {d.transp.municipio}
        </Campo>
        <Campo rotulo="UF" style={{ flex: 0.6 }}>
          {d.transp.uf}
        </Campo>
        <Campo rotulo="Inscrição Estadual" style={{ flex: 1.8 }}>
          {d.transp.ie}
        </Campo>
      </div>
      {(d.transp.volumes.length > 0 ? d.transp.volumes : [null]).map((v, i) => (
        <div className="row" key={i}>
          <Campo rotulo="Quantidade" style={{ flex: 1.2 }}>
            {v?.quantidade}
          </Campo>
          <Campo rotulo="Espécie" style={{ flex: 1.4 }}>
            {v?.especie}
          </Campo>
          <Campo rotulo="Marca" style={{ flex: 1.4 }}>
            {v?.marca}
          </Campo>
          <Campo rotulo="Numeração" style={{ flex: 1.6 }}>
            {v?.numeracao}
          </Campo>
          <Campo rotulo="Peso bruto" style={{ flex: 1.6 }}>
            {v?.pesoBruto}
          </Campo>
          <Campo rotulo="Peso líquido" style={{ flex: 1.6 }}>
            {v?.pesoLiquido}
          </Campo>
        </div>
      ))}

      {/* Produtos */}
      <div className="sec">Dados do produto / serviços</div>
      <table className="it">
        <colgroup>
          {[9, 20, 8, 4, 4, 3, 6, 8, 8, 8, 6, 6, 5, 5].map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Cód. produto</th>
            <th>Descrição do produto / serviços</th>
            <th>NCM/SH</th>
            <th>CST</th>
            <th>CFOP</th>
            <th>UNID</th>
            <th>QTD</th>
            <th>V. unitário</th>
            <th>V. total</th>
            <th>BC do ICMS</th>
            <th>V. ICMS</th>
            <th>V. IPI</th>
            <th>Aliq. ICMS</th>
            <th>Aliq. IPI</th>
          </tr>
        </thead>
        <tbody>
          {d.itens.map((it, i) => (
            <tr key={i}>
              <td>{it.codigo}</td>
              <td>{it.descricao}</td>
              <td>{it.ncm}</td>
              <td>{it.cst}</td>
              <td>{it.cfop}</td>
              <td>{it.unidade}</td>
              <td className="r">{qtd(it.quantidade)}</td>
              <td className="r">{brl(it.valorUnitario)}</td>
              <td className="r">{brl(it.valorTotal)}</td>
              <td className="r">{brl(it.baseIcms)}</td>
              <td className="r">{brl(it.valorIcms)}</td>
              <td className="r">{brl(it.valorIpi)}</td>
              <td className="r">{brl(it.aliqIcms)}</td>
              <td className="r">{brl(it.aliqIpi)}</td>
            </tr>
          ))}
          <tr>
            {Array.from({ length: 14 }, (_, i) => (
              <td key={i} style={{ height: `${enchimento}mm` }} />
            ))}
          </tr>
        </tbody>
      </table>

      <div className="sec">Cálculo do ISSQN</div>
      <div className="row">
        <Campo rotulo="Inscrição municipal" style={{ flex: 1 }} />
        <Campo rotulo="Valor total dos serviços" style={{ flex: 1 }} />
        <Campo rotulo="Base de cálculo do ISSQN" style={{ flex: 1 }} />
        <Campo rotulo="Valor do ISSQN" style={{ flex: 1 }} />
      </div>

      <div className="sec">Dados adicionais</div>
      <div className="row">
        <div className="box" style={{ flex: 6, minHeight: '22mm' }}>
          <span className="lb">Informações complementares</span>
          <span className="v" style={{ fontSize: '7pt' }}>
            {d.infCpl}
          </span>
        </div>
        <div className="box" style={{ flex: 4, minHeight: '22mm' }}>
          <span className="lb">Reservado ao fisco</span>
          <span className="v" style={{ fontSize: '7pt' }}>
            {d.infFisco}
          </span>
        </div>
      </div>
    </div>
  )
}
