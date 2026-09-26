# Novidades da 3.3

Foco total em **chamadas estáveis** e em **legendas de verdade**.

## Transmissão de tela

- **A tela não "cai e volta" mais.** A captura do Linux (e do Windows) só envia
  imagem quando algo muda. Com um slide ou um código parado, nada saía: do
  outro lado a tela sumia e voltava sem parar, com o aviso "está compartilhando"
  pulando a cada volta. Agora a última imagem é repetida enquanto a tela está
  parada, e o ladrilho só sai quando a pessoa realmente para de compartilhar.
- **Quem entra no meio vê a tela na hora**, mesmo que ela esteja parada.
- **Trocar o que está sendo mostrado sem parar**: outra janela, a tela inteira,
  com ou sem som, direto do ladrilho (**Trocar**). Ninguém perde a transmissão.
  → [Compartilhar a tela](Compartilhar-a-tela)
- **Menos CPU no Linux**: a tela passou a usar VP9 em vez de AV1, cujo encoder
  por software saturava máquinas modestas e fazia a imagem travar.
- Enquanto o primeiro quadro não chega, o ladrilho mostra "Carregando a tela…"
  em vez de um retângulo preto.

## Legendas e transcrição

- **Whisper no app de mesa**: reconhecimento muito mais preciso, com pontuação,
  **no seu computador**. Três níveis de precisão. → [Legendas](Legendas)
- **Visual novo**: foto e cor de quem fala, até duas linhas, tamanho ajustável.
- **Transcrição ao vivo** numa aba do painel, com **busca**, **copiar** e
  download em **.txt** ou **.srt**.

## Voz (inspirado no Discord)

- **Supressão de ruído por IA** (RNNoise): some teclado, ventilador, barulho.
- **Sensibilidade de entrada**: automática (a IA decide) ou manual, com medidor
  ao vivo. → [Jogos e voz](Jogos-e-voz)
- **Economia de banda**: com a sua janela escondida, os outros param de mandar
  câmera para você.

## Moderação

- **Deixar voltar** quem foi removido: pelo aviso logo depois de remover, ou
  em Pessoas → Removidos. → [Moderação](Moderacao-e-sala-de-espera)

## Testado

Tela parada por 12 s sem sumir (o teste falha na 3.2 e passa na 3.3); troca de
janela para tela inteira sem o ladrilho sair; legenda do microfone reconhecida
pelo Whisper dentro do app real; readmissão de quem foi removido; economia de
banda com a janela escondida.
