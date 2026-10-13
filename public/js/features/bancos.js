/**
 * features/bancos.js — o conteúdo dos jogos de diversão: palavras para
 * desenhar, imitar e adivinhar, perguntas do quiz, personagens, dilemas e
 * categorias do Stop. Só dados, em português do Brasil, para toda idade e
 * para usar no trabalho sem constrangimento.
 *
 * Fica num arquivo à parte para crescer sem mexer na lógica, e é carregado
 * só quando alguém abre a mesa de jogos.
 */

/* ------------------------------------------------------------------ *
 * Palavras: Desenha e Adivinha, Forca e Palavras-código
 * ------------------------------------------------------------------ */

const lista = (texto) =>
  texto
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
/** Uma frase por linha (as frases podem ter vírgula). */
const linhas = (texto) =>
  texto
    .split("\n")
    .map((s) => s.trim().replace(/,$/, ""))
    .filter(Boolean);

/** Categoria -> palavras fáceis de desenhar (e de adivinhar). */
export const PALAVRAS = {
  Animal: lista(`cachorro, gato, peixe, pássaro, cobra, elefante, girafa, leão, macaco, tartaruga, coelho, cavalo, vaca,
    porco, galinha, pato, sapo, aranha, borboleta, abelha, formiga, polvo, tubarão, baleia, golfinho, pinguim, coruja,
    jacaré, camelo, zebra, urso, panda, rato, caracol, caranguejo, minhoca, morcego, papagaio, dinossauro, unicórnio,
    dragão, capivara, tucano, joaninha, canguru, foca, ovelha, esquilo, flamingo, lagosta, preguiça, bode, raposa`),
  Comida: lista(`pizza, hambúrguer, sorvete, bolo, banana, maçã, melancia, uva, abacaxi, morango, cenoura, milho, ovo,
    pão, queijo, sanduíche, pipoca, brigadeiro, coxinha, pastel, cachorro-quente, chocolate, pirulito, sushi, macarrão,
    batata frita, laranja, limão, cereja, coco, pera, tomate, cebola, pimenta, biscoito, rosquinha, pudim, picolé, açaí,
    melão, abacate, pão de queijo, panqueca, churrasco, salada`),
  Objeto: lista(`cadeira, mesa, cama, sofá, relógio, óculos, guarda-chuva, chave, tesoura, lápis, livro, celular,
    computador, televisão, câmera, violão, piano, microfone, fone de ouvido, lâmpada, vela, escova de dente, pente,
    espelho, garrafa, copo, xícara, garfo, colher, panela, geladeira, ventilador, mochila, carteira, anel, coroa,
    chapéu, boné, sapato, meia, camiseta, vestido, gravata, balão, pipa, bola, dado, presente, envelope, martelo,
    escada, vassoura, balde, regador, tijolo, ímã, bússola, mapa, âncora, troféu, medalha, robô, ampulheta, cadeado,
    sino, tambor, trompete, controle remoto, teclado, mouse, impressora, tênis, luva, cachecol, travesseiro, pincel,
    bateria, megafone, binóculo, lupa, carrinho de bebê, ioiô, patins, apito, cofrinho`),
  Lugar: lista(`casa, castelo, igreja, escola, hospital, praia, montanha, vulcão, ilha, cachoeira, rio, floresta,
    deserto, ponte, farol, circo, fazenda, iglu, pirâmide, torre, parque, estádio, piscina, cinema, biblioteca,
    padaria, aeroporto, zoológico, supermercado, prisão`),
  Natureza: lista(`sol, lua, estrela, nuvem, chuva, arco-íris, raio, neve, árvore, flor, cacto, folha, cogumelo,
    fogo, onda, planeta, cometa, tornado, girassol, coqueiro, pedra, terremoto, eclipse`),
  Transporte: lista(`carro, ônibus, avião, helicóptero, bicicleta, moto, navio, barco, trem, submarino, foguete, skate,
    patinete, trator, ambulância, caminhão, balão de ar quente, disco voador, metrô, canoa, carroça, teleférico`),
  Corpo: lista(`olho, nariz, boca, orelha, mão, pé, dente, coração, cérebro, osso, cabelo, bigode, barba, unha,
    joelho, umbigo, sobrancelha, língua`),
  Profissão: lista(`médico, bombeiro, policial, cozinheiro, professor, astronauta, pirata, palhaço, mágico, pintor,
    pescador, dentista, jardineiro, carteiro, detetive, cientista, músico, fotógrafo, piloto, goleiro, enfermeira,
    padeiro, mecânico, salva-vidas`),
  Esporte: lista(`futebol, basquete, vôlei, natação, tênis de mesa, surfe, boxe, xadrez, golfe, karatê, ciclismo,
    boliche, esqui, corrida, ginástica, judô, pesca`),
};

