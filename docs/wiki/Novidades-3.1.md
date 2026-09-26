# Novidades da 3.1

## Correções

- **Compartilhar tela no Linux** — a captura travava sempre no app (a
  resposta ao pedido levava `audio: undefined`, que o Electron recusa).
- **Escolher uma janela específica** — antes o app só compartilhava a tela
  inteira; agora há uma lista com miniaturas de telas e janelas.
- **Som nas transmissões** — o som do computador ia junto sem pedir e trazia
  as vozes da própria chamada de volta como eco. Agora é opcional e desligado.
- **Cair ao transmitir** — prévia da tela inteira sem efeito espelho; a
  janela que cai volta sozinha para a sala e o motivo vai para o log.
- **Segunda transmissão invisível** — a partir da segunda vez que alguém
  compartilhava a tela na mesma chamada, os outros não viam mais.
- **Notificação do canvas** — aparecia a cada traço para todo mundo; agora
  uma vez por chamada.
- **Perfil** — a aba Pessoas abria vazia; o avatar não abria nada; `Esc` não
  fechava as janelas e os atalhos vazavam para a chamada.
- **Arquivos** — acima de ~1 MB os arquivos nunca terminavam de chegar
  (pedaços descartados quando o canal enchia). Agora chegam inteiros, na
  ordem, com progresso real. O visualizador de texto também voltou a abrir.
- **Pessoa duplicada** — quem caía e voltava aparecia duas vezes por até
  50 segundos.
- **Legendas** — não funcionavam no app de mesa; transcreviam no idioma do
  sistema (inglês num Windows em inglês); continuavam com o microfone mudo;
  perdiam frases.
- **Segurança** — a senha da sala não era conferida (qualquer pessoa com o
  link entrava).

## Novidades

- **Moderação:** silenciar, silenciar todos, desligar câmera, baixar a mão,
  remover (sem volta pelo mesmo aparelho), trancar a sala.
- **Sala de espera** com aprovação do anfitrião.
- **Fila de mãos levantadas** e **tempo de fala** de cada participante.
- **Convite pelo WhatsApp** que abre direto no aplicativo.
- **Legendas offline** no app de mesa, sem enviar áudio a ninguém.
- **Balão flutuante** na chamada a dois e transições suaves da grade.
- **Linux em todas as distros:** AppImage, `.deb`, `.rpm` (Fedora), `pacman`
  (Arch) e `.tar.gz`.
- **Bateria de testes** (servidor, interface, app de mesa) e CI no GitHub.
