# HANDOFF — Vcall

Leia isto antes de mexer em qualquer coisa. É o mapa que não dá para deduzir
lendo os arquivos em ordem alfabética.

> **App Android:** desde a 3.7.4. Ver a seção 12.

**Repositório:** `victor-kauan-coder/vcall` · **Versão no `package.json`:** 3.7.3
**Idioma do código:** português. Nomes de funções, variáveis e comentários em
português. Mantenha — misturar os dois é pior que escolher o errado.

---

## 1. O que é, em uma frase

Salas de vídeo ponto a ponto (malha WebRTC, sem servidor de mídia), servidas
por um `server.js` de Node, que também é empacotado num executável de uma peça
só para Windows e Linux.

Duas formas de rodar, e a diferença explica metade do código:

| | Servidor web | Aplicativo |
|---|---|---|
| Entrada | `server.js` | `desktop/main.js` (Electron) |
| Quem abre a janela | o usuário, no navegador dele | o próprio app, janela sem barra de título |
| Link público | você configura | túnel Cloudflare sob demanda |
| Permissões de câmera | o navegador pergunta | concedidas pelo processo principal |

**O aplicativo é Electron.** Até a 3.5.1 ele era um Node SEA que abria o
Chromium do sistema em modo `--app=`. Duas coisas mataram esse caminho:

1. **A barra de título não saía.** Em `--app=` a janela roda como
   `standalone` e a sobreposição de controles (`window-controls-overlay`)
   nunca liga — medido com o CDP, não suposto: `{"visivel": false, "modo":
   false, "standalone": true}`. Forçar com `--enable-features` não muda.
   No Electron, `titleBarStyle: "hidden"` resolve numa linha.
2. **Dependia de o usuário ter Chromium.** Era metade da dor no Linux.

O que sobrou do caminho antigo: `scripts/build-exe.mjs`,
`scripts/build-installer.mjs`, `desktop/launcher.js`, `desktop/navegador.js`,
`desktop/perfil.js`, `desktop/setup.js`. **Não são mais distribuídos.**
Mantidos por enquanto porque `navegador.js` e `perfil.js` guardam o que foi
aprendido sobre Snap e Wayland; apague quando tiver certeza de que não volta.

### A sobreposição de controles tem DOIS gatilhos

O Electron liga a API (`navigator.windowControlsOverlay.visible === true` e
`env(titlebar-area-*)` funcionam) mas **não** reporta
`display-mode: window-controls-overlay`. Um PWA instalado faz o contrário.
Por isso quem decide é `public/js/boot-tema.js`, que põe `data-sem-barra` no
`<html>`, e o CSS pende desse atributo — nunca de uma media query sozinha.

---

## 2. Mapa dos diretórios

```
server.js              servidor HTTP + sinalização WebSocket
desktop/               tudo que só existe no executável
public/js/core/        WebRTC puro: mesh, peer, media, screen, stats, tuning
public/js/ui/          componentes de tela (dock, painel, palco, folhas…)
public/js/features/    o que o usuário chama de funcionalidade
public/js/lib/         utilitários sem dependência de DOM
public/css/            base → app → dashboard → mobile (nesta ordem!)
scripts/               build, testes, diagnóstico
```

### Ordem do CSS importa

`public/index.html` carrega `mobile.css` **por último, de propósito**: ele é a
última palavra sobre telas pequenas e vence por ordem de cascata, não por
especificidade. Se você inserir uma folha nova depois dele, quebra o celular.

---

## 3. As decisões que você vai querer reverter (e por que não deve)

Cada uma destas custou um bug real para ser descoberta.

**O túnel não pode alcançar o painel de controle.** O `cloudflared` conecta
pelo `127.0.0.1`, então "é local" é verdade para ele também. `desktop/guard.js`
confere o cabeçalho `Host` e os cabeçalhos de proxy (`cf-connecting-ip`,
`cf-ray`, `x-forwarded-for`). Sem isso, qualquer pessoa com o link público
ligava e desligava o túnel da sua máquina.

