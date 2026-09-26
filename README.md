# Vcall

Salas de vídeo em malha ponto a ponto, criptografadas fim a fim, com
compartilhamento de tela de alta fidelidade e quadro branco colaborativo.

O servidor apresenta os participantes uns aos outros e para por aí. Áudio,
vídeo, tela, chat e quadro vão direto de um navegador ao outro, cifrados por
DTLS-SRTP. Nenhum conteúdo de conversa passa pelo servidor ou fica em disco.

> **Só quer rodar?** Veja **[COMECE-AQUI.md](COMECE-AQUI.md)** — são dois
> comandos. Este README é para quem vai mexer no código.

---

## Rodando

```bash
npm install        # 1 pacote, menos de um segundo
npm start          # http://localhost:3000
```

Para desenvolver, instale também as ferramentas (ícones, avatares, testes):

```bash
npm install --include=dev
npm run dev        # recarrega o servidor a cada alteração
npm test           # verificação estática + dois navegadores + túnel
npm run vendor     # regenera o sprite de ícones e o pacote de avatares
```

As devDependencies ficam desativadas por padrão (`.npmrc` com `omit=dev`)
porque uma delas baixa navegadores, e nada disso é necessário para rodar: os
ícones e avatares já vêm gerados em `public/vendor/`.

Câmera, microfone e captura de tela só funcionam em **HTTPS** ou em
`localhost` — é uma exigência do navegador, não do aplicativo.

### Deixando outras pessoas entrarem

O jeito mais rápido é um túnel, que já resolve o HTTPS:

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

O túnel carrega a página e a sinalização. A mídia continua indo direto de um
navegador ao outro, fora dele — por isso **o túnel não substitui o TURN**.
Detalhes e verificação em **[TUNEL.md](TUNEL.md)**.

---

## Configuração

**O `.env` é opcional.** Sem nenhuma configuração o sistema sobe e funciona em
`localhost` — só não terá TURN, o que faz diferença quando alguém entra de uma
rede corporativa ou de 4G.

Para configurar, copie o exemplo e edite:

```bash
cp .env.example .env          # Linux e macOS
copy .env.example .env        # Windows
```

O `npm start` lê esse arquivo sozinho (`--env-file-if-exists`), e ignora se ele
não existir. Variáveis exportadas no ambiente têm precedência — útil em Docker,
Railway, Render e afins, onde você define tudo no painel e não usa `.env`.

Tudo é configurável por variável de ambiente; nada precisa ser editado no
código.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor |
| `MAX_PEERS` | `8` | Participantes por sala |
| `TURN_URLS` | — | Endereços do TURN, separados por vírgula |
| `TURN_SECRET` | — | Segredo compartilhado do coturn (`use-auth-secret`) |
| `TURN_USER` / `TURN_PASS` | — | Alternativa com senha fixa (só para testar) |
| `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` | — | Cloudflare Realtime TURN |
| `TURN_API_URL` / `TURN_API_TOKEN` | — | Provedor que entrega `iceServers` por REST (Metered, Xirsys…) |
| `TURN_TTL` | `21600` | Validade das credenciais temporárias, em segundos |
| `STUN_URLS` | STUN do Google | Servidores STUN |
| `ICE_TRANSPORT_POLICY` | `all` | `relay` força o uso do TURN (útil para testar) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

### Sobre o TURN

Sem TURN, cerca de 8 a 15% das chamadas simplesmente **não conectam**: redes
corporativas, CGNAT de operadora móvel e firewalls simétricos bloqueiam a
conexão direta, e o STUN sozinho não resolve.

**Dá para resolver de graça, e bem.** Duas opções sem custo:

```bash
# 1. Metered Open Relay — 20 GB/mês grátis, cinco minutos de configuração
TURN_API_URL="https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=CHAVE" npm start

# 2. coturn próprio — de graça no Oracle Cloud Always Free (10 TB/mês de
#    saída, região em São Paulo). É a melhor opção: qualidade de produção,
#    custo zero. O servidor gera credenciais que expiram; o segredo nunca
#    chega ao navegador.
TURN_URLS="turn:turn.exemplo.com:3478?transport=udp,turns:turn.exemplo.com:5349" \
TURN_SECRET=$(openssl rand -hex 32) npm start
```

Evite `TURN_USER`/`TURN_PASS` em produção: o `/ice` é público, então uma senha
fixa ali vira um relay aberto às suas custas.

**[TURN.md](TURN.md)** traz o passo a passo completo: Oracle Always Free,
Metered, instalação do coturn,
`turnserver.conf` comentado, certificado TLS, firewall, como testar e o que
fazer quando não funciona.

---

## Arquitetura

