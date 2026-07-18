import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Filial, Vendedor } from '../types/domain'

interface Lookups {
  vendedores: Vendedor[]
  filiais: Filial[]
  tiposOperacao: string[]
  meiosPagamento: string[]
  loading: boolean
}

export function useLookups(): Lookups {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [filiais, setFiliais] = useState<Filial[]>([])
  const [tiposOperacao, setTiposOperacao] = useState<string[]>([])
  const [meiosPagamento, setMeiosPagamento] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [v, f, t, m] = await Promise.all([
        supabase.from('vendedores').select('id, nome, ativo').eq('ativo', true).order('nome'),
        supabase.from('filiais').select('id, nome, ativo, cnpj').eq('ativo', true).order('nome'),
        supabase.from('tipos_operacao').select('nome').order('nome'),
        supabase.from('meios_pagamento').select('nome').order('nome'),
      ])
      if (!mounted) return
      setVendedores((v.data as Vendedor[]) ?? [])
      setFiliais((f.data as Filial[]) ?? [])
      setTiposOperacao((t.data ?? []).map((r) => r.nome as string))
      setMeiosPagamento((m.data ?? []).map((r) => r.nome as string))
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  return { vendedores, filiais, tiposOperacao, meiosPagamento, loading }
}
