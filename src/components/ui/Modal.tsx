import { useEffect, useRef, type ReactNode } from 'react'

// Pilha global de modais abertos (em ordem de montagem) — quando dois modais
// estão empilhados (ex: extrato do vendedor -> espelho da NF-e por cima), só
// o que está no topo (o último montado) deve responder ao Esc.
const modalStack: symbol[] = []

export function Modal({
  onClose,
  children,
  maxWidthClassName = 'max-w-lg',
}: {
  onClose: () => void
  children: ReactNode
  maxWidthClassName?: string
}) {
  const idRef = useRef<symbol>()
  if (!idRef.current) idRef.current = Symbol('modal')

  useEffect(() => {
    const id = idRef.current!
    modalStack.push(id)
    return () => {
      const i = modalStack.indexOf(id)
      if (i !== -1) modalStack.splice(i, 1)
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === idRef.current) {
        onClose()
      }
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
