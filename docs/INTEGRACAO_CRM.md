# Integração CRM → Faturamento: botão "Enviar para faturamento"

Guia para o programador do CRM. Objetivo: quando o comercial clicar em **"Enviar para faturamento"** num pedido fechado, o CRM manda o pedido para o nosso sistema, e ele aparece na fila do faturista (e na TV de acompanhamento de pedidos), igual a um pedido cadastrado pela nossa tela.

## Como funciona (resumo)

```
Vendedor clica no botão (CRM)
        │
        ▼
Servidor do CRM  ──POST /api/crm-pedido (JSON + PDF em base64)──▶  Sistema de Faturamento
        ◀── 201 { "ok": true, "numero": 1234 } ───────────────────
```

- A chamada é **de servidor para servidor** (back-end do CRM → nosso endereço). **Nunca** chame direto do navegador/JavaScript do front do CRM: o segredo de acesso vazaria.
- Não existe iframe nem login nosso dentro do CRM. É só essa chamada HTTP.

## O que combinar com a gente antes de começar

| Item | Quem fornece |
|---|---|
| **Endereço (URL)** do endpoint: `https://<endereço-do-nosso-sistema>/api/crm-pedido` | Nós (é o mesmo endereço que o financeiro abre no navegador, mais `/api/crm-pedido`) |
| **Segredo** (`x-webhook-secret`) | Nós, por canal seguro (não por e-mail aberto nem WhatsApp de grupo) |
| **Lista oficial de nomes de vendedores** como estão cadastrados no nosso sistema | Nós |

## Passo a passo

### 1. Guardar a URL e o segredo no servidor do CRM
Em variáveis de ambiente / cofre de segredos do servidor do CRM, por exemplo:
```
FATURAMENTO_URL=https://<endereço-do-nosso-sistema>/api/crm-pedido
FATURAMENTO_SECRET=<o segredo que enviamos>
```
Nada disso pode ir para o código do front-end.

### 2. Criar o botão no pedido do CRM
Botão **"Enviar para faturamento"**, visível só para pedido fechado e ainda **não enviado**. Ao clicar, ele chama uma rota **do back-end do CRM** (ex.: `POST /pedidos/{id}/enviar-faturamento`), não o nosso endereço diretamente.

### 3. No back-end do CRM: obter o PDF do pedido
O nosso sistema recebe **um PDF do pedido** (é o documento que o faturista abre para emitir a nota). O back-end do CRM precisa gerar ou buscar esse PDF e converter o conteúdo para **base64**.

### 4. Montar o JSON e chamar o nosso endpoint
`POST` com o header `x-webhook-secret` e `Content-Type: application/json`. Campos:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `vendedor` | sim | Nome do vendedor **como cadastrado no nosso sistema** (ver "Regras" abaixo) |
| `cliente` | sim | Nome do cliente |
| `arquivo_nome` | sim | Nome do arquivo, ex.: `pedido-1234.pdf` |
| `arquivo_base64` | sim | Conteúdo do PDF em base64 (pode vir com o prefixo `data:application/pdf;base64,`) |
| `id_externo` | **recomendado** | O identificador do pedido no CRM (número ou texto, até 100 caracteres). É a trava contra duplicidade: reenviar o mesmo `id_externo` nunca cria outro pedido. Ele também aparece na observação do pedido como "Pedido CRM #…" |
| `observacao` | não | Texto livre para o faturista (até 1000 caracteres) |
| `origem` | não | De onde sai a mercadoria: `"SC"`, `"SP"` ou `"CE"`. Se não souber, **não envie** (o campo fica vazio e a nossa equipe define) |

Limites de texto: `cliente` e `arquivo_nome` até 200 caracteres.

Exemplo de corpo:
```json
{
  "vendedor": "Wendel",
  "cliente": "OCTO STUDIO LTDA",
  "id_externo": "1234",
  "observacao": "Entrega urgente",
  "origem": "SP",
  "arquivo_nome": "pedido-1234.pdf",
  "arquivo_base64": "JVBERi0xLjQK..."
}
```