/** Para a Mímica: coisas divertidas de imitar sem falar. */
export const MIMICAS = {
  Ação: lista(`escovar os dentes, tomar banho, dirigir, nadar, dançar, cozinhar, pescar, dormir, espirrar, chorar,
    pular corda, andar de bicicleta, tocar violão, tocar bateria, jogar futebol, jogar boliche, surfar, esquiar,
    pintar uma parede, lavar louça, passar roupa, trocar uma lâmpada, tirar uma selfie, fazer yoga, levantar peso,
    remar, escalar, andar na corda bamba, fazer malabarismo, mergulhar, regar as plantas, fazer um bolo,
    comer espaguete, beber com canudo, mascar chiclete, soprar as velinhas, encher um balão, abrir um presente,
    pegar um táxi, esperar o ônibus, varrer a casa, pentear o cabelo, se maquiar, fazer a barba, amarrar o sapato,
    vestir uma calça apertada, andar na chuva, escorregar numa casca de banana, ser picado por um mosquito,
    ver um filme de terror, torcer no estádio, fazer churrasco, cortar cebola, abrir um pote difícil,
    carregar compras pesadas, soltar pipa, montar um móvel, falar com o microfone mudo, perder o ônibus,
    procurar o controle remoto, pisar num lego, acordar atrasado, tirar o celular da piscina`),
  Personagem: lista(`Super-Homem, Homem-Aranha, Tarzan, zumbi, vampiro, robô, múmia, pirata, ninja, bailarina,
    mágico, palhaço, astronauta, caubói, rei, fantasma, sereia, maestro, goleiro, garçom, bombeiro, cabeleireiro,
    guarda de trânsito, estátua viva, chef de cozinha, Chaves, Saci-Pererê, Papai Noel, super-herói voando`),
  Animal: lista(`macaco, galinha, elefante, cobra, canguru, pinguim, caranguejo, gato, cachorro, sapo, flamingo,
    gorila, cavalo, polvo, tartaruga, preguiça, galo, foca, coelho, urso`),
  Filme: lista(`Titanic, O Rei Leão, Homem-Aranha, Tubarão, Harry Potter, Star Wars, Frozen, Procurando Nemo, Shrek,
    Matrix, Toy Story, Jurassic Park, Karatê Kid, O Mágico de Oz, Piratas do Caribe, Rocky, E.T., Os Incríveis,
    Up: Altas Aventuras, Divertida Mente`),
};

/* ------------------------------------------------------------------ *
 * Quiz: conhecimentos gerais, com o Brasil no meio
 *
 * `c` é a posição da resposta certa em `o`; a ordem das opções é
 * embaralhada na hora de jogar.
 * ------------------------------------------------------------------ */

const q = (t, pergunta, opcoes) => ({ t, q: pergunta, o: opcoes, c: 0 });

export const TEMAS_QUIZ = {
  brasil: "Brasil",
  geografia: "Geografia",
  ciencia: "Ciência e natureza",
  historia: "História",
  esportes: "Esportes",
  cultura: "Filmes, música e desenhos",
  tecnologia: "Tecnologia",
  cotidiano: "Comida e cotidiano",
};

