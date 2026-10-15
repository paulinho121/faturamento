// Dia útil bancário: sábado, domingo e feriado nacional/bancário não contam.
// Usado pra achar a data de compensação (quando o dinheiro de fato cai no
// banco) de um pagamento de boleto: o dia útil seguinte ao pagamento.

function iso(ano: number, mes: number, dia: number): string {
  return new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10)
}

function somarDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.split('-').map(Number)
  return iso(a, m, d + dias)
}

// Domingo de Páscoa (algoritmo gregoriano anônimo) — base dos feriados móveis.
function pascoa(ano: number): string {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return iso(ano, mes, dia)
}

const cacheFeriados = new Map<number, Set<string>>()

// Feriados nacionais fixos + os de calendário bancário (Carnaval segunda e
// terça, Sexta-feira Santa, Corpus Christi). Feriado só estadual/municipal
// fica de fora — varia por praça e não dá pra saber qual vale pro banco.
export function feriadosBancarios(ano: number): Set<string> {
  const cache = cacheFeriados.get(ano)
  if (cache) return cache
  const p = pascoa(ano)
  const feriados = new Set([
    iso(ano, 1, 1), // Confraternização Universal
    iso(ano, 4, 21), // Tiradentes
    iso(ano, 5, 1), // Dia do Trabalho
    iso(ano, 9, 7), // Independência
    iso(ano, 10, 12), // Nossa Senhora Aparecida
    iso(ano, 11, 2), // Finados
    iso(ano, 11, 15), // Proclamação da República
    iso(ano, 11, 20), // Consciência Negra (nacional desde 2024)
    iso(ano, 12, 25), // Natal
    somarDias(p, -48), // Carnaval (segunda)
    somarDias(p, -47), // Carnaval (terça)
    somarDias(p, -2), // Sexta-feira Santa
    somarDias(p, 60), // Corpus Christi
  ])
  cacheFeriados.set(ano, feriados)
  return feriados
}

export function ehDiaUtil(dataIso: string): boolean {
  const [a, m, d] = dataIso.split('-').map(Number)
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  if (diaSemana === 0 || diaSemana === 6) return false
  return !feriadosBancarios(a).has(dataIso)
}

// Primeiro dia útil DEPOIS da data (a própria data nunca conta).
export function proximoDiaUtil(dataIso: string): string {
  let dia = somarDias(dataIso, 1)
  while (!ehDiaUtil(dia)) dia = somarDias(dia, 1)
  return dia
}

// Compensação bancária: o pagamento informado no retorno (.RET) cai na conta
// no dia útil seguinte.
export function dataCompensacao(dataPagamentoIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamentoIso)) return dataPagamentoIso
  return proximoDiaUtil(dataPagamentoIso)
}
