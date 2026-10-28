// O sistema também roda dentro de um iframe no CRM (o vendedor consulta as
// próprias vendas e notas por lá). Nesse caso o CRM já tem marca e menu, então
// a gente enxuga o cabeçalho.
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // acesso bloqueado entre origens: só acontece de dentro de um iframe
    return true
  }
}
