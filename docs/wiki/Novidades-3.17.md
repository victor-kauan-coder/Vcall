# Novidades da 3.17

## 3.17.4: tela sem travar pela internet

- **Som da tela:** não fica mais segundos atrás quando a imagem engasga.
  Antes chegava a 2,7 s de atraso; agora espera a imagem por no máximo
  250 ms.
- **Depois de um aperto na internet:** a tela volta à qualidade toda de
  uma vez. O tempo parado por rodada caiu de até 18,9 s para ~1 s.
- **Conexão:** não reinicia mais a cada ~10 s em algumas redes.
- **Resolução:** troca menos; só cresce depois de 18 s com folga.
- **Tela parada pelo relé:** a imagem repetida volta a sair, uma por
  segundo.

## 3.17.3: mais de 50 quadros, com o som junto

- **Vídeo e jogo:** passam de 50 quadros por segundo no aplicativo de mesa.
  Um gameplay do YouTube em tela cheia foi de 43–45 para 53–57. Na
  Fluidez, a janela é capturada no tamanho dela, e quem reduz a imagem é o
  codificador.
- **Som da tela:** chega sincronizado com a imagem. A diferença caiu de
  ~95 ms para ~70 ms.
- **Linux:** a captura não pede mais de 60 quadros, o que só repetia
  quadros.
- **Porta ocupada:** o Vcall abre na porta seguinte em vez de mostrar um
  erro e ficar sem janela.

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
