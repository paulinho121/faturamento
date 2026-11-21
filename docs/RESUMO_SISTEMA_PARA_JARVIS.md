# MCI Faturamento — resumo do sistema para a integração com o JARVIS

Documento para a equipe do JARVIS conhecer **tudo o que o sistema de faturamento faz**, quais dados ele
guarda e o que já conversa com outros sistemas. Serve de base para combinarmos o que o JARVIS vai receber e
como. Não há segredos neste documento: tokens e chaves ficam só em variáveis de ambiente.

Atualizado em 21/11/2026.

---

## 0. Para que o JARVIS vai servir (ponto central da integração)

O **JARVIS será o sistema que o diretor usa para acompanhar os números da empresa.** O faturamento é a
principal fonte desses números: tudo o que vai para o JARVIS deve responder, com confiança, às perguntas que
o diretor faz no dia a dia:

- **Quanto faturamos** no dia e no mês, por filial, por vendedor e por tipo de operação, e quanto falta para a
  meta?
- **Quanto cada vendedor vendeu** e quanto tem de **comissão** a pagar?
- **Quanto a receber** e quanto está **vencido** (faixas de atraso, clientes que mais devem, juros e multa)?
- **Como estão os pedidos**: quantos aguardando, em separação, devolvidos, faturados parcialmente, e há quanto
  tempo estão parados?
- **Como estão as entregas** e as transferências entre filiais?
- **Demonstrações em campo**: quais estão perto do prazo de 45 dias ou atrasadas?

Por isso a prioridade dos envios é: **notas (XML), comissões, recebíveis (títulos e baixas), pedidos e entregas,
demos e metas**. Os números precisam bater com os do sistema de faturamento (por exemplo, uma nota cancelada,
transferência ou demo **não conta** como faturamento; a comissão usa a apuração do dia 21 ao dia 20).

Como o diretor decide com base nesses números, **consistência importa mais que velocidade**: o envio é
idempotente (reenviar não duplica) e há um reenvio diário de segurança.

---

## 1. O que é

Sistema web (PWA) da **Multi Comercial & Importadora (MCI)** para acompanhar o caminho do dinheiro e da
mercadoria: do pedido fechado pelo vendedor até a nota fiscal, a entrega e a cobrança.

- Endereço: https://faturamentomcit.vercel.app
- Tecnologia: React + Vite + TypeScript + Tailwind no navegador; banco e login no **Supabase** (Postgres com
  controle de acesso por perfil); funções de servidor na **Vercel** (`/api/...`).
- Entrada de notas: o **XML da NF-e** é carregado (upload manual ou por um "watcher" no PC do faturista), e o
  faturista revisa e confirma. O vendedor, a filial e o tipo de operação **não vêm no XML**; são escolhidos na
  revisão.

## 2. Quem usa e o que cada perfil vê

| Perfil | Rotas principais | Para que serve |
|---|---|---|
| **Vendedor** | `/vendedor`, `/vendedor/pedidos` | Acompanha as próprias vendas, comissão e meta pessoal; envia pedidos (PDF) para faturar e corrige os devolvidos |
| **Faturista** | `/operacoes`, `/operacoes/pedidos` | Lança as notas (XML), conduz o pedido pelas etapas e marca como faturado |
| **Financeiro** | `/financeiro`, `/financeiro/conciliacao`, `/financeiro/pedidos`, `/financeiro/demos` | Títulos/boletos, cobrança, conciliação bancária, aprovação de pedidos, demos |
| **Logística** | `/logistica`, `/logistica/entregas` | Transferências entre filiais e quadro de entregas (despacho, rastreio, ocorrências) |
| **Diretor** | `/dashboard`, `/dashboard/pedidos`, `/dashboard/orientacoes`, `/dashboard/bi` | Faturamento, metas, comissões, BI, pedidos |
| **Cliente** | `/cliente` | O cliente final vê só as próprias notas e boletos |
| **TV** | `/tv` | Painel "Acompanhamento de Pedidos" para a TV da sala comercial (somente leitura) |

Um perfil pode ter módulos extras (ex.: faturista com acesso ao financeiro).

## 3. Fluxos principais

### 3.1 Pedido → faturamento
1. O pedido nasce pelo **vendedor** (PDF anexado), pelo **CRM** (webhook `api/crm-pedido`) ou pela **Loja
   Integrada** (site). Recebe um número sequencial `PED-0000`.
2. O **financeiro** pode aprovar (selo informativo) ou o faturista/financeiro **devolve** ao vendedor com
   motivo. Pedido corrigido e reenviado volta com a marca "Corrigido · Rev. N".
3. O **faturista** inicia o processo e define a **origem**: **SC** (separação pela Sanco), **SP** ou **CE**
   (separação pela própria MCI).
