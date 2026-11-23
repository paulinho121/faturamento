# Captura automática das NF-e emitidas contra a empresa (Distribuição DF-e)

Base do módulo da contabilidade: a rotina `api/dfe-sync.ts` consulta o serviço **Distribuição DF-e da SEFAZ** com
o **certificado A1** da empresa e grava as NF-e em que o CNPJ da empresa é o **destinatário**, sem ninguém
precisar importar XML.

## Como funciona

1. A cada 15 minutos o agendador chama **`/api/dfe-sync`** (header `x-sync-secret`).
2. Para cada **CNPJ de filial ativa** (campo `cnpj` da tabela `filiais`; ou os de `DFE_CNPJS`), a rotina consulta a
   SEFAZ a partir do último **NSU** lido (guardado em `dfe_controle`). Cada resposta traz até 50 documentos.
3. Chegam três tipos de documento:
   - **Resumo da nota** (`resNFe`): chave, emitente, valor e data. Gravado em `nfe_entrada` com `completa = false`.
   - **XML completo** (`procNFe`): só vem depois da **Ciência da Operação**. Atualiza a nota (`completa = true`, com o XML).
   - **Evento** (`resEvento`/`procEventoNFe`): cancelamento, carta de correção etc. Gravado em
     `nfe_entrada_eventos`; o cancelamento muda a situação da nota para `cancelada`.
4. **Regra da SEFAZ:** quando não há novidade, é preciso esperar cerca de **1 hora** para consultar de novo (senão
   há bloqueio por "consumo indevido", status 656). A rotina respeita isso (`proxima_consulta`), então chamar de
   15 em 15 minutos é seguro: nas chamadas dentro da espera ela só responde "aguardando".
5. **Ciência da Operação** (opcional, `DFE_CIENCIA_AUTOMATICA=1`): a rotina registra o evento 210210 (assinado com o
   certificado) nas notas que só têm o resumo, até 20 por chamada. É o que faz o XML completo chegar na consulta
   seguinte. Veja "Decisão da contabilidade" abaixo.

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `nfe_entrada` | Uma linha por NF-e: chave (44 dígitos), CNPJ destinatário, emitente (CNPJ, nome, IE), número, série, emissão, valor, natureza da operação, situação (`autorizada`, `cancelada`, `denegada`), XML, `completa`, manifestação |
| `nfe_entrada_eventos` | Eventos por nota (cancelamento 110111, carta de correção 110110, manifestações 2102xx...) |
| `dfe_controle` | Por CNPJ: último NSU lido, quando pode consultar de novo, último status e mensagem, erros seguidos |

Leitura: diretor e financeiro. O perfil da contabilidade entra quando o módulo for criado. Só o servidor escreve.

## Configuração (uma vez)

1. **Banco:** rode no SQL Editor, nesta ordem, `supabase/migrations/0091_nfe_entrada.sql` e
   `supabase/migrations/0092_dfe_certificado.sql`.
2. **CNPJ das filiais:** confira se estão preenchidos: `select nome, cnpj, ativo from filiais;`
3. **Variáveis na Vercel** (Settings → Environment Variables; marque como *Sensitive* o segredo) e **redeploy**:
   - `DFE_SYNC_SECRET` — um segredo longo qualquer (só entre o agendador e a rotina);
   - opcionais: `DFE_CNPJS` (lista separada por vírgula, para consultar só alguns CNPJs), `DFE_UF_AUTOR`
     (código IBGE da UF do cadastro da empresa; padrão **42** = SC), `DFE_AMBIENTE` (`producao` padrão ou
     `homologacao`), `DFE_CIENCIA_AUTOMATICA` (`1` liga), `DFE_ACEITAR_CADEIA_ICP` (`1` só se a conexão falhar por
     certificado da SEFAZ não reconhecido), `DFE_CHAVE_CRIPTOGRAFIA` (veja abaixo).
4. **Certificado A1: envie pela tela.** Entre como **diretor** → menu **Certificado** → escolha o arquivo `.pfx`
   (ou `.p12`), digite a senha e clique em **Enviar certificado**.
   - O servidor abre o arquivo para validar (senha, validade, CNPJ) e só então guarda, **criptografado**
     (AES-256-GCM). O arquivo e a senha **nunca** aparecem de novo na tela nem em respostas ou registros.
   - A tela mostra titular, CNPJ, validade (com aviso 30 dias antes de vencer), quem enviou, a situação da captura
     por CNPJ e avisos (por exemplo, CNPJ do certificado com raiz diferente do de alguma filial).
   - Para **trocar** o certificado (renovação anual), use **Substituir certificado**. Para pausar a captura, **Remover**.
   - Alternativa antiga, ainda aceita: variáveis `DFE_CERT_PFX_BASE64` e `DFE_CERT_SENHA` na Vercel. O certificado
     enviado pela tela tem prioridade sobre as variáveis.
