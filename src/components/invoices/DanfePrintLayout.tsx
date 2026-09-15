import type { ReactNode, RefObject } from 'react'
import { formatCurrency, formatDate } from '../../lib/format'
import type { NFeDetalhes } from '../../lib/nfeParser'
import type { Invoice } from '../../types/domain'

function formatChave(chave: string | null): string {
  if (!chave) return ''
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

// Layout só para impressão/PDF, inspirado no DANFE oficial da NF-e (a mesma
// estrutura de caixas: emitente, chave de acesso, destinatário, cálculo do
// imposto, produtos, dados adicionais) — pensado pra ser algo apresentável
// pra mandar pro cliente, não uma réplica certificada byte-a-byte do PDF
// gerado pelo emissor fiscal (não temos todos os campos granulares dele,
// tipo CST/base de ICMS por item — só os totais da nota).
export function DanfePrintLayout({
  invoice,
  detalhes,
  capturing = false,
  containerRef,
}: {
  invoice: Invoice
  detalhes: NFeDetalhes | null
  // Quando true, renderiza fora da tela (mas com layout/estilos reais) em vez
  // de "display:none" — necessário pra biblioteca de captura conseguir
  // rasterizar este DOM ao gerar o PDF pra compartilhar via WhatsApp.
  capturing?: boolean
  containerRef?: RefObject<HTMLDivElement>
}) {
  const chave = invoice.xml_chave_acesso ?? detalhes?.chaveAcesso ?? null
  const isServico = !detalhes || detalhes.itens.every((i) => !i.ncm && !i.cfop)

  return (
    <div
      ref={containerRef}
      className={capturing ? undefined : 'hidden print:block'}
      style={
        capturing
          ? { position: 'fixed', top: 0, left: '-10000px', width: '794px', background: '#fff', fontSize: '9px', lineHeight: 1.35, color: '#000' }
          : { fontSize: '9px', lineHeight: 1.35, color: '#000' }
      }
    >
      {/* Canhoto do destinatário — mesma faixa de recibo que vem no topo do DANFE oficial */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #000', padding: '4px', verticalAlign: 'top' }}>
              <div>
                RECEBEMOS DE <strong>{detalhes?.emitNome || invoice.filiais?.nome || 'EMITENTE'}</strong> OS
                {isServico ? ' SERVIÇOS CONSTANTES' : ' PRODUTOS CONSTANTES'} DA NOTA FISCAL INDICADA AO LADO.
              </div>
              <div>
                DESTINATÁRIO: {detalhes?.destNome || invoice.cliente}
                {detalhes?.destEndereco ? ` - ${detalhes.destEndereco}` : ''}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                <span>EMISSÃO: {formatDate(invoice.data_emissao)} · VALOR TOTAL R$: {formatCurrency(invoice.valor)}</span>
                <span>DATA DE RECEBIMENTO: _____/_____/_______</span>
              </div>
              <div style={{ marginTop: '10px', borderTop: '1px solid #000', paddingTop: '2px' }}>
                IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR
              </div>
            </td>
            <td style={{ border: '1px solid #000', padding: '4px', width: '90px', textAlign: 'center', verticalAlign: 'middle' }}>
              <div style={{ fontWeight: 700 }}>N. {invoice.numero_nf}</div>
              <div>SÉRIE 1</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', margin: '4px 0 6px' }} />

      {/* Bloco principal: emitente / identificação DANFE / chave de acesso */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #000', padding: '4px', width: '38%', verticalAlign: 'top' }}>
              <div style={{ fontWeight: 700, fontSize: '11px' }}>{detalhes?.emitNome || invoice.filiais?.nome || 'EMITENTE'}</div>
              {detalhes?.emitEndereco && <div>{detalhes.emitEndereco}</div>}
              {detalhes?.emitCnpj && <div>CNPJ: {detalhes.emitCnpj}</div>}
            </td>
            <td style={{ border: '1px solid #000', padding: '4px', width: '16%', textAlign: 'center', verticalAlign: 'middle' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>DANFE</div>
              <div style={{ fontSize: '7px' }}>Documento Auxiliar da Nota Fiscal Eletrônica</div>
              <div style={{ marginTop: '4px' }}>0 - Entrada &nbsp; <strong>1 - Saída</strong></div>
              <div style={{ marginTop: '4px' }}>N° {invoice.numero_nf}</div>
              <div>Série 1 &nbsp; Folha 1/1</div>
            </td>
            <td style={{ border: '1px solid #000', padding: '4px', width: '46%', verticalAlign: 'top' }}>
              {chave && (
                <>
                  <BarcodeStripe />
                  <div style={{ textAlign: 'center', fontFamily: 'monospace', marginTop: '2px' }}>{formatChave(chave)}</div>
                </>
              )}
              <div style={{ textAlign: 'center', marginTop: '2px' }}>
                Consulta de autenticidade no portal nacional da NF-e
                <br />
                www.nfe.fazenda.gov.br ou no site da Sefaz Autorizadora
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {detalhes?.protocolo && (
        <div style={{ border: '1px solid #000', padding: '4px', marginBottom: '4px' }}>
          Protocolo de Autorização de Uso: <strong>{detalhes.protocolo}</strong> &nbsp; Data/Hora: {detalhes.dataAutorizacao}
        </div>
      )}

      <div style={{ border: '1px solid #000', padding: '4px', marginBottom: '4px' }}>
        NATUREZA DA OPERAÇÃO: {detalhes?.naturezaOperacao || invoice.tipo_operacao}
      </div>

      {/* Destinatário / Remetente */}
      <SectionLabel text="DESTINATÁRIO / REMETENTE" />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #000', padding: '4px', width: '55%' }}>
              <FieldLabel text="NOME/RAZÃO SOCIAL" />
              {detalhes?.destNome || invoice.cliente}
            </td>
            <td style={{ border: '1px solid #000', padding: '4px', width: '25%' }}>
              <FieldLabel text="CPF/CNPJ" />
              {detalhes?.destCnpjCpf || '—'}
            </td>
            <td style={{ border: '1px solid #000', padding: '4px', width: '20%' }}>
              <FieldLabel text="DATA EMISSÃO" />
              {formatDate(invoice.data_emissao)}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #000', padding: '4px' }} colSpan={2}>
              <FieldLabel text="ENDEREÇO" />
              {detalhes?.destEndereco || invoice.estado || '—'}
            </td>
            <td style={{ border: '1px solid #000', padding: '4px' }}>
              <FieldLabel text="UF" />
              {invoice.estado || '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Cálculo do Imposto */}
      <SectionLabel text="CÁLCULO DO IMPOSTO" />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px', textAlign: 'center' }}>
        <tbody>
          <tr>
            <Td label="VALOR DOS PRODUTOS/SERVIÇOS" value={formatCurrency(detalhes?.valorProdutos ?? invoice.valor)} />
            <Td label="VALOR DO FRETE" value={formatCurrency(invoice.frete)} />
            <Td label="VALOR DO ICMS" value={formatCurrency(invoice.valor_icms)} />
            <Td label="VALOR DO IPI" value={formatCurrency(invoice.valor_ipi)} />
            <Td label="VALOR TOTAL DA NOTA" value={formatCurrency(invoice.valor)} strong />
          </tr>
        </tbody>
      </table>

      {invoice.transportadora && (
        <>
          <SectionLabel text="TRANSPORTADOR / VOLUMES TRANSPORTADOS" />
          <div style={{ border: '1px solid #000', padding: '4px', marginBottom: '4px' }}>
            Nome: {invoice.transportadora}
          </div>
        </>
      )}

      {/* Produtos / Serviços */}
      <SectionLabel text={isServico ? 'DADOS DO SERVIÇO' : 'DADOS DO PRODUTO/SERVIÇO'} />
      {detalhes && detalhes.itens.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <thead>
            <tr>
              <Th text="CÓDIGO" />
              <Th text="DESCRIÇÃO" />
              {!isServico && <Th text="NCM" />}
              {!isServico && <Th text="CFOP" />}
              <Th text="UNID" />
              <Th text="QTD" align="right" />
              <Th text="VLR UNIT" align="right" />
              <Th text="VLR TOTAL" align="right" />
            </tr>
          </thead>
          <tbody>
            {detalhes.itens.map((item, i) => (
              <tr key={i}>
                <Td2>{item.codigo}</Td2>
                <Td2>{item.descricao}</Td2>
                {!isServico && <Td2>{item.ncm}</Td2>}
                {!isServico && <Td2>{item.cfop}</Td2>}
                <Td2>{item.unidade}</Td2>
                <Td2 align="right">{item.quantidade}</Td2>
                <Td2 align="right">{formatCurrency(item.valorUnitario)}</Td2>
                <Td2 align="right">{formatCurrency(item.valorTotal)}</Td2>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ border: '1px solid #000', padding: '4px', marginBottom: '4px' }}>
          {invoice.cliente} — {formatCurrency(invoice.valor)}
        </div>
      )}

      {/* Dados adicionais */}
      <SectionLabel text="DADOS ADICIONAIS" />
      <div style={{ border: '1px solid #000', padding: '4px', minHeight: '30px' }}>
        {detalhes?.informacoesComplementares || `Filial: ${invoice.filiais?.nome ?? '—'} · Vendedor: ${invoice.vendedores?.nome ?? '—'} · Forma de pagamento: ${invoice.meio_pagamento}${invoice.parcelas > 1 ? ` em ${invoice.parcelas}x` : ''}`}
      </div>
    </div>
  )
}

function BarcodeStripe() {
  // Puramente decorativo (não é um Code128 real/escaneável) — só pra dar a
  // aparência de código de barras que o DANFE oficial tem nessa área.
  const bars = Array.from({ length: 60 }, (_, i) => (i * 37) % 4 === 0 ? 2 : (i * 53) % 3 === 0 ? 0.5 : 1)
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '28px', gap: '1px' }}>
      {bars.map((w, i) => (
        <div key={i} style={{ width: `${w}px`, background: i % 2 === 0 ? '#000' : 'transparent' }} />
      ))}
    </div>
  )
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontWeight: 700, fontSize: '8px', margin: '4px 0 1px' }}>{text}</div>
  )
}

function FieldLabel({ text }: { text: string }) {
  return <div style={{ fontSize: '7px', color: '#444' }}>{text}</div>
}

function Th({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  return (
    <th style={{ border: '1px solid #000', padding: '2px 4px', fontSize: '7px', textAlign: align, background: '#eee' }}>
      {text}
    </th>
  )
}

function Td({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <td style={{ border: '1px solid #000', padding: '3px' }}>
      <FieldLabel text={label} />
      <div style={{ fontWeight: strong ? 700 : 400 }}>{value}</div>
    </td>
  )
}

function Td2({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: align }}>{children}</td>
}
