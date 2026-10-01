# Brief — recepção (tela inicial + antessala)

Alvo: `public/js/ui/dashboard.js`, `public/js/ui/lobby.js`,
`public/css/estacao.css`, `public/index.html` (bloco da antessala).

Escopo: as duas telas ANTES da chamada. A chamada em si fica fora — ela é
modo Operar puro e continua escura e quieta, na paleta Tinta.

Modo: Convencer (tela inicial) e Operar com personalidade (antessala).

Público e tarefa: amigos, família e times pequenos. Quem chega quer uma de
duas coisas — criar uma sala e mandar o link, ou entrar numa sala com o
código que recebeu. Tudo o mais é secundário.

Decisões em aberto: nenhuma. Direção e alcance escolhidos pelo usuário.

---

## Direction contract

**THESIS.** O Vcall é a prova de um contato direto entre duas estações, e a
tela inicial é esse cartão. Recusa a página que a categoria sempre entrega —
degradê roxo-azul, ilustração 3D de gente sorrindo em ladrilhos, cartões
arredondados iguais, botão "Nova reunião" — porque ela descreve uma reunião
corporativa e o Vcall não é isso. Recusa também o oposto previsível, a
página preta de ferramenta de desenvolvedor com fonte monoespaçada.

**OWN-WORLD.** Cartão QSL de radioamador: a prova impressa, trocada pelo
correio, de que duas estações se falaram sem ninguém no meio. Impressão de
duas cores sobre cartão de cor saturada — **cartão âmbar-sinal**, **tinta
preta** e **magenta da marca** como cor-tinta, sobre uma **mesa azul-tinta
escura**. O cartão é objeto iluminado sobre mesa escura, não uma página
clara: a cena física é alguém num notebook à noite. NÃO é creme, papel
pardo nem pergaminho — cartões QSL vivem no espectro saturado, e o creme é
a rendição-padrão que esta linha existe para barrar. Tipografia: gótico
condensado para display, máquina de escrever para dado de estação. Fios
grossos, cantos retos, marca de carimbo, registro de impressão levemente
fora. Componentes: campo de formulário como linha preenchível de cartão,
botão como carimbo, listagem como caderno de registro (log).

**STORY.** A pessoa entende em um olhar que isto é contato direto, não uma
sala de reunião numa nuvem. Acredita porque a tela fala a língua de quem se
comunica sem infraestrutura — indicativo, sinal, no ar. Faz uma de duas
coisas: bate o carimbo "ABRIR ESTAÇÃO", ou escreve o indicativo que recebeu
e entra.

**FIRST VIEWPORT.** Mesa escura ocupando a tela. Ao centro-esquerda, o
cartão QSL em escala grande (até 620px de largura), levemente girado, com
sombra de objeto sobre mesa: no topo o indicativo da estação em gótico
condensado gigante; abaixo, fios grossos separando os campos do cartão
(PARA / FREQUÊNCIA / SINAL / MODO) preenchidos com a verdade do produto;
no pé, o carimbo de ação. À direita, em coluna estreita, o caderno de
registro — "no ar agora", as salas públicas, em linha de log monoespaçada.
A ação principal é o carimbo dentro do cartão, não um botão flutuante.

**FORM.** Cartão QSL / radioamadorismo. Primeiro da minha lista ordenada de
sete por ressonância — é o único candidato em que o mecanismo, o vocabulário
(indicativo, relatório de sinal, confirmação de contato) e uma tradição
gráfica completa chegam juntos. Escolhido pelo usuário entre quatro cartas.
Seed: **não houve sorteio** — `impeccable concept-seed` não existe nesta
instalação (só `SKILL.md` e `reference/`), então a lista foi derivada e
ordenada à mão e a decisão foi para o usuário pela ferramenta de perguntas.
Divergência declarada, não omitida.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, DESIGN.md, and every shipping raster
carrying its provenance.

---

## Riscos assumidos

- Mundo retrô vira fantasia se os controles não forem refeitos no vocabulário
  dele. Todo campo, botão e lista desta superfície é reconstruído; componente
  padrão dentro de forma comprometida é falha.
- Fonte tem de ser **auto-hospedada**. CDN quebra a promessa de que o
  executável não baixa nada de fora (PRODUCT.md).
- O cartão em cor saturada não pode vazar para dentro da chamada: lá o vídeo
  manda, e a paleta Tinta continua.
