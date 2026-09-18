export function formatNumeroPedido(numero: number): string {
  return `PED-${String(numero).padStart(4, '0')}`
}

// SHA-256 do conteúdo do PDF: mesma trava de duplicidade do banco, calculada
// no navegador pra avisar antes de subir o arquivo.
export async function hashArquivo(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Violação da unique index de hash (pedidos_arquivo_hash_uniq).
export function isPedidoDuplicadoError(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' && (error.message ?? '').includes('pedidos_arquivo_hash_uniq')
}
