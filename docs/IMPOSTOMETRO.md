# Impostômetro: créditos e débitos de impostos em tempo real (Lucro Presumido)

Tela do diretor em **Impostômetro** (`/dashboard/impostometro`). Mostra, mês a mês, quanto de imposto a empresa
tem a recolher, somando os **débitos** (notas que a empresa emite) e abatendo os **créditos** (notas emitidas contra a
empresa). Os valores vêm dos **XMLs das notas** e a tela se atualiza sozinha (a cada minuto e conforme as notas entram).

> **É uma estimativa para acompanhamento.** Não substitui a apuração oficial da contabilidade e não inclui IRPJ, CSLL,
> ICMS-ST, DIFAL nem créditos de ativo imobilizado.

## O que a tela mostra

| Cartão | Como é calculado |
|---|---|
| **ICMS** | Débito = ICMS destacado nas vendas (notas emitidas). Crédito = ICMS destacado nas compras cujo CFOP gera crédito. Devoluções reduzem o lado correspondente. Saldo = débito − crédito (a recolher ou saldo credor). |
| **IPI** | Mesma lógica do ICMS, para a importadora (equiparada a industrial). A contabilidade deve confirmar. |
| **PIS e COFINS** | **Cumulativos no Lucro Presumido: sem crédito nas compras.** Estimativa: 0,65% e 3% sobre a receita do mês (vendas que afetam o faturamento, sem cancelada nem transferência) **menos o ICMS**. |
| **CBS e IBS** | Informativo (2026 é ano de teste da reforma): soma o que o XML traz no grupo `IBSCBS`, como débito (vendas) e crédito (compras). Aparece vazio se as notas não trazem o grupo. |
| **Imposto a recolher estimado** | ICMS (só se a pagar) + IPI (só se a pagar) + PIS + COFINS. Saldo credor de um imposto não abate outro. |

Notas **canceladas** não entram. Só entram compras que já têm o **XML completo** (veja `docs/CAPTURA_NFE_ENTRADA.md`:
sem a Ciência da Operação a SEFAZ entrega só o resumo, que não traz os impostos).

## Filtros e totais
- **Período:** datas "De" e "Até", com setas de mês e atalhos (mês atual, dois meses anteriores, ano até hoje).
- **Operação:** Todas, Vendas (notas emitidas) ou Compras (notas recebidas).
- **CFOP:** código completo ou só o começo (ex.: `51` traz todos os 51xx).
- **Buscar nota:** número da nota, nome do cliente ou fornecedor, CNPJ ou chave de acesso.
- **Totais do filtro:** quadro com **Vendas, Compras e Total geral** (quantidade de notas, valor das notas e ICMS, IPI, PIS,
  COFINS, CBS e IBS destacados), mais o **imposto a recolher estimado**. Tudo recalcula com os filtros.
- **Lista de notas do filtro** (25 por página), com número, cliente ou fornecedor, CFOP, valor e impostos de cada nota, e
  **quanto ela pesa na conta**: `+` aumenta o imposto a pagar, `−` é crédito que abate. O rodapé traz o **total de todas as
  páginas** do filtro.
- A estimativa de **PIS e COFINS** usa a receita do período inteiro; por isso só aparece sem filtro de CFOP ou busca e fora
  de "só compras".

## Regras por CFOP
Cada CFOP entra na conta de ICMS e de IPI de um jeito:

| Efeito | Significa |
|---|---|
| Débito | soma no imposto a pagar |
| Crédito | soma no imposto a abater |
| Reduz débito | desfaz um débito (ex.: devolução de venda que voltou) |
| Reduz crédito | desfaz um crédito (ex.: devolução de compra que fizemos) |
| Fora da conta | não entra (ex.: uso e consumo, ativo imobilizado) |

- A migração já traz uma lista inicial (compra para revenda/industrialização e importação = crédito; devoluções = reduz
  débito/crédito; uso e consumo e ativo = fora). **A contabilidade deve revisar.**
- **CFOP sem regra:** venda entra como **débito**; compra fica **fora da conta** até alguém definir (a tela avisa quais).
- Na tabela "Detalhe por CFOP" o diretor muda o efeito de qualquer CFOP, e a tela recalcula na hora.

## Como funciona por dentro
1. **Leitura dos XMLs** (`api/impostometro.ts`): cada nota nova (as emitidas em `invoices.xml_raw` e as capturadas em
   `nfe_entrada.xml`) é lida uma vez; os impostos de cada item (ICMS, IPI, PIS, COFINS, CBS, IBS) ficam em
   `impostometro_itens`. A tela lê até 150 notas por chamada e repete até acabar; o "faltam N" some quando termina.
2. **Apuração do mês:** soma os itens do mês pelas regras de CFOP (`impostometro_regras`).
3. **Atualização:** cancelamento de nota é refletido automaticamente (a nota sai da conta).

## Configuração
1. Rode no SQL Editor, nesta ordem, `supabase/migrations/0094_impostometro.sql` e `supabase/migrations/0095_impostometro_filtros.sql`.
2. Nenhuma variável nova. Abra **Impostômetro** no menu do diretor; na primeira vez as notas antigas são lidas aos poucos.

## Próxima fase (calculadoras da Receita Federal)
Os repositórios `calculadora-rtc-regime-regular` (CBS/IBS/IS), `calculadora-rtc-simples-nacional` e
`calculadora-rtc-gerador-danfse` são APIs de cálculo (Java e Go) que precisam de um servidor próprio. Uso previsto:
projetar a CBS/IBS de 2027 em diante com as notas do mês, conferir os grupos de CBS/IBS dos XMLs emitidos e usar as tabelas
oficiais (cClassTrib, NCM). Fica para depois que esta fase estiver validada pela contabilidade.