// A certa vem sempre primeiro aqui (c: 0); o jogo embaralha.
export const QUIZ = [
  q("brasil", "Qual é a capital do Brasil?", ["Brasília", "Rio de Janeiro", "São Paulo", "Salvador"]),
  q("brasil", "Quantos estados tem o Brasil, sem contar o Distrito Federal?", ["26", "27", "25", "24"]),
  q("brasil", "Em que ano a frota de Pedro Álvares Cabral chegou ao Brasil?", ["1500", "1492", "1822", "1530"]),
  q("brasil", "Quem proclamou a independência do Brasil em 1822?", ["Dom Pedro I", "Dom Pedro II", "Tiradentes", "Deodoro da Fonseca"]),
  q("brasil", "Qual é o maior estado brasileiro em área?", ["Amazonas", "Pará", "Mato Grosso", "Minas Gerais"]),
  q("brasil", "Quantas Copas do Mundo masculinas o Brasil já ganhou?", ["5", "4", "6", "3"]),
  q("brasil", "Qual cidade sediou as Olimpíadas de 2016?", ["Rio de Janeiro", "Londres", "Tóquio", "Pequim"]),
  q("brasil", "Em que ano começou a circular o Real, a moeda atual do Brasil?", ["1994", "1990", "1986", "2000"]),
  q("brasil", "Qual é a capital da Bahia?", ["Salvador", "Recife", "Feira de Santana", "Ilhéus"]),
  q("brasil", "Qual é o ponto mais alto do Brasil?", ["Pico da Neblina", "Pico da Bandeira", "Monte Roraima", "Pico das Agulhas Negras"]),
  q("brasil", "Qual bioma ocupa a maior parte do território brasileiro?", ["Amazônia", "Cerrado", "Mata Atlântica", "Caatinga"]),
  q("brasil", "Em qual morro fica o Cristo Redentor?", ["Corcovado", "Pão de Açúcar", "Morro Dois Irmãos", "Morro da Urca"]),
  q("brasil", "Quem foi o primeiro presidente do Brasil?", ["Deodoro da Fonseca", "Floriano Peixoto", "Getúlio Vargas", "Prudente de Morais"]),
  q("brasil", "Em que ano foi assinada a Lei Áurea?", ["1888", "1822", "1889", "1871"]),
  q("brasil", "Qual cidade era a capital do Brasil antes de Brasília?", ["Rio de Janeiro", "Salvador", "São Paulo", "Belo Horizonte"]),
  q("brasil", "Em que ano Brasília foi inaugurada?", ["1960", "1955", "1964", "1950"]),
  q("brasil", "Quem é chamado de pai da aviação no Brasil?", ["Santos Dumont", "Bartolomeu de Gusmão", "Oswaldo Cruz", "Rui Barbosa"]),
  q("brasil", "Quem escreveu “Dom Casmurro”?", ["Machado de Assis", "José de Alencar", "Jorge Amado", "Clarice Lispector"]),
  q("brasil", "Quem pintou o “Abaporu”?", ["Tarsila do Amaral", "Anita Malfatti", "Di Cavalcanti", "Candido Portinari"]),
  q("brasil", "Quem criou a Turma da Mônica?", ["Mauricio de Sousa", "Ziraldo", "Monteiro Lobato", "Laerte"]),

  q("geografia", "Qual é o maior oceano do planeta?", ["Pacífico", "Atlântico", "Índico", "Ártico"]),
  q("geografia", "Qual é o maior país do mundo em área?", ["Rússia", "Canadá", "China", "Estados Unidos"]),
  q("geografia", "Qual é a capital da Austrália?", ["Camberra", "Sydney", "Melbourne", "Perth"]),
  q("geografia", "Qual é a capital do Canadá?", ["Ottawa", "Toronto", "Montreal", "Vancouver"]),
  q("geografia", "Qual é a montanha mais alta do mundo?", ["Everest", "K2", "Aconcágua", "Kilimanjaro"]),
  q("geografia", "Qual é o maior deserto quente do mundo?", ["Saara", "Gobi", "Atacama", "Kalahari"]),
  q("geografia", "Qual rio tem o maior volume de água do mundo?", ["Amazonas", "Nilo", "Mississippi", "Yangtzé"]),
  q("geografia", "Que país tem o formato de uma bota?", ["Itália", "Portugal", "Grécia", "Chile"]),
  q("geografia", "Em que país fica Machu Picchu?", ["Peru", "Bolívia", "México", "Chile"]),
  q("geografia", "Em que país ficam as pirâmides de Gizé?", ["Egito", "México", "Marrocos", "Peru"]),
  q("geografia", "Qual é a capital de Portugal?", ["Lisboa", "Porto", "Coimbra", "Braga"]),
  q("geografia", "Qual é a capital do Japão?", ["Tóquio", "Osaka", "Kyoto", "Seul"]),
  q("geografia", "Qual é a língua oficial do México?", ["Espanhol", "Português", "Inglês", "Francês"]),
  q("geografia", "Em que cidade fica a Torre Eiffel?", ["Paris", "Londres", "Roma", "Bruxelas"]),
  q("geografia", "Qual país passou a China e virou o mais populoso do mundo em 2023?", ["Índia", "Estados Unidos", "Indonésia", "Nigéria"]),
  q("geografia", "Qual é a capital da Argentina?", ["Buenos Aires", "Córdoba", "Montevidéu", "Rosário"]),

  q("ciencia", "Qual é o planeta mais próximo do Sol?", ["Mercúrio", "Vênus", "Marte", "Terra"]),
  q("ciencia", "Qual é o maior planeta do Sistema Solar?", ["Júpiter", "Saturno", "Netuno", "Terra"]),
  q("ciencia", "Qual planeta é chamado de planeta vermelho?", ["Marte", "Vênus", "Júpiter", "Mercúrio"]),
  q("ciencia", "Qual é a fórmula química da água?", ["H₂O", "CO₂", "O₂", "NaCl"]),
  q("ciencia", "Que gás as plantas absorvem do ar para fazer fotossíntese?", ["Gás carbônico", "Oxigênio", "Nitrogênio", "Hélio"]),
  q("ciencia", "Quantos ossos tem o corpo de um adulto?", ["206", "186", "226", "300"]),
  q("ciencia", "Qual é o maior órgão do corpo humano?", ["A pele", "O fígado", "O intestino", "O pulmão"]),
  q("ciencia", "Quem formulou a teoria da relatividade?", ["Albert Einstein", "Isaac Newton", "Galileu Galilei", "Nikola Tesla"]),
  q("ciencia", "Qual é o símbolo químico do ouro?", ["Au", "Ag", "Or", "Go"]),
  q("ciencia", "Qual é o maior mamífero do mundo?", ["Baleia-azul", "Elefante-africano", "Girafa", "Tubarão-baleia"]),
  q("ciencia", "Qual é o animal terrestre mais rápido?", ["Guepardo", "Leão", "Cavalo", "Antílope"]),
  q("ciencia", "A quantos graus Celsius a água ferve ao nível do mar?", ["100", "90", "120", "80"]),
  q("ciencia", "Quantas patas tem uma aranha?", ["8", "6", "10", "12"]),
  q("ciencia", "Que vitamina o corpo produz com a luz do sol?", ["Vitamina D", "Vitamina C", "Vitamina A", "Vitamina B12"]),
  q("ciencia", "Qual é o osso mais longo do corpo humano?", ["Fêmur", "Úmero", "Tíbia", "Coluna"]),
  q("ciencia", "Quantos planetas tem o Sistema Solar?", ["8", "9", "7", "10"]),
  q("ciencia", "Qual metal é líquido na temperatura ambiente?", ["Mercúrio", "Chumbo", "Alumínio", "Estanho"]),
  q("ciencia", "Quantos cromossomos tem uma célula humana comum?", ["46", "23", "48", "44"]),
  q("ciencia", "Qual é a velocidade aproximada da luz?", ["300 mil km por segundo", "30 mil km por segundo", "3 mil km por segundo", "3 milhões de km por segundo"]),
  q("ciencia", "Quem descobriu a penicilina?", ["Alexander Fleming", "Louis Pasteur", "Marie Curie", "Oswaldo Cruz"]),

  q("historia", "Quem pintou a Mona Lisa?", ["Leonardo da Vinci", "Michelangelo", "Rafael", "Van Gogh"]),
  q("historia", "Em que ano o ser humano pisou na Lua pela primeira vez?", ["1969", "1965", "1972", "1959"]),
  q("historia", "Quem foi o primeiro homem a pisar na Lua?", ["Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Michael Collins"]),
  q("historia", "Em que ano começou a Segunda Guerra Mundial?", ["1939", "1914", "1945", "1929"]),
  q("historia", "Qual civilização construiu Machu Picchu?", ["Os incas", "Os maias", "Os astecas", "Os romanos"]),
  q("historia", "Que muro caiu em 1989?", ["O Muro de Berlim", "A Muralha da China", "O Muro de Adriano", "O Muro das Lamentações"]),
  q("historia", "Quem chegou à América em 1492?", ["Cristóvão Colombo", "Vasco da Gama", "Fernão de Magalhães", "Américo Vespúcio"]),
  q("historia", "Em que ano foi proclamada a República no Brasil?", ["1889", "1822", "1888", "1891"]),
  q("historia", "Qual povo antigo construiu o Coliseu?", ["Os romanos", "Os gregos", "Os egípcios", "Os persas"]),
  q("historia", "Quem foi o inconfidente mineiro enforcado em 1792?", ["Tiradentes", "Zumbi dos Palmares", "Frei Caneca", "Bento Gonçalves"]),

  q("esportes", "Quantos jogadores de cada time ficam em campo no futebol?", ["11", "10", "9", "12"]),
  q("esportes", "Quem é conhecido como o Rei do Futebol?", ["Pelé", "Garrincha", "Maradona", "Zico"]),
  q("esportes", "Quantas vezes Ayrton Senna foi campeão mundial de Fórmula 1?", ["3", "2", "4", "5"]),
  q("esportes", "Em que país nasceram os Jogos Olímpicos?", ["Grécia", "Itália", "França", "Egito"]),
  q("esportes", "De quantos em quantos anos acontece a Copa do Mundo de futebol?", ["4", "2", "3", "5"]),
  q("esportes", "Que seleção ganhou a Copa do Mundo de 2022?", ["Argentina", "França", "Brasil", "Croácia"]),
  q("esportes", "Quantos anéis tem a bandeira olímpica?", ["5", "4", "6", "7"]),
  q("esportes", "Em que esporte se usa taco e se mira num buraco?", ["Golfe", "Hóquei", "Beisebol", "Críquete"]),
  q("esportes", "Quanto dura o tempo normal de um jogo de futebol?", ["90 minutos", "80 minutos", "100 minutos", "60 minutos"]),
  q("esportes", "Marta, seis vezes eleita a melhor do mundo, joga qual esporte?", ["Futebol", "Vôlei", "Basquete", "Handebol"]),
  q("esportes", "Quantos pontos vale a cesta de longe, além da linha, no basquete?", ["3", "2", "4", "1"]),
  q("esportes", "Quantos sets um time precisa vencer para ganhar uma partida de vôlei?", ["3", "2", "4", "5"]),

  q("cultura", "Qual é o nome do leãozinho de “O Rei Leão”?", ["Simba", "Mufasa", "Scar", "Nala"]),
  q("cultura", "Qual é o nome da escola de magia de Harry Potter?", ["Hogwarts", "Nárnia", "Durmstrang", "Beauxbatons"]),
  q("cultura", "Que personagem diz “Ao infinito e além!”?", ["Buzz Lightyear", "Woody", "Wall-E", "Relâmpago McQueen"]),
  q("cultura", "Quantos são os anões da Branca de Neve?", ["7", "5", "6", "8"]),
  q("cultura", "Qual é a cor do Hulk?", ["Verde", "Azul", "Roxo", "Vermelho"]),
  q("cultura", "Que banda gravou “Hey Jude”?", ["The Beatles", "Rolling Stones", "Queen", "Pink Floyd"]),
  q("cultura", "Quem é chamado de Rei do Pop?", ["Michael Jackson", "Elvis Presley", "Prince", "Freddie Mercury"]),
  q("cultura", "Em que o Chaves costuma se esconder?", ["Num barril", "Numa caixa", "Num armário", "Debaixo da escada"]),
  q("cultura", "O que o Popeye come para ficar forte?", ["Espinafre", "Brócolis", "Cenoura", "Feijão"]),
  q("cultura", "Como se chama o cachorro do Cebolinha?", ["Floquinho", "Bidu", "Monicão", "Rex"]),
  q("cultura", "Qual é o nome da boneca de pano do Sítio do Picapau Amarelo?", ["Emília", "Narizinho", "Cuca", "Dona Benta"]),
  q("cultura", "Quem compôs “Garota de Ipanema” com Vinicius de Moraes?", ["Tom Jobim", "Chico Buarque", "Caetano Veloso", "Gilberto Gil"]),
  q("cultura", "Que boneco de madeira tem o nariz que cresce quando mente?", ["Pinóquio", "Gepeto", "Pequeno Polegar", "João e Maria"]),
  q("cultura", "Qual super-herói é o Homem-Morcego?", ["Batman", "Superman", "Lanterna Verde", "Flash"]),
  q("cultura", "Em “Procurando Nemo”, que tipo de peixe é o Nemo?", ["Peixe-palhaço", "Peixe-cirurgião", "Baiacu", "Tubarão"]),
  q("cultura", "Qual é o nome do boneco de neve de “Frozen”?", ["Olaf", "Sven", "Kristoff", "Hans"]),

  q("tecnologia", "O que significa “www” num endereço da internet?", ["World Wide Web", "Web World Wide", "Wide Web World", "World Web Window"]),
  q("tecnologia", "Quem fundou a Microsoft junto com Paul Allen?", ["Bill Gates", "Steve Jobs", "Mark Zuckerberg", "Larry Page"]),
  q("tecnologia", "Que empresa criou o iPhone?", ["Apple", "Samsung", "Google", "Nokia"]),
  q("tecnologia", "Em que ano foi lançado o primeiro iPhone?", ["2007", "2005", "2009", "2010"]),
  q("tecnologia", "Quantos bits tem um byte?", ["8", "4", "16", "10"]),
  q("tecnologia", "Que empresa é dona do WhatsApp?", ["Meta", "Google", "Microsoft", "Apple"]),
  q("tecnologia", "Quem criou o Linux?", ["Linus Torvalds", "Richard Stallman", "Bill Gates", "Tim Berners-Lee"]),
  q("tecnologia", "Em que ano o Google foi fundado?", ["1998", "2001", "1995", "2004"]),
  q("tecnologia", "Qual atalho copia um texto na maioria dos programas?", ["Ctrl + C", "Ctrl + V", "Ctrl + X", "Ctrl + Z"]),
  q("tecnologia", "O que significa CPU?", ["Unidade central de processamento", "Computador pessoal único", "Central de programas úteis", "Placa de uso central"]),
  q("tecnologia", "HTML é uma linguagem de…", ["Marcação", "Banco de dados", "Programação de robôs", "Planilhas"]),
  q("tecnologia", "Qual linguagem de programação foi criada por Guido van Rossum?", ["Python", "Java", "Ruby", "C"]),

  q("cotidiano", "Qual é o ingrediente principal do guacamole?", ["Abacate", "Tomate", "Pimentão", "Feijão"]),
  q("cotidiano", "De que estado é típico o pão de queijo?", ["Minas Gerais", "Bahia", "Goiás", "Rio Grande do Sul"]),
  q("cotidiano", "De que região do Brasil vem o açaí?", ["Norte", "Sul", "Sudeste", "Centro-Oeste"]),
  q("cotidiano", "A feijoada tradicional é feita com feijão de que cor?", ["Preto", "Carioca", "Branco", "Vermelho"]),
  q("cotidiano", "Que bebida leva cachaça, limão, açúcar e gelo?", ["Caipirinha", "Batida", "Quentão", "Mojito"]),
  q("cotidiano", "O sushi é um prato de que país?", ["Japão", "China", "Coreia do Sul", "Tailândia"]),
  q("cotidiano", "Quantos minutos tem um dia?", ["1.440", "1.200", "2.400", "1.000"]),
  q("cotidiano", "Quantos lados tem um hexágono?", ["6", "5", "7", "8"]),
  q("cotidiano", "Quanto é 7 × 8?", ["56", "54", "48", "64"]),
  q("cotidiano", "Quantos dias tem um ano bissexto?", ["366", "365", "364", "360"]),
  q("cotidiano", "Qual é a raiz quadrada de 144?", ["12", "14", "11", "16"]),
  q("cotidiano", "Quantos segundos tem uma hora?", ["3.600", "360", "6.000", "1.800"]),
  q("cotidiano", "De que país vem a pizza?", ["Itália", "Estados Unidos", "França", "Grécia"]),
];

