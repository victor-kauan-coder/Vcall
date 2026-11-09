# vcall-nativo

Cliente do Vcall em Rust com [GPUI](https://gpui.rs) (a interface do Zed),
sem navegador dentro. Entra nas mesmas salas que os navegadores, o app de mesa
e o Android, pelo mesmo protocolo (`src/protocol.js`): quem está do outro lado
não precisa saber que é um cliente nativo.

Por que GPUI e não Tauri: o Tauri usa o WebView do sistema, e no Linux
(WebKitGTK) o WebRTC é fraco ou falta. O GPUI desenha direto na placa
(DirectX 11 no Windows, Vulkan no Linux, Metal no macOS) e não depende de
WebView nenhum. O preço: a página da chamada (`public/js`, ~30 mil linhas)
não roda nele e tem de ser refeita em Rust, por fases. O app Electron continua
sendo o que sai nas versões até o nativo alcançá-lo.

Prova de que dá: o próprio Zed faz chamada e compartilhamento de tela com
GPUI + o crate `livekit` (libwebrtc), no Windows, Linux e macOS.

Para continuar este trabalho, leia antes `CONTINUAR.md` (estado, pastas,
branches dos agentes, regras, armadilhas e o que falta).

## Uso

```
cd cliente
cargo run --release -- http://maquina:7718/#nome-da-sala --nome "Seu nome"
cargo test --release      # sala, papéis da negociação, oferta, ICE, mistura de som
```

No Windows:
- precisa do Visual Studio Build Tools (MSVC);
- `.cargo/config.toml` liga `+crt-static`: o libwebrtc do LiveKit vem
  compilado com a CRT estática, e sem isso o link falha (LNK2038);
- a pasta de build tem de ter caminho curto. O libwebrtc é extraído dentro
  dela, e os arquivos mais fundos passam dos 260 caracteres do Windows e
  somem calados (depois o compilador não acha `absl/...`). Num caminho fundo
  como o do worktree, use por exemplo `CARGO_TARGET_DIR=C:\Users\voce\vt`.

Teste numa sala de verdade, com navegadores: `node scripts/nativo-test.mjs`
(acha o binário em `cliente/target` ou em `$CARGO_TARGET_DIR`).

## Fases

1. **G1 — presença (feita neste branch).** Janela GPUI que abre o link de uma
   sala, entra pela sinalização (WebSocket) e mostra quem está lá, ao vivo
   (entra, sai, microfone, câmera, tela, mão, anfitrião); ao fechar, se
   despede do servidor (sem isso ele a seguraria 20 s na sala). Verificado com
   `scripts/nativo-test.mjs` (4/4, janela de verdade + navegador) e com uma
   foto da janela. Executável de 6,9 MB; primeira compilação ~3,5 min (MSVC).
   Ainda sem mídia: os navegadores tentam abrir WebRTC com ele, e ele não
   responde.
2. **G2 — WebRTC e receber (feita neste branch).** `libwebrtc` (crate do
   LiveKit, o mesmo libwebrtc do Chrome): uma `PeerConnection` por pessoa
   (`rtc.rs`), com o que o `core/peer.js` exige — as quatro linhas fixas
   (microfone, câmera, tela, som da tela) com o mapa `mid -> papel`, o
   educado/impolido pelo id e os quatro canais negociados (ids 0 a 3). O som
   vai a uma mistura tocada pelo cpal (`som.rs`); o vídeo vira BGRA e uma
   imagem do GPUI (no máximo ~30 por segundo por trilha). Verificado com
   `scripts/nativo-test.mjs` 8/8 nos dois papéis (o cliente ofertando e
   respondendo): conecta dos dois lados, recebe câmera 1280x720, som e tela
   1280x720; a foto da janela mostra os vídeos com as cores certas.
   Dois achados do crate: o `OfferOptions::default()` tira o "receber" das
   linhas (a oferta saía `sendonly` e o navegador não mandava nada); o "BGRA"
   dele é o da libyuv, com o alfa primeiro — o GPUI quer o "ARGB" dela.
   Falta: TLS (wss://) para salas pelo túnel; cancelamento de eco (só importa
   quando o cliente mandar o microfone, na G3).
3. **G3 — mandar (feita neste branch).** Microfone (cpal + o processamento
   de áudio do libwebrtc, com o cancelamento do eco do som que o próprio
   cliente toca), câmera (nokhwa) e a tela pelo vcall-midia *direto*: os
   quadros que o motor codifica na placa entram no libwebrtc pelo
   codificador de passagem do crate, sem a trilha falsa do app Electron.
   Verificado com `scripts/nativo-test.mjs` nos dois papéis: o navegador
   recebe o tom de teste, a câmera de teste e a tela 1302x732 a 60 qps em
   H.264 da placa. Manias do crate achadas no caminho: `set_track(None)`
   derruba o processo (trilhas vazias no lugar); quem responde manda com o
   primeiro codec da *oferta* (a linha da tela é reordenada antes de
   aplicar); a coleta contínua de candidatos estoura o limite do servidor
   (coleta única, como o navegador); a fonte de vídeo crua pede Tokio.
4. **G4 — a chamada inteira, igual ao app (em andamento).** A lógica em
   `chamada.rs` (chat pelo canal de dados, reações, mão, moderação, voz,
   avisos) e o desenho em `ui/`, um arquivo por parte, copiando o app web
   (tokens, Bricolage, ícones e emojis dos mesmos sprites, avatares pelo
   próprio JS do app num QuickJS em `avatares/`). TLS (`wss://`, salas pelo
   túnel; `VCALL_CA` para uma CA própria). `scripts/nativo-test.mjs` 20/20
   (chat, reações, mão, silenciar, voz, operações de recurso);
   `scripts/nativo-foto.mjs` põe o app web e o nativo lado a lado, na mesma
   cena, nos dois temas. Os testes rodam sem janela à vista e sem som.
5. **G5 — o resto do app.** Quadro colaborativo, jogos, quiz, Planning
   Poker com GitHub, legendas (Whisper em Rust), modo jogo com sobreposição.
6. **G6 — no lugar do Electron.** Instalador e atualização automática
   (Windows e Linux, com a mesma assinatura das versões), o servidor da sala
   embutido (ou o servidor em Rust) e o protocolo `vcall://`.

## O que pede atenção

- Compilar no Windows pede o Visual Studio Build Tools (MSVC): o GPUI puxa o
  `ring`, que precisa de compilador de C, e o `libwebrtc` do LiveKit (G2) vem
  pré-compilado com MSVC. O CI do GitHub já tem.
- A negociação tem de casar exatamente com a do `core/peer.js` (linhas fixas,
  papéis, canais negociados); qualquer diferença aparece como tela preta de um
  lado só. Os testes da G2 devem pôr o cliente nativo numa sala com navegadores
  de verdade (como o `scripts/e2e.mjs`).
- Paridade de recursos é o trabalho grande: o Electron continua até a G5.
