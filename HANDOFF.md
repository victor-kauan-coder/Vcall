# HANDOFF — Vcall

Leia isto antes de mexer em qualquer coisa. É o mapa que não dá para deduzir
lendo os arquivos em ordem alfabética.

**Repositório:** `victor-kauan-coder/vcall` · **Versão no `package.json`:** 3.0.0
**Idioma do código:** português. Nomes de funções, variáveis e comentários em
português. Mantenha — misturar os dois é pior que escolher o errado.

---

## 1. O que é, em uma frase

Salas de vídeo ponto a ponto (malha WebRTC, sem servidor de mídia), servidas
por um `server.js` de Node, que também é empacotado num executável de uma peça
só para Windows e Linux.

Duas formas de rodar, e a diferença explica metade do código:

| | Servidor web | Executável |
|---|---|---|
| Entrada | `server.js` | `desktop/launcher.js` |
| Quem abre a janela | o usuário, no navegador dele | o programa, num Chromium com perfil próprio |
| Link público | você configura | túnel Cloudflare sob demanda |
| Permissões de câmera | o navegador pergunta | já liberadas no perfil, antes de abrir |

`desktop/main.js` é uma **terceira** variante, em Electron, que **não é a que
se distribui**. Ela existe e funciona, mas o `build:exe` não a usa. Se você
mexer em comportamento de janela, confira se mexeu no arquivo certo —
já aconteceu de uma correção ir só para o Electron e o executável continuar
quebrado (foi o caso da opção de PipeWire no Linux).

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

**O que ainda não foi verificado em máquina Linux de verdade:** tudo nesta
seção foi corrigido a partir de leitura de código e de relatos conhecidos do
Chromium. Nenhuma distribuição foi testada de fato por falta de máquina. Se
você tem acesso a uma, comece por Ubuntu (Snap) e Fedora (Wayland).

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
npm run check          # os três testes + verificação de sintaxe
npm run build:exe      # dist-exe/Vcall.exe
npm run build:setup    # dist-setup/VcallSetup.exe (instalador, nada baixado de fora)
```

**Armadilha:** `build:setup` empacota o `dist-exe/Vcall.exe` que estiver lá.
Esquecer de rodar `build:exe` antes gera um instalador com o executável velho
dentro. Já aconteceu.

**Armadilha 2:** o executável instalado não se atualiza sozinho ao você
recompilar. Feche o `Vcall.exe`, rode o instalador, reabra.

---

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

`desktop/atualizacao.js` consulta a API de releases do GitHub e **só avisa**.
Não baixa e não executa — um atualizador automático é, por construção, um
caminho de execução remota de código num programa que já tem câmera e
microfone. Para passar a instalar sozinho, o mínimo é assinar os pacotes e
conferir a assinatura no cliente.

A versão vem de `VCALL_VERSAO` (padrão `3.0.0`). **Ela está defasada**: o
repositório já publicou `v3.4.0`. Acerte `VERSAO` ao lançar.

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