**O `pagehide` tem três segundos de carência.** Recarregar a página dispara
`pagehide`, e desligar o programa na hora derrubava a chamada ao apertar F5.
`desktop/vida.js` espera (`DESPEDIDA_MS`) e cancela se o batimento voltar.

**O ícone é aplicado ANTES da injeção do SEA.** O `rcedit` num binário de
100 MB roda por minutos e não termina. Antes, leva 2 segundos. Não troque a
ordem em `scripts/build-exe.mjs`.

**Links `vcall://` são validados com rigor.** A janela do app não tem barra de
endereço: quem clica não vê para onde está indo. `desktop/protocol.js` só
aceita `https` ou IP de rede privada, com id de sala válido no fragmento.

**O perfil do navegador muda de lugar conforme o navegador.** Ver seção 4.

**Limite de taxa não encerra a conexão.** Fechar com 1008 na primeira
infração, com o cliente tratando 1008 como fatal, derrubava a chamada quando as
legendas falavam demais. Corrigido nas três camadas; não "simplifique" de volta.

---

## 4. Linux — onde mora o perigo

É a plataforma que mais deu trabalho, e por motivos que não aparecem no
Windows.

**Não existe "o caminho do navegador".** `desktop/navegador.js` procura no PATH
de verdade, mais `/usr/bin`, `/usr/local/bin`, `/opt/*`, `/snap/bin` e os
diretórios de exportação do Flatpak. Procurar só em `/usr/bin` era o motivo de
o programa não abrir em várias distribuições.

**Snap é prisão.** No Ubuntu, `chromium` é um Snap, e o confinamento do Snap
**não deixa escrever em pasta oculta dentro da pasta pessoal**. O perfil vivia
em `~/.vcall/navegador` — oculto. O Chromium abortava com `Failed to create …
SingletonLock: Permission denied` e o aplicativo simplesmente não abria.
`perfilPara()` move o perfil para `~/snap/<nome>/common/vcall-perfil` quando o
navegador é confinado. Navegador de pacote normal tem prioridade sobre Snap.

**Compartilhar tela no Wayland não passa pelo navegador.** Passa pelo
`xdg-desktop-portal` + PipeWire. Sem `--enable-features=WebRTCPipeWireCapturer`
o Chromium tenta capturar pelo X11, e sob Wayland isso devolve tela preta — ou
a promessa do `getDisplayMedia` nunca resolve, e a chamada parece travada. As
opções ficam em `opcoesLinux()`, em `desktop/perfil.js`.

**O `getDisplayMedia` tem prazo.** `public/js/core/screen.js` corta em dois
minutos e explica o que instalar. Um portal ausente deixava o botão
pressionado para sempre.

**Compartilhar tela derrubava o app (até a 3.6).** Duas causas:

