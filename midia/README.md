# vcall-midia

Motor de mídia nativo do Vcall, em Rust. Captura a tela (ou uma janela) e
codifica H.264 na placa de vídeo, sem o quadro passar pela memória do
processador. O executável tem ~430 KB e só usa o que o Windows já traz
(Direct3D 11, Media Foundation, Windows Graphics Capture): nenhum SDK de
fabricante instalado, nenhuma DLL junto.

## Como funciona

```
WGC (textura BGRA) → cópia na placa → D3D11 Video Processor (NV12, BT.709)
  → MFT H.264 da placa (Quick Sync, NVENC ou AMF, o que o driver trouxer;
    sem nenhum, o H.264 de software do Windows) → Annex-B
```

- A placa (`ID3D11Device`) é criada no adaptador ligado à tela capturada. Num
  notebook híbrido a tela sai pela Intel: capturar e codificar ali evita copiar
  cada quadro de uma placa para a outra.
- `MinUpdateInterval` de 1 ms no WGC (Windows 11 24H2+): sem ele a captura fica
  em ~50 qps mesmo em monitor de 144 Hz.
- Codificador: baixa latência, VBR com pico igual à média, sem quadros B,
  buffer de um quadro, GOP de 60 s (IDR quando pedido). O MFT da Intel, em
  CBR, ignora mudanças de banda durante a transmissão; em VBR com pico,
  ajustado depois dos tipos, aceita (e solta um IDR a cada mudança).
- Uma vaga de "quadro mais novo": captura e codificador não esperam um pelo
  outro, e o último estado da tela sempre sai. Balde de fichas para o qps (o
  horário do WGC oscila; comparar com o quadro anterior perdia 1 em 4 a 60 qps).
- Processo em prioridade alta, thread em MMCSS "Capture", timer de 1 ms.

## Como entra no Vcall: injeção no WebRTC do Chromium

O motor não fala WebRTC. A página cria uma trilha falsa (160x90, parada) e
põe uma `RTCRtpScriptTransform` no sender da tela que troca cada quadro dela
pelo quadro do motor. O empacotador H.264 do Chromium relê as NAL do quadro,
então o quadro injetado sai como se fosse dele. Malha, relé, SFU, FlexFEC e o
controle de banda continuam os do Chromium, e quem recebe (navegador, app de
mesa, Android) não muda nada.

- Um quadro falso por quadro nativo, escrito quando ele chega e com o horário
  da captura: o RTP sai no ritmo real da tela (com um ritmo de relógio próprio,
  o jitter buffer de quem recebe ia a 120 ms).
- `--sob-demanda`: o motor só codifica quando a página pede (`quadro`), um
  pedido por quadro consumido. Cada quadro codificado sai uma vez, em ordem: a
  cadeia de referência do H.264 não quebra mesmo quando o Chromium descarta
  quadros falsos.
- Quadro falso marcado `key` = quem recebe pediu (PLI/FIR): a página manda
  `chave` e o próximo quadro do motor é IDR.
- Banda: a página lê `availableOutgoingBitrate` e manda `kbps` com 100% da
  estimativa (mandando menos, o controle de banda do WebRTC para de sondar).

O protótipo completo está em `scripts/midia-bench/` (recebe.html + injetor.js).

## Uso

```
vcall-midia codificadores                 lista os codificadores H.264
vcall-midia medir      [opções]           relatório JSON no fim
vcall-midia transmitir [opções]           quadros na saída padrão
```

Opções: `--tela N` (0 = principal) ou `--janela HWND` (o número do meio do id
`window:HWND:0` do `desktopCapturer`), `--qps 60`, `--kbps 8000`,
`--altura 1080` (teto, nunca aumenta), `--segundos S`, `--saida arquivo.h264`,
`--software`, `--sob-demanda`.

Saída do `transmitir`: para cada quadro, 16 bytes (u32 LE tamanho, u8 flags
com bit 0 = quadro-chave, 3 bytes zero, u64 LE captura em µs do relógio QPC) e
o H.264 Annex-B com SPS/PPS antes de todo quadro-chave. Comandos na entrada,
um por linha: `chave`, `kbps N`, `quadro`, `parar` (fechar a entrada também
para). Uma linha JSON por segundo na saída de erro.

## Compilar e testar

```
cd midia
cargo build --release      # Windows com Visual Studio (MSVC), como no CI
cargo +stable-x86_64-pc-windows-gnu build --release   # sem Visual Studio
cargo test --release       # comandos, tamanhos, cabeçalho
node ../scripts/midia-bench.mjs --fora   # Chromium x nativo, ponta a ponta
```

## Medidas

