# Apuração de IRPJ e CSLL (Lucro Presumido)

Tela **IRPJ e CSLL** (menu do diretor, `/dashboard/apuracao-irpj`). Monta a apuração trimestral no mesmo método da planilha da contabilidade ("PLANILHA IRPJ E CSLL"), com o que o sistema já sabe e campos para a contabilidade digitar o resto.

## Antes de usar

Rode no SQL Editor do Supabase, **um arquivo por vez e em ordem**: `0094`, `0095` (se ainda não rodou), `0096_apuracao_irpj_csll.sql` e, para a conta da contabilidade, `0097` e `0098` (veja "Quem acessa"). Depois do deploy, feche e abra o app.

A 0096 cria três tabelas (`contab_parametros`, `contab_lancamentos`, `contab_fechamentos`) e já deixa os parâmetros de 2026 com os valores da planilha.

## Como a tela funciona

1. Escolha o trimestre nas setas. Cada mês mostra uma coluna de valores.
2. Valores em **azul** vêm do sistema. Clique e digite para substituir: o valor digitado fica em **amarelo** e prevalece. Para voltar ao valor do sistema, apague o campo e saia dele.
3. Linhas que o sistema não sabe (descontos, ganho de capital, IRRF, JCP...) começam vazias: a contabilidade digita.
4. Os cartões do topo e os quadros "Cálculo do IRPJ", "Cálculo da CSLL" e "Pagamento em cotas" recalculam na hora.
5. **Exportar para Excel** gera um arquivo com as abas IRPJ, CSLL, Pagamento e Por filial.
6. **Guardar fechamento** grava uma foto do trimestre (valores, parâmetros e resultado) no histórico. Pode ser feito mais de uma vez; nada é apagado.

## De onde vem cada valor do sistema

| Linha | Origem |
| --- | --- |
| Receita de mercadorias | Notas do mês (valor total da nota, com IPI) que afetam o faturamento, exceto canceladas, transferências e as dos tipos Locação/Serviço. Demonstração fica de fora porque não afeta o faturamento. |
| Receita de serviços | Notas dos tipos **Locação** e **Serviço** lançadas no sistema. Se a NFS-e é emitida fora do sistema, digite o valor. |
| IPI | IPI destacado nos XMLs das notas de venda. |
| Devoluções de vendas | Notas de devolução de venda recebidas (CFOPs que a tela do Impostômetro marca como "reduz débito"), pelo valor total da nota, com XML completo. |
| IPI s/ devolução | IPI dos itens dessas notas de devolução. |
| Receitas financeiras | Juros cobrados dos clientes nos títulos quitados no mês (pela data de pagamento). Rendimentos bancários precisam ser somados e digitados. |

Quando há notas com XML ainda por ler, a tela avisa; atualize em alguns segundos.

## Regras de cálculo (editáveis em "Parâmetros do ano")

- **Receita presumida** = receita total − devoluções − descontos + IPI s/ devolução − IPI.
- Limite de **R$ 1.250.000 por trimestre**: o que passa dele usa percentuais maiores (mercadorias 8% → 8,8% no IRPJ e 12% → 13,2% na CSLL; serviços 32% → 35,2%).
- O rateio entre mercadorias e serviços é proporcional à receita presumida.
- **Base do IRPJ** = parte presumida + outras receitas (financeiras, ganho de capital, locação de imóvel, demais, bonificações) − recuperações, reversão de provisões, lucros/dividendos e JCP.
- **IRPJ** = 15% da base + adicional de 10% sobre o que passa de R$ 60.000 no trimestre − IRRF. Nunca negativo; se o IRRF passa do imposto, o excesso aparece como "saldo a compensar".
- **CSLL** = 9% da base da CSLL (mesma lógica, com 12%/13,2% para mercadorias).
- **Cotas**: o total (IRPJ + CSLL) pode ser pago em até 3 cotas de no mínimo R$ 1.000. A 1ª vence no último dia útil do mês seguinte ao trimestre; as demais, nos meses seguintes (com juros pela Selic, que a tela não calcula). Só fins de semana e feriados nacionais entram no cálculo do dia útil.

## Diferenças em relação à planilha

O cálculo foi conferido com a planilha: bate nos trimestres em que ela está preenchida por completo. Onde diverge, a causa está na planilha:

- A base do IRPJ da planilha não soma algumas linhas de "outras receitas" (linhas 22, 24 e 26 a 31); a tela soma todas.
- O adicional da planilha não tem piso em zero; a tela usa `max(base − 60.000, 0)`.
- No 1º trimestre a receita de serviços está digitada à mão na planilha e há células em branco na CSLL do 1º e do 4º trimestres.

## Quem acessa

- **Diretor**: tudo, pelo menu dele.
- **Contabilidade** (conta `contabilidade@mcistore.com.br`): entra direto no painel `/contabilidade`, com atalhos para **IRPJ e CSLL**, **Impostômetro** e **Notas de entrada**. Pode digitar valores, ajustar parâmetros, guardar fechamentos, ajustar regras de CFOP, exportar para Excel e baixar os XMLs das notas capturadas. **Não** vê faturamento, comissões, financeiro nem o certificado digital, e não pode buscar notas na SEFAZ nem registrar a Ciência da Operação (isso continua só com o diretor).

### Como ativar a conta da contabilidade

1. No Supabase, rode **sozinho** o `0097_papel_contabilidade.sql` (cria o papel).
2. Em Authentication → Users → Add user, crie o usuário `contabilidade@mcistore.com.br` com uma senha (marque "Auto Confirm User").
3. Rode, em execução separada, o `0098_contabilidade_acesso.sql`: ele libera a leitura das tabelas da apuração e já vincula a conta ao papel. Se o usuário ainda não existia, o arquivo só avisa; crie o usuário e rode de novo.
4. Entregue a senha à contabilidade por um canal seguro e peça para trocá-la no primeiro acesso.

## API (`/api/impostometro`)

- `GET ?recurso=irpj&ano=2026&trimestre=3`: valores do sistema por mês, valores digitados, parâmetros do ano, receita por filial e fechamentos.
- `POST { acao: "lancamento", ano, mes, linha, valor | null }`: digita (ou apaga, com `null`) um valor do mês.
- `POST { acao: "parametros", ano, parametros }`: grava limite, percentuais, alíquotas e cotas do ano.
- `POST { acao: "fechar", ano, trimestre, dados, irpjDevido, csllDevido, observacao }`: guarda o fechamento.
