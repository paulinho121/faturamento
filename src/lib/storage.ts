// O Storage do Supabase recusa chaves com acento, espaço e vários símbolos
// ("Invalid key"). Usado só na chave do arquivo — o nome original continua
// guardado em arquivo_nome pra exibir e baixar.
export function nomeArquivoSeguro(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const partes = semAcento.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()!.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}` : ''
  const base = partes.join('.').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'arquivo'
  return `${base}${extensao}`
}
