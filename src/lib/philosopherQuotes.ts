export interface PhilosopherQuote {
  text: string
  author: string
}

// Frases de filósofos, traduzidas — uma por dia, sem repetir por ~2 meses
// (ver getDailyQuote). Mantidas apenas atribuições amplamente reconhecidas.
export const PHILOSOPHER_QUOTES: PhilosopherQuote[] = [
  { text: 'Só sei que nada sei.', author: 'Sócrates' },
  { text: 'Uma vida sem exame não vale a pena ser vivida.', author: 'Sócrates' },
  { text: 'Conhece-te a ti mesmo.', author: 'Tales de Mileto' },
  { text: 'Somos aquilo que fazemos repetidamente. A excelência, então, não é um feito, mas um hábito.', author: 'Aristóteles' },
  { text: 'A raiz da educação é amarga, mas o fruto é doce.', author: 'Aristóteles' },
  { text: 'A coragem é saber o que não temer.', author: 'Platão' },
  { text: 'Seja gentil, pois todos que você encontra travam uma dura batalha.', author: 'Platão' },
  { text: 'Você tem poder sobre sua mente, não sobre os eventos externos. Perceba isso, e você encontrará força.', author: 'Marco Aurélio' },
  { text: 'A felicidade da sua vida depende da qualidade dos seus pensamentos.', author: 'Marco Aurélio' },
  { text: 'Não é porque as coisas são difíceis que não ousamos; é porque não ousamos que elas são difíceis.', author: 'Sêneca' },
  { text: 'Enquanto adiamos a vida, ela passa.', author: 'Sêneca' },
  { text: 'Não são as coisas que perturbam os homens, mas as opiniões que eles têm sobre as coisas.', author: 'Epicteto' },
  { text: 'Não busque que as coisas aconteçam como você deseja, mas deseje que elas aconteçam como acontecem.', author: 'Epicteto' },
  { text: 'Não importa o quão devagar você vá, desde que você não pare.', author: 'Confúcio' },
  { text: 'Escolha um trabalho que você ama e não terá que trabalhar um único dia da sua vida.', author: 'Confúcio' },
  { text: 'Uma jornada de mil quilômetros começa com um único passo.', author: 'Lao Tsé' },
  { text: 'A única constante na vida é a mudança.', author: 'Heráclito' },
  { text: 'Ninguém entra duas vezes no mesmo rio.', author: 'Heráclito' },
  { text: 'Penso, logo existo.', author: 'René Descartes' },
  { text: 'Não basta ter um bom espírito; o principal é aplicá-lo bem.', author: 'René Descartes' },
  { text: 'Tenha a coragem de usar teu próprio entendimento.', author: 'Immanuel Kant' },
  { text: 'Aja apenas segundo uma máxima tal que possas, ao mesmo tempo, querer que ela se torne lei universal.', author: 'Immanuel Kant' },
  { text: 'Aquele que tem um porquê para viver pode suportar quase qualquer como.', author: 'Friedrich Nietzsche' },
  { text: 'O que não me mata, me fortalece.', author: 'Friedrich Nietzsche' },
  { text: 'Não rir, não lamentar, nem detestar, mas compreender.', author: 'Baruch Spinoza' },
  { text: 'A felicidade não é a recompensa da virtude, mas a própria virtude.', author: 'Baruch Spinoza' },
  { text: 'O homem está condenado a ser livre.', author: 'Jean-Paul Sartre' },
  { text: 'No meio do inverno, aprendi que havia em mim um verão invencível.', author: 'Albert Camus' },
  { text: 'Temos tanto medo da opinião dos outros que sacrificamos nossa própria felicidade.', author: 'Arthur Schopenhauer' },
  { text: 'Educai as crianças e não será preciso punir os homens.', author: 'Pitágoras' },
  { text: 'Não é rico aquele que tem muito, mas aquele que precisa de pouco.', author: 'Diógenes de Sinope' },
  { text: 'A gratidão não é apenas a maior das virtudes, mas a mãe de todas as outras.', author: 'Cícero' },
  { text: 'O mundo é um livro, e aqueles que não viajam leem apenas uma página.', author: 'Santo Agostinho' },
  { text: 'O melhor é inimigo do bom.', author: 'Voltaire' },
  { text: 'O homem nasce livre, mas em toda parte encontra-se acorrentado.', author: 'Jean-Jacques Rousseau' },
  { text: 'A razão é, e deve ser apenas, escrava das paixões.', author: 'David Hume' },
  { text: 'A vida só pode ser compreendida olhando-se para trás, mas só pode ser vivida olhando-se para frente.', author: 'Søren Kierkegaard' },
  { text: 'A coruja de Minerva só levanta voo ao entardecer.', author: 'Georg W. F. Hegel' },
  { text: 'A pior maldade não é feita por vilões, mas por pessoas que nunca decidiram ser boas ou más.', author: 'Hannah Arendt' },
  { text: 'É melhor ser temido do que amado, se não se pode ser ambos.', author: 'Nicolau Maquiavel' },
  { text: 'Não é o jovem que deve ser considerado feliz, mas o velho que viveu bem.', author: 'Epicuro' },
  { text: 'O homem é a medida de todas as coisas.', author: 'Protágoras' },
  { text: 'O coração tem razões que a própria razão desconhece.', author: 'Blaise Pascal' },
  { text: 'O homem é uma cana pensante, a mais frágil da natureza, mas é uma cana que pensa.', author: 'Blaise Pascal' },
  { text: 'O valor da vida não está nos dias que passaram, mas no uso que fizemos deles.', author: 'Michel de Montaigne' },
]

export function getDailyQuote(): PhilosopherQuote {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24))
  return PHILOSOPHER_QUOTES[dayOfYear % PHILOSOPHER_QUOTES.length]
}
