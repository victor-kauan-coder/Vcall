# Jogos

O botão **Jogos** na barra da chamada (atalho **K**) abre o menu com todos os
jogos. Escolher um avisa a chamada: cada pessoa recebe um aviso com
**Participar**. Ninguém é arrastado para o jogo.

Tudo roda pelo canal direto da chamada, sem servidor novo. Quem entra no
meio recebe o jogo como está.

## Festa

| Jogo | Pessoas | Como se joga |
|---|---|---|
| **Desenha e Adivinha** | 3+ | Na sua vez, escolha uma de três palavras (ou escreva a sua) e desenhe. Os outros chutam no campo ao lado; quem acerta antes ganha mais, e quem desenha ganha por acerto. Com metade e com um quarto do tempo, uma letra aparece de dica. Quem chega perto vê "está quase". |
| **Stop!** | 2+ | Sai uma letra. Preencha as categorias (você escolhe quais, de 3 a 12) e aperte **STOP**: todo mundo para na hora. Resposta só sua vale 10, repetida vale 5. Clique na resposta de alguém para votar e anular; a maioria decide. |
| **Quiz** | 1+ | Mais de 100 perguntas de conhecimentos gerais, com o Brasil no meio, em 8 temas. Todos veem a mesma pergunta; acertar rápido vale mais (até 1.000). Pódio no fim. Ou use os seus quizzes do QuizzV, pelo celular ([veja abaixo](#quiz-pelo-celular-quizzv)). |
| **Mímica** | 3+ | Quem imita vê a palavra; a câmera dele fica grande para todos. Os outros chutam em voz alta, e quem imita aponta quem acertou. |
| **Quem sou eu?** | 3+ | Cada um ganha um personagem colado na própria câmera: todos veem, menos você. Na sua vez, pergunte algo de sim ou não. Dá para escolher o personagem de alguém. |
| **Roda de perguntas** | 2+ | *O que você prefere?*, *Eu nunca...*, *Quem da call...* e quebra-gelo. Os votos ficam escondidos até todo mundo votar. No *Quem da call*, ninguém vê quem votou em quem. |
| **Duas verdades e uma mentira** | 3+ | Escreva três frases sobre você e marque a mentira. A turma vota; quem acha ganha 100, e você ganha 50 por pessoa enganada. |
| **Palavras-código** | 4+ | Dois times, um mestre de cada. O mestre vê as cores e dá uma dica de uma palavra e um número; o time aponta as cartas. Cuidado com a bomba. |

## Quiz pelo celular (QuizzV)

No **Quiz**, toque em **Usar um quiz do meu QuizzV** (ou em **Pelo celular**,
no topo). Aparece um QR:

1. No celular, abra o QuizzV (1.9.0+) e toque em **Vcall**.
2. Leia o QR. Sem câmera, use **Sem câmera? Mande o link para o celular**.
3. Escolha um quiz da biblioteca, o tempo, quantas perguntas e a ordem, e
   toque em **Começar**.

As perguntas entram no Quiz de sempre, para todos. Cada um responde pela
chamada ou pelo celular (a resposta do celular é sua e trava a mesma
alternativa no computador). Quem não tem o QuizzV também usa o QR: ele abre
uma página do Vcall para responder pelo navegador do celular.

O celular conversa com o **seu** navegador, pelo servidor da chamada (o mesmo
túnel ou Tailscale dos convidados). O QR leva um código que vale só para você,
enquanto você estiver na chamada; ninguém mais responde com ele depois que você
sai. No app de mesa, sem link público aberto, o QR pede para gerar o link
primeiro: o celular não alcança o endereço local do computador.

## Tabuleiro e palavras

| Jogo | Pessoas | Como se joga |
|---|---|---|
| **Jogo da velha** | 1 ou 2 | Sente num lado. Sozinho, **Jogar contra o computador** (ele não perde). |
| **Lig 4** | 1 ou 2 | Quatro em linha antes do outro. O computador também joga. |
| **Forca** | 2+ | Todo mundo chuta letras para a mesma palavra (sorteada ou escolhida por alguém, que só assiste). Seis erros e acabou; dá para arriscar a palavra inteira. |
| **Jogo da memória** | 1+ | Na sua vez, vire duas cartas. Achou um par, joga de novo. Fácil, médio ou difícil. |

## Sorteios

**Roleta e dados**: roleta com os nomes da chamada (ou as opções que você
escrever), que para no mesmo lugar para todos; **Tirar o sorteado** ajuda a
sortear uma ordem. Também dados (1 a 6) e cara ou coroa.

## Equipe ágil

Planning Poker, Retrospectiva e Daily continuam como antes, agora dentro do
mesmo menu. → [Jogos de equipe](Jogos-de-equipe)

## Segredos

- A palavra do Desenha e Adivinha nunca sai do computador de quem desenha.
- As respostas do Stop, os votos da Roda e a mentira das Duas verdades só
  são publicados quando a rodada revela.
- São jogos entre amigos: algumas coisas (como a ordem das cartas da memória)
  estão no estado compartilhado e poderiam ser vistas pelo console.