4. Etapas: `enviado → em_processo → (SC: enviado_sanco → em_separacao → preparando_embarque | SP/CE:
   em_separacao) → faturado`.
   - **SC**: o andamento vem da **Sanco** (WMS Escalasoft), consultado automaticamente pelo número do pedido
     no ERP.
   - **SP**: a logística informa **números de série e volumes**; **CE**: o próprio faturista informa.
     Sem isso, o pedido de SP/CE não pode ser faturado.
   - **NF de serviço**: pedido marcado pelo faturista vai direto para SP, sem separação.
   - **Pedido parcial**: pode ser faturado em partes (várias NFs); fica na coluna "Pedidos faturados
     parcialmente" até a NF do restante.
   - **Pré-venda**: pedido com item sem estoque, parado até chegar.
5. Ao faturar, o faturista informa o número da NF; a **entrega** é criada para a logística despachar.

### 3.2 Entrega (logística)
Quadro com as etapas: aguardando faturamento → aguardando despacho → em trânsito → entregue → finalizada.
Registra transportadora, código de rastreio, previsão de chegada, ocorrências ("problema na carga") e
observações; guarda histórico de cada evento.

### 3.3 Transferências entre filiais
Notas de tipo "Transferência" aparecem para a logística, que agora marca cada uma como **finalizada** (com
opção de reabrir).

### 3.4 Financeiro: títulos, cobrança e conciliação
- **Títulos (boletos/parcelas)** por nota. Entrada de dados: importação do XML de títulos do ERP, cadastro
  manual (inclusive **parcela 0 = Entrada**) e vínculo automático dos títulos soltos quando a nota é lançada.
- **Baixa**: total ou parcial, com data de pagamento e juros cobrados; também por arquivo de **retorno
  bancário CNAB 400 (.RET)** e extrato.
- **Títulos Vencidos**: lista por cliente, separada por nota, com busca (cliente, vendedor, CNPJ, NF), faixas
  de atraso (0-30, 31-60, 61-90, 90+) e **juros e multa simulados** (juros padrão 6% a.m., proporcional aos
  dias; multa de 2% única; a taxa de juros pode ser alterada por cliente antes de gerar o documento).
- **Demonstrativo financeiro** (PDF por cliente): por nota, com vencimento, data de pagamento, dias de atraso
  (pagas: data de pagamento − vencimento), pago, vencido + juros e a vencer.
- **Conciliação diária**: confere no banco quem pagou e marca como pago.

### 3.5 Demonstrações (demo)
Notas com tipo de operação "Demo/Demonstração" têm **45 dias** (da emissão) para retornar. A tela *Demos*
mostra o prazo restante, quem está atrasado e onde o financeiro registra a **NF de retorno**.

### 3.6 Comissões e metas
- Cada vendedor tem um **percentual de comissão**. O valor é **calculado na hora** (não é gravado como
  registro): soma das notas válidas do período × percentual. O ciclo de apuração da empresa vai do **dia 21 ao
  dia 20** do mês seguinte e o "mês" da comissão é o mês em que o ciclo termina (21/06 a 20/07 = julho); o painel
  do diretor deixa escolher qualquer intervalo de datas. Há também
  **parcerias** de comissão entre vendedores (percentual repassado a um beneficiário).
- **Meta da empresa** (por filial ou global, por mês) definida pelo diretor e **meta pessoal** de cada vendedor.
- Notas de tipos que não são receita (transferência, comodato, brinde, demo, devolução, cancelada etc.) têm
  `afeta_faturamento = false` por padrão e não entram no faturamento.

### 3.7 Modo TV
Painel em tempo real com metas do dia/mês, corrida de vendedores e colunas dos pedidos por etapa (Em processo,
Na Sanco, Em separação, Prep. embarque, Devolvidos, Faturados parcialmente, Faturados hoje). A conta da TV mostra
percentuais, nunca valores.

## 4. Principais dados (tabelas)

| Tabela | O que guarda |
|---|---|
| `invoices` | Notas fiscais: número, chave de acesso, emissão, cliente, UF, valor, frete e impostos, tipo de operação, meio de pagamento, filial, vendedor, `afeta_faturamento`, `excluida`, **`xml_raw`** (XML original), transportadora, finalização de transferência |
| `pedidos` | Pedidos: número, cliente, vendedor, origem (SC/SP/CE), etapa, status, nº do pedido no ERP, nº da NF, volumes, séries, parcial, NF de serviço, `id_externo` (CRM/loja), revisão |
| `pedido_eventos` | Linha do tempo de cada pedido (enviado, aprovado, devolvido, faturado, etapas, parcial...) |
| `entregas`, `entrega_registros`, `entrega_marcas` | Entregas e o diário de ocorrências, rastreio e previsões |
| `boletos` | Títulos/parcelas: nota, nº do título, parcela (0 = entrada), valor, juros, valor pago, vencimento, data de pagamento, status (pendente/parcial/pago) |
| `demo_retornos` | Retorno das notas de demo (NF de retorno, data) |
| `vendedores`, `clientes`, `filiais` | Cadastros (vendedor com percentual de comissão; cliente com CNPJ/CPF) |
| `metas`, `metas_pessoais`, `comissao_parcerias` | Metas e parcerias de comissão |
| `nfe_capturas` | XMLs recebidos pelo watcher, aguardando confirmação do faturista |
| `pedidos_sanco` | Pedidos acompanhados só no CD (aparecem na TV) |
| `conciliacoes_bancarias` | Movimentos bancários conciliados |
| `profiles` | Usuários e perfis |