- Fechar ou cancelar o seletor do portal derrubava o processo inteiro: bug do
  Electron até a 34 ([electron#45198](https://github.com/electron/electron/issues/45198)),
  corrigido na 35/36. **Não volte o Electron para antes da 35.** A 3.7 usa a 44.
- Dois pedidos de captura simultâneos abriam duas sessões do portal no mesmo
  PipeWire. `umPorVez()` em `desktop/captura.js` recusa o segundo e tem prazo.

**Electron 38+ abre como Wayland nativo.** No Wayland nativo a janela não se
posiciona (mini-janela e sobreposição do modo jogo perdem o canto). Por isso,
quando há XWayland, o app se reabre uma vez com `--ozone-platform=x11` na linha
de comando (`argsParaX11()` em `desktop/linux.js`). **Não troque isso por
`appendSwitch`:** o Electron escolhe Wayland/X11 antes do main.js, e a opção
posta depois só chega à GPU. Foi o que fez a 3.7.0/3.7.1 não abrir no Fedora
(GPU caindo com exit 139 e "XGetWindowAttributes failed for window 1"). O WSLg
não mostra o problema porque deixa `XDG_SESSION_TYPE` vazio; para reproduzir,
rode com `XDG_SESSION_TYPE=wayland`. `opcoesDeExibicao()` fica só com
`--gtk-version=3` (o Electron 36+ usa GTK 4 no GNOME, e misturar com GTK 3
aborta o processo). Quedas de processos auxiliares (GPU, rede) vão para o
registro como `processo-caiu`.

**O que já foi verificado em Linux:** a 3.7 rodou no Ubuntu 26.04 (WSLg, com
Wayland e XWayland): abre, entra na sala e compartilha a tela, inclusive com
dois pedidos seguidos, sem cair. **Ainda não testado:** o seletor do portal de
verdade (o WSL não tem portal) num Ubuntu e num Fedora instalados.

---

## 5. Rede — por que a chamada travava ao compartilhar tela

Cada `RTCPeerConnection` estima a banda **isoladamente** e não sabe das outras.
Numa malha com N pares, todas disputam o mesmo enlace de subida.

`meshBudget()` em `public/js/core/tuning.js` é o teto central. O erro antigo:
ele partia de um palpite fixo de **8 Mbps de subida**. Quem tem 3 Mbps recebia
um teto três vezes maior que o enlace, enchia a fila do roteador e o
congelamento aparecia **em todo mundo**, não só em quem transmitia.

Hoje o teto vem de `availableOutgoingBitrate` somado entre as conexões
(`#uplink()` em `public/js/core/stats.js`), com suavização **assimétrica**:
cai na hora, sobe devagar. É isso que estabiliza.

O piso por par (600 kbps de tela) só vale **enquanto a soma couber no enlace**.
Essa é a regra que o teste `✓ rede: o orçamento da malha cabe no enlace medido`
protege — se você mexer no piso, ele quebra, e com razão.

**Próximo passo, se precisar escalar:** malha pura não passa de ~8 pessoas com
vídeo. Distribuir carga de verdade exige ou uma árvore de retransmissão (um par
repassa para os outros) ou um SFU. As duas mudam a arquitetura; nenhuma foi
feita.

---

## 6. Build

```bash
npm run check                  # os testes + verificação estática
npx electron-builder --win     # dist/VcallSetup-<versão>.exe
npx electron-builder --linux   # AppImage, deb, rpm, pacman, tar.gz
```

**Mas o caminho normal é a tag.** `.github/workflows/release.yml` constrói
Windows e Linux em runners de verdade e publica a Release:

```bash
git tag v3.6.0 && git push origin v3.6.0
```

**Armadilha:** no Windows o AppImage falha com "A required privilege is not
held by the client" — ele precisa de link simbólico, e o Windows só permite
com modo desenvolvedor. Localmente dá para gerar `tar.gz`; o resto sai no CI.

**Armadilha 2:** `extraFiles` do electron-builder aponta para
`.cache-cloudflared/`, que é ignorado pelo git. O workflow baixa o binário
antes de empacotar, um passo por sistema. Se adicionar uma plataforma, some
o passo de download junto — senão o build quebra só lá.

## 7. Testes

```
scripts/features-test.mjs   canvas, arquivos, grade, áudio, orçamento de rede
scripts/host-test.mjs       painel local, token, links vcall://, desligamento
scripts/security-test.mjs   origem do WebSocket, limite de taxa, cabeçalhos
```

Rodam sem navegador. São rápidos. Rode antes de qualquer build.

O teste de segurança usa `http.request` cru, **não** `fetch`: o `fetch` do Node
sobrescreve o cabeçalho `Host` em silêncio, e o teste passava sem testar nada.

---

## 8. Atualizações

Desde a 3.7 o app **se atualiza sozinho**, mas só com o pacote assinado por nós:

- `desktop/atualizador.js` procura (ao abrir e a cada 6 h) e baixa com o
  electron-updater; a instalação automática DELE fica desligada, porque é
  armada antes de qualquer conferência.
- Baixado o pacote, ele busca `<pacote>.sig` na release e confere com a chave
  pública que vai no app (`desktop/chave-atualizacao.pem`, Ed25519). A mensagem
  assinada inclui a versão: um instalador antigo e legítimo não passa por novo.
- Windows e AppImage instalam ao fechar o app; .deb/.rpm só pelo botão (o
  sistema pede senha); pacman e .tar.gz só avisam (`modoDeInstalacao()`). O
  pacman não entra no `latest-linux.yml` do electron-builder 25.
- **A chave privada não está no repositório.** Ela é o segredo
  `VCALL_UPDATE_KEY` do GitHub, usado pelo job "publicar" para assinar
  (`scripts/assinar-atualizacao.mjs`). Sem o segredo, a release sai sem `.sig`
  e os apps recusam instalar sozinhos aquela versão (só avisam). Perder a chave
  privada = gerar outra e publicar uma versão com a pública nova; quem estiver
  na antiga precisa instalar essa à mão.

A versão instalada vem de `app.getVersion()` (o `package.json` empacotado).
`VERSAO` em `desktop/atualizacao.js` só serve ao executável antigo (SEA).

---

## 9. Segredo do código-fonte — o que é verdade

O README para quem recebe o executável diz que o código é secreto. Isso é
**parcialmente verdade e está declarado honestamente** em
`README-EXECUTAVEL.md`: tudo que está em `public/` é servido para o navegador
de todo mundo que entra na sala, por construção. O que fica dentro do binário é
o servidor e o `desktop/`.

Não prometa mais do que isso para o usuário.

---

## 10. Dados do usuário

`~/.vcall/` guarda registro (`vcall.log`), perfil do navegador, marcador de
instância e o cache de atualização. **A desinstalação preserva essa pasta** —
é onde ficam as permissões já concedidas. `limparInstalacaoAntiga()` usa uma
lista fechada de 18 nomes; nunca troque por um `rm -rf` do diretório.

---

## 11. Estado atual e o que falta

Feito e verificado:
- responsivo de celular (375×812 e paisagem 740×360), telas conferidas uma a uma
- borracha do canvas preserva imagens de fundo
- fechar a janela derruba o túnel, por cinco caminhos diferentes
- orçamento de banda medido, com teste

Feito mas **não verificado em máquina real**:
- todas as correções de Linux da seção 4

Não feito:
- árvore de retransmissão / SFU (seção 5)
- gestos de arrastar para fechar as folhas no celular
- assinatura de pacote (seção 8)

---

## 12. App Android e logo em vetor

Pedido: um APK otimizado, com tudo funcionando, e a logo vetorizada para o app.

### O que é (e o que não é)

**Não existe servidor público:** quem cria a chamada é o app de mesa (servidor
local + túnel `https://…trycloudflare.com`). Por isso o APK **entra** em
chamadas, não cria. Ele é um WebView em Java puro, sem AndroidX:

- **Tela inicial** vem de dentro do APK (`assets/inicio/index.html`): logo,
  campo para colar o link, botão Colar, recentes. Servida pela origem falsa
  `https://appassets.androidplatform.net/` (`shouldInterceptRequest`).
- **A chamada** é carregada do servidor de quem convidou: a MESMA interface
  do computador, então as duas pontas sempre falam a mesma versão.
- **`assets/injetar.js`** roda em toda página de chamada: salva downloads
  `blob:` (arquivo da conversa, gravação, transcrição, quadro) em
  `Downloads/Vcall` pela ponte; avisa o Android quando a pessoa entra/sai da
  sala (`#dock` visível); passa a cor do tema (meta theme-color) para as
  barras do sistema; e esconde barra e controles na mini-janela. Só usa
  coisas que a interface tem desde a 3.x, para funcionar com app de mesa antigo.

| Arquivo | Papel |
| --- | --- |
| `android/app/src/main/java/com/vcall/app/MainActivity.java` | WebView, permissões de câmera/microfone, escolher arquivo, mini-janela (PiP), botão voltar (na chamada vira PiP), convites, bordas da tela, recriar a página se o motor cair |
| `…/Ponte.java` | `window.VcallAndroid`. Métodos de navegação e área de transferência só valem na tela inicial (qualquer página vê a ponte) |
| `…/ChamadaService.java` | Serviço em primeiro plano "Chamada em andamento" (sem ele o Android corta câmera/mic fora do app) |
| `…/Links.java` + `src/test/…/LinksTest.java` | Acha a sala no texto colado/compartilhado: `https://…/#sala`, `/abrir#sala`, `vcall://join?u=…`, sem `https://`, no meio de mensagem. Só HTTPS (exceto localhost) |
| `…/Recentes.java` | Últimas 6 salas (SharedPreferences) |
| `AndroidManifest.xml` | `configChanges` amplo (girar a tela não recarrega = não derruba a chamada), PiP, intents: `vcall://`, `https://*.trycloudflare.com`, Compartilhar (text/plain) |
| `res/xml/rede.xml` | Só HTTPS; HTTP só para localhost (teste com `adb reverse`) |
| `app/build.gradle` | Versão vem do `package.json` da raiz. Copia `brand/vcall-simbolo.svg` e a fonte Bricolage para os assets na hora do build. Release com R8 e assinatura por variáveis de ambiente (abaixo) |

### Logo em vetor (feito)

- `brand/vcall-simbolo.svg` (só o símbolo), `brand/vcall-icone.svg` (ícone
  com o fundo `#12103b`, cantos 115/512), `brand/vcall-logo.svg` (símbolo +
  "Vcall"). O símbolo é geometria limpa (cápsulas + círculos) ajustada sobre
  `public/assets/logo-mark.png` (96% de sobreposição); as letras são traçado.
- Ícone do Android: `res/drawable/ic_launcher_foreground.xml` (adaptável,
  com gradientes) e `ic_launcher_monochrome.xml` (ícone temático do Android
  13+ e ícone da notificação). Gerados por `brand/gerar-logo.py`.
- Cuidado: no SVG a cor com alfa é `#RRGGBBAA`; no Android é `#AARRGGBB`.
  O gerador guarda a opacidade à parte e escreve cada formato.

### Estado

- [x] Compila: APK de release com R8 e assinado: **75 KB** (`dist-android/`, fora do git).
- [x] `LinksTest`: 10/10.
- [x] Testado no emulador (Android 16, WebView 153) com `scripts/android-test.mjs`
      (celular + navegador no Windows na mesma sala): 37 verificações.
      Entrar, áudio/vídeo nos dois sentidos, mic/câmera, trocar de câmera,
      conversa, receber e baixar arquivo, enviar arquivo pelo seletor do
      Android, reação, mão, quadro com o dedo, gravar, legendas (aviso), barras
      do sistema, mini-janela (botão início e voltar) com a mídia seguindo,
      girar a tela, desligar pela notificação, Compartilhar → Vcall, link
      expirado, recentes, Colar.
- [x] Chave de assinatura FORA do repositório: `~/.vcall/android/vcall.jks`
      (senha em `senha.txt` ao lado). **Perder = não dá para atualizar o app
      instalado.** Faça backup.
- [ ] Job no CI para gerar o APK e anexar à release (precisa dos segredos).
- [ ] Opcional: `public/js/abrir.js` no Android oferecer "Abrir no app".

Bugs achados no teste e corrigidos:
- 404 com acento na frase de status fechava o app (ali só ASCII).
- `fetch(blob:)` é bloqueado pelo CSP do servidor: `injetar.js` guarda cada
  Blob ao criar o endereço (`createObjectURL`).
- **O WebView mata a página ao iniciar `webkitSpeechRecognition`** (anuncia a
  API, mas não tem o reconhecedor): `captions.js` trata WebView como sem
  reconhecimento. É código da interface, então só chega a quem convida quando
  o app de mesa for atualizado; até lá o app recupera a página sozinho.
- A notificação ia para "Silenciosas"; agora é `CallStyle` (Android 12+).

### Atualizador do app (3.7.4)

`Atualizador.java` procura `releases/latest` na API do GitHub ao abrir a
tela inicial (de 6 em 6 h, contando só buscas que deram certo) ou pelo
"Procurar atualização" do rodapé, baixa o anexo `Vcall-*.apk` para o cache e
mostra "Vcall X · Atualizar". Instalar passa o APK ao `PackageInstaller`; o
sistema pede um toque (o app não veio da Play Store). Sem assinatura extra:
o Android só aceita APK com a MESMA chave e recusa versão mais velha. Teste
de ponta a ponta: `./gradlew assembleRelease -PversaoTeste=3.7.3` gera um APK
"velho" com a mesma chave; instalado, ele acha a release nova e se atualiza.

**CI:** o job `android` do `release.yml` gera e assina o APK se existirem os
segredos `VCALL_ANDROID_KEYSTORE` (o .jks em base64) e `VCALL_ANDROID_SENHA`.
Sem eles a release sai sem APK (aviso no log) e o APK é anexado à mão:
`gh release upload v<versão> dist-android/Vcall-<versão>.apk`. Criar os
segredos (o usuário decide):
`base64 -w0 ~/.vcall/android/vcall.jks | gh secret set VCALL_ANDROID_KEYSTORE --repo victor-kauan-coder/Vcall`
e `gh secret set VCALL_ANDROID_SENHA --repo victor-kauan-coder/Vcall < ~/.vcall/android/senha.txt`.

### Como compilar

```bash
cd android
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"   # JDK 21 do Android Studio
./gradlew testDebugUnitTest assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Gradle 8.14.3 e AGP 8.11.0 já estão no cache (`~/.gradle`), SDK 36 em
`%LOCALAPPDATA%/Android/Sdk`. Release assinado: defina
`VCALL_ANDROID_KEYSTORE` (caminho do .jks), `VCALL_ANDROID_SENHA` e
opcionalmente `VCALL_ANDROID_ALIAS`, e rode `./gradlew assembleRelease`.
Gerar a chave (uma vez, guardar fora do repo, junto da chave de atualização):
`keytool -genkeypair -v -keystore ~/.vcall/android/vcall.jks -alias vcall -keyalg RSA -keysize 4096 -validity 36500`.
**Perder essa chave = não dá para atualizar o app instalado.**

### Como testar (o plano que estava em curso)

1. Emulador: `emulator -avd Medium_Phone_API_36.1 -camera-back emulated -camera-front emulated`.
2. Servidor: `npm start` na raiz (porta 3000) e `adb reverse tcp:3000 tcp:3000`
   (no emulador, `http://localhost:3000` é origem segura: câmera funciona).
3. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
4. Abrir uma sala: `adb shell am start -a android.intent.action.VIEW -d "vcall://join?u=http%3A%2F%2Flocalhost%3A3000%2F%23<sala de 16+ caracteres>"`.
5. Segundo participante: Playwright no Windows em `http://localhost:3000/#<sala>`
   com `--use-fake-device-for-media-stream` (ver `scripts/ui-test.mjs`).
6. Controlar a página do app: build de depuração liga a inspeção;
   `adb shell cat /proc/net/unix | grep webview_devtools` e
   `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, depois
   `chromium.connectOverCDP("http://localhost:9222")`.

Conferir, um por um: tela inicial (claro/escuro), colar link, recentes,
permissões, vídeo e áudio nos dois sentidos, ligar/desligar câmera e mic,
trocar câmera frontal/traseira, conversa, enviar arquivo (seletor) e receber
(cai em Downloads/Vcall), reações, levantar a mão, quadro com o dedo, temas,
gravar e baixar, mini-janela (botão início e voltar), seguir em segundo plano
com a notificação, "Sair da chamada" pela notificação, girar a tela sem cair,
Compartilhar → Vcall, link `vcall://`, servidor fora do ar (volta ao início
com aviso).

### Limites conhecidos (do WebView, não do app)

- **Compartilhar a tela não existe** no WebView do Android (`getDisplayMedia`);
  a interface já esconde o botão sozinha.
- **Legenda da própria fala** não: o reconhecimento de voz do navegador não
  existe no WebView e o motor offline é do app de mesa. Legendas dos outros
  chegam normalmente (são texto).
- Notificações da página (Notification API) não existem no WebView.
