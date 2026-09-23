import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { ResponderOrientacaoModal } from '../../components/pedidos/ResponderOrientacaoModal'
import { formatNumeroPedido } from '../../components/pedidos/pedidoUtils'
import { diretorNavItems } from './nav'
import type { PedidoOrientacao } from '../../types/domain'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Local exclusivo de quem tem profiles.pode_orientar_pedidos (hoje só a
// Bianca) — RLS já bloqueia qualquer outro diretor, aqui é só reforço de UI.
export function OrientacoesPage() {
  const { profile } = useAuth()
  const { push } = useToast()

  const [orientacoes, setOrientacoes] = useState<PedidoOrientacao[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<'pendentes' | 'respondidas'>('pendentes')
  const [respondendo, setRespondendo] = useState<PedidoOrientacao | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pedido_orientacoes')
      .select('*, pedidos(numero, cliente), profiles!pedido_orientacoes_solicitado_por_fkey(full_name)')
      .order('solicitado_em', { ascending: false })
    if (!error) setOrientacoes((data as PedidoOrientacao[]) ?? [])
    setLoading(false)
  }

  async function handleBaixar(o: PedidoOrientacao) {
    if (!o.arquivo_path) return
    const { data, error } = await supabase.storage.from('orientacoes').download(o.arquivo_path)
    if (error || !data) {
      push('error', `Erro ao baixar arquivo: ${error?.message ?? 'não encontrado'}`)
      return
    }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = o.arquivo_nome ?? 'orientacao'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    load()
  }, [])

  if (!profile?.pode_orientar_pedidos) {
    return (
      <AppShell title="Consultas" navItems={diretorNavItems(profile)}>
        <EmptyState icon="lock" title="Sem acesso a essa área" />
      </AppShell>
    )
  }

  const pendentes = orientacoes.filter((o) => !o.arquivo_path)
  const respondidas = orientacoes.filter((o) => o.arquivo_path)
  const exibidas = aba === 'pendentes' ? pendentes : respondidas

  return (
    <AppShell
      title="Consultas"
      navItems={diretorNavItems(profile, 0, pendentes.length)}
      onRefresh={load}
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-level2 overflow-hidden mb-lg">
        <div className="p-lg border-b border-outline-variant">
          <h3 className="font-title-md text-title-md text-on-surface">Consultas dos Faturistas</h3>
          <p className="font-label-md text-label-md text-on-surface-variant">
            Dúvidas sobre pedidos (é locação ou venda? é comodato? precisa autorização do diretor?) — anexe uma
            orientação em PDF ou JPEG.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-sm border-b border-outline-variant p-md">
          {(
            [
              ['pendentes', 'Pendentes', pendentes.length],
              ['respondidas', 'Respondidas', respondidas.length],
            ] as const
          ).map(([chave, label, total]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setAba(chave)}
              className={`flex items-center gap-xs rounded-full px-md py-xs font-label-md text-label-md transition-colors ${
                aba === chave ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {label}
              {total > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    aba === chave ? 'bg-on-primary/20' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {total}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-sm p-lg">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : exibidas.length === 0 ? (
          <div className="p-lg">
            <EmptyState
              icon="task_alt"
              title={aba === 'pendentes' ? 'Nenhuma consulta pendente' : 'Nenhuma consulta respondida'}
            />
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {exibidas.map((o) => (
              <div key={o.id} className="p-lg">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      <span className="font-label-md text-label-md text-on-surface-variant">
                        {o.pedidos ? formatNumeroPedido(o.pedidos.numero) : ''}
                      </span>{' '}
                      {o.pedidos?.cliente}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {o.profiles?.full_name ?? 'Faturista'} · {formatDataHora(o.solicitado_em)}
                    </p>
                  </div>
                  {!o.arquivo_path && (
                    <button
                      type="button"
                      onClick={() => setRespondendo(o)}
                      className="flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90"
                    >
                      <span className="material-symbols-outlined text-[16px]">attach_file</span>
                      Responder
                    </button>
                  )}
                </div>
                <p className="mt-sm font-body-md text-body-md text-on-surface">{o.pergunta}</p>
                {o.arquivo_path && (
                  <div className="mt-sm rounded-lg bg-tertiary/5 p-sm">
                    {o.resposta_texto && (
                      <p className="font-body-md text-body-md text-on-surface">{o.resposta_texto}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleBaixar(o)}
                      className="mt-xs flex items-center gap-xs font-label-md text-label-md text-tertiary hover:underline"
                    >
                      <span className="material-symbols-outlined text-[16px]">attach_file</span>
                      {o.arquivo_nome}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {respondendo && (
        <ResponderOrientacaoModal
          orientacao={respondendo}
          onClose={() => setRespondendo(null)}
          onDone={() => {
            setRespondendo(null)
            load()
          }}
        />
      )}
    </AppShell>
  )
}
