import { Link } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { useAuth } from '../../auth/AuthContext'
import { contabilidadeNavItems } from '../diretor/nav'

const ATALHOS = [
  {
    to: '/dashboard/apuracao-irpj',
    icon: 'request_quote',
    titulo: 'IRPJ e CSLL',
    texto: 'Apuração trimestral no Lucro Presumido: receita do sistema, valores digitados, cálculo, cotas e exportação para Excel.',
  },
  {
    to: '/dashboard/impostometro',
    icon: 'account_balance',
    titulo: 'Impostômetro',
    texto: 'ICMS e IPI (débito e crédito), PIS/COFINS estimados e CBS/IBS informativos, com filtros, totais por nota e exportação para Excel.',
  },
  {
    to: '/dashboard/notas-entrada',
    icon: 'inbox',
    titulo: 'Notas de entrada',
    texto: 'Notas emitidas contra a empresa, capturadas da SEFAZ: busque, baixe o XML de uma nota ou de todas as do filtro (.zip).',
  },
]

export function ContabilidadePage() {
  const { profile } = useAuth()
  return (
    <AppShell title="Contabilidade" navItems={contabilidadeNavItems()}>
      <p className="mb-lg font-body-md text-body-md text-on-surface-variant">
        Olá{profile?.full_name ? `, ${profile.full_name}` : ''}. Estas são as telas fiscais da empresa, atualizadas em tempo real a partir das notas e dos XMLs.
      </p>
      <div className="grid grid-cols-1 gap-md md:grid-cols-3">
        {ATALHOS.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2 transition hover:border-primary"
          >
            <span className="material-symbols-outlined mb-sm text-[28px] text-primary">{a.icon}</span>
            <h3 className="mb-xs font-title-md text-title-md text-on-surface">{a.titulo}</h3>
            <p className="font-body-md text-body-md text-on-surface-variant">{a.texto}</p>
          </Link>
        ))}
      </div>
    </AppShell>
  )
}