5. **Agendamento** (Supabase, SQL Editor; troque `SEU_SEGREDO` pelo `DFE_SYNC_SECRET`):
   ```sql
   select cron.schedule('dfe-sync', '*/15 * * * *', $$
     select net.http_get(
       url := 'https://faturamentomcit.vercel.app/api/dfe-sync',
       headers := '{"x-sync-secret": "SEU_SEGREDO"}'::jsonb,
       timeout_milliseconds := 55000) $$);
   ```
   Sem certificado a rotina responde "desligado" e não faz nada, então o agendamento pode ser criado antes.

### Como o certificado é protegido
- Fica na tabela `dfe_certificado`, **criptografado** pelo servidor. A chave de criptografia **não está no banco**:
  é derivada de `DFE_CHAVE_CRIPTOGRAFIA` (se você definir) ou da chave de serviço do Supabase. Quem só tem o banco não
  consegue abrir o certificado.
- Só o **diretor** (conferido no servidor pelo login) consegue enviar, ver a situação ou remover.
- Se a chave de serviço do Supabase for trocada e você não tiver definido `DFE_CHAVE_CRIPTOGRAFIA`, o certificado
  guardado deixa de abrir: a tela avisa e basta enviar o arquivo de novo. Para evitar isso, defina uma
  `DFE_CHAVE_CRIPTOGRAFIA` própria (texto longo e aleatório) **antes** de enviar o certificado e não a troque.

## Primeiro teste (nesta ordem)

Chame a rotina uma vez por SQL (com o seu segredo) e leia a resposta em `net._http_response`:

```sql
select net.http_get(
  url := 'https://faturamentomcit.vercel.app/api/dfe-sync?diagnostico=1',
  headers := '{"x-sync-secret": "SEU_SEGREDO"}'::jsonb, timeout_milliseconds := 55000);
-- depois: select status_code, left(content::text, 900) from net._http_response order by created desc limit 1;
```

1. **`?diagnostico=1`**: abre o certificado, mostra a origem (tela ou variável), o CNPJ dele, a validade e a lista de
   CNPJs que serão consultados. Não fala com a SEFAZ.
2. **Consulta sem ciência** (`/api/dfe-sync?ciencia=0`): traz os resumos. Confira a tabela `nfe_entrada`.
3. Com o aval da contabilidade, ligue `DFE_CIENCIA_AUTOMATICA=1` (ou chame uma vez com `?ciencia=1`). Na consulta
   seguinte (após o intervalo de 1 hora da SEFAZ) os XMLs completos passam a chegar.

## Decisão da contabilidade: Ciência da Operação
É um evento fiscal que informa à SEFAZ que a empresa tomou conhecimento da nota. **Não** confirma nem recusa a
operação, mas é o que libera o download do XML completo e fica registrado. A contabilidade precisa autorizar o
registro automático. Os eventos que **confirmam, desconhecem ou declaram a operação não realizada** (210200, 210220,
210240) **não** são enviados por esta rotina: ficam para a contabilidade decidir nota a nota.

## Limites e cuidados
- Só **A1** (arquivo). Certificado em cartão ou token (A3) não funciona em servidor.
- O certificado deve ser da empresa; para consultar o CNPJ de uma filial, ele precisa ser aceito pela SEFAZ para
  aquele CNPJ (em geral, mesma raiz de CNPJ). Se algum CNPJ der erro de autorização, o resultado aparece em
  `dfe_controle.ultima_mensagem` e na resposta da chamada.
- No primeiro carregamento a SEFAZ entrega só o que ainda mantém disponível (em geral cerca de 3 meses).
  Notas mais antigas entram por importação manual de XML.
- Cobre **NF-e (modelo 55)**. **CT-e** (frete) e **NFS-e** (serviços, municipal) são integrações à parte.
- **Vencimento do certificado:** a rotina recusa certificado vencido e avisa na resposta. Renove e envie o novo certificado pela tela
  (menu Certificado → Substituir certificado) antes da data.
- Consultas e erros ficam em `dfe_controle` (`ultimo_status`, `ultima_mensagem`, `erros_seguidos`).
- Status da SEFAZ mais comuns: `138` documentos localizados, `137` nenhum documento, `656` consumo indevido
  (bloqueio de cerca de 1 hora).
