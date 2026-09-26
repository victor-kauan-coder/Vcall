# Publicando com um túnel (cloudflared, ngrok, Tailscale Funnel)

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

Ele devolve um endereço como `https://algo-aleatorio.trycloudflare.com`. Abra,
crie a sala e mande o link — funciona, é grátis e não pede conta.

---

## O que o túnel resolve (e o que não resolve)

Esta é a parte que confunde, e vale entender antes de contar com ela:

| Problema | Túnel resolve? |
| --- | --- |
| Expor o `localhost` para outras pessoas | **sim** |
| HTTPS, sem o qual câmera, microfone e captura de tela nem abrem | **sim** |
| Certificado válido, sem aviso de segurança | **sim** |
| Fazer a chamada conectar através de NAT restritivo | **não** |

O motivo é que eles operam em camadas diferentes. O túnel carrega o **HTTP e o
WebSocket** — a página e a sinalização. A conversa em si é WebRTC: pacotes UDP
que vão **direto de um navegador ao outro**, sem tocar no túnel nem no seu
servidor. É justamente isso que permite a criptografia fim a fim.

```
                    ┌─────────── túnel ───────────┐
navegador A ────────┤  página, sinalização (WSS)  ├──────── navegador B
     │              └──────────── ▲ ──────────────┘              │
     │                       seu servidor                        │
     │                                                           │
     └────────── áudio, vídeo, tela, quadro (WebRTC) ────────────┘
                   direto, cifrado, fora do túnel
```

O teste automatizado `scripts/proxy-test.mjs` confirma isso na prática: com o
app atrás de um proxy HTTPS, o par de candidatos escolhido pela chamada é
`host ↔ host` — ou seja, a mídia encontrou o caminho direto e ignorou o túnel.

Então: **túnel e TURN não são alternativas um do outro.** O túnel é o que
torna o sistema acessível; o TURN é o que faz a chamada conectar quando o
caminho direto não existe.

---

## Usar só o túnel, sem TURN

É uma escolha legítima, e na maioria dos casos funciona. Sem TURN:

- entre pessoas em redes domésticas comuns: **conecta quase sempre**;
- alguém no 4G/5G de operadora brasileira (quase todas usam CGNAT): **pode não
  conectar**;
- alguém na rede de uma empresa, escola ou hospital: **frequentemente não
  conecta**;
- alguém em Wi-Fi de hotel ou aeroporto: **é aposta**.

O app foi ajustado para esse cenário: se uma conexão não fecha em 20 segundos,
ele avisa em português claro que aquela rede exige TURN, em vez de deixar a
pessoa olhando para um "conectando…" eterno.

Se um dia a falta de TURN incomodar, o [TURN.md](TURN.md) tem duas opções
gratuitas — o Metered leva cinco minutos.

---

## Detalhes do túnel rápido da Cloudflare

**O endereço muda a cada vez.** O quick tunnel sorteia um subdomínio novo a
cada execução. Links de sala antigos deixam de funcionar. Para um endereço
fixo você precisa de um túnel nomeado, com conta e domínio na Cloudflare:

```bash
cloudflared tunnel login
cloudflared tunnel create vcall
cloudflared tunnel route dns vcall vcall.seudominio.com.br
cloudflared tunnel run --url http://localhost:3000 vcall
```

**Sem garantia de disponibilidade.** A própria Cloudflare avisa no arranque que
túneis sem conta não têm SLA e não são para produção. Para uso ocasional, com
amigos ou para demonstrar, está ótimo.

**WebSocket funciona** sem configuração extra — o que o teste com proxy
confirma. Se você trocar por Nginx ou Apache, aí sim precisa encaminhar o
upgrade explicitamente (`proxy_set_header Upgrade $http_upgrade;`), que é o
esquecimento clássico e deixa a página abrindo mas a sala vazia.

**O link é o segredo da sala.** O identificador fica depois do `#`, e o
navegador nunca envia essa parte ao servidor — nem ao da Cloudflare. Ainda
assim, quem tiver o link entra: mande só para quem deve participar.

---

## Alternativas equivalentes

| Ferramenta | Comando | Observação |
| --- | --- | --- |
| **cloudflared** | `cloudflared tunnel --url http://localhost:3000` | grátis, sem conta, endereço sorteado |
| **ngrok** | `ngrok http 3000` | grátis com conta; endereço fixo é pago |
| **Tailscale Funnel** | `tailscale funnel 3000` | endereço fixo, exige conta Tailscale |
| **localtunnel** | `npx localtunnel --port 3000` | sem conta, instável |

Todas funcionam igual do ponto de vista do app: HTTPS na borda, HTTP atrás,
WebSocket por upgrade. E nenhuma delas substitui o TURN.

---

## Verificando

Com o app rodando atrás de qualquer túnel ou proxy HTTPS:

```bash
node scripts/proxy-test.mjs
```

Ele sobe um proxy HTTPS local, abre dois navegadores, entra na mesma sala e
confere: contexto seguro, `wss://` derivado corretamente, WebSocket
atravessando o proxy, microfone abrindo, vídeo fluindo e — o principal — que a
rota da mídia é direta, não passando pelo túnel.

Na chamada de verdade, o painel **Qualidade da chamada** mostra a mesma
informação na linha **Rota**: `direta (P2P)` ou `via servidor TURN`.
