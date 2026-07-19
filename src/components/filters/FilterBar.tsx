import { useEffect, useState, type ReactNode } from 'react'
import type { Filial, Vendedor } from '../../types/domain'
import type { DashboardFilters } from '../../types/domain'

const ESTADOS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]

export function FilterBar({
  filters,
  onChange,
  filiais,
  vendedores,
  tiposOperacao,
  meiosPagamento,
}: {
  filters: DashboardFilters
  onChange: (next: DashboardFilters) => void
  filiais: Filial[]
  vendedores: Vendedor[]
  tiposOperacao: string[]
  meiosPagamento: string[]
}) {
  function set<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div className="mb-lg flex flex-wrap gap-sm">
      <ClienteSearch value={filters.clienteSearch} onChange={(v) => set('clienteSearch', v)} />
      <Select value={filters.filialId ?? ''} onChange={(v) => set('filialId', v || null)} placeholder="Filial">
        {filiais.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
          </option>
        ))}
      </Select>
      <Select value={filters.estado ?? ''} onChange={(v) => set('estado', v || null)} placeholder="Estado">
        {ESTADOS.map((uf) => (
          <option key={uf} value={uf}>
            {uf}
          </option>
        ))}
      </Select>
      <Select value={filters.tipoOperacao ?? ''} onChange={(v) => set('tipoOperacao', v || null)} placeholder="Operação">
        {tiposOperacao.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
      <Select value={filters.vendedorId ?? ''} onChange={(v) => set('vendedorId', v || null)} placeholder="Vendedor">
        {vendedores.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nome}
          </option>
        ))}
      </Select>
      <Select value={filters.meioPagamento ?? ''} onChange={(v) => set('meioPagamento', v || null)} placeholder="Pagamento">
        {meiosPagamento.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Select>
    </div>
  )
}

function ClienteSearch({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '')

  useEffect(() => {
    const t = setTimeout(() => onChange(text.trim() || null), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div className="relative">
      <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant">
        search
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Buscar cliente…"
        className="rounded-lg border border-outline-variant bg-surface-container-lowest py-sm pl-7 pr-md font-label-md text-label-md text-on-surface-variant outline-none focus:border-primary transition-colors"
      />
    </div>
  )
}

function Select({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder: string
  children: ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface-variant outline-none focus:border-primary transition-colors"
    >
      <option value="">{placeholder}: Todos</option>
      {children}
    </select>
  )
}
