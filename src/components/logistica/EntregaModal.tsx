import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../ui/ToastContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { diasDeAtraso, type Entrega, type EntregaHistorico } from '../../lib/entregas'
import { parseNFeTransporte, type NFeTransporte } from '../../lib/nfeParser'
import { baixarXml } from '../invoices/NfeMirrorModal'
import { formatNumeroPedido } from '../pedidos/pedidoUtils'

const EVENTO: Record<string, { texto: string; icone: string; cor: string }> = {
  // pedido (CRM -> faturamento -> Sanco -> faturado)
  enviado: { texto: 'Pedido recebido', icone: 'send', cor: 'text-primary' },
  aprovado: { texto: 'Aprovado pelo Financeiro', icone: 'verified', cor: 'text-tertiary' },
  devolvido: { texto: 'Devolvido ao vendedor', icone: 'undo', cor: 'text-error' },
  reenviado: { texto: 'Corrigido e reenviado', icone: 'forward_to_inbox', cor: 'text-primary' },
  faturado: { texto: 'Faturado (NF emitida)', icone: 'receipt_long', cor: 'text-tertiary' },
  cancelado: { texto: 'Cancelado', icone: 'cancel', cor: 'text-on-surface-variant' },
  processo_iniciado: { texto: 'Processo iniciado pelo faturamento', icone: 'play_circle', cor: 'text-primary' },
  enviado_sanco: { texto: 'Enviado para a Sanco', icone: 'local_shipping', cor: 'text-primary' },
  separacao_iniciada: { texto: 'Em separação', icone: 'inventory_2', cor: 'text-primary' },
  preparando_embarque: { texto: 'Preparando embarque', icone: 'package_2', cor: 'text-primary' },
  pre_venda_marcada: { texto: 'Marcado como pré-venda', icone: 'inventory', cor: 'text-violet-600' },
  pre_venda_desmarcada: { texto: 'Pré-venda desmarcada', icone: 'inventory', cor: 'text-primary' },
  // diário da logística
  despacho: { texto: 'Despachado', icone: 'local_shipping', cor: 'text-primary' },
  previsao: { texto: 'Previsão de chegada atualizada', icone: 'event', cor: 'text-primary' },
  ocorrencia: { texto: 'Problema com a carga', icone: 'warning', cor: 'text-error' },
  ocorrencia_resolvida: { texto: 'Problema resolvido', icone: 'check_circle', cor: 'text-tertiary' },
  observacao: { texto: 'Observação', icone: 'sticky_note_2', cor: 'text-on-surface-variant' },
  entrega: { texto: 'Entregue ao cliente', icone: 'where_to_vote', cor: 'text-tertiary' },
  finalizacao: { texto: 'Ciclo finalizado', icone: 'task_alt', cor: 'text-tertiary' },
}

const TIPOS_DIARIO = [
  { valor: 'previsao', rotulo: 'Previsão de chegada' },
  { valor: 'ocorrencia', rotulo: 'Problema com a carga' },
  { valor: 'ocorrencia_resolvida', rotulo: 'Problema resolvido' },
  { valor: 'observacao', rotulo: 'Observação' },
] as const

const CAMPO =
  'w-full rounded-xl border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none'
const ROTULO = 'mb-xs block font-label-md text-label-md text-on-surface-variant'
const BOTAO =
  'rounded-full bg-primary px-md py-xs font-label-md text-label-md text-on-primary hover:opacity-90 disabled:opacity-50'

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Valor de <input type="datetime-local"> no fuso do navegador.
function agoraLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

// NF-e do pedido (função logistica_nfe): só existe depois que o faturamento anexa a nota.
interface NfeDoPedido {
  numero_nf: string
  chave: string | null
  xml_raw: string | null
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-label-md text-label-md text-on-surface-variant">{rotulo}</p>
      <p className="truncate font-body-md text-body-md text-on-surface">{children}</p>
    </div>
  )
}

