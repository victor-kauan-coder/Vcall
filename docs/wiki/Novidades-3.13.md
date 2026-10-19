# Novidades da 3.13

## Quiz pelo celular (QuizzV)

Em **Jogos › Quiz › Usar um quiz do meu QuizzV**, o Vcall mostra um QR. O
QuizzV (1.9.0 ou mais novo) lê o código, e a biblioteca de quizzes do celular
vira as perguntas do Quiz da chamada: mesma tela, placar e pódio.
→ [Jogos](Jogos#quiz-pelo-celular-quizzv)

- Todos respondem pela chamada ou pelo celular; quem não tem o app responde
  pela página que o QR abre.
- Até 5 alternativas, textos-base longos e a explicação de cada questão.
- O celular fala com o navegador da própria pessoa pelo servidor da chamada:
  nenhum serviço de terceiros no meio.

## Segurança

- Uma mensagem com objetos aninhados demais derrubava o servidor de
  sinalização (e todas as chamadas). Corrigido; vale atualizar.

## Correções

- Safari pela rede local (`http://`): a chamada não abre mais em branco.
- Quem entra no meio de um jogo com muito conteúdo recebe o jogo inteiro.
