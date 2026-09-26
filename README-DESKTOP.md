# Vcall como aplicativo desktop

O Vcall continua sendo o mesmo sistema: um servidor de sinalização pequeno e
uma interface que roda no navegador. O aplicativo desktop não é uma reescrita
— é uma casca do Electron que **sobe o próprio servidor em `127.0.0.1`** e
abre a interface nele.

## Por que assim, e não com `file://`

Câmera, microfone e captura de tela só funcionam em origem segura. `file://`
não é origem segura para o Chromium; `http://127.0.0.1` é. Carregar a
interface a partir de um servidor local também mantém a política de segurança
de conteúdo (CSP) exatamente igual à da versão web, sem exceções criadas só
para o desktop — e exceção de CSP no desktop é como a maioria dos aplicativos
Electron acaba com uma brecha.

## Rodar em desenvolvimento

```bash
npm install
npm run desktop
```

A janela abre com um servidor embutido numa porta livre escolhida pelo sistema.

Para usar um servidor de sinalização já publicado em vez do embutido:

```bash
SIGNALING_URL=https://vcall.suaempresa.com npm run desktop
```

## Gerar os instaladores

```bash
npm run desktop:build:win      # dist/VcallSetup-<versão>.exe  (NSIS, x64, com cloudflared)
npm run desktop:build:linux    # dist/Vcall-<versão>-x86_64.AppImage e .deb
```

O build Linux precisa rodar num Linux (o `.deb` usa o `fpm`). No Windows,
pelo WSL, com o Node Linux que já vem em `.cache-node-linux/`:

```bash
wsl -d Ubuntu -- bash -lc 'cd "$(wslpath "$PWD")" && PATH="$PWD/.cache-node-linux/node-v22.13.1-linux-x64/bin:$PATH" node node_modules/electron-builder/cli.js --linux'
```

## Janela e mini-janela

- **Sem moldura do sistema.** A interface vai até o topo; minimizar, maximizar
  e fechar são os botões nativos por cima dela (Window Controls Overlay), na
  cor do tema. As barras do topo servem para arrastar a janela.
- **Mini-janela (tecla `J` ou o botão ao lado de "sair").** No app, a própria
  janela encolhe para o canto da tela e fica por cima de tudo, com os vídeos
  de quem fala e os controles essenciais; "voltar" restaura o tamanho. O
  Electron anuncia a Document Picture-in-Picture API mas não a implementa (a
  janela nasce e morre na hora), por isso o modo compacto é a janela principal.
  No Chrome/Edge a mesma função usa a Document PiP de verdade.
- **Porta fixa (7718).** Nome, avatar e preferências ficam guardados por
  origem; com porta sorteada, a pessoa perderia tudo a cada abertura.

Os arquivos saem em `dist/`. Multiplataforma tem as limitações de sempre:
assinar um `.dmg` exige macOS e um certificado da Apple; assinar um `.exe`
exige um certificado de código. Sem assinatura, o instalador funciona, mas o
sistema mostra um aviso de origem desconhecida.

## Links de convite abrindo o aplicativo

O app registra o esquema `vcall://`. Estas três formas funcionam:

```
vcall://ID_DA_SALA
vcall://join/ID_DA_SALA
vcall://call?room=ID_DA_SALA
```

Clicado com o aplicativo aberto, o link cai na janela que já existe (há trava
de instância única); com o aplicativo fechado, ele abre o app já dentro da
sala. No macOS isso chega pelo evento `open-url`; no Windows e no Linux, como
argumento de linha de comando — os dois caminhos estão tratados.

Para transformar um link web num link de aplicativo, troque
`https://servidor/#ID` por `vcall://ID`.

## Permissões de mídia

O processo principal restringe as permissões à própria origem do app
(`setPermissionRequestHandler` e `setPermissionCheckHandler`). O padrão do
Electron é conceder tudo a qualquer coisa que a janela carregar; aqui não.

A captura de tela usa `setDisplayMediaRequestHandler` com o seletor do sistema
quando ele existe (Electron 30+ no Windows e no macOS); onde não existe, cai
para a lista do `desktopCapturer`.

## Proteção do código — o que dá e o que não dá

O empacotamento usa `asar`, e o executável não expõe uma árvore de arquivos
editável. **Isso não é criptografia.** Quem souber o que está fazendo extrai o
conteúdo de um `.asar` com uma linha de comando, e isso vale para qualquer
aplicativo Electron, Tauri ou nativo: o código precisa estar executável na
máquina do usuário em algum momento.

O que o `asar` resolve de verdade é o caso comum — o usuário que abriria a
pasta e mexeria num arquivo por curiosidade ou por engano.

Se você precisa de uma barreira mais alta, as opções reais são:

1. **`asarUnpack` mínimo e código compilado.** Rodar `esbuild --minify` sobre
   `public/js` e `src` antes do empacotamento deixa o resultado ilegível na
   prática, sem custo de execução.
2. **V8 snapshots / bytenode.** Compila o JavaScript para bytecode do V8.
   Aumenta bastante o atrito, ao custo de amarrar o pacote a uma versão exata
   do runtime. Não vem configurado aqui de propósito: quebra em cada
   atualização do Electron.
3. **Mover o que é sensível para o servidor.** É a única proteção que não é
   ilusão. No Vcall, porém, quase nada é sensível: a lógica está na sinalização
   e na negociação WebRTC, que são públicas por natureza.

## Estrutura

```
desktop/
  main.js                   processo principal: servidor embutido, deep link, permissões
  preload.cjs               ponte mínima entre janela e sistema (só informação)
  entitlements.mac.plist    câmera, microfone e rede sob hardened runtime
electron-builder.yml        alvos, ícones, protocolo e o que entra no pacote
```

`extraMetadata.main` no `electron-builder.yml` é o que permite `npm start`
continuar subindo só o servidor (`server.js`) enquanto o pacote desktop usa
`desktop/main.js` como ponto de entrada.
