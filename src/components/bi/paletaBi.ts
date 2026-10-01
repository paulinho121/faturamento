// Paleta categórica validada (contraste CVD/normal-vision ok em pares
// adjacentes — ver skill de dataviz) usada nos gráficos de BI. Ordem fixa,
// nunca ciclada: a 9ª série vira "Outros" em vez de gerar uma cor nova.
export const PALETA_BI = [
  '#2a78d6', // azul
  '#eb6834', // laranja
  '#1baf7a', // água
  '#eda100', // amarelo
  '#e87ba4', // magenta
  '#008300', // verde
  '#4a3aa7', // violeta
  '#e34948', // vermelho
]

export const COR_OUTROS = '#898781' // cinza neutro — nunca uma cor categórica

// Rampa sequencial (um hue só, claro -> escuro) pro mapa de faturamento por
// estado: magnitude, não identidade, então cor contínua numa única matiz —
// mesma matiz do teal de marca usado nos gráficos de série única. Lightness
// monotonicamente decrescente (88% -> 24%), checado com o validador da skill
// de dataviz (o validador em si é só pra paleta categórica).
export const RAMPA_SEQUENCIAL_TEAL = [
  '#d5ece9',
  '#97d8d0',
  '#35d4c2',
  '#18aa99',
  '#0c6e63',
]

export const COR_SEM_DADO = '#e7e5e1' // cinza claro neutro — estado sem faturamento no período
