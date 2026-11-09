# Passagem de trabalho: Vcall nativo (motor de mídia em Rust + cliente GPUI)

Documento para quem continuar este trabalho (outro agente ou pessoa).
Estado em 2026-11-09. Leia inteiro antes de mexer.

---

## 1. O que é e o que o dono do produto pediu

- Reescrever o Vcall para rodar **sem navegador**, em Rust: um **motor de mídia
  nativo** (captura e codificação na placa) e um **cliente desktop em GPUI** (a
  biblioteca de interface do Zed). O GPUI foi escolha explícita do usuário
  **no lugar do Tauri**; não reabra essa decisão.
- **Paridade total** com o app web atual: "o design e tudo seja o MESMO",
  "literalmente todas as funcionalidades, visual, jogos, integrações,
  animações". O gabarito visual é o app web (`public/css`, `public/js`) e o
  `DESIGN.md`. Compare sempre por foto (seção 5).
- Portável (Windows agora; Linux/macOS depois) e otimizado.
- O app Electron continua sendo o que sai nas versões até o nativo alcançá-lo.

## 2. Onde está tudo

| O quê | Onde |
|---|---|
| Repositório | `C:\Users\kauan\Downloads\vcall_10\sistema` (GitHub: `victor-kauan-coder/vcall`) |
| Worktree deste trabalho | `C:\Users\kauan\Downloads\vcall_10\sistema\.worktrees\midia-nativa` |
| Branch | `midia-nativa` (de `main` 64c7260 = versão 3.24.0), **no GitHub**: `origin/midia-nativa` |
| Commits | `eb1caa6` motor + cliente G1–G4 lógica; `08ab92c` interface igual ao app (saguão, palco, barra, painel); depois este documento |
| Motor de mídia | `midia/` (crate `vcall-midia`) |
| Cliente GPUI | `cliente/` (crate `vcall-nativo`); avatares em `cliente/avatares/` (crate `vcall-avatares`) |
| Ficha visual extraída do CSS | `cliente/docs/ESPEC-UI.md` (medidas, cores, raios, fontes, por seletor e linha) |
| Design system do produto | `DESIGN.md` na raiz do **checkout principal** (`C:\Users\kauan\Downloads\vcall_10\sistema\DESIGN.md`, não versionado lá); `PRODUCT.md` está versionado |
| Pastas de build (curtas, ver 6.1) | `C:\Users\kauan\vt` (principal), `vt-avatares`, e uma por agente: `vt-quadro`, `vtj` (jogos), `vt-festa`, `vt-dados`, `vt-telas` |
| Fotos de comparação | `cliente/fotos/<cena>-<tema>/` (ignorado pelo git) |
| Memória do assistente | `C:\Users\kauan\.claude\projects\C--Users-kauan-Downloads-vcall-10-sistema\memory\vcall-midia-nativa.md` |

### Branches de agentes em andamento (worktrees em `sistema\.claude\worktrees\agent-*`)

| Branch | Worktree | Assunto | Estado em 2026-11-09 |
|---|---|---|---|
| `nativo-quadro` | `agent-a6743233a36bf30cd` | Quadro branco (`func/quadro/`) | modelo pronto (passa 59 passos de referência do `canvas.js`); parte GPUI em andamento, alterações ainda **não commitadas** |
| `nativo-jogos` | `agent-aa8bc5316135b994a` | Jogos + tabuleiro (`func/jogos/`) | duelo/Velha/Lig 4 em andamento, não commitado |
| `nativo-festa` | `agent-a71d8fd35d35127ea` | Festa + quiz + QuizzV (`func/festa/`) | base commitada (`cb92f12`), ligações em andamento |
| `nativo-dados` | `agent-a7733c90b2e368acd` | Estatísticas/sinal, volume por pessoa, "ver"/Assistir, dispositivos do saguão, Configurações | começando |
| `nativo-telas` | `agent-a45ee09edbdbd9c2d` | Tela inicial, convite com QR, telas de erro, mini-janela | começando |

Esses agentes só podem ser retomados pela sessão que os criou. Numa sessão
nova: entre em cada worktree, veja `git status` e `git log`, termine ou
redelegue o que faltar (os pedidos originais estão resumidos na seção 8) e
junte no `midia-nativa` (seção 7).

## 3. Estado (aprox. 45% da paridade total)