## 5. Integrações que já existem

| Integração | Sentido | Como |
|---|---|---|
| **CRM → Faturamento** | CRM envia pedido fechado (e reenvia o corrigido) | `POST /api/crm-pedido`, header `x-webhook-secret`; guia em `docs/INTEGRACAO_CRM.md` |
| **Loja Integrada → Faturamento** | Pedidos aprovados do site viram pedido | `api/loja-integrada-sync.ts` (agendador a cada 5 min); guia em `docs/INTEGRACAO_LOJA_INTEGRADA.md` |
| **Sanco/CD (Escalasoft) → Faturamento** | Etapa e volumes dos pedidos de SC | `api/escala-sync.ts` (agendador a cada 5 min) |
| **Watcher de NF-e → Faturamento** | XML novo da pasta do emissor chega ao sistema | `api/nfe-watcher.ts`, header `x-watcher-secret` |

Agendamento: `pg_cron` + `pg_net` no Supabase chamam as rotas `/api` com um segredo no header.

> Ponto aberto hoje: a consulta à Sanco está falhando por **bloqueio de conexão** do servidor da Vercel até
> `sanco.cloud.escalasoft.com.br:4034` (timeout de conexão). Em tratativa com a Escalasoft.

## 6. Integração com o JARVIS — como ficou

Contrato recebido (4 endpoints, todos com `x-integration-token`): NF-e em XML, comissões, **títulos a receber**
e **indicadores calculados**. Está implementado em `api/jarvis-sync.ts`; configuração, agendamento e teste
guiado em **`docs/INTEGRACAO_JARVIS.md`**. Resumo:

| Contrato | Origem no faturamento | Observação |
|---|---|---|
| NF-e (XML) | `invoices.xml_raw` (XML original, sem alterar) | Só notas que têm XML guardado; só o que mudou |
| Comissões | Calculadas **por NF**: valor da nota × percentual do vendedor (parcerias divididas) | Status `calculada` ou `cancelada`; não existe fluxo de aprovar/pagar |
| Títulos a receber | `boletos` (parcelas, juros, valor pago, vencimento, data de pagamento, status; 0 = entrada) | Inclui pagos; título excluído no sistema não é enviado |
| Indicadores | Calculados a cada hora | Faturamento dia/mês, meta, pedidos por etapa, demos, a receber e vencido por faixa |

Regras dos números (iguais às do painel do diretor): nota cancelada, transferência, demo, devolução e demais
tipos que não afetam o faturamento **não entram**. A referência da comissão é o mês em que o ciclo 21→20 termina.

### 6.1 Pontos a alinhar com a equipe do JARVIS
- **Cancelamento de NF-e:** o XML que guardamos é o da autorização; o cancelamento existe só como tipo de
  operação "Cancelada" no nosso sistema. Como o JARVIS quer receber isso: XML do evento de cancelamento, um
  campo/cabeçalho extra, ou aceita só o status da comissão (`cancelada`)?
- **Título excluído:** o contrato não tem status "cancelado" para título; um título removido deixa de ser enviado
  e permanece como estava no JARVIS.
- **Comissão aprovada/paga:** hoje o sistema não controla isso. Só enviamos `calculada` e `cancelada`.
- **Indicadores extras** que enviamos além do exemplo (JSON livre): `notasMes`, `percentualMeta`,
  `demosEmAberto`, `aReceber`, `vencidoTotal`, `titulosVencidos`, `vencidoPorFaixa`.

### 6.2 Segurança
- O token do JARVIS fica em variável de ambiente na Vercel (`JARVIS_INTEGRATION_TOKEN`), nunca no código nem no
  repositório; a URL também (`JARVIS_BASE_URL`). Sem elas o envio fica **desligado**.
- Dados enviados: notas fiscais (inclui clientes e valores), comissões por vendedor, títulos a receber por cliente
  (nome e CNPJ) e indicadores. Tudo para uso interno do diretor.

---

## 7. Mudanças recentes (novembro/2026)

- Aviso de série e volumes (NS) para a logística; opção **NF de serviço**; CE com série/volumes pelo faturista.
- **Pedido parcial** com coluna própria e NFs informadas pelo faturista; destaque de pedidos novos e marcação de
  **corrigido** para pedidos reenviados pelo CRM; devolução liberada para SP/CE em separação.
- Financeiro: **busca global de pedidos** (inclui antigos), juros/multa e **demonstrativo** em PDF próprio,
  **Entrada** como parcela 0, vínculo automático de títulos soltos, correção de arredondamento nas baixas,
  tela de **Demos** com prazo de 45 dias.
- Logística: transferências com **finalizada/reabrir**.
- Sincronização com a Sanco reescrita (consultas em paralelo e erros de rede com causa explicada).
