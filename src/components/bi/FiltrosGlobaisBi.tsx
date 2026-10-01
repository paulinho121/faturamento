import type { Filial, Vendedor } from '../../types/domain'

const SELECT_CLASS =
  'rounded-xl border border-outline-variant bg-surface-container-lowest px-sm py-xs font-label-md text-label-md text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'

export function FiltrosGlobaisBi({
  estados,
  filiais,
  vendedores,
  tipos,
  estadoFiltro,
  filialFiltro,
  vendedorFiltro,
  tipoFiltro,
  onEstadoChange,
  onFilialChange,
  onVendedorChange,
  onTipoChange,
}: {
  estados: string[]
  filiais: Filial[]
  vendedores: Vendedor[]
  tipos: string[]
  estadoFiltro: string | null
  filialFiltro: string | null
  vendedorFiltro: string | null
  tipoFiltro: string | null
  onEstadoChange: (v: string | null) => void
  onFilialChange: (v: string | null) => void
  onVendedorChange: (v: string | null) => void
  onTipoChange: (v: string | null) => void
}) {
  const temFiltro = estadoFiltro || filialFiltro || vendedorFiltro || tipoFiltro

  return (
    <div className="mb-lg flex flex-wrap items-center gap-sm">
      <select
        value={estadoFiltro ?? ''}
        onChange={(e) => onEstadoChange(e.target.value || null)}
        className={SELECT_CLASS}
        aria-label="Filtrar por estado"
      >
        <option value="">Todos os estados</option>
        {estados.map((uf) => (
          <option key={uf} value={uf}>
            {uf}
          </option>
        ))}
      </select>

      <select
        value={filialFiltro ?? ''}
        onChange={(e) => onFilialChange(e.target.value || null)}
        className={SELECT_CLASS}
        aria-label="Filtrar por filial"
      >
        <option value="">Todas as filiais</option>
        {filiais.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
          </option>
        ))}
      </select>

      <select
        value={vendedorFiltro ?? ''}
        onChange={(e) => onVendedorChange(e.target.value || null)}
        className={SELECT_CLASS}
        aria-label="Filtrar por vendedor"
      >
        <option value="">Todos os vendedores</option>
        {vendedores.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nome}
          </option>
        ))}
      </select>

      <select
        value={tipoFiltro ?? ''}
        onChange={(e) => onTipoChange(e.target.value || null)}
        className={SELECT_CLASS}
        aria-label="Filtrar por tipo de operação"
      >
        <option value="">Todos os tipos</option>
        {tipos.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {temFiltro && (
        <button
          type="button"
          onClick={() => {
            onEstadoChange(null)
            onFilialChange(null)
            onVendedorChange(null)
            onTipoChange(null)
          }}
          className="flex items-center gap-xs rounded-full bg-surface-container-low px-sm py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
          Limpar filtros
        </button>
      )}
    </div>
  )
}