| Fase | Peso | Pronto | Observação |
|---|---|---|---|
| Motor de mídia (fases 1–2) | parte de G1–G3 | 100% | WGC → D3D11 → H.264 da placa; no Electron, modo "Motor nativo (beta)" |
| G1 presença, G2 receber, G3 mandar | ~25% | 100% | `scripts/nativo-test.mjs` |
| G4 chamada igual ao app | ~20% | ~85% | falta sinal por pessoa, volume, "ver", dispositivos, Configurações (agente `nativo-dados`) |
| G5 recursos | ~40% | ~10% | quadro, jogos, festa em andamento; o resto pendente (seção 8) |
| G6 substituir o Electron | ~15% | ~5% | pendente |

Funciona hoje (testado contra o servidor real com navegadores):
- entrar pelo link (http e https/wss), saguão igual ao app, chamada com câmera,
  som e tela nos dois sentidos (tela pelo motor, H.264 da placa, ~60 qps);
- chat (canal de dados, com acentos/IME), reações (protocolo novo `reacao`/
  `sinal` e o antigo), mão, moderação (silenciar, câmera, remover, porta),
  indicador de voz, avisos, painel Conversa/Pessoas/Transcrição/Qualidade;
- interface: palco sozinho/duo/grade/destaque, ladrilhos, barra de controles
  com atalhos e animações, menu de reações, temas claro/escuro.

## 4. Arquitetura

### Motor e app Electron (fases 1–2)
- `midia/src/{captura,codificador,main}.rs`: `vcall-midia codificadores |
  medir | transmitir [--sob-demanda] [--janela HWND | --tela N]`. Quadros na
  saída padrão com cabeçalho de 16 bytes (tamanho, chave, captura µs);
  comandos pela entrada: `chave`, `kbps N`, `quadro`, `parar`. Sai sozinho se a
  entrada fecha. Leia `midia/README.md`.
- Electron: `desktop/midia.js` (sobe o motor), `desktop/main.js` (IPC
  `vcall:midia-*`), `public/js/core/midia.js` + `core/injetor-worker.js`
  (injeção por RTCRtpScriptTransform), ganchos em `core/peer.js`,
  `core/screen.js`, `core/stats.js`, `core/sfu.js`, `core/tuning.js`.

### Cliente GPUI (`cliente/src`)
| Arquivo | Papel |
|---|---|
| `main.rs` | partida: link + `--nome` → chamada; só link → saguão; modo foto/fundo |
| `chamada.rs` | **lógica** da chamada (estado, mensagens do servidor, mídia local, chat, reações, mão, moderação, voz, avisos, roteiro de teste) |
| `sala.rs` | estado da sala a partir do protocolo (`src/protocol.js`), avatar, link |
| `sinalizacao.rs` | WebSocket (thread própria), TLS rustls + `VCALL_CA`, GET `/ice` |
| `rtc.rs` | `Malha`: uma PeerConnection por pessoa, contrato do `core/peer.js`, canais de dados, trilhas locais, H.264 na linha da tela |
| `local.rs` | microfone (cpal + APM com eco), câmera (nokhwa), tela (vcall-midia) |
| `som.rs` | mistura do som recebido + referência do eco |
| `entrada.rs` | caixa de texto com InputHandler (acentos/IME) |
| `recursos.rs` | fontes, ícones e emojis dos sprites de `public/vendor` |
| `func/` | recursos que ocupam o palco (quadro, jogos, festa, poker): `abrir`, `palco`, `receber` |
| `ui/` | o desenho, um arquivo por parte: `tema`, `comp`, `avatar`, `janela` (min/max/fechar), `topo`, `palco` (+`palco_ladrilho`, `palco_arte`, `palco_flutuante`), `dock` (+`dock_mov`), `reacoes`, `painel`, `saguao` (+`saguao_midia`, `saguao_pecas`) |
| `avatares/` | crate que roda o **próprio JS** do app (DiceBear + paisagens) num QuickJS: avatares idênticos byte a byte |

## 5. Compilar, testar, comparar

```
cd cliente
set CARGO_TARGET_DIR=C:\Users\kauan\vt        (PowerShell: $env:CARGO_TARGET_DIR="C:\Users\kauan\vt")
cargo build --release
cargo test --release                            (26 testes)
cd ..
node scripts/nativo-test.mjs                    (20/20: o cliente numa sala real com um navegador)
node scripts/nativo-foto.mjs --cena chamada --tema escuro
```
- Cenas da foto: `saguao`, `sozinha`, `chamada`, `chat`, `tela`; temas `claro`,
  `escuro`. Saída: `cliente/fotos/<cena>-<tema>/lado-a-lado.png` (web à
  esquerda). O nativo é fotografado primeiro e o web no **mesmo tamanho**.
