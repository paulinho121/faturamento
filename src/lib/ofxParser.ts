export interface OfxTransacao {
  // conta:fitid — único por lançamento, usado pra nunca importar duas vezes.
  id: string
  data: string
  valor: number
  memo: string
}

export class OfxParseError extends Error {}

function campo(bloco: string, tag: string): string {
  return bloco.match(new RegExp(`<${tag}>([^\\n<]*)`))?.[1].trim() ?? ''
}

// OFX do Itaú é SGML (tags sem fechamento), então em vez de um parser XML
// lemos cada <STMTTRN> por regex. Só interessa o que entrou na conta (valor
// positivo) — saídas nem são retornadas.
export function parseOfx(texto: string): OfxTransacao[] {
  if (!/<OFX>/i.test(texto)) throw new OfxParseError('Este arquivo não parece ser um extrato OFX.')
  const conta = campo(texto, 'ACCTID') || 'sem-conta'
  const blocos = Array.from(texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g), (m) => m[1])
  const transacoes: OfxTransacao[] = []
  for (const bloco of blocos) {
    const valor = Number(campo(bloco, 'TRNAMT'))
    const dt = campo(bloco, 'DTPOSTED')
    const fitid = campo(bloco, 'FITID')
    if (!Number.isFinite(valor) || valor <= 0 || dt.length < 8 || !fitid) continue
    transacoes.push({
      id: `${conta}:${fitid}`,
      data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      valor: Math.round(valor * 100) / 100,
      memo: campo(bloco, 'MEMO').replace(/\s+/g, ' '),
    })
  }
  return transacoes
}