/* ------------------------------------------------------------------ *
 * Quem sou eu?
 * ------------------------------------------------------------------ */

export const PERSONAGENS = {
  Famosos: lista(`Pelé, Ayrton Senna, Xuxa, Silvio Santos, Anitta, Neymar, Ivete Sangalo, Gisele Bündchen, Roberto Carlos,
    Marta, Albert Einstein, Leonardo da Vinci, Cleópatra, Napoleão, Tiradentes, Dom Pedro I, Santos Dumont,
    Frida Kahlo, Michael Jackson, Beyoncé, Taylor Swift, Lionel Messi, Cristiano Ronaldo, Gilberto Gil,
    Fernanda Montenegro, Rebeca Andrade, Ronaldinho Gaúcho, Elvis Presley, Charles Chaplin, Shakespeare`),
  Personagens: lista(`Mônica, Cebolinha, Cascão, Magali, Chaves, Chapolin, Seu Madruga, Bob Esponja, Patrick Estrela,
    Shrek, Harry Potter, Hermione, Darth Vader, Yoda, Homem-Aranha, Batman, Mulher-Maravilha, Super-Homem, Hulk,
    Pikachu, Mario, Sonic, Mickey Mouse, Pato Donald, Elsa, Olaf, Simba, Nemo, Dory, Woody, Buzz Lightyear,
    Scooby-Doo, Pica-Pau, Homer Simpson, Pinóquio, Saci-Pererê, Curupira, Emília, Papai Noel, Fada do Dente,
    Sherlock Holmes, Chapeuzinho Vermelho, Lobo Mau, Cinderela, Branca de Neve, Rapunzel, Peter Pan,
    Capitão Gancho, Aladdin, Gênio da Lâmpada, Bela Adormecida, Minion, Stitch, Garfield, Snoopy`),
  Animais: lista(`leão, girafa, pinguim, tubarão, elefante, polvo, preguiça, capivara, tucano, mico-leão-dourado,
    jacaré, panda, unicórnio, dragão, coruja, camaleão, canguru, flamingo, tartaruga, golfinho, baleia, cavalo,
    papagaio, abelha, borboleta, formiga, dinossauro, lobo, raposa, coala`),
  Objetos: lista(`geladeira, guarda-chuva, celular, escova de dente, travesseiro, liquidificador, bicicleta, vassoura,
    controle remoto, relógio, lâmpada, mochila, panela de pressão, micro-ondas, chinelo, espelho, violão, cadeira,
    óculos, televisão`),
};

