# Para desenvolvedores

## Rodando

```bash
npm install --include=dev   # ferramentas de teste e empacotamento
npm run dev                 # servidor recarregando a cada alteração
npm run desktop             # o app de mesa (Electron)
```

## Arquitetura

```
server.js                  entrada: HTTP + sinalização
src/                       servidor (config, http, protocol, rooms, signaling, ice)
public/js/core/            WebRTC sem DOM: signaling, peer, mesh, media, screen, tuning
public/js/ui/              interface sem WebRTC: stage, panel, dock, sharesheet…
public/js/features/        canvas, transfer, captions, fala-offline, board-notice
public/js/lib/             dom, util, invite (links), identity (sessão/anfitrião)
desktop/                   app de mesa: main, preload, captura, fala, linux, protocol, tunnel
scripts/                   testes, build e vendorização
```

A regra é de mão única: `core/` não conhece o DOM, `ui/` não conhece WebRTC, e
`main.js` é o único lugar onde os dois se encontram. As decisões do app de mesa
que dá para testar sem Electron ficam em funções puras
(`desktop/captura.js`, `desktop/fala.js`, `desktop/linux.js`).

## Testes

| Comando | O que cobre | Tempo |
| --- | --- | --- |
| `npm run check` | Estática, canvas, arquivos, segurança, **correções 3.1** | segundos |
| `npm run test:fixes` | Servidor real + clientes: senha, reconexão sem duplicata, moderação, sala de espera, captura, legendas, convite, Linux | segundos |
| `npm run test:e2e` | Dois Chromium numa chamada: P2P, vídeo, tela, áudio, chat | ~40 s |
| `npm run test:ui` | 33 verificações clicando na interface | ~2 min |
| `npm run test:desktop` | App de mesa real: seletor de janelas, tela, legenda offline | ~1 min |
| `npm test` | Tudo acima menos o desktop | ~4 min |

O teste do app de mesa no Linux precisa de uma tela e de um gerenciador de
janelas:

```bash
xvfb-run -a sh -c 'openbox & node scripts/desktop-test.mjs'
```

Com um Chromium já instalado: `CHROMIUM_PATH=/caminho/chrome npm run test:ui`.

## Integração contínua

`.github/workflows/ci.yml` roda a cada push: servidor e navegador (Ubuntu),
app de mesa (Ubuntu + Xvfb + openbox) e os testes rápidos no Windows.

## Release

`.github/workflows/release.yml` gera os instaladores e publica a Release:

- **Linux:** AppImage, `.deb`, `.rpm`, `pacman`, `.tar.gz`
- **Windows:** instalador NSIS com o `cloudflared` embutido
- `SHA256SUMS.txt` com as somas de verificação

Dispara com uma tag (`git tag v3.4.0 && git push origin v3.4.0`) ou à mão em
**Actions → Release → Run workflow**. As notas vêm de
`docs/release/v<versão>.md`.

## Wiki

As páginas desta wiki vivem em `docs/wiki/` e são publicadas aqui pelo
workflow `.github/workflows/wiki.yml` a cada alteração no `main`.

## Dependências vendorizadas

`npm run vendor` regenera `public/vendor/`: o sprite de ícones (Lucide), o
pacote de avatares (DiceBear) e o `vosk.js` (reconhecimento de fala, com o
worker adaptado para funcionar sem `eval` dentro da CSP).

## Medir as legendas

`scripts/bench-fala.mjs` mede o reconhecimento (o mesmo núcleo do app,
`public/js/features/whisper-nucleo.js`) com voz humana do LapsBM: taxa de
palavras erradas, tempo por frase e memória, para cada configuração. Roda no
GitHub Actions (`.github/workflows/bench-fala.yml`, que tem acesso ao Hugging
Face) sempre que o reconhecedor muda, e a tabela aparece no resumo da execução.
Sem rede: `BENCH_CACHE` com os modelos e `BENCH_FRASES_DIR` com pares
`.wav`/`.txt`.
