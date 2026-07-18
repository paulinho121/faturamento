// Best-effort match of a free-text XML value (e.g. natOp "VENDA DE MERCADORIA")
// against a curated list of options (e.g. tipos_operacao). Never auto-submitted —
// only used to pre-select a sensible default that the faturista must confirm.
export function bestMatch(text: string, options: string[]): string | null {
  if (!text) return null
  const normalized = normalize(text)
  const exact = options.find((o) => normalize(o) === normalized)
  if (exact) return exact
  const partial = options.find((o) => normalized.includes(normalize(o)) || normalize(o).includes(normalized))
  return partial ?? null
}

// Strips combining diacritical marks (U+0300–U+036F) left behind by NFD
// normalization, e.g. "GARANTIA" vs "Garantia" or "LOCAÇÃO" vs "locacao".
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g')

function normalize(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim()
}