/* ------------------------------------------------------------------ *
 * Roda de perguntas: O que você prefere?, Eu nunca…, Quem da call…,
 * e perguntas para quebrar o gelo.
 * ------------------------------------------------------------------ */

const par = (a, b) => [a, b];

export const PREFERE = [
  par("Poder voar", "Ficar invisível"),
  par("Nunca mais tomar café", "Nunca mais comer chocolate"),
  par("Trabalhar de casa para sempre", "Escritório com almoço e café pagos"),
  par("Viajar para o passado", "Viajar para o futuro"),
  par("Praia", "Montanha"),
  par("Falar todas as línguas do mundo", "Tocar qualquer instrumento"),
  par("Uma reunião de duas horas", "Cem e-mails para responder"),
  par("Ler mentes", "Prever o futuro"),
  par("Um mês sem internet", "Um verão sem ventilador nem ar-condicionado"),
  par("Ser o melhor do mundo em algo inútil", "Ser mais ou menos em tudo"),
  par("Cachorro", "Gato"),
  par("Pizza para o resto da vida", "Hambúrguer para o resto da vida"),
  par("Acordar às 5 da manhã", "Dormir às 2 da madrugada"),
  par("Um botão de pausar a vida", "Um botão de voltar no tempo"),
  par("Calor de 40 °C", "Frio de 0 °C"),
  par("Ser famoso", "Ser rico e anônimo"),
  par("Um carro voador", "Teletransporte"),
  par("Saber o final de todo filme antes de ver", "Nunca ver o final de nenhuma série"),
  par("Só poder sussurrar", "Só poder gritar"),
  par("Só comer doce", "Só comer salgado"),
  par("Um dragão de estimação", "Um unicórnio de estimação"),
  par("Ir ao show da sua banda favorita", "Jantar com o seu ídolo"),
  par("Morar numa casa na árvore", "Morar num barco"),
  par("Celular sempre com 100% de bateria", "Wi-Fi perfeito em qualquer lugar"),
  par("Câmera sempre ligada nas reuniões", "Microfone sempre ligado nas reuniões"),
  par("Férias de um mês uma vez por ano", "Fim de semana de três dias para sempre"),
  par("Ser um super-herói", "Ser um vilão que sempre vence"),
  par("Cozinhar qualquer prato do mundo", "Ter um chef em casa"),
  par("Conversar com os animais", "Falar com plantas e fazê-las crescer"),
  par("Ter uma memória perfeita", "Conseguir esquecer o que quiser"),
  par("Morar na cidade grande", "Morar no interior"),
  par("Ver o nascer do sol", "Ver o pôr do sol"),
  par("Livro", "Filme"),
  par("Viajar sozinho", "Viajar com um grupo grande"),
  par("Ganhar uma viagem para o espaço", "Ganhar uma volta ao mundo"),
  par("Ter o dia com 30 horas", "Ter a semana com 4 dias de trabalho"),
  par("Nunca mais pegar fila", "Nunca mais pegar trânsito"),
  par("Ser o mais engraçado da turma", "Ser o mais inteligente da turma"),
  par("Ter um robô que limpa a casa", "Ter um robô que cozinha"),
  par("Só ouvir uma música para sempre", "Nunca mais ouvir música"),
];

