import type { Entrega, EntregaMarca } from '../../lib/entregas'

const BASE = 'flex items-center gap-xs rounded-full border px-md py-0.5 font-label-md text-label-md transition-colors'

// Fixar / esconder o pedido (marca pessoal de quem está logado).
export function MarcaBotoes({ entrega, onMarcar }: { entrega: Entrega; onMarcar: (marca: EntregaMarca | null) => void }) {
  const fixada = entrega.marca === 'fixada'
  const oculta = entrega.marca === 'oculta'
  return (
    <>
      <button
        type="button"
        onClick={() => onMarcar(fixada ? null : 'fixada')}
        aria-pressed={fixada}
        title={fixada ? 'Tirar da lista de fixados' : 'Fixar no topo da coluna'}
        className={`${BASE} ${
          fixada ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">push_pin</span>
        {fixada ? 'Fixado' : 'Fixar'}
      </button>
      <button
        type="button"
        onClick={() => onMarcar(oculta ? null : 'oculta')}
        title={oculta ? 'Voltar a mostrar este pedido' : 'Esconder da minha tela'}
        className={`${BASE} border-outline-variant text-on-surface-variant hover:bg-surface-container-high`}
      >
        <span className="material-symbols-outlined text-[14px]">{oculta ? 'visibility' : 'visibility_off'}</span>
        {oculta ? 'Mostrar' : 'Esconder'}
      </button>
    </>
  )
}
