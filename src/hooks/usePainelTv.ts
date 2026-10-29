import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export interface PainelVendedor {
  id: string
  nome: string
  foto_path: string | null
  na_corrida: boolean // escolhido pra aparecer na corrida dos cavalinhos
  meta_pessoal: number | null // meta pessoal do mês, se o vendedor cadastrou
  faturado_hoje: number
  faturado_mes: number
  pedidos_hoje: number
  pedidos_mes: number
}

export interface PainelPedido {
  numero: number
  cliente: string
  vendedor: string
  status: 'pendente' | 'devolvido' | 'faturado' | 'cancelado'
  etapa: string
  pre_venda: boolean
  motivo: string | null // motivo da devolução, quando devolvido
  criado_em: string
  desde: string // desde quando está nesta etapa/situação
  sanco?: boolean // pedido acompanhado direto no CD, sem passar pelo faturamento
}

export interface PainelDados {
  hoje: string
  meta_mes: number
  faturado_hoje: number
  faturado_mes: number
  vendedores: PainelVendedor[]
  etapas: Record<string, number>
  devolvidos: number
  faturados_hoje: number
  pedidos: PainelPedido[] // em andamento + faturados hoje, do mais antigo pro mais novo
}

export interface PainelEvento {
  tipo: 'novo' | 'mudou'
  pedido: PainelPedido
  chave: number
}

const POLL_MS = 30_000
const DEBOUNCE_MS = 400
const EVENTO_MS = 9_000

// Dados do painel da TV: uma chamada só (painel_tv) + Realtime nos pedidos
// pra atualizar na hora em que um pedido chega ou muda de etapa, e um polling
// de reserva (as notas fiscais não passam pelo Realtime da conta da TV).
export function usePainelTv() {
  const [dados, setDados] = useState<PainelDados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)
  const [evento, setEvento] = useState<PainelEvento | null>(null)
  // numero do pedido -> o que aconteceu com ele há pouco (destaque na lista)
  const [destaques, setDestaques] = useState<Record<number, 'novo' | 'mudou'>>({})

  const anterior = useRef<PainelDados | null>(null)
  const contador = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('painel_tv')
    if (error) {
      setErro(error.message)
      return
    }
    if (!data) {
      setErro('Esta conta não tem acesso ao painel da TV.')
      return
    }
    const novo = data as PainelDados
    setErro(null)
    setAtualizadoEm(new Date())

    // Só compara depois da primeira carga — senão tudo seria "novo" ao abrir.
    const antes = anterior.current
    if (antes) {
      const porNumero = new Map(antes.pedidos.map((p) => [p.numero, p]))
      const novos: Record<number, 'novo' | 'mudou'> = {}
      let ultimo: PainelEvento | null = null
      for (const p of novo.pedidos) {
        const velho = porNumero.get(p.numero)
        if (!velho) {
          novos[p.numero] = 'novo'
          ultimo = { tipo: 'novo', pedido: p, chave: ++contador.current }
        } else if (velho.etapa !== p.etapa || velho.status !== p.status) {
          novos[p.numero] = 'mudou'
          if (!ultimo || ultimo.tipo !== 'novo') ultimo = { tipo: 'mudou', pedido: p, chave: ++contador.current }
        }
      }
      if (Object.keys(novos).length > 0) {
        setDestaques((d) => ({ ...d, ...novos }))
        setTimeout(() => {
          setDestaques((d) => {
            const resto = { ...d }
            for (const n of Object.keys(novos)) delete resto[Number(n)]
            return resto
          })
        }, EVENTO_MS)
      }
      if (ultimo) {
        const chave = ultimo.chave
        setEvento(ultimo)
        setTimeout(() => setEvento((e) => (e && e.chave === chave ? null : e)), EVENTO_MS)
      }
    }
    anterior.current = novo
    setDados(novo)
  }, [])

  useEffect(() => {
    carregar()

    const agendar = () => {
      clearTimeout(debounce.current)
      debounce.current = setTimeout(carregar, DEBOUNCE_MS)
    }
    const canal = supabase
      .channel('painel-tv-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, agendar)
      .subscribe()
    const poll = setInterval(carregar, POLL_MS)

    return () => {
      clearTimeout(debounce.current)
      clearInterval(poll)
      supabase.removeChannel(canal)
    }
  }, [carregar])

  return { dados, erro, atualizadoEm, evento, destaques }
}
