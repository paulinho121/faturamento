# API de leitura do faturamento para o JARVIS

API **somente leitura** para o JARVIS consultar os dados do faturamento e responder ao diretor ("quanto a nota
563100 deu?", "quais clientes têm título vencido acima de 60 dias?", "quanto a Ana vendeu e de comissão em
novembro?"). Não há acesso direto ao banco: tudo passa por esta API.

- Base: `https://faturamentomcit.vercel.app/api/jarvis`
- Implementação: `api/jarvis.ts` (uma única função; o `vercel.json` reescreve `/api/jarvis/<rota>` para ela).
- Os números seguem as mesmas regras dos indicadores enviados ao JARVIS (`docs/INTEGRACAO_JARVIS.md`).

## 1. Autenticação e segurança

- Header **`x-integration-token`** com o token de **leitura**, que é **diferente** do token de envio.
- Só **GET**. Qualquer outro método responde **405**.
- **Sem restrição por IP** (o JARVIS pode rodar em nuvem).
- Sem o token: **401**. API sem configurar no servidor: **503**.
- **Não expõe** logins, senhas, cadastros bancários, dados de cartão nem o token.
- **Auditoria:** cada consulta é gravada em `jarvis_consultas` (quando, rota, filtros, status, itens, tempo, IP).
- **Limite:** **120 requisições por minuto** (resposta **429** com `Retry-After`). Pode ser ajustado.
- **Rotação do token:** avisem com antecedência; trocamos a variável `JARVIS_READ_TOKEN` no servidor e o JARVIS
  passa a usar o novo valor.

## 2. Formato

- JSON em UTF-8. Valores em reais com ponto decimal. Datas `AAAA-MM-DD`; data e hora em ISO.
- Campos sem dado vêm como `null` (nunca omitidos).
- Listas: `{ "itens": [...], "proximoCursor": "..." | null }`. Paginação com `cursor` (opaco: use o
  `proximoCursor` recebido) e `limit` (padrão 50, **máximo 200**).
- Erros: `{ "erro": "mensagem" }`; em `400` também `"detalhes": [{ "campo": "...", "motivo": "..." }]`.
- `GET /api/jarvis` devolve a lista de rotas.

## 3. Endpoints

### Notas fiscais
- `GET /notas?numero=&chave=&cliente=&cnpj=&de=&ate=&tipo=&afetaFaturamento=true|false&limit=&cursor=`
- `GET /notas/{chave}` — detalhe (chave de 44 dígitos ou id da nota), com **itens** lidos do XML.
- `GET /notas/{chave}/xml` — o XML original, `Content-Type: application/xml`, sem alteração.

Campos: `chaveAcesso, numero, serie, dataEmissao, cliente, cnpj, uf, valorTotal, valorIcms, frete, tipoOperacao,
afetaFaturamento, filial, vendedor, status, temXml`. O detalhe acrescenta `valorIpi, valorDifal, valorFcp,
meioPagamento, parcelas, transportadora, itens[]` (`item, codigo, descricao, ncm, cfop, unidade, quantidade,
valorUnitario, valorTotal`).

`status`: **`cancelada`** (a nota está marcada como cancelada ou foi excluída no faturamento), **`autorizada`**
(XML com protocolo `cStat` 100/150), **`sem_protocolo`** (XML sem protocolo de autorização) ou `null` (a nota não
tem XML guardado). Isso resolve o ponto do cancelamento: o JARVIS lê o status aqui.

### Títulos a receber
- `GET /titulos?cliente=&cnpj=&nota=&status=pendente|parcial|pago&vencimentoDe=&vencimentoAte=&limit=&cursor=`
- `GET /titulos/{id}` — um título.
- `GET /titulos/vencidos?faixa=0-30|31-60|61-90|90+&cliente=&cnpj=&nota=` — só vencidos com saldo.
  - **Extra:** `&agrupar=cliente` devolve **um item por cliente** (`cliente, cnpj, titulos, saldoVencido,
    maiorAtraso, faixaMaiorAtraso`), do maior devedor para o menor. Ideal para "quais clientes estão com título
    vencido acima de 60 dias" (`?faixa=61-90` + `?faixa=90%2B`, ou `agrupar=cliente` e filtrar por `maiorAtraso`).
- `GET /titulos/resumo` — `totalEmAberto`, `totalVencido`, `titulosVencidos`, `porFaixa`
  (`ate30dias, de31a60dias, de61a90dias, acima90dias`) e `maioresDevedores` (top 10). **Bate com os indicadores
  enviados**, porque usa o mesmo cálculo.
- `GET /titulos/{id}/boleto` — o **PDF do boleto**, quando o financeiro o anexou (senão 404).

Campos: `id, cliente, cnpj, nota, parcela, valor, juros, valorPago, saldo, vencimento, dataPagamento, status,
diasAtraso`. `parcela` 0 = entrada. `saldo = valor + juros − valorPago`. `diasAtraso`: título em aberto = dias
desde o vencimento; título quitado = dias que levou para pagar (pagamento − vencimento).

### Comissões
- `GET /comissoes?vendedor=&referencia=AAAA-MM&status=` (referência padrão: o ciclo atual)

Campos: `id, vendedor, referencia, chaveNfe, valorBase, percentual, valorComissao, status, nota, cliente`. A
resposta traz também `resumo` com `periodoApuracao`, `comissoes`, **`totalVendido`** e **`totalComissao`** (sem as
canceladas), que respondem direto "quanto a Ana vendeu e de comissão em novembro". Comissão **por NF**; a
referência é o mês em que o ciclo **dia 21 → dia 20** termina. `status`: `calculada` e `cancelada` (`aprovada` e
`paga` não existem no sistema; o filtro é aceito e volta vazio).

### Pedidos
- `GET /pedidos?etapa=&origem=SC|SP|CE&status=&paradoHaDiasMais=&cliente=&vendedor=&limit=&cursor=`

`etapa`: `enviado, em_processo, enviado_sanco, em_separacao, preparando_embarque, faturado` e
**`faturado_parcial`** (faturado só em parte). Campos: `numero` (PED-0000), `cliente, vendedor, origem, etapa,
status, dataCriacao, dataUltimaMovimentacao, diasParado, numeroNf, parcial, numeroPedidoErp, idExterno`.
`diasParado` = dias desde a última movimentação da linha do tempo do pedido (só para pedido em andamento ou
devolvido; senão `null`). Sem `status`, não vêm os cancelados.

### Entregas
- `GET /entregas?status=aguardando_despacho|em_transito|entregue|finalizado&transportadora=&limit=&cursor=`

Campos: `id, notaFiscal, pedido, cliente, vendedor, origem, status, transportadora, rastreio, previsao,
despachadoEm, entregueEm, recebidoPor, ocorrenciaAberta, ocorrencias[]` (`tipo, texto, em`). Sem `status`, as
finalizadas não vêm. As **transferências entre filiais** não estão nesta rota (ficam em outro módulo).

### Demonstrações (demos)
- `GET /demos?situacao=emAberto|atrasada|vencendo7dias|devolvida&limit=&cursor=`

Campos: `nota, cliente, vendedor, dataEmissao, valor, prazoFinal, diasRestantes, situacao, nfRetorno,
dataRetorno`. Prazo de 45 dias da emissão; `situacao`: `noPrazo, vencendo7dias, atrasada, devolvida`.

### Metas
- `GET /metas?mes=AAAA-MM&filial=&vendedor=` (mês padrão: o atual)

Itens com `escopo` (`empresa`, `filial` ou `vendedor`), `nome, mes, meta, realizado, percentual`. O realizado é o
faturamento do **mês calendário** (mesmas regras dos indicadores). Meta da empresa: a global, ou a soma das metas
por filial. Metas de vendedor são as pessoais.

## 4. Regras dos números
Nota cancelada, transferência, demo, devolução, brinde e comodato **não entram no faturamento**. As notas vêm com
`tipoOperacao` e `afetaFaturamento` para explicar a diferença entre a soma de todas as notas e o faturamento.

## 5. Respostas e desempenho
`200` JSON · `400` filtro inválido (com `detalhes`) · `401` token · `404` não encontrado · `405` método ·
`429` limite · `503` não configurada · `500` erro inesperado. Meta de resposta: até 5 s nas consultas comuns
(consultas agregadas como `/titulos/resumo` e `/pedidos?paradoHaDiasMais=` leem mais dados e podem levar mais).

## 6. O que NÃO existe
- **Demonstrativo em PDF** (`/clientes/{id}/demonstrativo`): ele é gerado no navegador, não no servidor; não
  incluímos. Os dados para montá-lo estão em `/titulos`.
- **`isDemoData`:** o sistema não distingue dado de teste de dado real; o campo não é enviado.

## 7. Configuração (uma vez)
1. Rode `supabase/migrations/0090_jarvis_consultas.sql` no SQL Editor.
2. Na Vercel (Environment Variables): **`JARVIS_READ_TOKEN`** (um token longo e aleatório, marcado como
   *Sensitive*). Opcional: `JARVIS_LIMITE_POR_MINUTO`. Já usadas aqui: `VITE_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. **Redeploy** depois.
3. Passe o token ao JARVIS por canal seguro (nunca em chat, e-mail aberto ou repositório).

## 8. Teste de aceite
1. Consultar uma nota pelo número (`/notas?numero=...`) e abrir o detalhe e o XML.
2. Listar os vencidos de um cliente (`/titulos/vencidos?cliente=...`) e conferir `/titulos/resumo` com os
   indicadores.
3. Consultar comissões de um vendedor (`/comissoes?vendedor=...&referencia=...`).
4. Um **POST** (ou PUT/DELETE) deve voltar **405**; sem token, **401**.
5. Conferir no banco que as consultas ficaram registradas em `jarvis_consultas`.
