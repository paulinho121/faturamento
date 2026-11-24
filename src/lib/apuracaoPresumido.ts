import { ehDiaUtil } from './diasUteis'

// Apuração trimestral de IRPJ e CSLL no Lucro Presumido, no mesmo método da planilha da contabilidade
// ("PLANILHA IRPJ E CSLL"): receita presumida do trimestre, rateio entre mercadorias e serviços, limite de
// R$ 1,25 milhão por trimestre (acima dele os percentuais de presunção sobem 10%), IRPJ de 15% com adicional de 10%
// sobre o que passa de R$ 60 mil, e CSLL de 9%.

export interface Parametros {
  limiteTrimestre: number
  percMercIrpj: number
  percMercIrpjExcedente: number
  percServ: number
  percServExcedente: number
  percMercCsll: number
  percMercCsllExcedente: number
  aliquotaIrpj: number
  adicionalAliquota: number
  adicionalLimite: number
  aliquotaCsll: number
  cotas: number
  cotaMinima: number
}

export const PARAMETROS_PADRAO: Parametros = {
  limiteTrimestre: 1_250_000,
  percMercIrpj: 8,
  percMercIrpjExcedente: 8.8,
  percServ: 32,
  percServExcedente: 35.2,
  percMercCsll: 12,
  percMercCsllExcedente: 13.2,
  aliquotaIrpj: 15,
  adicionalAliquota: 10,
  adicionalLimite: 60_000,
  aliquotaCsll: 9,
  cotas: 3,
  cotaMinima: 1000,
}

// Linhas de entrada (por mês). `sinal`: como entram na base. `auto`: o sistema consegue preencher.
export type ChaveLinha =
  | 'mercadorias'
  | 'devolucoes'
  | 'descontos'
  | 'ipiDevolucao'
  | 'ipi'
  | 'servicos'
  | 'ganhoCapital'
  | 'financeiras'
  | 'locacaoImovel'
  | 'demais'
  | 'bonificacoes'
  | 'demais2'
  | 'recuperacoes'
  | 'reversaoProvisoes'
  | 'lucrosDividendos'
  | 'jcp'
  | 'irrf'
  | 'irrfOrgaos'
  | 'irrfVariavel'

export interface DefLinha {
  chave: ChaveLinha
  rotulo: string
  grupo: 'receita' | 'outras' | 'deducoes'
  auto: boolean
  ajuda?: string
}

export const LINHAS: DefLinha[] = [
  { chave: 'mercadorias', rotulo: '(+) Receita de venda de mercadorias', grupo: 'receita', auto: true, ajuda: 'Notas do mês cujos itens têm CFOP de venda de mercadoria (ex.: 5102, 6102, 5108, 6108, 5403, 5405), pelo valor total da nota, com IPI — independente do tipo marcado no lançamento. A lista de CFOPs é editável nos parâmetros.' },
  { chave: 'devolucoes', rotulo: '(−) Devoluções de vendas', grupo: 'receita', auto: true, ajuda: 'Notas de devolução de venda recebidas (CFOPs que reduzem o débito), com XML completo.' },
  { chave: 'descontos', rotulo: '(−) Descontos incondicionais', grupo: 'receita', auto: false },
  { chave: 'ipiDevolucao', rotulo: '(+) IPI s/ devolução de vendas', grupo: 'receita', auto: true, ajuda: 'IPI destacado nas notas de devolução de venda.' },
  { chave: 'ipi', rotulo: '(−) IPI', grupo: 'receita', auto: true, ajuda: 'IPI destacado nos itens das notas de venda contadas como receita de mercadorias (CFOP de venda).' },
  { chave: 'servicos', rotulo: '(+) Receita de serviços', grupo: 'receita', auto: true, ajuda: 'Notas dos tipos Locação e Serviço lançadas no sistema (as que têm itens de CFOP de mercadoria contam como mercadorias). Se a NFS-e fica fora do sistema, digite o valor.' },
  { chave: 'ganhoCapital', rotulo: '(+) Ganho de capital nas alienações de bens e direitos do ativo', grupo: 'outras', auto: false },
  { chave: 'financeiras', rotulo: '(+) Receitas financeiras em geral', grupo: 'outras', auto: true, ajuda: 'Juros cobrados dos clientes nos títulos quitados no mês (pela data de pagamento). Some os rendimentos bancários digitando o total.' },
  { chave: 'locacaoImovel', rotulo: '(+) Receitas de locação de imóvel, quando não exercer essa atividade', grupo: 'outras', auto: false },
  { chave: 'demais', rotulo: '(+) Demais receitas operacionais e não operacionais', grupo: 'outras', auto: false },
  { chave: 'bonificacoes', rotulo: '(+) Bonificações/amostras recebidas e sucatas', grupo: 'outras', auto: false },
  { chave: 'demais2', rotulo: '(+) Demais receitas operacionais e não operacionais (2)', grupo: 'outras', auto: false },
  { chave: 'recuperacoes', rotulo: '(−) Recuperações de créditos que não representem ingressos de novas receitas', grupo: 'outras', auto: false },
  { chave: 'reversaoProvisoes', rotulo: '(−) Reversão de saldo de provisões (salvo as exceções legais)', grupo: 'outras', auto: false },
  { chave: 'lucrosDividendos', rotulo: '(−) Lucros e dividendos de participações avaliadas pelo custo / equivalência patrimonial', grupo: 'outras', auto: false },
  { chave: 'jcp', rotulo: '(−) Juros sobre o capital próprio pagos ou creditados por outra pessoa jurídica', grupo: 'outras', auto: false },
  { chave: 'irrf', rotulo: '(−) Imposto de renda retido na fonte', grupo: 'deducoes', auto: false },
  { chave: 'irrfOrgaos', rotulo: '(−) IRRF por demais entidades da Adm. Pública Federal (Lei 10.833/2003)', grupo: 'deducoes', auto: false },
  { chave: 'irrfVariavel', rotulo: '(−) Imposto pago sobre ganhos no mercado de renda variável', grupo: 'deducoes', auto: false },
]

