# Novidades da 3.17

## 3.17.2: vídeo mais fluido no aplicativo de mesa

- **Vcall minimizado:** o Windows 11 não desacelera mais a captura. Um vídeo
  compartilhado foi de ~20 para 41 a 46 quadros por segundo.
- **Fluidez automática:** escolher a janela do YouTube, Twitch, Netflix ou de
  um player já liga a Fluidez, se você não escolheu o modo à mão.
- **Sem codificador da placa de vídeo:** a Fluidez captura em 720p para
  manter os quadros.
- **Janela minimizada:** o Vcall avisa quando a tela compartilhada fica
  parada, porque o Windows não captura janela minimizada.
- **Seletor:** a lista de janelas aparece em menos de 1 segundo, e as
  miniaturas entram em seguida.

## 3.17.1: tela fluida pela internet

- **Tela pela internet:** para de travar. A 3.17.0 reconectava a chamada a
  cada ~10 s e derrubava a tela com 1% de perda. Agora fica entre 55 e 60
  quadros por segundo numa internet de casa.
- **Pouca banda:** vídeo e jogo diminuem a imagem para caber na conexão e
  mantêm os 60 quadros. O modo de texto continua nítido.
- **Monitor de 60 Hz:** não tenta mais passar de 60 quadros, o que fazia a
  imagem engasgar.
- **Link público:** no aplicativo de mesa, sai já ao criar a sala. O
  "Copiar link da reunião" copia esse link sem abrir o Convidar.
- **Visual Empresa:** o "Convidar" não fica mais por baixo dos botões da
  janela.

## 3.17.0: tela e câmera a 60, até 120 em Fluidez

- **Tela:** a tela compartilhada sai em 1080p a 60 quadros por segundo (antes 30), com imagem mais nítida.
- **Até 120 em Fluidez:** vídeo e jogo vão até 120 numa chamada a dois, com monitor de 120 Hz ou mais e ~8 Mbps de internet.
  - A chamada começa em 60 e sobe sozinha.
  - Num monitor de 60 Hz sai a 60.
  - O modo de texto fica em 60.
- **Câmera:** entra em 720p a 60 já no começo. Antes passava 8 a 10 segundos em 320×180 e depois ficava em 30.
- **Sala maior:** com mais gente, os quadros diminuem conforme a sala cresce. Se o computador não acompanha, desce para 45 e depois 34 em vez de travar.

Mais detalhes em [Compartilhar a tela](Compartilhar-a-tela).
