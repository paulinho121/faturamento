# Integração Loja Integrada (site) → Faturamento

A rotina `api/loja-integrada-sync.ts` busca na API da Loja Integrada os pedidos
**aprovados** (situação com `aprovado = true` e `cancelado = false`) e cria o pedido
no faturamento do mesmo jeito que o vendedor ou o CRM: fila do faturista, logística
(coluna "Em faturamento") e barra de progresso. A loja não manda PDF, então o
sistema gera um **PDF-resumo** (cliente, documento, endereço, itens, frete,
pagamento) que o faturista abre para emitir a NF.

- Cada pedido vira `id_externo = LI-<número>`: rodar de novo não duplica, e pedido
  cancelado no faturamento não volta.
- Pedido ainda sem pagamento é ignorado; quando for aprovado (dentro da janela de
  `LI_JANELA_HORAS`, padrão 72 h) entra na rodada seguinte.
- Documentação da API: https://api-docs.lojaintegrada.com.br (base `https://api.awsli.com.br`).

## O que configurar

1. **Vendedor "Site"**: cadastre em *Vendedores* um vendedor ativo chamado `Site`
   (ou outro nome, e informe em `LI_VENDEDOR_NOME`). Os pedidos do site entram em nome dele.
2. **Credencial da loja** (Vercel → Settings → Environment Variables):
   - `LI_PERSONAL_TOKEN` — o Personal Token do lojista (recomendado). É a parte
     depois de `Basic` no header `Authorization`. Como gerar:
     https://ajuda.lojaintegrada.com.br/pt-BR/articles/5360466-como-o-integrador-gera-a-chave-de-aplicacao
   - ou `LI_CHAVE_API` + `LI_CHAVE_APLICACAO` (credencial de integrador tem
     **restrição por IP** e a Vercel não tem IP fixo — por isso o token do lojista).
3. `LI_SYNC_SECRET` — um segredo longo qualquer (o agendador manda no header `x-sync-secret`).
4. Opcionais: `LI_ORIGEM` (padrão `SC` — todos os pedidos do site saem de Santa Catarina),
   `LI_JANELA_HORAS`, `LI_SERVICE_PROFILE_ID` (padrão: `CRM_SERVICE_PROFILE_ID`).
5. **Redeploy** (variável nova só vale depois).

## Testar

Só consulta um pedido da loja (não cria nada) — confere token e dados:

```bash
curl -H "x-sync-secret: <LI_SYNC_SECRET>" "https://faturamentomcit.vercel.app/api/loja-integrada-sync?pedido=<NUMERO>"
```

Sincronizar agora (cria os pedidos aprovados novos):

```bash
curl -H "x-sync-secret: <LI_SYNC_SECRET>" "https://faturamentomcit.vercel.app/api/loja-integrada-sync"
```

## Agendar (a cada 5 minutos)

No SQL Editor do Supabase (extensões `pg_cron` e `pg_net` já usadas pelo `escala-sync`):

```sql
select cron.schedule('loja-integrada-sync', '*/5 * * * *', $$
  select net.http_get('https://faturamentomcit.vercel.app/api/loja-integrada-sync',
                      headers := '{"x-sync-secret": "<LI_SYNC_SECRET>"}'::jsonb) $$);
```

Limites da API: 100 requisições/minuto por loja. A rotina faz 1 listagem + 1 consulta por
pedido novo (máx. 25 por rodada), bem abaixo disso.