export function EntregaModal({
  entrega,
  onClose,
  onChanged,
}: {
  entrega: Entrega
  onClose: () => void
  onChanged: () => void
}) {
  const { push } = useToast()
  const [historico, setHistorico] = useState<EntregaHistorico[] | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [transportadora, setTransportadora] = useState(entrega.transportadora ?? '')
  const [rastreio, setRastreio] = useState(entrega.codigo_rastreio ?? '')
  const [previsaoTransporte, setPrevisaoTransporte] = useState(entrega.previsao_chegada ?? '')

  const [tipoDiario, setTipoDiario] = useState<(typeof TIPOS_DIARIO)[number]['valor']>('previsao')
  const [textoDiario, setTextoDiario] = useState('')
  const [previsaoDiario, setPrevisaoDiario] = useState(entrega.previsao_chegada ?? '')

  const [entregando, setEntregando] = useState(false)
  const [entregueEm, setEntregueEm] = useState(agoraLocal)
  const [recebidoPor, setRecebidoPor] = useState('')
  const [textoEntrega, setTextoEntrega] = useState('')

  const [nfe, setNfe] = useState<NfeDoPedido | null>(null)
  const [transporteNfe, setTransporteNfe] = useState<NFeTransporte | null>(null)
  const [sugerida, setSugerida] = useState(false)

  const aberta = entrega.status === 'aguardando_despacho' || entrega.status === 'em_transito'
  const atraso = diasDeAtraso(entrega)

  const carregarHistorico = useCallback(async () => {
    const { data } = await supabase.rpc('logistica_historico', { p_entrega_id: entrega.id })
    setHistorico((data as EntregaHistorico[] | null) ?? [])
  }, [entrega.id])

  useEffect(() => {
    void carregarHistorico()
  }, [carregarHistorico])

  // A NF-e anexada pelo faturamento traz a transportadora: já vem sugerida no despacho.
  useEffect(() => {
    let ativo = true
    supabase.rpc('logistica_nfe', { p_entrega_id: entrega.id }).then(({ data }) => {
      if (!ativo || !data) return
      const nota = data as NfeDoPedido
      setNfe(nota)
      const transporte = nota.xml_raw ? parseNFeTransporte(nota.xml_raw) : null
      setTransporteNfe(transporte)
      if (transporte?.transportadora && !entrega.transportadora) {
        setTransportadora((atual) => atual || transporte.transportadora)
        setSugerida(true)
      }
    })
    return () => {
      ativo = false
    }
  }, [entrega.id, entrega.transportadora])

  // Roda uma função do banco, avisa o resultado e recarrega a lista e a linha do tempo.
  async function executar(fn: string, args: Record<string, unknown>, sucesso: string): Promise<boolean> {
    setSalvando(true)
    const { error } = await supabase.rpc(fn, args)
    setSalvando(false)
    if (error) {
      push('error', error.message)
      return false
    }
    push('success', sucesso)
    onChanged()
    void carregarHistorico()
    return true
  }

  async function despachar() {
    await executar(
      'entrega_despachar',
      { p_entrega_id: entrega.id, p_transportadora: transportadora, p_rastreio: rastreio, p_previsao: previsaoTransporte || null },
      entrega.status === 'aguardando_despacho' ? 'Despachado — agora está em trânsito.' : 'Dados do transporte atualizados.'
    )
  }

  async function registrar() {
    const ok = await executar(
      'entrega_registrar',
      { p_entrega_id: entrega.id, p_tipo: tipoDiario, p_texto: textoDiario, p_previsao: tipoDiario === 'previsao' ? previsaoDiario || null : null },
      'Registrado no diário da entrega.'
    )
    if (ok) setTextoDiario('')
  }

  async function entregar() {
    const ok = await executar(
      'entrega_entregar',
      { p_entrega_id: entrega.id, p_entregue_em: new Date(entregueEm).toISOString(), p_recebido_por: recebidoPor, p_texto: textoEntrega },
      'Entrega registrada. Falta finalizar o ciclo.'
    )
    if (ok) setEntregando(false)
  }

  async function finalizar() {
    const ok = await executar('entrega_finalizar', { p_entrega_id: entrega.id }, 'Ciclo finalizado.')
    if (ok) onClose()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl">
      <div className="space-y-lg p-lg">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <h3 className="font-title-md text-title-md text-on-surface">
              {formatNumeroPedido(entrega.pedido_numero)} · {entrega.cliente}
            </h3>
            <div className="mt-xs flex flex-wrap items-center gap-xs">
              {entrega.id_externo && (
                <span className="rounded-full bg-primary/10 px-sm py-0.5 font-label-md text-label-md text-primary">Pedido do CRM</span>
              )}
              {entrega.ocorrencia && (
                <span className="rounded-full bg-error/10 px-sm py-0.5 font-label-md text-label-md text-error">Problema na carga</span>
              )}
              {atraso > 0 && (
                <span className="rounded-full bg-amber-100 px-sm py-0.5 font-label-md text-label-md text-amber-800">
                  {atraso} {atraso === 1 ? 'dia' : 'dias'} de atraso
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-on-secondary-container transition-colors hover:bg-surface-container-low"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-md rounded-xl bg-surface-container-low p-md sm:grid-cols-3">
          <Info rotulo="Vendedor">{entrega.vendedor}</Info>
          <Info rotulo="Nota fiscal">{entrega.numero_nf ? `NF ${entrega.numero_nf}` : 'não informada'}</Info>
          <Info rotulo="Valor da NF">{entrega.nf_valor != null ? formatCurrency(Number(entrega.nf_valor)) : '—'}</Info>
          <Info rotulo="Emissão da NF">
            {entrega.nf_emissao ? `${formatDate(entrega.nf_emissao)}${entrega.nf_estado ? ` · ${entrega.nf_estado}` : ''}` : 'nota ainda não anexada'}
          </Info>
          <Info rotulo="Volumes">{entrega.volumes ?? transporteNfe?.volumes ?? '—'}</Info>
          <Info rotulo="Origem">{entrega.origem ?? '—'}</Info>
          <Info rotulo="Faturado em">{entrega.faturado_em ? dataHora(entrega.faturado_em) : '—'}</Info>
          <Info rotulo="Previsão de chegada">{entrega.previsao_chegada ? formatDate(entrega.previsao_chegada) : 'sem previsão'}</Info>
          <Info rotulo="Transportadora">
            {entrega.transportadora ?? '—'}
            {entrega.codigo_rastreio ? ` · ${entrega.codigo_rastreio}` : ''}
          </Info>
        </div>
        {nfe && (
          <div className="flex flex-wrap items-center justify-between gap-sm rounded-xl border border-outline-variant p-md">
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface-variant">NF-e anexada pelo faturamento</p>
              <p className="break-all font-label-md text-label-md text-on-surface">
                {nfe.chave ? `Chave: ${nfe.chave.replace(/(\d{4})(?=\d)/g, '$1 ')}` : `NF ${nfe.numero_nf}`}
              </p>
              {transporteNfe?.transportadora && (
                <p className="font-label-md text-label-md text-on-surface-variant">
                  Transportadora na nota: {transporteNfe.transportadora}
                </p>
              )}
            </div>
            {nfe.xml_raw && (
              <button
                type="button"
                onClick={() => baixarXml(nfe.numero_nf, nfe.xml_raw!)}
                className="flex shrink-0 items-center gap-xs rounded-full border border-outline-variant px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Baixar XML
              </button>
            )}
          </div>
        )}
        {entrega.observacao && (
          <p className="rounded-lg border border-outline-variant p-sm font-label-md text-label-md text-on-surface-variant">
            Observação do pedido: {entrega.observacao}
          </p>
        )}
        {entrega.ocorrencia && entrega.ultima_ocorrencia && (
          <p className="rounded-lg bg-error/5 p-sm font-label-md text-label-md text-on-surface">⚠ {entrega.ultima_ocorrencia}</p>
        )}

        {aberta && (
          <section className="space-y-sm">
            <h4 className="font-title-md text-title-md text-on-surface">
              {entrega.status === 'aguardando_despacho' ? 'Despachar' : 'Dados do transporte'}
            </h4>
            <div className="grid gap-sm sm:grid-cols-3">
              <label className="block">
                <span className={ROTULO}>Transportadora</span>
                <input value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Ex.: Jamef" className={CAMPO} />
                {sugerida && entrega.status === 'aguardando_despacho' && (
                  <span className="mt-xs block font-label-md text-label-md text-on-surface-variant">Sugerida pela NF-e — confirme ou corrija.</span>
                )}
              </label>
              <label className="block">
                <span className={ROTULO}>Código de rastreio</span>
                <input value={rastreio} onChange={(e) => setRastreio(e.target.value)} className={CAMPO} />
              </label>
              <label className="block">
                <span className={ROTULO}>Previsão de chegada</span>
                <input type="date" value={previsaoTransporte} onChange={(e) => setPrevisaoTransporte(e.target.value)} className={CAMPO} />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={despachar} disabled={salvando} className={BOTAO}>
                {entrega.status === 'aguardando_despacho' ? 'Despachar' : 'Salvar transporte'}
              </button>
            </div>
          </section>
        )}

        {entrega.status !== 'finalizado' && (
          <section className="space-y-sm">
            <h4 className="font-title-md text-title-md text-on-surface">Diário da entrega</h4>
            <div className="grid gap-sm sm:grid-cols-2">
              <label className="block">
                <span className={ROTULO}>O que registrar?</span>
                <select value={tipoDiario} onChange={(e) => setTipoDiario(e.target.value as typeof tipoDiario)} className={CAMPO}>
                  {TIPOS_DIARIO.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              {tipoDiario === 'previsao' && (
                <label className="block">
                  <span className={ROTULO}>Nova previsão de chegada</span>
                  <input type="date" value={previsaoDiario} onChange={(e) => setPrevisaoDiario(e.target.value)} className={CAMPO} />
                </label>
              )}
            </div>
            <label className="block">
              <span className={ROTULO}>
                {tipoDiario === 'ocorrencia' ? 'O que aconteceu com a carga?' : 'Detalhes (opcional para previsão e problema resolvido)'}
              </span>
              <textarea
                rows={2}
                value={textoDiario}
                onChange={(e) => setTextoDiario(e.target.value)}
                placeholder={tipoDiario === 'ocorrencia' ? 'Ex.: volume avariado, cliente ausente, atraso na transportadora…' : ''}
                className={CAMPO}
              />
            </label>
            <div className="flex justify-end">
              <button type="button" onClick={registrar} disabled={salvando} className={BOTAO}>
                Registrar
              </button>
            </div>
          </section>
        )}

        {entrega.status === 'em_transito' && (
          <section className="space-y-sm rounded-xl border border-outline-variant p-md">
            {!entregando ? (
              <div className="flex items-center justify-between gap-sm">
                <p className="font-body-md text-body-md text-on-surface">A carga chegou ao cliente?</p>
                <button type="button" onClick={() => setEntregando(true)} className={BOTAO}>
                  Marcar como entregue
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-sm sm:grid-cols-2">
                  <label className="block">
                    <span className={ROTULO}>Data e hora da entrega</span>
                    <input type="datetime-local" value={entregueEm} onChange={(e) => setEntregueEm(e.target.value)} className={CAMPO} />
                  </label>
                  <label className="block">
                    <span className={ROTULO}>Quem recebeu</span>
                    <input value={recebidoPor} onChange={(e) => setRecebidoPor(e.target.value)} className={CAMPO} />
                  </label>
                </div>
                <label className="block">
                  <span className={ROTULO}>Observação (opcional)</span>
                  <textarea rows={2} value={textoEntrega} onChange={(e) => setTextoEntrega(e.target.value)} className={CAMPO} />
                </label>
                <div className="flex justify-end gap-sm">
                  <button
                    type="button"
                    onClick={() => setEntregando(false)}
                    className="rounded-full px-md py-xs font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high"
                  >
                    Cancelar
                  </button>
                  <button type="button" onClick={entregar} disabled={salvando || !entregueEm} className={BOTAO}>
                    Confirmar entrega
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {entrega.status === 'entregue' && (
          <section className="flex items-center justify-between gap-sm rounded-xl border border-outline-variant p-md">
            <p className="font-body-md text-body-md text-on-surface">
              Entregue{entrega.entregue_em ? ` em ${dataHora(entrega.entregue_em)}` : ''}
              {entrega.recebido_por ? ` · recebido por ${entrega.recebido_por}` : ''}. Tudo certo com a entrega?
            </p>
            <button type="button" onClick={finalizar} disabled={salvando} className={`${BOTAO} shrink-0`}>
              Finalizar ciclo
            </button>
          </section>
        )}

        <section>
          <h4 className="mb-sm font-title-md text-title-md text-on-surface">Linha do tempo</h4>
          {historico === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ol className="space-y-md">
              {historico.map((h, i) => {
                const info = EVENTO[h.tipo] ?? { texto: h.tipo, icone: 'circle', cor: 'text-on-surface-variant' }
                return (
                  <li key={`${h.quando}-${i}`} className="flex gap-sm">
                    <span className={`material-symbols-outlined mt-0.5 shrink-0 text-[20px] ${info.cor}`}>{info.icone}</span>
                    <div className="min-w-0">
                      <p className="font-body-md text-body-md text-on-surface">
                        {info.texto}
                        {h.previsao ? ` · ${formatDate(h.previsao)}` : ''}
                      </p>
                      <p className="font-label-md text-label-md text-on-surface-variant">
                        {dataHora(h.quando)}
                        {h.por ? ` · ${h.por}` : ''}
                      </p>
                      {h.texto && (
                        <p className="mt-xs rounded-lg bg-surface-container-low p-sm font-label-md text-label-md text-on-surface">{h.texto}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  )
}