- Motor: `cd midia && cargo +stable-x86_64-pc-windows-gnu build --release`
  (ou MSVC). Testes do app Electron: `scripts/midia-app-test.mjs`,
  `scripts/midia-bench.mjs`.
- Variáveis do cliente: `VCALL_NATIVO_LOG` (log para testes),
  `VCALL_NATIVO_ROTEIRO` (comandos pela entrada: `chat X`, `reagir X`, `mao`,
  `alternar mic|cam|tela`, `painel conversa|pessoas`, `sair`),
  `VCALL_NATIVO_FUNDO` (sem janela e sem som), `VCALL_NATIVO_FOTO` (janela fora
  da tela, sem foco, sem som; imprime `hwnd` e `tamanho`), `VCALL_TEMA`,
  `VCALL_RTC_LOG` (log do libwebrtc), `VCALL_CA`, `VCALL_MIDIA`.
- Argumentos: `vcall-nativo <link> [--nome N] [--ligar mic,cam,tela]
  [--tela-janela HWND] [--teste]`.

## 6. Regras do usuário (obrigatórias)

- Tudo em **português do Brasil** (interface, código, comentários).
- **Commits no nome do usuário, sem a linha `Co-Authored-By`.** Não commitar,
  dar push nem soltar versão sem o usuário pedir (o push do branch
  `midia-nativa` foi autorizado: "Subir e usar nuvem").
- **Testes nunca podem aparecer na tela nem tocar som**, e nunca capturar a
  tela, a webcam ou o microfone de verdade: use `--teste`, a janela de teste
  (`scripts/fixtures/janela-teste.cjs`, fora da tela), Chromium sem janela e
  com `--mute-audio`, `VCALL_NATIVO_FUNDO`/`VCALL_NATIVO_FOTO`.
- Testar o Electron de dev isolado (`scripts/fixtures/app-isolado.mjs`) para
  não regravar o `vcall://` do Vcall instalado.
- Não mexer em configurações de sistema/segurança do Windows.
- Velocidade: o gargalo é o **limite de 5 h de uso da conta**. Agentes novos
  em **Sonnet**; uma rodada de fotos, uma correção em lote, uma confirmação.

### 6.1 Armadilhas já descobertas (não redescubra)
- Windows: build do cliente precisa de **MSVC** e **`+crt-static`**
  (`cliente/.cargo/config.toml`) e de **pasta de build curta**: no worktree o
  libwebrtc passa de 260 caracteres e os headers somem calados.
- `libwebrtc` 0.4 (LiveKit): `OfferOptions::default()` tira o "receber"
  (usar `rtc::opcoes_da_oferta`); `VideoFormatType::ARGB` é o BGRA do GPUI;
  `set_track(None)` **derruba o processo** (usar as trilhas vazias da Malha);
  quem responde manda com o 1º codec da **oferta** (`h264_primeiro`);
  `RtcConfiguration` padrão coleta candidatos sem parar e estoura o limite do
  servidor (240 msg/10 s, descarte calado) → `GatherOnce`; `NativeVideoSource::new`
  exige runtime Tokio; o codificador de passagem exige
  `set_video_encoder_backend(PreEncoded)` e o codec H.264 negociado.
- Sinalização: o prazo de leitura tem de ser posto no socket do próprio
  stream (num `try_clone` o Windows não repassa e os envios atrasam).
- GPUI 0.2.2: SVG em `img()` sai com **vermelho e azul trocados** e borrado a
  125% → `ui::palco::arte::svg_nitido` (raster no tamanho certo + troca de
  canais) ou `recursos::trocar_rb`/`ui::avatar::para_img`. Sem letter-spacing,
  gradientes cônicos/radiais, transformações, máscaras e backdrop-filter: veja
  os contornos em `palco_arte.rs` e `saguao_pecas.rs`. `blur_radius` é o desvio
  padrão (metade do blur do CSS). Uma janela criada fora da tela é puxada de
  volta ao monitor (usar `SetWindowPos` fora do `update`).
- RTCRtpScriptTransform (Electron) só vale se posta antes da negociação.
- MFT da Intel: CBR ignora mudança de banda (VBR com pico); ForceKeyFrame
  logo após mudar banda → MEError (o motor recria o codificador).
- Teste de voz: tom constante é abafado pela supressão de ruído; o tom de teste
  é em rajadas.

## 7. Como juntar o branch de um agente

1. No worktree do agente: confira `git status` e os commits; rode o build com a
   pasta curta dele e `cargo test`.
