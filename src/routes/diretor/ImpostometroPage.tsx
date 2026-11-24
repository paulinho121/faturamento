import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency } from '../../lib/format'
import { diretorNavItems } from './nav'

type Efeito = 'debito' | 'credito' | 'estorno_debito' | 'estorno_credito' | 'nenhum'

interface Fechamento {
  debito: number
  credito: number
  saldo: number
  estornoDebito: number
  estornoCredito: number
}

interface LinhaCfop {
  origem: 'saida' | 'entrada'
  cfop: string
  itens: number
  icms: number
  ipi: number
  efeitoIcms: Efeito
  efeitoIpi: Efeito
  comRegra: boolean
}

interface Apuracao {
  mes: string
  periodo: { de: string; ate: string }
  regime: string
  icms: Fechamento
  ipi: Fechamento
  pisCofins: { receitaBruta: number; icmsExcluido: number; base: number; pis: number; cofins: number; observacao: string }
  cbsIbs: { debitoCbs: number; debitoIbs: number; creditoCbs: number; creditoIbs: number; notasComGrupo: number; observacao: string }
  porCfop: LinhaCfop[]
  semRegra: LinhaCfop[]
  notasConsideradas: number
  pendentes: number
  geradoEm: string
  regras: { cfop: string; efeitoIcms: Efeito; efeitoIpi: Efeito; descricao: string | null }[]
}

const ROTULO_EFEITO: Record<Efeito, string> = {
  debito: 'Débito',
  credito: 'Crédito',
  estorno_debito: 'Reduz débito',
  estorno_credito: 'Reduz crédito',
  nenhum: 'Fora da conta',
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function mesAtual(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)
}

function deslocaMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${NOMES_MES[m - 1]} de ${a}`
}

async function chamar(metodo: 'GET' | 'POST', url: string, corpo?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { data } = await supabase.auth.getSession()
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await resposta.json()) as Record<string, unknown>
  } catch {
    /* sem corpo */
  }
  return { status: resposta.status, json }
}

function CartaoImposto({ titulo, f, dica }: { titulo: string; f: Fechamento; dica: string }) {
  const aRecolher = f.saldo >= 0
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
      <div className="mb-sm flex items-center justify-between gap-sm">
        <h3 className="font-title-md text-title-md text-on-surface">{titulo}</h3>
        <span className={`rounded-full px-sm py-0.5 font-label-md text-label-md ${aRecolher ? 'bg-error/10 text-error' : 'bg-tertiary/10 text-tertiary'}`}>
          {aRecolher ? 'A recolher' : 'Saldo credor'}
        </span>
      </div>
      <p className={`font-display text-[28px] font-bold leading-tight ${aRecolher ? 'text-error' : 'text-tertiary'}`}>{formatCurrency(Math.abs(f.saldo))}</p>
      <div className="mt-sm grid grid-cols-2 gap-sm">
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Débitos (vendas)</p>
          <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(f.debito)}</p>
          {f.estornoDebito > 0 && <p className="font-label-md text-[11px] text-on-surface-variant">já abatidas devoluções de {formatCurrency(f.estornoDebito)}</p>}
        </div>
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Créditos (compras)</p>
          <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(f.credito)}</p>
          {f.estornoCredito > 0 && <p className="font-label-md text-[11px] text-on-surface-variant">já abatidas devoluções de {formatCurrency(f.estornoCredito)}</p>}
        </div>
      </div>
      <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">{dica}</p>
    </div>
  )
}

export function ImpostometroPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const [mes, setMes] = useState(mesAtual())
  const [dados, setDados] = useState<Apuracao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const sequencia = useRef(0)

  const carregar = useCallback(
    async (mesAlvo: string, silencioso = false) => {
      const minha = ++sequencia.current
      if (!silencioso) setCarregando(true)
      setErro(null)
      try {
        const { status, json } = await chamar('GET', `/api/impostometro?mes=${mesAlvo}`)
        if (minha !== sequencia.current) return
        if (status === 200) setDados(json as unknown as Apuracao)
        else setErro(String(json.erro ?? `Erro ${status} ao calcular.`))
      } catch {
        if (minha === sequencia.current) setErro('Não foi possível falar com o servidor.')
      }
      if (minha === sequencia.current) setCarregando(false)
    },
    []
  )

  useEffect(() => {
    carregar(mes)
  }, [mes, carregar])

  // Tempo real: enquanto há XMLs para ler, busca de novo em 2 s; depois, atualiza a cada minuto.
  useEffect(() => {
    const t = setTimeout(() => carregar(mes, true), dados && dados.pendentes > 0 ? 2000 : 60_000)
    return () => clearTimeout(t)
  }, [dados, mes, carregar])

  async function definirRegra(l: LinhaCfop, efeitoIcms: Efeito, efeitoIpi: Efeito) {
    setSalvando(l.cfop)
    const { status, json } = await chamar('POST', '/api/impostometro', { acao: 'regra', cfop: l.cfop, efeitoIcms, efeitoIpi })
    setSalvando(null)
    if (status === 200) {
      push('success', `Regra do CFOP ${l.cfop} salva.`)
      carregar(mes, true)
    } else {
      push('error', String(json.erro ?? 'Não foi possível salvar a regra.'))
    }
  }

  const regraDoCfop = (cfop: string) => dados?.regras.find((r) => r.cfop === cfop)
  const totalEstimado = dados ? Math.max(dados.icms.saldo, 0) + Math.max(dados.ipi.saldo, 0) + dados.pisCofins.pis + dados.pisCofins.cofins : 0

  return (
    <AppShell title="Impostômetro" navItems={diretorNavItems(profile)} onRefresh={() => carregar(mes)}>
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-xs">
          <button type="button" onClick={() => setMes(deslocaMes(mes, -1))} aria-label="Mês anterior" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <p className="min-w-[170px] text-center font-title-md text-title-md capitalize text-on-surface">{nomeDoMes(mes)}</p>
          <button type="button" onClick={() => setMes(deslocaMes(mes, 1))} disabled={mes >= mesAtual()} aria-label="Próximo mês" className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant hover:bg-surface-container-high disabled:opacity-40">
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>
        <div className="flex items-center gap-sm">
          <span className="rounded-full bg-primary/10 px-md py-xs font-label-md text-label-md text-primary">Lucro Presumido</span>
          <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
            <span className="inline-block h-2 w-2 rounded-full bg-tertiary" /> ao vivo
            {dados && ` · atualizado às ${new Date(dados.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>

      <div className="mb-lg flex items-start gap-sm rounded-xl border border-amber-300 bg-amber-50 p-md">
        <span className="material-symbols-outlined text-[20px] text-amber-800">info</span>
        <p className="font-label-md text-label-md text-amber-900">
          <b>Estimativa para acompanhamento.</b> Os valores vêm dos impostos destacados nos XMLs das notas, conforme as regras de cada CFOP abaixo. Não substituem a apuração
          oficial da contabilidade e não incluem IRPJ, CSLL, ICMS-ST, DIFAL nem créditos de ativo imobilizado.
        </p>
      </div>

      {carregando && !dados ? (
        <div className="grid gap-md md:grid-cols-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : erro && !dados ? (
        <p className="rounded-xl border border-error/30 bg-error/5 p-lg font-body-md text-body-md text-error">{erro}</p>
      ) : (
        dados && (
          <>
            {dados.pendentes > 0 && (
              <p className="mb-md rounded-lg bg-surface-container-low p-sm font-label-md text-label-md text-on-surface-variant">
                Lendo os XMLs das notas… faltam {dados.pendentes}. Os números abaixo já se atualizam à medida que as notas são lidas.
              </p>
            )}

            <div className="mb-lg rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
              <p className="font-label-md text-label-md text-on-surface-variant">Imposto a recolher estimado em {nomeDoMes(dados.mes)} (ICMS + IPI + PIS + COFINS)</p>
              <p className="font-display text-[34px] font-bold leading-tight text-on-surface">{formatCurrency(totalEstimado)}</p>
              <p className="font-label-md text-label-md text-on-surface-variant">
                Calculado com {dados.notasConsideradas} nota{dados.notasConsideradas === 1 ? '' : 's'} (vendas e compras com XML). Saldo credor de um imposto não abate outro.
              </p>
            </div>

            <div className="mb-lg grid gap-md md:grid-cols-2 xl:grid-cols-4">
              <CartaoImposto titulo="ICMS" f={dados.icms} dica="Débito das notas que emitimos menos o crédito das compras que geram direito (CFOPs abaixo)." />
              <CartaoImposto titulo="IPI" f={dados.ipi} dica="Vale para importadora (equiparada a industrial). Confirme com a contabilidade." />
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <div className="mb-sm flex items-center justify-between gap-sm">
                  <h3 className="font-title-md text-title-md text-on-surface">PIS e COFINS</h3>
                  <span className="rounded-full bg-error/10 px-sm py-0.5 font-label-md text-label-md text-error">A recolher</span>
                </div>
                <p className="font-display text-[28px] font-bold leading-tight text-error">{formatCurrency(dados.pisCofins.pis + dados.pisCofins.cofins)}</p>
                <div className="mt-sm grid grid-cols-2 gap-sm">
                  <div>
                    <p className="font-label-md text-label-md text-on-surface-variant">PIS (0,65%)</p>
                    <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(dados.pisCofins.pis)}</p>
                  </div>
                  <div>
                    <p className="font-label-md text-label-md text-on-surface-variant">COFINS (3%)</p>
                    <p className="font-body-md font-semibold text-body-md text-on-surface">{formatCurrency(dados.pisCofins.cofins)}</p>
                  </div>
                </div>
                <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">
                  Cumulativos, sem crédito. Base: receita de {formatCurrency(dados.pisCofins.receitaBruta)} menos ICMS de {formatCurrency(dados.pisCofins.icmsExcluido)}.
                </p>
              </div>
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-level2">
                <div className="mb-sm flex items-center justify-between gap-sm">
                  <h3 className="font-title-md text-title-md text-on-surface">CBS e IBS</h3>
                  <span className="rounded-full bg-surface-container-high px-sm py-0.5 font-label-md text-label-md text-on-surface-variant">Informativo</span>
                </div>
                {dados.cbsIbs.notasComGrupo === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">Nenhuma nota deste mês traz o grupo de CBS/IBS no XML.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-sm">
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant">CBS débito / crédito</p>
                      <p className="font-body-md font-semibold text-body-md text-on-surface">
                        {formatCurrency(dados.cbsIbs.debitoCbs)} / {formatCurrency(dados.cbsIbs.creditoCbs)}
                      </p>
                    </div>
                    <div>
                      <p className="font-label-md text-label-md text-on-surface-variant">IBS débito / crédito</p>
                      <p className="font-body-md font-semibold text-body-md text-on-surface">
                        {formatCurrency(dados.cbsIbs.debitoIbs)} / {formatCurrency(dados.cbsIbs.creditoIbs)}
                      </p>
                    </div>
                  </div>
                )}
                <p className="mt-sm font-label-md text-[11px] text-on-surface-variant">{dados.cbsIbs.observacao}</p>
              </div>
            </div>

            {dados.semRegra.length > 0 && (
              <div className="mb-lg rounded-xl border border-amber-300 bg-amber-50 p-md">
                <p className="font-label-md font-semibold text-label-md text-amber-900">
                  {dados.semRegra.length} CFOP{dados.semRegra.length === 1 ? '' : 's'} de compra sem regra definida: {dados.semRegra.map((c) => c.cfop).join(', ')}.
                </p>
                <p className="font-label-md text-label-md text-amber-900">Compras sem regra ficam fora da conta (nenhum crédito é contado). Defina abaixo, na tabela, se geram crédito.</p>
              </div>
            )}

            <div className="mb-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-level2">
              <div className="border-b border-outline-variant p-lg">
                <h3 className="font-title-md text-title-md text-on-surface">Detalhe por CFOP</h3>
                <p className="font-label-md text-label-md text-on-surface-variant">Como cada tipo de operação entra na conta. A contabilidade pode ajustar; a tela recalcula na hora.</p>
              </div>
              {dados.porCfop.length === 0 ? (
                <p className="p-lg font-body-md text-body-md text-on-surface-variant">Nenhuma nota com XML neste mês.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {['Operação', 'CFOP', 'Itens', 'ICMS', 'IPI', 'Efeito no ICMS', 'Efeito no IPI'].map((h) => (
                          <th key={h} className="whitespace-nowrap px-md py-sm font-label-md text-label-md text-on-surface-variant">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {dados.porCfop.map((l) => (
                        <tr key={`${l.origem}-${l.cfop}`} className={l.comRegra || l.origem === 'saida' ? '' : 'bg-amber-50/60'}>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{l.origem === 'saida' ? 'Venda' : 'Compra'}</td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface" title={regraDoCfop(l.cfop)?.descricao ?? ''}>
                            {l.cfop}
                            {regraDoCfop(l.cfop)?.descricao && <span className="block max-w-[260px] truncate font-label-md text-[11px] text-on-surface-variant">{regraDoCfop(l.cfop)?.descricao}</span>}
                          </td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface">{l.itens}</td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{formatCurrency(l.icms)}</td>
                          <td className="whitespace-nowrap px-md py-sm font-body-md text-body-md text-on-surface">{formatCurrency(l.ipi)}</td>
                          {(['icms', 'ipi'] as const).map((imposto) => (
                            <td key={imposto} className="px-md py-sm">
                              <select
                                value={imposto === 'icms' ? l.efeitoIcms : l.efeitoIpi}
                                disabled={salvando === l.cfop}
                                onChange={(e) => definirRegra(l, imposto === 'icms' ? (e.target.value as Efeito) : l.efeitoIcms, imposto === 'ipi' ? (e.target.value as Efeito) : l.efeitoIpi)}
                                className="rounded-lg border border-outline-variant bg-surface px-sm py-xs font-label-md text-label-md text-on-surface focus:border-primary focus:outline-none"
                              >
                                {(Object.keys(ROTULO_EFEITO) as Efeito[]).map((e) => (
                                  <option key={e} value={e}>
                                    {ROTULO_EFEITO[e]}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}
    </AppShell>
  )
}