### 5. Tratar a resposta e atualizar o CRM
| Código | Significado | O que o CRM deve fazer |
|---|---|---|
| **201** | Pedido criado. Corpo: `{ "ok": true, "numero": 1234 }` | Marcar o pedido como **"Enviado para faturamento"**, **guardar o `numero`** e desabilitar o botão |
| **409** | Esse pedido já foi enviado antes (mesmo `id_externo` ou mesmo PDF). Corpo: `{ "error": "...", "duplicado": true, "numero": 1234 }` | Tratar como **sucesso** ("já enviado"): guardar o `numero` que vem na resposta. Não é erro e não duplica nada |
| **404** | Nenhum vendedor **ativo** com esse nome no nosso sistema | Mostrar erro ao usuário e avisar a nossa equipe (nome diferente do cadastro) |
| **400** | Campo faltando/inválido/grande demais (a mensagem vem em `error`), arquivo que não é PDF, ou nome de vendedor que coincide com mais de um cadastro | Mostrar a mensagem de `error` |
| **401** | Segredo ausente ou errado | Erro de configuração: conferir `FATURAMENTO_SECRET` |
| **405** | Não foi usado `POST` | Corrigir o método |
| **500 / timeout** | Falha nossa ou de rede | Pode **tentar de novo com segurança** (ver "Reenvio") |

Qualquer erro vem como `{ "error": "mensagem em português" }`.

### 6. Testar
**a) Teste de conexão (não cria nada).** Um `GET` no mesmo endereço, com o header do segredo, confere se o endereço, o segredo e a nossa configuração estão certos:
```bash
curl "$FATURAMENTO_URL" -H "x-webhook-secret: $FATURAMENTO_SECRET"
# esperado: {"ok":true,"vendedores_ativos":8}
```
`401` = segredo errado; `500` = configuração do nosso lado (avise a gente).

**b) Pedido de teste.** Com `curl` (abaixo), depois pelo botão. Combine com a gente: avisamos quando ele chegar na fila do faturista e apagamos.

```bash
# converte o PDF para base64 (Linux/Mac): base64 -w0 pedido-1234.pdf
curl -X POST "$FATURAMENTO_URL" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $FATURAMENTO_SECRET" \
  -d '{
    "vendedor": "Wendel",
    "cliente": "CLIENTE TESTE LTDA",
    "id_externo": "TESTE-1",
    "observacao": "TESTE de integração - pode apagar",
    "arquivo_nome": "teste.pdf",
    "arquivo_base64": "'"$(base64 -w0 teste.pdf)"'"
  }'
```

### 7. Ir para produção
Trocar o pedido de teste pelo fluxo real, conferir que o número (`numero`) fica salvo no CRM e avisar a gente para acompanharmos os primeiros pedidos.

## Regras importantes

- **Nome do vendedor:** o nosso sistema ignora maiúscula/minúscula, acentos e espaços repetidos ("João Sousa" = "joao  sousa"), mas o **nome em si** precisa ser o do nosso cadastro, e o vendedor precisa estar **ativo**. O ideal é o CRM manter uma tabela de equivalência *vendedor do CRM → nome no nosso sistema*, usando a lista oficial que enviaremos.
- **Só PDF:** o arquivo precisa ser um PDF de verdade (começa com `%PDF`). Qualquer outro formato volta com erro 400.
- **Tamanho do PDF:** mantenha em **até ~3 MB**. O envio em base64 aumenta o tamanho em cerca de 33%, e a hospedagem aceita no máximo 4,5 MB por requisição.
- **Duplicidade:** o sistema trava de duas formas e responde `409` (com o `numero` do pedido que já existe) em vez de criar outro: pelo mesmo **`id_externo`** e pelo mesmo **conteúdo do PDF**. Se o `id_externo` já existe com outro PDF, vale o primeiro pedido — para corrigir, o escritório devolve o pedido e o vendedor reenvia pelo nosso sistema. Um pedido **cancelado** pode ser enviado de novo.
- **Reenvio seguro:** se a chamada falhar por timeout ou erro `500`, pode repetir a mesma chamada. Se o primeiro envio tinha chegado, a repetição volta `409` (já enviado) e nada é duplicado.
- **Devolução:** se o escritório devolver o pedido, o vendedor vê o motivo na página **Pedidos** do nosso sistema e reenvia por lá. O CRM não precisa fazer nada.
- **Segredo:** enviado sempre no header `x-webhook-secret`, só por HTTPS. Se ele vazar, avise a gente: trocamos o segredo e passamos o novo.
- **Sentido da integração:** hoje o fluxo é **CRM → Faturamento**. O andamento (faturado, devolvido) é acompanhado no nosso sistema e na TV; ele ainda **não volta** para o CRM.