2. No `.worktrees\midia-nativa`: `git merge nativo-<x>` (ou copie os arquivos
   que o agente é dono, se ele não commitou). Conflitos esperados só em
   `cliente/src/func/mod.rs` e linhas de ligação em `chamada.rs`/`ui/dock.rs`.
3. Ligue o botão na barra (`ui/dock.rs`, função `acionar`: hoje "Quadro
   branco"/"Jogos" etc. mostram "chega em breve") a `func::abrir(c, Recurso::X, cx)`.
4. `cargo build`, `cargo test`, `node scripts/nativo-test.mjs` (20/20) e fotos
   lado a lado das telas do recurso nos dois temas.
5. Commit (sem Co-Authored-By) e, se autorizado, `git push`.
6. Apague a pasta de build do agente (`C:\Users\kauan\vt-<x>`): o disco está
   apertado (~28 GB livres).

## 8. O que falta (por ordem sugerida)

### G4 (agente `nativo-dados`, se não terminou)
- Qualidade por pessoa (port de `core/stats.js`) no chip de sinal e na aba Qualidade.
- Volume por pessoa (0–150%) no `som.rs`.
- Protocolo `ver` (Assistir/Parar de assistir; obedecer o `ver` recebido).
- Dispositivos escolhidos no saguão levados à chamada.
- Configurações (dispositivos, aparência: tema, paletas de `paletas.css`, visual Empresa).
- Pedidos menores: mostrar o halo de voz no botão do microfone (`c.falando`),
  `Entrada` com várias linhas e cursor na altura da fonte, segurar Espaço para
  falar, lista de atalhos ("?"), tecla G, Shift+letra; animação FLIP da grade;
  sinais (menu "Sinais") com exibição no ladrilho (`c.sinais` já existe).

### G5 recursos (portar de `public/js/features` + `public/js/ui`, mesmo protocolo)
- Quadro branco (`features/canvas.js`, `css/board.css`) — `nativo-quadro`.
- Jogos + tabuleiro (`features/jogos.js`, `ui/jogos*.js`, `features/tabuleiro.js`, `ui/tabuleiro.js`) — `nativo-jogos`.
- Festa + quiz + QuizzV (`features/festa.js`, `ui/festa.js`, `features/bancos.js`, `features/quizzv.js`) — `nativo-festa`.
- Tela inicial, convite com QR, erro, mini-janela — `nativo-telas`.
- Planning Poker + GitHub Projects (`features/github.js`, `ui/github.js`; só no app de mesa).
- Legendas ao vivo (`features/captions.js`, `whisper-*`, `fala-*`): Whisper em Rust (whisper-rs ou candle).
- Gravação local (`features/recorder.js`) — dá para reaproveitar o vcall-midia.
- Arquivos e imagens no chat (`features/transfer.js`, canal "canvas-blob"; `Malha::blob` e `Evento::Blob` já existem).
- Lightbox, foto de perfil, permissões, mãos livres (`ui/lightbox.js`, `ui/photo.js`, `ui/permissions.js`, `ui/handsfree.js`).
- Salas grandes: SFU e relé (`core/sfu.js`, `core/rele.js`).
- Sobreposição de jogo (`public/sobreposicao.html`).

### G6 no lugar do Electron
- Servidor da sala embutido (hoje é Node: `server.js`, `src/*.js`) — embutir o
  Node ou portar para Rust; túnel Cloudflare (cloudflared) com o mesmo ciclo de
  vida (fechar a janela derruba o túnel).
- Instalador e atualização automática com a mesma assinatura das versões
  (ver a memória `vcall-chave-atualizacao` e `.github/workflows/release.yml`).
- Protocolo `vcall://`, ícone, bandeja, inicialização.
- Linux: PipeWire + VAAPI/NVENC no motor; empacotamento.

## 9. Referências rápidas
- Medidas e decisões do motor: `midia/README.md`. Fases do cliente: `cliente/README.md`.
- Ficha visual: `cliente/docs/ESPEC-UI.md` (o "visual vcall" com a paleta "tinta" é o padrão; o "Empresa" está na seção 9 dela).
- Protocolo do servidor: `src/protocol.js`, `src/signaling.js`. Contrato WebRTC: `public/js/core/peer.js`, `core/mesh.js`.
- Ganho medido do motor (notebook Intel UHD + RTX 2050): 1080p a 56–57 qps contra
  1440x806 a 27–30 qps do Chromium; vidro a vidro 95 ms contra 172–193 ms com a CPU ocupada.