export const EU_NUNCA = linhas(`Eu nunca dormi durante uma reunião online.,
  Eu nunca falei um tempão com o microfone mudo sem perceber.,
  Eu nunca fingi que a internet caiu para sair de uma ligação.,
  Eu nunca mandei mensagem para a pessoa errada.,
  Eu nunca esqueci o nome de alguém logo depois de ser apresentado.,
  Eu nunca andei de avião.,
  Eu nunca comi sushi.,
  Eu nunca cantei no chuveiro.,
  Eu nunca chorei vendo desenho animado.,
  Eu nunca procurei o celular enquanto falava nele.,
  Eu nunca usei pijama da cintura para baixo numa reunião.,
  Eu nunca quebrei um osso.,
  Eu nunca maratonei uma série inteira em um fim de semana.,
  Eu nunca ri numa hora em que não podia.,
  Eu nunca publiquei uma mudança na sexta-feira à tarde.,
  Eu nunca apaguei um arquivo importante sem querer.,
  Eu nunca disse “tô chegando” ainda em casa.,
  Eu nunca fiquei preso num elevador.,
  Eu nunca acampei.,
  Eu nunca ganhei um sorteio.,
  Eu nunca andei a cavalo.,
  Eu nunca saí de casa com a roupa do avesso.,
  Eu nunca esqueci o aniversário de alguém próximo.,
  Eu nunca tropecei em público.,
  Eu nunca cliquei em “responder a todos” sem querer.,
  Eu nunca vi neve.,
  Eu nunca comi algo que caiu no chão.,
  Eu nunca dei um nome para uma planta.,
  Eu nunca falei sozinho em voz alta na rua.,
  Eu nunca fui a um show.,
  Eu nunca perdi um voo ou um ônibus de viagem.,
  Eu nunca aprendi a nadar.,
  Eu nunca mandei um áudio de mais de cinco minutos.,
  Eu nunca fiz tatuagem.,
  Eu nunca pintei o cabelo de uma cor maluca.,
  Eu nunca liguei a câmera sem saber que ela estava ligada.`);

