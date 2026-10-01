# DESIGN.md — Vcall

Escrito a partir do que foi construído, não antes dele. Descreve dois mundos
que convivem de propósito.

## Dois mundos, e por quê

| Superfície | Mundo | Modo |
|---|---|---|
| Tela inicial, antessala | **Estação** (cartão QSL) | Convencer / Operar com personalidade |
| Chamada, quadro, painéis | **Tinta** (ou a paleta escolhida) | Operar |

A recepção pode ter opinião porque a pessoa está decidindo. A chamada não
pode: lá o vídeo manda, e qualquer cor forte ao redor de dezesseis ladrilhos
tinge o rosto de quem fala. Isto não é inconsistência — é a mesma regra
aplicada a tarefas diferentes.

---

## Mundo 1 — Estação

`public/css/estacao.css`. Contrato em `.impeccable/briefs/recepcao.md`.

O cartão QSL é a prova impressa, trocada pelo correio, de que duas estações
se falaram sem ninguém no meio. Mesmo mecanismo do Vcall, com uma tradição
gráfica de 1930–50 já pronta.

### Cor — estratégia Comprometida

Uma cor saturada carrega mais de 30% da superfície.

| Token | Valor | Papel |
|---|---|---|
| `--qsl-cartao` | `#e8b63d` | O cartão. Âmbar-sinal, não creme. |
| `--qsl-cartao-sombra` | `#c9961f` | A espessura do papel. |
| `--qsl-tinta` | `#171310` | A primeira cor de impressão. |
| `--qsl-tinta-fraca` | `#4a3f31` | Rótulos de campo. |
| `--qsl-spot` | `#e8356f` | A segunda cor. É o magenta da marca. |
| `--qsl-mesa` | `#0b1018` | A mesa sob o cartão. |

Creme, papel pardo e pergaminho ficam **banidos** nesta superfície: são a
rendição automática para qualquer assunto "impresso", e cartões QSL de
verdade vivem no espectro saturado. Âmbar com magenta são as duas tintas de
processo que uma gráfica barata já tinha na máquina.

A cena física decidiu o escuro: alguém num notebook, em casa, à noite, com a
tela sendo a maior fonte de luz do cômodo. Por isso o cartão é objeto
iluminado sobre mesa escura, e não uma página clara.

### Tipografia

| Face | Uso | Por quê |
|---|---|---|
| Big Shoulders Display 400/700/800 | Indicativo, valores de campo, carimbo | Gótico condensado é a letra do cartão impresso barato: cabe muito caractere em pouca largura. |
| Courier Prime 400/700 | Rótulos, dados de estação, caderno | Máquina de escrever é o que o operador batia à mão nos campos. |

**Auto-hospedadas** em `public/vendor/fontes/`, geradas por
`scripts/fontes.mjs`. CDN quebraria a promessa de que o executável não baixa
nada de fora. SIL OFL 1.1.

### Componentes

- **`.qsl`** — o cartão. Girado −0.55°, sombra com deslocamento e borrão
  largo. O `::after` é o **registro de impressão fora do lugar**: numa gráfica
  barata as duas chapas nunca batem, e a segunda cor sai um fio deslocada.
- **`.carimbo`** — a ação principal. Afunda no `:active` em vez de deslizar.
- **`.qsl__entrada`** — campo como linha preenchível, nunca caixa com fundo.
- **`.qsl__selo`** — carimbo circular com anel interno, girado −9°.
- **`.registro__linha`** — sala é linha de caderno, não cartão empilhado.
- **`.registro__painel`** — dados fixos da estação.

Nada de componente padrão aqui: botão, campo e lista foram refeitos no
vocabulário da forma. Componente de estoque dentro de forma comprometida é
falha, não economia.

### Vocabulário

| Produto | Estação |
|---|---|
| Código da sala | Indicativo |
| Criar sala | Abrir estação |
| Salas ao vivo | Caderno de registro |
| Qualidade da conexão | Sinal |
| Antessala | Verso do cartão |

O indicativo da máquina (`PY#XXX`) é sorteado na primeira abertura e
guardado. Prefixo PY é o real do Brasil na alocação da UIT.

### Movimento

Um gesto, no carregamento: `qslPousa` — o cartão desce, assenta e ganha
nitidez, como objeto pousado na mesa. O caderno entra pela direita, 180 ms
depois. Nada se mexe sozinho depois disso. Tudo some em
`prefers-reduced-motion`.

---

## Mundo 2 — Tinta e as paletas

`public/css/paletas.css`, **gerado** por `scripts/paletas.mjs`.

Cinco paletas × dois temas. A rampa de claridade é a mesma para todas — é
isso que mantém sombra, borda e texto secundário com o mesmo peso visual em
qualquer cor. Só matiz e croma mudam.

| Paleta | Matiz | Croma | O que é |
|---|---|---|---|
| `tinta` | 250 | 0.014 | Padrão. Nanquim frio. |
| `ametista` | 285 | 0.075 | O roxo original. |
| `carvao` | 0 | 0 | Cinza puro. |
| `oceano` | 225 | 0.055 | Azul profundo. |
| `brasa` | 45 | 0.035 | Marrom queimado. |

OKLCH porque a claridade é perceptual: 0.20 parece o mesmo escuro em
qualquer matiz. Em HSL a rampa sairia torta de paleta para paleta.

**O gerador confere contraste e se recusa a gravar quando falha.** Texto
corrido, secundário e esmaecido precisam bater 4.5:1 sobre todas as cinco
superfícies, e o acento sobre o fundo base. Na primeira rodada reprovou 28
combinações.

Aplicação: `<html data-paleta>` + `data-theme`, escritos antes da primeira
pintura por `public/js/boot-tema.js` (externo porque a CSP recusa script
embutido).

### Regra do ladrilho

`--tile-bg` e `--tile-glow` são **escuros nos dois temas**. Vídeo pede fundo
escuro em qualquer luz, e o gradiente do ladrilho vai entre esses dois —
nunca entre uma superfície do tema e o ladrilho, que no claro produzia um
holofote branco desbotando para chumbo.

---

## Movimento geral

`public/css/motion.css`. Um só gesto repetido: sobe um pouco e ganha nitidez
(`sobeEEntra`). O desfoque faz o elemento parecer vindo de algum lugar em vez
de piscar, e some junto com o movimento.

`.carga` — quatro barras tipo medidor de voz, para qualquer espera. Um disco
girando diz "espere"; isto diz "isto é uma chamada".

---

## Limites

- Fonte nova entra por `scripts/fontes.mjs`, nunca por CDN.
- Paleta nova entra por `scripts/paletas.mjs`, nunca à mão em CSS.
- O mundo Estação **não** alcança a chamada.
- Toda superfície respeita `prefers-reduced-motion`.
