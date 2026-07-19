import { useEffect, type ReactNode } from 'react'

export function Modal({
  onClose,
  children,
  maxWidthClassName = 'max-w-lg',
}: {
  onClose: () => void
  children: ReactNode
  maxWidthClassName?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-inverse-surface/40 p-md py-xl backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClassName} rounded-xl bg-surface-container-lowest shadow-level3 toast-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