export type ValoresMes = Record<ChaveLinha, number>
export const zeraMes = (): ValoresMes => Object.fromEntries(LINHAS.map((l) => [l.chave, 0])) as ValoresMes

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface ResultadoTrimestre {
  receitaTotal: number
  receitaTotalMes: number[]
  somas: ValoresMes // total do trimestre de cada linha
  receitaPresumida: number
  receitaBrutaMercadorias: number
  rateioMercadorias: number
  rateioServicos: number
  dentroLimite: number
  excedente: number
  irpj: {
    mercadorias: number
    mercadoriasExcedente: number
    servicos: number
    servicosExcedente: number
    outrasReceitas: number
    base: number
    imposto15: number
    baseAdicional: number
    adicional: number
    deducoes: number
    devido: number // nunca negativo
    saldoACompensar: number // IRRF que passou do imposto
  }
  csll: {
    mercadorias: number
    mercadoriasExcedente: number
    servicos: number
    servicosExcedente: number
    base: number
    devido: number
  }
  totalAPagar: number
  cotas: { numero: number; valor: number }[]
}

// `meses`: os três meses do trimestre, já com o valor final de cada linha (digitado ou do sistema).
export function calcularTrimestre(meses: ValoresMes[], p: Parametros): ResultadoTrimestre {
  const soma = (chave: ChaveLinha) => meses.reduce((acc, m) => acc + (m[chave] ?? 0), 0)
  const somas = Object.fromEntries(LINHAS.map((l) => [l.chave, r2(soma(l.chave))])) as ValoresMes
  const receitaTotalMes = meses.map((m) => r2(m.mercadorias + m.servicos))
  const receitaTotal = r2(receitaTotalMes.reduce((a, b) => a + b, 0))
  // Receita presumida = receita total − devoluções − descontos + IPI s/ devolução − IPI (como na planilha).
  const receitaPresumida = r2(receitaTotal - somas.devolucoes - somas.descontos + somas.ipiDevolucao - somas.ipi)
  const receitaBrutaMercadorias = r2(somas.mercadorias - somas.devolucoes + somas.ipiDevolucao - somas.ipi)
  const rateioMercadorias = receitaPresumida > 0 ? receitaBrutaMercadorias / receitaPresumida : 0
  const rateioServicos = receitaPresumida > 0 ? somas.servicos / receitaPresumida : 0
  // O limite divide a receita em "até o limite" e "excedente" (a planilha usa o limite inteiro; aqui, se a receita
  // do trimestre for menor que ele, só a parte que existe entra).
  const dentroLimite = Math.max(Math.min(receitaPresumida, p.limiteTrimestre), 0)
  const excedente = Math.max(receitaPresumida - p.limiteTrimestre, 0)

  const mercIrpj = dentroLimite * rateioMercadorias * (p.percMercIrpj / 100)
  const mercIrpjExc = excedente * rateioMercadorias * (p.percMercIrpjExcedente / 100)
  const servIrpj = dentroLimite * rateioServicos * (p.percServ / 100)
  const servIrpjExc = excedente * rateioServicos * (p.percServExcedente / 100)
  // Outras receitas tributáveis: as linhas "(+)" menos as "(−)" do bloco de outras receitas.
  const outras =
    somas.ganhoCapital + somas.financeiras + somas.locacaoImovel + somas.demais + somas.bonificacoes + somas.demais2 -
    somas.recuperacoes - somas.reversaoProvisoes - somas.lucrosDividendos - somas.jcp
  const baseIrpj = mercIrpj + mercIrpjExc + servIrpj + servIrpjExc + outras
  const imposto15 = Math.max(baseIrpj, 0) * (p.aliquotaIrpj / 100)
  const baseAdicional = baseIrpj - p.adicionalLimite
  const adicional = Math.max(baseAdicional, 0) * (p.adicionalAliquota / 100)
  const deducoes = somas.irrf + somas.irrfOrgaos + somas.irrfVariavel
  const irpjBruto = imposto15 + adicional - deducoes
  const irpjDevido = Math.max(irpjBruto, 0)

  const mercCsll = dentroLimite * rateioMercadorias * (p.percMercCsll / 100)
  const mercCsllExc = excedente * rateioMercadorias * (p.percMercCsllExcedente / 100)
  const baseCsll = mercCsll + mercCsllExc + servIrpj + servIrpjExc + outras
  const csllDevido = Math.max(baseCsll, 0) * (p.aliquotaCsll / 100)

  const totalAPagar = r2(irpjDevido + csllDevido)
  // Cotas: até 3, cada uma de no mínimo R$ 1.000 (se o total for menor, cota única).
  const numCotas = totalAPagar <= 0 ? 0 : Math.max(1, Math.min(p.cotas, Math.floor(totalAPagar / p.cotaMinima)))
  const cotas = Array.from({ length: numCotas }, (_, i) => ({ numero: i + 1, valor: r2(totalAPagar / numCotas) }))

  return {
    receitaTotal,
    receitaTotalMes,
    somas,
    receitaPresumida,
    receitaBrutaMercadorias,
    rateioMercadorias,
    rateioServicos,
    dentroLimite: r2(dentroLimite),
    excedente: r2(excedente),
    irpj: {
      mercadorias: r2(mercIrpj),
      mercadoriasExcedente: r2(mercIrpjExc),
      servicos: r2(servIrpj),
      servicosExcedente: r2(servIrpjExc),
      outrasReceitas: r2(outras),
      base: r2(baseIrpj),
      imposto15: r2(imposto15),
      baseAdicional: r2(baseAdicional),
      adicional: r2(adicional),
      deducoes: r2(deducoes),
      devido: r2(irpjDevido),
      saldoACompensar: r2(Math.max(-irpjBruto, 0)),
    },
    csll: {
      mercadorias: r2(mercCsll),
      mercadoriasExcedente: r2(mercCsllExc),
      servicos: r2(servIrpj),
      servicosExcedente: r2(servIrpjExc),
      base: r2(baseCsll),
      devido: r2(csllDevido),
    },
    totalAPagar,
    cotas,
  }
}

// Último dia útil (bancário) de um mês.
export function ultimoDiaUtil(ano: number, mes: number): string {
  const d = new Date(Date.UTC(ano, mes, 0)) // último dia do mês (mes é 1–12)
  while (!ehDiaUtil(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Vencimento das cotas: a 1ª no último dia útil do mês seguinte ao fim do trimestre; as demais nos meses seguintes
// (com juros pela Selic, que não são calculados aqui).
export function vencimentoDaCota(ano: number, trimestre: number, numeroCota: number): string {
  const mesFim = trimestre * 3
  const total = mesFim + numeroCota
  const a = ano + Math.floor((total - 1) / 12)
  const m = ((total - 1) % 12) + 1
  return ultimoDiaUtil(a, m)
}

export const NOME_TRIMESTRE = ['1º trimestre', '2º trimestre', '3º trimestre', '4º trimestre']
export const MESES_DO_TRIMESTRE = (trimestre: number): number[] => [trimestre * 3 - 2, trimestre * 3 - 1, trimestre * 3]
export const NOME_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
