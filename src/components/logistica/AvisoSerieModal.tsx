import { Modal } from '../ui/Modal'

// Pop-up de alerta da separação (SP/CE): reforça que a logística precisa informar
// o número de série (NS) e os volumes antes de o faturamento conseguir faturar.
export function AvisoSerieModal({
  titulo,
  children,
  rotuloPrincipal,
  onPrincipal,
  rotuloSecundario,
  onSecundario,
}: {
  titulo: string
  children: React.ReactNode
  rotuloPrincipal: string
  onPrincipal: () => void
  rotuloSecundario?: string
  onSecundario?: () => void
}) {
  return (
    <Modal onClose={onPrincipal} maxWidthClassName="max-w-md">
      <div role="alertdialog" aria-labelledby="aviso-serie-titulo" className="space-y-md p-lg">
        <div className="flex items-start gap-sm">
          <span className="material-symbols-outlined shrink-0 rounded-full bg-amber-100 p-sm text-[28px] text-amber-700">
            qr_code_scanner
          </span>
          <div className="min-w-0 space-y-xs">
            <h3 id="aviso-serie-titulo" className="font-title-md text-title-md text-on-surface">
              {titulo}
            </h3>
            <div className="space-y-xs font-body-md text-body-md text-on-surface-variant">{children}</div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-sm">
          {rotuloSecundario && onSecundario && (
            <button
              type="button"
              onClick={onSecundario}
              className="rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
            >
              {rotuloSecundario}
            </button>
          )}
          <button
            type="button"
            onClick={onPrincipal}
            autoFocus
            className="rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90"
          >
            {rotuloPrincipal}
          </button>
        </div>
      </div>
    </Modal>
  )
}
