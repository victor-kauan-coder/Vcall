# O que mudou nesta versão (3.0)

Resumo do que foi feito sobre a base 2.2, arquivo por arquivo, e por quê.

## 1. Empacotamento desktop

Novos: `desktop/main.js`, `desktop/preload.cjs`, `desktop/entitlements.mac.plist`,
`electron-builder.yml`, `README-DESKTOP.md`.

O app Electron sobe o próprio servidor em `127.0.0.1` numa porta livre e carrega
a interface dele. Deep link `vcall://` registrado, com instância única. As
permissões de câmera, microfone e captura de tela são restritas à origem do
próprio app — o padrão do Electron é liberar tudo.

Leia a ressalva sobre `asar` no `README-DESKTOP.md`: empacotamento não é
criptografia, e nenhum formato desktop impede engenharia reversa de verdade.

## 2. Estabilidade e canais de dados

`public/js/core/peer.js` — os DataChannels passaram de dois para quatro, negociados
e com id fixo como antes:

| canal | uso | entrega |
|---|---|---|
| `canvas-sync` | deltas do canvas | ordenada, confiável |
| `cursor` | ponteiro laser | sem ordem, sem reenvio |
| `audio-control` | estado de voz (VAD) | sem ordem, sem reenvio |
| `canvas-blob` | imagens em pedaços | ordenada, com controle de buffer |

O motivo é concreto: um canal tem uma fila só. Uma imagem de 300 kB no mesmo
canal do indicador de fala faz o indicador chegar segundos atrasado. O canal de
carga pesada tem `bufferedAmountLowThreshold` e `drainBlob()`, porque `send()`
ignorando o buffer derruba a conexão inteira.

A reconexão automática, a fila de mensagens e o re-handshake transparente já
existiam em `core/signaling.js` (backoff com jitter, rejoin automático) e em
`core/peer.js` (perfect negotiation, `restartIce` com backoff). O que foi
acrescentado: mensagens de VAD velhas são descartadas em vez de enfileiradas —
estado de voz atrasado é pior do que estado de voz nenhum.

## 3. Painel inicial de chamadas ativas

Novos: `public/js/ui/dashboard.js`, `public/css/dashboard.css`.
Alterados: `src/protocol.js`, `src/rooms.js`, `src/signaling.js`, `src/http.js`,
`server.js`.

- Salas agora têm nome, visibilidade (pública/privada) e senha opcional,
  definidos por quem cria. Quem entra depois não renomeia nem publica a sala
  dos outros.
- Senha é conferida no servidor contra um SHA-256 com o id da sala como sal,
  comparado em tempo constante. Nunca é guardada em claro nem devolvida.
- Código curto de 6 caracteres por sala, sem letras ambíguas (`0/O`, `1/I/L`),
  para ditar por telefone. Vale enquanto a sala tiver gente.
- `GET /api/rooms` devolve o diretório; `GET /api/code/:code` resolve o código
  no id longo; `list-rooms` faz o mesmo pelo WebSocket.
- O painel atualiza por sondagem a cada 5 s. Assinar por WebSocket exigiria uma
  conexão aberta em toda aba parada nessa tela, para a mesma sensação de tempo
  real.

**Só salas públicas aparecem.** Neste sistema o id da sala *é* o segredo dela;
listar todas seria publicar todas as chaves. As privadas continuam alcançáveis
só por link ou código.

## 4. Áudio

`public/js/ui/audio.js`, `public/js/core/vad.js`, `public/js/core/mesh.js`,
`public/js/main.js`.

- **Mute individual local** já existia no controle de volume de cada
  quadradinho; ganhou confirmação explícita de que o silêncio é só seu.
- **Deafen global** (botão na barra, tecla `D`): corta a saída de todos os
  participantes de uma vez, sem mexer no volume individual de ninguém — ao
  desligar, cada um volta ao volume que tinha. Desliga também o seu microfone,
  porque falar sem ouvir a resposta é a pior das duas situações.