export const QUEM_DA_CALL = linhas(`chegar atrasado numa reunião,
  sobreviver a um apocalipse zumbi,
  ficar famoso na internet,
  esquecer o microfone ligado,
  ganhar na loteria e continuar trabalhando,
  ser o primeiro a responder no grupo,
  ter cem abas abertas agora,
  dormir no meio do filme,
  adotar mais um bicho de estimação,
  se mudar para o outro lado do mundo de repente,
  rir na hora errada,
  ter o melhor gosto musical,
  cozinhar o melhor jantar,
  se perder mesmo usando GPS,
  virar presidente,
  saber a resposta de qualquer pergunta,
  entrar num reality show,
  abrir o próprio negócio,
  comer a última fatia de pizza,
  mandar áudio de cinco minutos,
  esquecer a senha do computador,
  ganhar o Stop,
  ter mais plantas em casa,
  responder e-mail às duas da manhã,
  virar a noite jogando,
  chorar no final do filme,
  organizar a próxima festa,
  conhecer todos os países do mundo`);

export const QUEBRA_GELO = linhas(`Qual foi a melhor viagem da sua vida?,
  Que superpoder você escolheria?,
  Qual é o seu prato favorito?,
  Se pudesse jantar com qualquer pessoa, quem seria?,
  Que música não sai da sua cabeça ultimamente?,
  Qual foi o seu primeiro trabalho?,
  Que série você recomendaria para todo mundo?,
  Qual é a sua mania mais estranha?,
  Se ganhasse na loteria, qual seria a primeira coisa que faria?,
  O que você queria ser quando era criança?,
  Qual é o seu talento escondido?,
  Que aplicativo você mais usa no celular?,
  Que livro marcou a sua vida?,
  Qual foi a melhor coisa que aconteceu com você nesta semana?,
  Qual foi o maior mico que você já pagou?,
  Se pudesse morar em outro país, qual seria?,
  Qual é o filme que você vê de novo quando está pra baixo?,
  Que habilidade você gostaria de aprender?,
  Qual era a sua comida favorita na infância?,
  Café ou chá? E por quê?,
  Qual foi o melhor conselho que você já recebeu?,
  Qual emoji você mais usa?,
  Que personagem de desenho você seria?,
  Qual é o seu lugar favorito na sua cidade?,
  Você funciona melhor de manhã ou de noite?,
  Qual foi o último show ou evento que você foi?,
  Qual é a coisa mais útil que você aprendeu na internet?,
  Se a sua vida fosse um filme, qual seria o título?,
  Que cheiro te lembra a infância?,
  Qual foi a última coisa que te fez rir muito?,
  Que mania de colega de trabalho você acha engraçada?,
  Qual objeto da sua mesa tem uma história?`);

