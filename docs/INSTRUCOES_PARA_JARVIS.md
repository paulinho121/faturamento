# Instruções para a equipe do JARVIS — o lado de vocês da integração

O lado do **faturamento (MCI)** está pronto para **enviar** os dados no contrato que vocês passaram. Este
documento diz **o que vocês precisam fazer, confirmar e responder** para a integração entrar no ar, e descreve
exatamente o que vamos mandar (formatos, volumes e frequência).

O JARVIS será o sistema em que o **diretor acompanha os números da empresa**. Para a visão geral do sistema de
faturamento, veja `RESUMO_SISTEMA_PARA_JARVIS.md`.

---

## 1. O que vocês precisam fazer (checklist)

1. **Confirmar que os 4 endpoints estão no ar**, em **HTTPS**, exatamente como no contrato:
   - `POST /api/integrations/faturamento/invoices` (NF-e em XML)
   - `POST /api/integrations/faturamento/commissions` (comissões)
   - `POST /api/integrations/faturamento/receivables` (títulos a receber)
   - `POST /api/integrations/faturamento/indicators` (indicadores)
2. **Gerar o token da integração** e nos passar, junto com a **URL pública base** (sem `/api/...`). Mandem por
   **canal seguro** (não por e-mail aberto, nem grupo de WhatsApp, nem chat). Nós guardamos só em variável de
   ambiente do servidor.
3. **Não restringir por IP.** O envio sai de servidores da Vercel (nuvem), que **não têm IP fixo**. A
   autenticação é só o header `x-integration-token`.
4. **Responder às perguntas da seção 5** (principalmente o cancelamento de NF-e).
5. **Acompanhar o primeiro envio de teste** com a gente (seção 6) e conferir os critérios de aceite.
6. Se possível, ter um **ambiente de teste** (ou um modo de apagar o que foi enviado), porque o primeiro envio
   carrega histórico.

## 2. O que vamos enviar, e como

Todas as chamadas levam `x-integration-token`. Tempo máximo de espera nosso: **25 s por requisição**; em `5xx` ou
falha de rede repetimos **uma vez** após 1,5 s; o que falhar entra na rodada seguinte. Por isso o envio **precisa
ser idempotente** (já previsto no contrato) e responder dentro desse tempo.

### 2.1 NF-e (XML)
- `POST .../invoices`, `multipart/form-data`, campo **`files`** repetido, **até 100 notas por requisição**.
- Cada arquivo é o **XML original, sem alteração**, como foi emitido/guardado. O nome é
  `<chave de acesso de 44 dígitos>-nfe.xml` (quando não há chave, `nf-<número>-<8 caracteres>-nfe.xml`).
- Enviamos as notas do **mês anterior e do mês atual** que ainda não foram enviadas ou que mudaram. No primeiro
  envio pode vir histórico maior (combinamos a data inicial).
- Esperamos `200` (ou `422` se nenhuma for válida) com `{ recebidos, criadas, atualizadas, erros }`. Em `erros`,
  **incluam o nome do arquivo** e o motivo: é por ele que sabemos qual nota reenviar.
- Pode chegar XML de nota **cancelada no nosso sistema**. Veja a pergunta 1 da seção 5.
- Notas sem XML guardado no nosso sistema não são enviadas.

### 2.2 Comissões
- `POST .../commissions`, JSON `{ "items": [...] }`, até **500 por requisição** (aceitem até 1000, como no contrato).
- **Uma comissão por NF.** `externalId` estável: `COM-<id da nota>` (ou `COM-<id da nota>-<id do beneficiário>`
  nas parcerias, em que o mesmo vendedor "combo" divide a comissão de uma nota entre duas ou mais pessoas, então
  **uma NF pode gerar mais de uma linha**).
- Exemplo:

```json
{
  "externalId": "COM-5b0e6c1e-0f0a-4a53-9d51-6a3a0c9f2b11",
  "vendedor": "Ana Souza",
  "referencia": "2026-11",
  "chaveNfe": "35261112345678000190550010000001231000001234",
  "valorBase": 1500.50,
  "percentual": 5,
  "valorComissao": 75.03,
  "status": "calculada",
  "pagoEm": null
}
```