```
server.js                 entrada: HTTP + sinalização
src/
  config.js               configuração
  ice.js                  STUN/TURN e credenciais temporárias
  http.js                 arquivos estáticos, CSP, compressão, cache
  protocol.js             contrato de sinalização e validação
  rooms.js                registro de salas em memória
  signaling.js            servidor WebSocket
  logger.js
public/
  index.html
  css/   tokens · base · app · board
  js/
    lib/     dom · emitter · util
    core/    signaling · peer · mesh · media · screen · tuning · stats · vad · audio-graph
    ui/      theme · lobby · stage · panel · dock · avatars · audio · photo · toast
    features/whiteboard
  vendor/  icons.svg (Lucide) · avatars.js (DiceBear)
scripts/
  vendor.mjs      gera o sprite de ícones e o pacote de avatares
  check.mjs       verificação estática
  e2e.mjs         teste com dois navegadores reais
  proxy-test.mjs  teste atrás de um túnel HTTPS
```

A regra de dependência é de mão única: `core/` não conhece o DOM, `ui/` não
conhece WebRTC, e `main.js` é o único lugar onde os dois se encontram. Dá para
testar a lógica de conexão sem uma tela — é o que o `e2e.mjs` faz.

### O caminho da mídia

```
Alice ──── WebSocket (só SDP e ICE) ────► servidor ────► Bruno
  └────────── DTLS-SRTP, áudio/vídeo/tela/dados ──────────┘
```

Numa malha, cada pessoa mantém uma conexão com cada outra. É o que permite
criptografia fim a fim sem servidor de mídia — e é também por isso que o limite
é de 8 participantes: com N pessoas, cada uma codifica o vídeo N−1 vezes.
Passar disso exige um SFU no meio, e aí a conversa deixa de ser fim a fim.

---

## Como o compartilhamento de tela foi resolvido

Este era o ponto que não funcionava. As causas, e o que foi feito:

**1. Renegociação no meio da chamada.** Ligar a tela criava uma linha de mídia
nova, o que dispara uma renegociação; quando os dois lados negociavam ao mesmo
tempo, a negociação travava e a tela chegava preta — ou só num sentido.

→ As quatro linhas (microfone, câmera, tela, áudio da tela) são criadas **uma
vez**, antes da primeira oferta. Ligar e desligar qualquer coisa depois disso é
só `replaceTrack`: sem linha nova, sem renegociação, sem conflito.

**2. Linhas órfãs.** Pela especificação, uma linha criada com `addTransceiver`
nunca é reaproveitada para casar com uma linha da oferta remota. Com os dois
lados criando as suas, cada navegador terminava com oito linhas — quatro
enviando para o vazio.

→ Só quem oferta cria as linhas. Quem responde **adota** as que chegaram na
oferta e vira a direção para `sendrecv` antes de montar a resposta. Resultado:
quatro linhas, os mesmos identificadores nas duas pontas, uma única negociação.
O teste automatizado verifica isso.

**3. O encoder achatando o texto.** O padrão do navegador é encolher a imagem
quando a banda aperta — péssimo para código e slides, que ficam ilegíveis.

→ `contentHint = "text"` e `degradationPreference = "maintain-resolution"`:
a resolução é preservada e o que cai é a taxa de quadros. Quem compartilha
vídeo ou animação troca para o perfil de movimento, que faz o inverso. Os
parâmetros são **reaplicados a cada negociação concluída**, porque o Chrome os
zera quando alguém entra ou sai da sala.

**4. Codec errado.** VP9 custa cerca de metade da banda de VP8 e H.264 para o
mesmo texto a 1080p.

→ A linha da tela pede VP9 (e AV1 em chamadas de duas pessoas, onde o custo de
CPU se paga), mantendo `rtx` na lista — removê-la desliga a retransmissão e
produz exatamente o congelamento que se estava tentando evitar.

**5. Orçamento de banda.** Cada conexão estima a banda sozinha e não sabe das
outras. Numa malha, todas tentam ocupar o mesmo enlace de subida ao mesmo
tempo.

→ Há um teto central, dividido pelo número de participantes, e um controle
adaptativo que lê o `getStats` a cada dois segundos: desce rápido quando falta
banda ou sobra carga de CPU, sobe devagar. A tela tem prioridade alta e a
câmera baixa, senão o alocador reparte igual e a tela some.

**6. Detalhes que quebram na prática.** `min` e `exact` são proibidos nas
restrições de captura; o Firefox ignora `frameRate` na captura mas aceita na
trilha; `monitorTypeSurfaces: "exclude"` com `displaySurface: "monitor"` lança
erro; trocar de janela no meio muda a resolução sem encerrar a trilha; e o
`<video>` só deve ser ligado quando a trilha sai de `muted`, senão fica preto
para sempre. Todos estão tratados, com o porquê comentado no código.

