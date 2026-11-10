// Notas de demonstração: a mercadoria sai em demo e tem até 45 dias (da emissão) para voltar.
export const PRAZO_DEMO_DIAS = 45

// Nota de demo = tipo de operação "Demo" / "Demonstração".
export function isDemoTipo(tipoOperacao: string | null | undefined): boolean {
  return (tipoOperacao?.toUpperCase() ?? '').startsWith('DEMO')
}

function somaDias(data: string, dias: number): string {
  const d = new Date(`${data.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diferencaEmDias(de: string, ate: string): number {
  return Math.round((new Date(`${ate}T00:00:00Z`).getTime() - new Date(`${de}T00:00:00Z`).getTime()) / 86_400_000)
}

export function prazoFinalDemo(dataEmissao: string): string {
  return somaDias(dataEmissao, PRAZO_DEMO_DIAS)
}

export type NivelPrazoDemo = 'ok' | 'atencao' | 'atrasada'

// diasRestantes: positivo = faltam; 0 = vence hoje; negativo = atrasada.
export function situacaoPrazoDemo(
  dataEmissao: string,
  hoje: string
): { diasRestantes: number; diasDecorridos: number; nivel: NivelPrazoDemo; prazoFinal: string } {
  const prazoFinal = prazoFinalDemo(dataEmissao)
  const diasRestantes = diferencaEmDias(hoje, prazoFinal)
  const diasDecorridos = diferencaEmDias(dataEmissao.slice(0, 10), hoje)
  const nivel: NivelPrazoDemo = diasRestantes < 0 ? 'atrasada' : diasRestantes <= 15 ? 'atencao' : 'ok'
  return { diasRestantes, diasDecorridos, nivel, prazoFinal }
}