- `referencia` = mês em que o **ciclo de apuração termina** (ciclo do dia 21 ao dia 20). Nota de 25/10 → `2026-11`;
  nota de 10/11 → `2026-11`.
- `status`: enviamos **`calculada`** ou **`cancelada`** (nota cancelada/excluída). **`aprovada` e `paga` não são
  enviados**: o nosso sistema não controla aprovação/pagamento de comissão (podemos criar isso depois, se o
  diretor quiser).
- `chaveNfe` pode ser `null` quando a nota não tem chave de acesso guardada.
- Reenviamos a comissão quando muda qualquer valor (ex.: o percentual do vendedor foi alterado); o `externalId`
  é o mesmo, então é uma **atualização**.
- O vendedor vai **pelo nome** (texto). Façam a correspondência com o cadastro de vocês pelo nome.

### 2.3 Títulos a receber
- `POST .../receivables`, JSON `{ "items": [...] }`, até **1000 por requisição**.
- `externalId` = identificador do título/parcela no nosso sistema (UUID), estável.
- Exemplo:

```json
{
  "externalId": "9f2d3c58-6d57-4a0e-8e0b-2f4f1f0f9a77",
  "cliente": "CLIENTE EXEMPLO COMERCIO LTDA",
  "cnpj": "12345678000190",
  "nota": "2354",
  "parcela": 4,
  "valor": 359.92,
  "juros": 23.04,
  "valorPago": 382.96,
  "vencimento": "2026-10-25",
  "dataPagamento": "2026-11-17",
  "status": "pago"
}
```

- `parcela` **0 = entrada**. `status`: `pendente`, `parcial` (pago menos que o devido) ou `pago`.
- `juros` é o valor de juros **registrado na baixa** (pelo financeiro), **não** um cálculo automático.
  Saldo em aberto = `valor + juros − valorPago`.
- `cnpj` só tem dígitos (CNPJ ou CPF) e vem omitido quando o cliente não tem documento cadastrado. `nota` é o número
  da NF e vem omitido em título sem nota vinculada.
- Enviamos o **estado atual** de cada título, **inclusive os já pagos**: os em aberto + os pagos nos últimos 90
  dias a cada rodada; o histórico completo no reenvio diário.
- Título **removido** no nosso sistema deixa de ser enviado (o contrato não tem status "cancelado"); veja a
  pergunta 2.

### 2.4 Indicadores
- `POST .../indicators`, JSON livre com `geradoEm` (ISO com fuso, `-03:00`). **De hora em hora**, em horário
  comercial (segunda a sábado, 8h–18h de Brasília). Cada envio **substitui** o anterior.
- Exemplo do que mandamos:

```json
{
  "geradoEm": "2026-11-21T12:00:00-03:00",
  "faturamentoDia": 45200.00,
  "faturamentoMes": 812300.00,
  "notasMes": 118,
  "metaMes": 900000.00,
  "percentualMeta": 90.26,
  "pedidosPorEtapa": {
    "enviado": 4, "emProcesso": 7, "enviadoSanco": 1, "emSeparacao": 3,
    "preparandoEmbarque": 2, "faturadosParcialmente": 2, "devolvidos": 5
  },
  "demosEmAberto": 11,
  "demosAtrasadas": 3,
  "demosVencendoEm7Dias": 5,
  "aReceber": 2853512.76,
  "vencidoTotal": 643320.59,
  "titulosVencidos": 135,
  "vencidoPorFaixa": { "ate30dias": 382502.80, "de31a60dias": 67599.10, "de61a90dias": 127811.16, "acima90dias": 45407.53 }
}
```

- Regra do faturamento: **nota cancelada, transferência e notas que não afetam o faturamento (demo, devolução,
  brinde, comodato etc.) não entram.**

### 2.5 Frequência
- Notas, comissões e títulos que **mudaram**: a cada 15 minutos.
- Indicadores: de hora em hora (horário comercial).
- **Reenvio completo** de segurança: todo dia às 6h (Brasília).

## 3. Como usar os números no JARVIS (importante para o diretor)