`node scripts/midia-bench.mjs --fora` em 2026-11-08: notebook com Intel UHD +
RTX 2050, 12 threads, Windows 11 25H2, Electron 44 (Chromium 152). Janela de
teste 1920x1080 parecida com jogo (fundo que desliza, 150 bolas, texto
rolando), WebRTC em laço no mesmo Electron, H.264 nos três caminhos, teto de
14 Mbps (o perfil de tela em movimento do Vcall), 12 s de medida depois de
12 s de aquecimento. "Carga" = 12 threads ocupadas, como um jogo pesado.

| caminho | carga | imagem que chega | vidro a vidro p50/p95 | banda | CPU da máquina |
|---|---|---|---|---|---|
| Chromium (OpenH264) | não | 1440x806, 29 qps | 156/183 ms | 12,9 Mbps | 9,7% |
| Chromium + placa (`--disable-gpu-sandbox`, Quick Sync) | não | 1440x804, 30 qps | 158/190 ms | 13,4 Mbps | 8,7% |
| **nativo** (Quick Sync pelo MFT) | não | **1920x1080, 56 qps** | **142/161 ms** | 11,1 Mbps | 9,5% (motor 1,2%) |
| Chromium (OpenH264) | sim | 1440x806, 27 qps | 172/214 ms | 12,0 Mbps | 11,1% |
| Chromium + placa | sim | 1440x804, 28 qps | 193/214 ms | 13,2 Mbps | 9,9% |
| **nativo** | sim | **1920x1080, 57 qps** | **95/118 ms** | 11,7 Mbps | 10,7% (motor 1,2%) |

- Pixels por segundo que chegam: **3,4x** os do Chromium sem carga e **3,7x**
  com carga, com o mesmo processador e a mesma banda.
- Codificar um quadro: 5–6 ms em 1080p (nativo) contra 7–9 ms em 1440x804
  (Chromium com a placa) e 8,5–11,7 ms (OpenH264).
- Nenhum congelamento em nenhum caminho. O MFT da Intel morreu uma vez por
  rodada (MEError ao mudar a banda) e o motor o recriou sem a imagem parar.
- Variação entre rodadas: numa rodada anterior o Chromium chegou a 34–43 qps
  e 92–144 ms. Sem carga a latência fica parecida entre os caminhos; com
  carga o nativo ganha em toda rodada (76–110 ms contra 122–207 ms).
- "Vidro a vidro" aqui inclui desenhar a janela de teste e compor a tela dos
  dois lados (~2 quadros); o que separa os caminhos é o resto.

## Fases

1. **Feita (este branch).** Prova da injeção no Electron 44 (Chromium 152);
   motor no Windows (WGC → Video Processor → MFT da placa, software de
   reserva), modos `medir`/`transmitir`/`--sob-demanda`; banco
   `scripts/midia-bench.mjs` contra o Chromium.
2. **App de mesa no Windows.** `desktop/midia.js` sobe o binário quando a
   pessoa compartilha (janela ou tela, pelo HWND/monitor que o seletor já
   devolve) e repassa os quadros por MessagePort, como o banco faz;
   `core/screen.js` troca a trilha da tela pela falsa + injetor em cada sender
   (na malha, todos recebem o mesmo quadro: codifica uma vez, não uma por
   pessoa); banda = a menor estimativa entre os pares; pedido de chave de
   qualquer par vira IDR; resolução menor quando a banda fica abaixo do piso
   da cena (refazer o conversor em 720p/540p); se o motor falhar, volta ao
   caminho do Chromium sem a pessoa perceber. SFU: o LiveKit cifra (E2EE) numa
   transform própria e só cabe uma por sender, então o injetor tem de cifrar
   junto, com a mesma função do worker do LiveKit.
3. **Som do sistema nativo.** WASAPI em loopback por processo, tirando o
   próprio Vcall (acaba o eco da chamada voltando), Opus de 10 ms, injetado na
   linha `screenAudio` do mesmo jeito.
4. **Mais desempenho.** NVENC e AMF diretos (carregados em tempo de execução,
   sem SDK): latência ultrabaixa, intra-refresh e invalidação de referência
   em vez de IDR, banda que muda sem IDR; prioridade de GPU
   (`D3DKMTSetProcessSchedulingPriorityClass`); captura DXGI para monitor em
   Windows anterior ao 24H2; 120 qps.
5. **Linux.** PipeWire pelo portal (ashpd + pipewire, com token para não
   perguntar toda vez) em DMA-BUF; VAAPI (AMD/Intel) e NVENC (NVIDIA)
   carregados por `dlopen`; X11 por XShm; OpenH264 baixado da Cisco como
   reserva.
6. **CI e pacote.** `cargo build` no `release.yml` (Windows MSVC; Linux com
   cargo-zigbuild e glibc 2.28 para rodar em qualquer distro), o binário em
   `extraResources` como o `livekit-server`, assinado junto da atualização.
7. **Se a injeção tiver limite.** WebRTC nativo (crate `libwebrtc` do LiveKit
   com quadros pré-codificados) ou a API Encoded Source do Chrome, que
   substitui a trilha falsa quando sair (Intent to Prototype em set/2026).