/* ------------------------------------------------------------------ *
 * Stop (Adedonha)
 * ------------------------------------------------------------------ */

export const CATEGORIAS_STOP = {
  nome: "Nome",
  animal: "Animal",
  cor: "Cor",
  fruta: "Fruta, verdura ou legume",
  lugar: "Cidade, estado ou país",
  objeto: "Objeto",
  profissao: "Profissão",
  marca: "Marca",
  filme: "Filme ou série",
  comida: "Comida",
  corpo: "Parte do corpo",
  sogra: "Minha sogra é…",
  time: "Time de futebol",
  esporte: "Esporte",
  musica: "Cantor ou banda",
  personagem: "Personagem",
  bebida: "Bebida",
  veiculo: "Carro ou veículo",
  ingles: "Palavra em inglês",
  app: "App ou site",
  planta: "Flor ou planta",
  desenho: "Desenho animado",
  verbo: "Verbo",
  cozinha: "Coisa da cozinha",
};
export const STOP_PADRAO = ["nome", "animal", "cor", "fruta", "lugar", "objeto", "sogra"];
/** As letras de sempre: sem K, Q, W, X, Y e Z, que travam o jogo. */
export const LETRAS_STOP = "ABCDEFGHIJLMNOPRSTUV";

/* ------------------------------------------------------------------ *
 * Jogo da memória: pares de ícones do sprite do app (Lucide)
 * ------------------------------------------------------------------ */

export const CARTAS_MEMORIA = lista(`cat, dog, fish, bird, rabbit, turtle, snail, bug, squirrel, panda, apple, cherry,
  grape, banana, pizza, cake, ice-cream-cone, cookie, carrot, croissant, rocket, plane, car, bike, anchor, umbrella,
  sun, moon, cloud, snowflake, flower, tree-pine, leaf, music, guitar, camera, heart, star, gem, key, bell, gift,
  feather, ghost, sailboat, drum, glasses, crown, puzzle, tent, mountain, zap`);
