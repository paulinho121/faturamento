// O Supabase limita cada resposta (por padrão 1000 linhas) e ignora um .limit() maior que o teto configurado.
// Em listas ordenadas, o que passa do teto some sem aviso. Este helper lê em páginas até acabar.
// A consulta precisa ter ordem estável (inclua o id no order) para a paginação não repetir nem pular linhas.
export async function lerPaginado<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  tamanhoPagina = 1000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const todos: T[] = []
  for (let de = 0; ; de += tamanhoPagina) {
    const { data, error } = await consulta(de, de + tamanhoPagina - 1)
    if (error) return { data: todos, error }
    const pagina = (data ?? []) as T[]
    todos.push(...pagina)
    if (pagina.length < tamanhoPagina) return { data: todos, error: null }
  }
}