---

## O que o sistema faz

**Chamada**

- Antessala com prévia da câmera, escolha de dispositivo, nome e avatar
- Até 8 participantes, malha P2P criptografada
- Destaque automático: a tela compartilhada ou quem está falando
- Fixar participante, tela cheia por ladrilho, grade igualitária
- Reconexão automática: reinício de ICE com período de tolerância e recuo
  progressivo, mais reconexão da sinalização

**Compartilhamento de tela**

- Perfis de nitidez (texto/código/slides) e de fluidez (vídeo/animação)
- Qualidade selecionável: automática, 1080p nítida, 720p fluida, 720p econômica
- Áudio do sistema em trilha própria, sem o processamento de voz que destrói música
- Anotação colaborativa por cima da tela

**Quadro branco**

- Caneta, marca-texto, linha, seta, retângulo, elipse, texto, borracha
- Ponteiro laser com o nome e a cor de quem aponta
- Vetorial: desfazer por autor, nitidez em qualquer tela, exportação em PNG
- Coordenadas normalizadas — todos veem a mesma coisa no mesmo lugar,
  do monitor de 27" ao celular
- Sincronizado pelo canal de dados P2P; o servidor só entra como plano B
- Traço transmitido enquanto é desenhado, não só no final

**Qualidade**

- Indicador de rede por participante, no próprio ladrilho
- Painel com latência, perda, banda, resolução real enviada e recebida, codec,
  custo de codificação, congelamentos e rota (direta ou via TURN)
- Detecção de quem está falando: contorno no ladrilho e barra de intensidade
  ao lado do nome, com histerese para o destaque não piscar
- Supressão de ruído e cancelamento de eco, desligáveis para música

**Conversa e presença**

- Volume por participante, de 0 a 150%, direto no quadradinho de cada um
- Volume geral e escolha de alto-falante nas configurações
- Foto de perfil própria (recortada e comprimida no navegador) ou avatar gerado
- Chat com agrupamento por autor e links clicáveis
- Levantar a mão, reações
- Lista de pessoas com estado de cada uma
- Anfitrião com sucessão automática

**Interface**

- Tema claro e escuro derivados da paleta da marca, além do modo do sistema
- Ícones SVG do [Lucide](https://lucide.dev) e avatares SVG do
  [DiceBear](https://dicebear.com) — nenhum emoji, nenhum ícone improvisado
- Atalhos: `M` microfone · `V` câmera · `S` tela · `Q` quadro · `H` mão ·
  `C` conversa · `P` pessoas · `L` layout · `Espaço` falar enquanto pressiona
- Responsivo de verdade: em telas estreitas o essencial fica na barra e o resto
  vai para o menu "mais"

---

## Privacidade e segurança

- Mídia e dados são cifrados fim a fim (DTLS-SRTP). O servidor não tem as chaves.
- O identificador da sala tem 128 bits aleatórios e vive no fragmento da URL —
  a parte depois do `#`, **que o navegador nunca envia ao servidor**.
- Salas existem só em memória e desaparecem com o último participante.
- Avatares trafegam como `{estilo, semente}` e são desenhados no navegador;
  nenhuma imagem é enviada.
- CSP fechada: nenhum script, fonte ou conexão externa. É por isso que ícones e
  avatares são servidos localmente.
- Toda mensagem de sinalização é validada e limitada em tamanho e frequência.
- O texto do chat é inserido como nó de texto, nunca como HTML.

Limite conhecido: o servidor de sinalização vê quem está em qual sala e quando.
Ele não vê o conteúdo de nada.

---

## Testes

```bash
node scripts/check.mjs        # estático
node scripts/e2e.mjs          # dois navegadores de verdade
node scripts/proxy-test.mjs   # atrás de um túnel HTTPS
CHROMIUM_PATH=/caminho/do/chrome node scripts/e2e.mjs
```

O teste de ponta a ponta sobe o servidor, abre dois navegadores com mídia
falsa, entra na mesma sala e verifica: descoberta, conexão P2P, quadros
chegando nos dois sentidos, ladrilhos montados dos dois lados, compartilhamento
de tela sem criar linha de mídia nova, tela decodificada do outro lado, perfil
de codificação aplicado, quadro branco pelo canal de dados, chat, os dois temas
e a saída limpa de um participante.

---

## Licenças de terceiros

- [Lucide](https://lucide.dev) — ícones, licença ISC
- [DiceBear](https://dicebear.com) — avatares, licença MIT
- [ws](https://github.com/websockets/ws) — WebSocket, licença MIT

Os arquivos em `public/vendor/` são gerados por `npm run vendor` a partir
dessas bibliotecas.