## Exemplos de código

**Node.js (18+)**
```js
import { readFile } from 'node:fs/promises'

const pdf = await readFile('pedido-1234.pdf')
const resp = await fetch(process.env.FATURAMENTO_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': process.env.FATURAMENTO_SECRET,
  },
  body: JSON.stringify({
    vendedor: 'Wendel',
    cliente: 'OCTO STUDIO LTDA',
    id_externo: '1234',
    arquivo_nome: 'pedido-1234.pdf',
    arquivo_base64: pdf.toString('base64'),
  }),
})
const corpo = await resp.json()
if (resp.status === 201) console.log('Enviado, nº', corpo.numero)
else if (resp.status === 409) console.log('Já tinha sido enviado, nº', corpo.numero)
else throw new Error(corpo.error)
```

**Python**
```python
import base64, os, requests

with open("pedido-1234.pdf", "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()

r = requests.post(
    os.environ["FATURAMENTO_URL"],
    headers={"x-webhook-secret": os.environ["FATURAMENTO_SECRET"]},
    json={
        "vendedor": "Wendel",
        "cliente": "OCTO STUDIO LTDA",
        "id_externo": "1234",
        "arquivo_nome": "pedido-1234.pdf",
        "arquivo_base64": pdf_b64,
    },
    timeout=30,
)
if r.status_code == 201:
    print("Enviado, nº", r.json()["numero"])
elif r.status_code == 409:
    print("Já tinha sido enviado, nº", r.json()["numero"])
else:
    raise RuntimeError(r.json().get("error"))
```

**PHP**
```php
<?php
$payload = json_encode([
    'vendedor'       => 'Wendel',
    'cliente'        => 'OCTO STUDIO LTDA',
    'id_externo'     => '1234',
    'arquivo_nome'   => 'pedido-1234.pdf',
    'arquivo_base64' => base64_encode(file_get_contents('pedido-1234.pdf')),
]);

$ch = curl_init(getenv('FATURAMENTO_URL'));
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'x-webhook-secret: ' . getenv('FATURAMENTO_SECRET'),
    ],
    CURLOPT_POSTFIELDS     => $payload,
]);
$resposta = json_decode(curl_exec($ch), true);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if ($status === 201)      { /* salvar $resposta['numero'] e marcar como enviado */ }
elseif ($status === 409)  { /* já enviado: tratar como sucesso, salvar $resposta['numero'] */ }
else                      { throw new Exception($resposta['error'] ?? 'Erro ao enviar'); }
```

## Checklist final para o programador

- [ ] URL e segredo guardados no **servidor** (não no front)
- [ ] Botão só aparece em pedido fechado e não enviado
- [ ] PDF gerado e convertido para base64 (até ~3 MB)
- [ ] Nome do vendedor mapeado para o nome do nosso cadastro
- [ ] `id_externo` enviado em toda chamada (id do pedido no CRM)
- [ ] Teste de conexão (`GET`) devolveu `{"ok":true,...}`
- [ ] `201` salva o `numero` e marca "Enviado"; `409` tratado como sucesso (também salva o `numero`)
- [ ] Erros (`400`/`401`/`404`/`500`) aparecem de forma clara para o usuário
- [ ] Teste feito com a nossa equipe antes de liberar
