# brag-plan.md — Vcall

Vídeo de lançamento do Vcall. Segunda versão, depois do retorno:

- **mais longo e mais calmo** — a primeira tinha 24 s e empilhava informação;
- **mais funcionalidades** — legendas, mini-janela, arquivos, mão levantada,
  reações, rede, gravação, paletas;
- **tudo em tema escuro**, e com o seletor de cores aparecendo;
- **foco em para que serve** — reunião, aula, grupo de estudos.

Resultado: **52,8 s**, 1920×1080, 30 fps, 16 cenas.

> O `/brag` pede 15–25 s. Aqui vale o pedido de quem encomendou: ~50 s.
> O que não se abre mão é a regra de leitura — cada linha fica parada pelo
> menos 0,3 s por palavra depois de assentar, e nenhuma cena tem corte
> abaixo de 1,2 s.

- Preset: `chaotic` só no ritmo das entradas; a direção é
  **anúncio brasileiro colorido, mas que respira.**
- Formato: landscape.

---

## Rubrica

**1. O que é?**
Salas de vídeo que vão direto de um navegador ao outro, criptografadas ponta a
ponta. Até 16 pessoas, quadro infinito, tela compartilhada, chat com arquivos,
legendas ao vivo, gravação local, mini-janela. Sem conta, sem instalar.

**2. A afirmação mais forte**
*"Chame quem importa, direto de um computador para o outro."* e *"O servidor só
apresenta os participantes — ele não vê nem guarda nada da conversa."*

**3. O gancho visual**
A intro animada do próprio app, reconstruída com os MESMOS caminhos SVG de
`public/index.html`.

**4. Para que serve (o pedido novo)**
Em vez de afirmar "serve para trabalho e estudo", o vídeo **mostra**: as salas
foram criadas de verdade com os nomes `Reunião de equipe · Q3`,
`Grupo de estudos · Cálculo II` e `Aula de violão · iniciantes`, marcadas como
públicas, e a tela inicial as lista em "Ao vivo agora". O nome aparece também
no topo da chamada, e o quadro branco acontece dentro do grupo de estudos, com
um gráfico de aula. Nada de declaração: é a interface.

**5. Tema e cor (o pedido novo)**
Tudo foi recapturado com `vcall:theme = "dark"`. A cena 15 mostra as cinco
paletas do produto — Tinta, Ametista, Carvão, Oceano, Brasa — no painel de
ajustes, e a mesma chamada trocando de cor de verdade a cada beat.

**6. Áudio**
`happy-beats-business-moves-vol-12` (109,96 BPM). SFX de interface por baixo,
suaves. Fade de entrada em 1,1 s e de saída nos 2,4 s finais.

**7. Legenda para publicar**
Em `share-copy.txt`.

---

## Identidade visual (de `public/css/tokens.css`)

| Papel | Valor |
|---|---|
| Rosa / laranja | `#fd4d87` · `#fe9c5f` |
| Azul-tinta | `#110c3a` · fundo de abertura `#0c0e13` |
| Pílulas (texto branco) | `#d12c5e → #c0611c` — os tons profundos dos botões primários |
| Fonte de título | Bricolage Grotesque, servida do próprio projeto |

---

## Storyboard — 16 cenas, 52,8 s

| # | t | dur | Cena | Linha na tela |
|---|---|---|---|---|
| 1 | 0,00 | 3,5 | A marca se monta | `Vcall` · conversas que chegam direto |
| 2 | 3,50 | 3,2 | A promessa | a manchete real do site, do detalhe à tela toda |
| 3 | 6,70 | 3,1 | **Para o quê** | "Reunião, aula, grupo de estudos." + as três salas no ar |
| 4 | 9,80 | 3,2 | Criar a sala | "1 · Dá um nome e cria" |
| 5 | 13,00 | 3,1 | Antessala | "2 · Se arrume antes de entrar" |
| 6 | 16,10 | 3,4 | Convidar | "Manda o link. Ou dita seis letras." |
| 7 | 19,50 | 3,4 | A sala enche 2→4→6 | "Até 16 pessoas. Sem conta. Sem instalar." |
| 8 | 22,90 | 3,1 | Conversa e arquivos | "Conversa, imagens e arquivos" |
| 9 | 26,00 | 3,2 | **Legendas ao vivo** | "Legenda a sua fala, no seu computador" |
| 10 | 29,20 | 3,3 | Quadro branco (Cálculo II) | "Um quadro infinito para explicar junto" |
| 11 | 32,50 | 3,2 | O mesmo quadro do outro lado | "O que você desenha aparece lá. Na hora." |
| 12 | 35,70 | 3,6 | Mão, reação, rede | `levantar a mão · reagir · ver a rede` |
| 13 | 39,30 | 3,3 | Tela e gravação | "Tela: nitidez ou fluidez" → "E grava, no seu computador" |
| 14 | 42,60 | 3,4 | **Picture-in-picture** | "Vira uma janelinha e sai da frente" |
| 15 | 46,00 | 3,5 | **As cores** | "Cinco paletas. Escolhe a sua." |
| 16 | 49,50 | 3,3 | Fecho | "Abra o navegador e chame." |

### Ritmo
Cena mais curta: 3,1 s. Corte interno mais curto: 1,2 s (cena 12). Na versão
anterior havia cortes de 0,55 s — é o que fazia a informação atropelar.

### Transições
Véu pelo preto nas três viradas de assunto (3,32 · 32,32 · 49,32). Dentro das
cenas, corte seco no beat. Nunca fusão direta entre dois layouts cheios.

### Cues travados no beat
17,47 (o código salta) · 24,56 (a pílula do chat pulsa) · 32,74 (o quadro abre
em dois lados) · 45,84–48,55 (o giro das paletas) · 50,20 e 50,74 (o fecho).

---

## Material

Capturas em `work/escuro/` — 43 PNGs, Vcall rodando de verdade, dirigido pelo
Playwright. Scripts em `work/capture*.mjs`.

- Tema escuro em todos os contextos (`vcall:theme = "dark"`).
- Layout "grade igualitária", para todo mundo do mesmo tamanho.
- Câmeras fechadas de propósito: a câmera falsa do Chromium é um pacman verde,
  e o avatar do Vcall é o que a interface mostra quando alguém entra sem vídeo.
- As legendas usam a interface real; o texto entra por
  `window.vcall.captions.show()`, porque mídia falsa não fala.
- A mini-janela é a **Document Picture-in-Picture de verdade**, capturada como
  uma segunda página do Playwright.
- Nenhum endereço de máquina em quadro: o convite entra recortado no código P2P
  e no botão do WhatsApp.
- Nomes fictícios (Victor, Alice, Bruno, Carla, Diego, Elisa, Marina, Rafael,
  Pedro, Júlia).

## O que ficou de fora, e por quê

- **Anotar sobre a tela compartilhada**: em ambiente sem monitor, o que o
  Chromium entrega como "tela" é a câmera falsa — um retângulo verde. A cena de
  compartilhamento ficou no diálogo de escolha (`Nitidez / Fluidez`), que é
  real e diz a mesma coisa.
- **Link público por túnel Cloudflare**: só existe no aplicativo de mesa.