- **VAD do próprio microfone.** Esta era a lacuna real: o analisador só via as
  trilhas que chegavam pela rede, então o destaque de "está falando" aparecia
  para todo mundo menos para quem falava. Agora `mesh.trackSelfAudio()` liga o
  stream local de captura ao mesmo `AnalyserNode` (RMS sobre a forma de onda),
  e o destaque acende no seu card pelo mesmo caminho dos outros.
- O estado de fala vai pelo canal `audio-control`; o nível contínuo também,
  a ~8 Hz. Só a transição fala/cala tem plano B pelo servidor — mandar o nível
  por lá estouraria o limite de mensagens sem acrescentar nada.
- Limiar ajustável nas Configurações, guardado entre sessões.

## 5. Canvas colaborativo infinito

Novo: `public/js/features/canvas.js` (substitui `features/whiteboard.js`).
Alterado: `public/css/board.css`.

A troca de fundo: as coordenadas eram normalizadas de 0 a 1 sobre uma tela
fixa, e "infinito" não tem como ser expresso nesse modelo. Agora há um plano
sem bordas em coordenadas de mundo, e a tela é uma janela sobre ele
(`view = {x, y, scale}`).

- **Navegação**: roda move, `Ctrl`+roda e pinça de trackpad dão zoom (ancorado
  no ponteiro), `Shift`+roda move na horizontal, espaço arrasta, ferramenta mão,
  botão do meio arrasta, botões de zoom, `F` enquadra tudo. Zoom de 5% a 800%.
- **Imagens**: upload, arrastar-e-soltar e `Ctrl+V`. Redimensionadas para 1600 px
  no lado maior e codificadas em WebP (JPEG onde não houver) antes de trafegar —
  é o que decide se a imagem atravessa em meio segundo ou em quinze. Vão
  fatiadas em pedaços de 48 kB pelo canal de carga pesada, com placeholder
  enquanto chegam.
- **Manipulação**: seleção, mover, redimensionar pelos quatro cantos (com
  proporção travada em imagens e com `Shift`), girar (com encaixe de 15° usando
  `Shift`), apagar com `Delete`. Vale para todos os tipos, inclusive traços —
  os pontos são transformados junto.
- **Ferramentas**: caneta, marca-texto, linha, seta, retângulo, círculo, texto
  editável (duplo clique reabre), borracha, laser, mão e seleção.
- **Sincronização**: só o delta trafega. Criar manda o objeto; arrastar manda
  `{id, patch}`; um traço em andamento vai em pedaços enquanto nasce. A cena
  inteira só vai uma vez, para quem chega depois.
- **Concorrência**: cada objeto carrega um relógio lógico (`seq`) e o autor.
  Todos ordenam por `(seq, autor)`, então a pilha de desenho é idêntica em
  todas as máquinas. Alterações no mesmo objeto resolvem por `rev` mais alto,
  com o id do autor desempatando — os dois lados chegam à mesma conclusão sem
  conversar.
- **Desempenho**: culling do que está fora da janela, grade desenhada pelo
  canvas (a de CSS ficava parada enquanto o desenho se movia) com passo que
  dobra conforme o zoom, e exportação PNG da cena inteira, não só do visível.

### Por que não Fabric.js ou Konva.js

A especificação sugeria uma das duas. O motor aqui é próprio por duas razões:
a política de segurança do app proíbe script de terceiros (é o que permite
`script-src 'self'` sem exceções), e o formato dos deltas que trafegam pelo
DataChannel teria de ser definido à mão de qualquer maneira. O modelo é o mesmo
que essas bibliotecas implementam — cena de objetos vetoriais com transformação
e hit-testing.

## Verificações

```
npm run check     # sintaxe, imports, ícones e variáveis CSS — passou
```

Além disso, foram executados aqui:

- teste de integração da sinalização: criação de sala pública e privada,
  diretório, resolução por código, senha certa e errada, relay de VAD,
  `list-rooms` e fallback do canvas pelo servidor — 11 verificações, todas ok;
- teste unitário da geometria do canvas: `bounds` e `hits` para retângulo,
  traço, texto multilinha e objeto girado — 8 verificações, todas ok.

O `npm test` completo (`scripts/e2e.mjs`) precisa do Playwright com navegador
baixado e não foi executado neste ambiente. Rode-o antes de publicar.
