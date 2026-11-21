# Integração Faturamento → JARVIS

O JARVIS é o sistema que o **diretor** usa para acompanhar os números da empresa. A rotina
`api/jarvis-sync.ts` empurra os dados do faturamento para o JARVIS. Visão geral do sistema em
`docs/RESUMO_SISTEMA_PARA_JARVIS.md`.

## O que é enviado

| Parte | Endpoint do JARVIS | O que vai | Quando |
|---|---|---|---|
| `notas` | `POST /api/integrations/faturamento/invoices` (multipart, campo `files`, até 100 por lote) | XML original de cada NF-e (`invoices.xml_raw`) | Só o que mudou; janela: mês anterior + mês atual |
| `comissoes` | `POST .../commissions` (JSON) | **Uma comissão por NF** (e por beneficiário, nas parcerias) | Só o que mudou |
| `titulos` | `POST .../receivables` (JSON, até 1000 por lote) | Estado atual de cada título/parcela, inclusive os pagos | Em aberto + pagos nos últimos 90 dias; o restante no reenvio completo |
| `indicadores` | `POST .../indicators` (JSON) | Faturamento do dia/mês, meta, pedidos por etapa, demos, a receber e vencido | De hora em hora (cada envio substitui o anterior) |

Todos levam o header `x-integration-token`. O envio é **idempotente**: reenviar não duplica. A tabela
`jarvis_envios` guarda uma impressão digital do que já foi enviado com sucesso, para reenviar só o que mudou
(apagar essa tabela apenas faz tudo ser reenviado).

### Regras dos números (iguais às do painel do diretor)
- **Faturamento**: não entram nota cancelada, transferência nem notas que não afetam o faturamento (demo,
  devolução, brinde, comodato etc.).
- **Comissão por NF**: valor base = valor da nota; percentual = o do vendedor (nas parcerias, a fatia de cada
  beneficiário); valor = base × percentual / 100. Vendedor com 0% não gera comissão. Nota cancelada ou excluída
  vai com status `cancelada`; as demais, `calculada` (o sistema **não tem** fluxo de aprovar/pagar comissão).
- **Referência (competência)** da comissão = mês em que o ciclo **dia 21 → dia 20** termina. Nota de 25/10 é
  `2026-11`; nota de 10/11 também é `2026-11`.
- **Título**: `parcela` 0 = entrada; `status` = `pendente`, `parcial` ou `pago`. Título removido no sistema
  (excluído) **não é enviado** e não há como avisar o JARVIS; o contrato não tem status de cancelado.

### Limites conhecidos
- Só notas com XML guardado (`xml_raw`) são enviadas; nota lançada sem XML fica de fora.
- **Cancelamento de NF-e:** o XML guardado é o da autorização. O cancelamento existe só como tipo de operação
  "Cancelada" no nosso sistema. Para o JARVIS saber, ele precisa receber o XML do evento de cancelamento ou um
  campo extra; **a combinar com a equipe do JARVIS**. Hoje as comissões dessas notas já vão como `cancelada`.

## Configuração (uma vez)

1. **Banco**: rode `supabase/migrations/0089_jarvis_envios.sql` no SQL Editor.
2. **Variáveis na Vercel** (Settings → Environment Variables; marque como *Sensitive* o token e o segredo):
   - `JARVIS_BASE_URL` — endereço público do JARVIS, sem barra no final e sem `/api/...`
     (ex.: `https://jarvis.suaempresa.com.br`);
   - `JARVIS_INTEGRATION_TOKEN` — o token que o JARVIS fornecer. **Nunca** coloque no código, no repositório
     nem em conversas;
   - `JARVIS_SYNC_SECRET` — um segredo longo qualquer, só entre o agendador e o nosso `/api/jarvis-sync`.
   - Já existentes e usadas também aqui: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Redeploy** na Vercel (variável nova só vale depois).
4. Sem `JARVIS_BASE_URL` e `JARVIS_INTEGRATION_TOKEN` a rotina responde `desligado: true` e **não envia nada**.

## Agendamento (Supabase, pg_cron + pg_net)

Use `timeout_milliseconds` alto: o padrão do pg_net é 5 s, e o primeiro envio (histórico) demora mais.
Troque `SEU_SEGREDO` pelo `JARVIS_SYNC_SECRET`.

```sql
-- notas, comissões e títulos que mudaram: a cada 15 minutos
select cron.schedule('jarvis-sync', '*/15 * * * *', $$
  select net.http_get(
    url := 'https://faturamentomcit.vercel.app/api/jarvis-sync',
    headers := '{"x-sync-secret": "SEU_SEGREDO"}'::jsonb,
    timeout_milliseconds := 55000) $$);

-- indicadores: de hora em hora, em horário comercial (11h–21h UTC = 8h–18h de Brasília), de segunda a sábado
select cron.schedule('jarvis-indicadores', '0 11-21 * * 1-6', $$
  select net.http_get(
    url := 'https://faturamentomcit.vercel.app/api/jarvis-sync?parte=indicadores',
    headers := '{"x-sync-secret": "SEU_SEGREDO"}'::jsonb,
    timeout_milliseconds := 55000) $$);

-- reenvio completo de segurança, todo dia às 6h de Brasília (9h UTC)
select cron.schedule('jarvis-completo', '0 9 * * *', $$
  select net.http_get(
    url := 'https://faturamentomcit.vercel.app/api/jarvis-sync?completo=1',
    headers := '{"x-sync-secret": "SEU_SEGREDO"}'::jsonb,
    timeout_milliseconds := 55000) $$);
```

## Primeiro envio (teste guiado)

Faça com o JARVIS acompanhando, uma parte de cada vez (cada chamada devolve um resumo em JSON):

1. `?parte=indicadores` — confere o formato e os números (o JARVIS deve responder `ok`).
2. `?parte=notas&desde=2026-11-01` — deve voltar `criadas` = número de notas; repetir deve dar `0` candidatos.
3. `?parte=comissoes` e `?parte=titulos`.
4. Só depois criar os agendamentos acima.

Critérios de aceite do JARVIS: NF-e nova → `criadas: 1`; reenvio → `atualizadas: 1` sem duplicar; comissão
reenviada atualiza; sem token → 401; `referencia` fora do formato `AAAA-MM` → 400.

## Em caso de erro
- Resposta `502` do nosso endpoint traz `falhas` com o motivo (`JARVIS respondeu 401/503/…`).
- `401` do JARVIS: token ausente ou inválido. `503`: integração não configurada no servidor do JARVIS.
- `400/422`: o lote é dividido até isolar o item inválido; o motivo aparece em `erros`. Os demais seguem.
- Falha de rede ou `5xx`: tenta de novo uma vez; o que não for enviado entra na rodada seguinte.