- **Faturamento oficial = os indicadores**, não a soma dos XMLs. A classificação que decide se uma nota conta no
  faturamento (transferência, demo, devolução, cancelada...) fica no **nosso sistema** e **não está dentro do XML**;
  por isso somar todos os XMLs daria um valor maior que o oficial. Usem o XML para **detalhe e auditoria** (itens,
  impostos, cliente, chave) e os indicadores para o **número do painel**.
- Se o JARVIS precisar do **tipo de operação** ou do "conta no faturamento" de cada nota, avisem: dá para
  acrescentar esses campos por acordo (hoje o contrato não tem onde recebê-los).
- Comissões e títulos têm identificadores estáveis: usem como chave de atualização, nunca como "novo registro".
- Mostrem sempre a hora do último recebimento (`geradoEm`/`receivedAt`), para o diretor saber a idade do número.

## 4. Erros que vamos tratar

| Resposta de vocês | O que fazemos |
|---|---|
| `200` | Registramos como enviado e seguimos |
| `422` (notas, nenhuma válida) | Registramos o motivo; as outras notas do lote seguem |
| `400` (comissões/títulos) | Dividimos o lote ao meio até achar o item inválido; os demais são enviados. **Por favor, devolvam em `detalhes` o campo e o motivo** |
| `401` | Paramos e avisamos (token inválido) |
| `503` | Paramos e avisamos (integração não configurada aí) |
| `5xx` ou sem resposta | Uma nova tentativa; depois fica para a próxima rodada |

## 5. Perguntas para vocês responderem

1. **Cancelamento de NF-e.** O XML que temos é o da autorização (`cStat` 100). O cancelamento existe só como "tipo
   de operação: Cancelada" no nosso sistema. Como querem saber que uma nota foi cancelada? Opções: (a) receber o
   **XML do evento de cancelamento** quando existir; (b) um **campo/cabeçalho extra** no envio (ex.:
   `x-status: cancelada`); (c) bastar o status `cancelada` das **comissões** dessa nota.
2. **Título removido.** Se um título for apagado do nosso lado, ele some dos envios. Querem um status extra
   (`cancelado`) no contrato para podermos avisar?
3. **Histórico.** A partir de que data carregamos as **notas** e os **títulos** no primeiro envio? (Notas: padrão é
   o mês anterior; títulos: todos os em aberto e os pagos dos últimos 90 dias, e o resto no reenvio completo.)
4. **Limites de vocês:** tamanho máximo do corpo, limite de requisições por minuto e tempo máximo de resposta.
5. **XML sem protocolo.** Pode chegar XML sem o bloco de protocolo de autorização. O JARVIS deve **aceitar** e
   marcar como "sem protocolo" (e não rejeitar). Confirmem.
6. **Aprovação e pagamento de comissão** (`aprovada`/`paga`): hoje não existem no faturamento. O diretor quer que
   passem a existir? Se sim, criamos o controle do nosso lado e passamos a enviar.
7. **Troca de token.** Como fazemos a rotação (avisem com antecedência para atualizarmos a variável no servidor)?

## 6. Teste de aceite (fazemos juntos)

Faremos o primeiro envio **uma parte de cada vez**, com alguém de vocês acompanhando:

1. **Indicadores** → devem responder `{ "ok": true, "receivedAt": ... }`.
2. **Notas** (um mês) → `criadas` = quantidade de notas. **Repetir o envio** → `atualizadas`, sem duplicar.
3. **Comissões** → depois uma comissão reenviada com valor diferente deve vir como `atualizadas`.
4. **Títulos** → confirmar que os pagos também aparecem e que `parcela: 0` (entrada) é aceita.
5. **Sem token** → `401`. **Comissão com `referencia` inválida** (ex.: `11/2026`) → `400` com `detalhes`.
6. Só depois ligamos o envio automático (a cada 15 minutos, de hora em hora e o reenvio diário).

## 7. Contato e combinados

- Nós cuidamos do envio (agendamento, regras dos números, reenvios). Vocês cuidam da recepção, da
  idempotência e da exibição para o diretor.
- Qualquer mudança no contrato, avisem **antes** de implementar, para ajustarmos juntos.
- Quando tiverem a **URL** e o **token**, nos passem por canal seguro; configuramos em minutos e fazemos o teste.
