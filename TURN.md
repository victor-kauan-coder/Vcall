# Configurando o TURN

## Por que isso é necessário

Numa chamada P2P, os dois navegadores precisam achar um caminho direto entre
si. O STUN só descobre o endereço público de cada um — funciona na maioria das
redes domésticas. Mas quando alguém está atrás de:

- rede corporativa com firewall que bloqueia UDP,
- CGNAT de operadora móvel (4G/5G),
- NAT simétrico,
- Wi-Fi de hotel, aeroporto ou universidade,

o caminho direto não existe, e a chamada **simplesmente não conecta**. O TURN é
um servidor que retransmite os pacotes quando o caminho direto falha. Na
prática ele entra em cerca de 8% a 15% das chamadas — e sem ele essas chamadas
ficam na tela de "conectando" para sempre.

A mídia continua criptografada fim a fim mesmo passando pelo TURN: ele
retransmite pacotes cifrados e não tem as chaves.

**Um túnel não resolve isso.** O `cloudflared`, o ngrok e afins carregam a
página e a sinalização; a mídia é WebRTC e vai direto entre os navegadores,
fora do túnel. Os dois resolvem problemas diferentes e se somam — veja
[TUNEL.md](TUNEL.md).

**Dá para rodar sem TURN**, e funciona na maioria dos casos. O app avisa em
português quando uma conexão específica falha por falta dele.

---

## Qual opção escolher

| Opção | Custo | Esforço | Qualidade |
| --- | --- | --- | --- |
| **coturn no Oracle Cloud Always Free** | **grátis, sem prazo** | ~30 min | produção, região em São Paulo |
| **Metered Open Relay** | grátis até 20 GB/mês | 5 min | boa, mas compartilhada |
| **coturn numa VPS paga** | US$ 5–7/mês | ~30 min | produção |
| **Cloudflare Realtime** | US$ 0,05/GB | 5 min | produção, rede global |

Se quer o melhor sem pagar: **coturn no Oracle Cloud Always Free**. São 10 TB
de saída por mês — mais do que este sistema consegue gastar — e o Oracle tem
região em São Paulo, o que mantém a latência baixa para usuários no Brasil.

Se quer resolver em cinco minutos e ver se tudo funciona antes de montar
servidor: **Metered Open Relay**, 20 GB grátis por mês.

---

## Os quatro modos do servidor

O Vcall detecta sozinho, pelo que estiver no ambiente:

| Modo | Variáveis |
| --- | --- |
| Segredo compartilhado (coturn próprio) — **recomendado** | `TURN_URLS`, `TURN_SECRET` |
| Cloudflare Realtime | `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` |
| Provedor por REST (Metered, Xirsys…) | `TURN_API_URL`, `TURN_API_TOKEN` |
| Usuário e senha fixos (só para testar) | `TURN_URLS`, `TURN_USER`, `TURN_PASS` |

Essas variáveis vão num arquivo `.env` na raiz do projeto (copie de
`.env.example`), ou direto no ambiente. O `npm start` lê o `.env` sozinho e não
reclama se ele não existir.

Ao subir, o servidor diz qual está em uso:

```
info  14:32:01 Vcall no ar {"url":"http://localhost:3000","turn":"segredo compartilhado, 2 endereço(s), validade de 6h"}
```

### Sobre a senha fixa

O endpoint `/ice` é público — tem de ser, o navegador precisa buscar a
configuração antes de entrar na sala. Com `TURN_USER` e `TURN_PASS`, qualquer
pessoa que abra a página fica com a senha do seu TURN e pode usá-lo como relay
aberto às suas custas. Serve para testar; em produção use `TURN_SECRET`.

Com `TURN_SECRET`, o servidor entrega a cada pessoa um usuário e uma senha que
expiram em algumas horas (`TURN_TTL`, padrão 6h), calculados por HMAC. O
segredo em si nunca sai do servidor.

---

## Opção grátis 1 — Metered Open Relay (5 minutos)

**20 GB de relay por mês, sem cartão de crédito.** Dá para umas 20 a 40 horas
de chamada em relay — e lembre que só uma fração das chamadas precisa dele.
É o jeito mais rápido de tirar o "não conecta" da frente e testar de verdade.

### Onde ficam as chaves no painel

O Metered tem **duas** chaves diferentes, e é fácil confundir:

| Chave | Onde fica | Para que serve |
| --- | --- | --- |
| **Secret Key** | painel → **Developers** | criar credenciais pela API. Fica só no seu servidor. |
| **API Key** | vem na resposta ao criar uma credencial | é o que vai na URL que o Vcall usa |

Na mesma página **Developers** aparece o **Metered Domain** — é o `SEUAPP` que
entra no endereço `SEUAPP.metered.live`.

### Passo a passo

1. Crie a conta grátis em
   [metered.ca/tools/openrelay](https://www.metered.ca/tools/openrelay/).
2. No painel, abra **Developers** e copie o **Metered Domain** e a
   **Secret Key**.
3. Crie uma credencial TURN. **O jeito mais simples é pelo painel**, em
   **TURN Server → Credentials → Create** — a `apiKey` aparece na tela e você
   não precisa de linha de comando nenhuma.

   Se preferir pela API, veja o bloco do seu sistema logo abaixo.

#### Criando a credencial pela linha de comando

**Linux e macOS**

```bash
curl -X POST "https://SEUAPP.metered.live/api/v1/turn/credential?secretKey=SUA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label": "vcall"}'
```

**Windows (PowerShell)**

No PowerShell, `curl` é apelido de `Invoke-WebRequest`, que **não** aceita
`-X`, `-H` nem `-d` — é daí que vem o erro *"não é possível localizar o
parâmetro"*. Use o comando nativo:

```powershell
$r = Invoke-RestMethod -Method Post `
  -Uri "https://SEUAPP.metered.live/api/v1/turn/credential?secretKey=SUA_SECRET_KEY" `
  -ContentType "application/json" `
  -Body '{"label":"vcall"}'
$r.apiKey
```

Ou chame o curl de verdade, que existe no Windows 10 e 11 — repare no
**`.exe`**, que é o que evita o apelido:

```powershell
curl.exe -X POST "https://SEUAPP.metered.live/api/v1/turn/credential?secretKey=SUA_SECRET_KEY" `
  -H "Content-Type: application/json" `
  -d "{\"label\":\"vcall\"}"
```

A resposta traz a **apiKey**:

```json
{
  "username": "a5c3184b4a4836923cf6bd96",
  "password": "mcOUQqUdXie7PTd1",
  "apiKey": "a57a9a52a4a56f5daffb86a0b6179e00e624"
}
```

4. Ponha essa `apiKey` no seu `.env`:

   ```bash
   TURN_API_URL=https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=A_APIKEY_DA_RESPOSTA
   ```

### `TURN_API_TOKEN` não é usado aqui

No Metered a chave viaja **dentro da URL** (`?apiKey=...`), então
`TURN_API_TOKEN` fica vazio. Essa variável existe para provedores que exigem
cabeçalho `Authorization: Bearer` — Xirsys, por exemplo. Se o seu provedor
pedir POST em vez de GET, use `TURN_API_METHOD=POST`.

Em qualquer caso a chave fica no servidor: o navegador recebe só as
credenciais já prontas, que o próprio provedor faz expirar.

---

## Opção grátis 2 — coturn no Oracle Cloud Always Free (a melhor)

O Always Free da Oracle dá, **sem prazo de validade**:

- 2 OCPUs ARM (Ampere A1) e 12 GB de RAM, ou 2 máquinas AMD de 1 GB
- **10 TB de saída por mês**
- 200 GB de disco
- região em **São Paulo (GRU)** — latência baixa no Brasil

Para efeito de comparação: 10 TB cobrem algo como 10 mil horas de chamada
passando inteiras pelo relay. Na prática você nunca chega perto disso.

Dois avisos honestos: a Oracle **reduziu pela metade** a cota ARM em junho de
2026 (era 4 OCPUs/24 GB, agora 2/12 — ainda é muito mais do que um TURN
precisa), e o cadastro às vezes é recusado sem explicação, principalmente com
cartão pré-pago. Se for recusado, vá de Metered ou de uma VPS de US$ 5.

### Criando a máquina

1. Crie a conta em [oracle.com/br/cloud/free](https://www.oracle.com/br/cloud/free/)
   e escolha a região **Brazil East (São Paulo)** — a região não pode ser
   trocada depois.
2. **Compute → Instances → Create instance**:
   - Imagem: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex**, com **1 OCPU e 6 GB** (sobra folgado)
   - Anote a chave SSH que o painel oferece para baixar
3. Depois de criada, anote o **IP público**.

### Abrindo as portas — os dois lugares

Este é o passo em que quase todo mundo tropeça: na Oracle o tráfego passa por
**dois** filtros, e é preciso abrir os dois.

**No painel** — VCN → Security Lists → Default → Add Ingress Rules, com
*Source* `0.0.0.0/0` e *Stateless* desmarcado:

| Protocolo | Portas |
| --- | --- |
| TCP | 3478, 5349, 80, 443 |
| UDP | 3478, 5349 |
| UDP | 49152–65535 |

**Dentro da máquina** — as imagens da Oracle vêm com o iptables fechado:

```bash
sudo iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 5349 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 49152:65535 -j ACCEPT
sudo netfilter-persistent save
```

Sem a segunda parte, o TURN autentica mas nenhum candidato `relay` aparece —
e o sintoma é idêntico ao de não ter TURN nenhum.

### Instalando o coturn

Aponte um subdomínio (`turn.seudominio.com.br`) para o IP público e siga a
seção **Instalando o coturn** abaixo: é o mesmo coturn, e o `external-ip` do
`turnserver.conf` é obrigatório aqui, porque a máquina não enxerga o próprio
IP público.

---

## Opção paga — Cloudflare Realtime (sem manter servidor)

Gratuito quando usado junto com o SFU da Cloudflare; fora disso,
**US$ 0,05 por GB** de saída do TURN para o cliente. Numa chamada de vídeo
típica, só a fração de chamadas que precisa de relay gera tráfego.

1. Entre no [painel da Cloudflare](https://dash.cloudflare.com/?to=/:account/calls)
   e crie uma **TURN key** em Realtime.
2. Anote o **Key ID** e o **API Token**.
3. Configure e suba:

```bash
CF_TURN_KEY_ID=sua-key-id \
CF_TURN_API_TOKEN=seu-token \
npm start
```

O servidor troca essa chave longa por credenciais curtas automaticamente e
guarda o resultado em cache pela metade da validade, para não pedir uma por
participante.

Endereços usados pela Cloudflare (o servidor recebe isso pronto da API):

```
stun.cloudflare.com:3478    UDP
turn.cloudflare.com:3478    UDP e TCP  (alternativa: 80/TCP)
turn.cloudflare.com:5349    TLS        (alternativa: 443/TCP)
```

---

## Instalando o coturn (Oracle, VPS, ou máquina própria)

Um servidor pequeno resolve: **1 vCPU e 1 GB de RAM** aguentam dezenas de
chamadas simultâneas. O que importa de verdade é a **banda**, porque tudo o que
é retransmitido conta duas vezes (entra e sai). Uma chamada de vídeo em relay
consome de 1 a 3 Mb/s em cada direção.

### 1. Instalar

```bash
sudo apt update
sudo apt install -y coturn
sudo sed -i 's/^#TURNSERVER_ENABLED/TURNSERVER_ENABLED/' /etc/default/coturn
```

### 2. Gerar o segredo

```bash
openssl rand -hex 32
```

Guarde o resultado: é o mesmo valor que vai em `static-auth-secret` no coturn e
em `TURN_SECRET` no Vcall.

### 3. Configurar

`/etc/turnserver.conf`:

```conf
# --- identidade ---
realm=turn.seudominio.com.br
server-name=turn.seudominio.com.br

# --- endereços ---
# Em nuvem (AWS, GCP, Azure, Oracle) a máquina não enxerga o próprio IP
# público: a linha external-ip é o que faz o coturn anunciar o endereço certo.
listening-ip=0.0.0.0
external-ip=SEU_IP_PUBLICO

listening-port=3478
tls-listening-port=5349

# --- autenticação por segredo compartilhado ---
use-auth-secret
static-auth-secret=COLE_AQUI_O_SEGREDO_GERADO

# --- TLS (use o mesmo certificado do seu domínio) ---
cert=/etc/letsencrypt/live/turn.seudominio.com.br/fullchain.pem
pkey=/etc/letsencrypt/live/turn.seudominio.com.br/privkey.pem

# --- faixa de portas do relay ---
min-port=49152
max-port=65535

# --- segurança ---
# Sem isto, o seu TURN vira um trampolim para varrer a rede interna
# e a rede local do provedor. Não é opcional.
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

no-cli
no-tlsv1
no-tlsv1_1

# --- operação ---
fingerprint
stale-nonce=600
user-quota=12
total-quota=1200
log-file=/var/log/turnserver.log
simple-log
```

Se a máquina não tem IPv6, acrescente `no-udp-relay-ipv6` — evita erros no log.

### 4. Certificado TLS

A porta 5349 com TLS é o que salva as redes mais fechadas, que só deixam sair
tráfego que parece HTTPS.

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d turn.seudominio.com.br
sudo usermod -aG ssl-cert turnserver
sudo chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
```

Renovação automática: o certbot já instala um timer. Adicione um gancho para o
coturn reler o certificado:

```bash
echo 'systemctl restart coturn' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

### 5. Firewall

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp
```

Em nuvem, abra as mesmas portas também no grupo de segurança do provedor — é o
esquecimento mais comum, e o sintoma é um TURN que autentica mas nunca
retransmite.

### 6. Subir

```bash
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

### 7. Apontar o Vcall

```bash
TURN_URLS="turn:turn.seudominio.com.br:3478?transport=udp,turn:turn.seudominio.com.br:3478?transport=tcp,turns:turn.seudominio.com.br:5349?transport=tcp" \
TURN_SECRET=o-mesmo-segredo-do-coturn \
npm start
```

Os três endereços têm papéis diferentes e vale listar todos: **UDP** é o
caminho normal e o de melhor qualidade; **TCP** cobre redes que bloqueiam UDP;
**TLS na 5349** atravessa firewalls corporativos que só liberam o que parece
tráfego HTTPS.

---

## Testando

### O servidor está gerando credenciais?

```bash
# Linux e macOS
curl -s localhost:3000/ice | python3 -m json.tool
```

```powershell
# Windows (PowerShell)
Invoke-RestMethod http://localhost:3000/ice | ConvertTo-Json -Depth 5
```

Mais simples ainda, em qualquer sistema: abra `http://localhost:3000/ice` no
navegador.

Deve aparecer `"hasTurn": true`, o `turnMode` em uso e um bloco com `urls` de
`turn:`, um `username` que começa com um carimbo de tempo e um `credential`.

### O coturn aceita essa credencial?

Pegue o par gerado e peça uma alocação ao servidor de verdade:

Este teste roda **na máquina do TURN** (Linux), onde o `turnutils_uclient` é
instalado junto com o coturn:

```bash
CREDS=$(curl -s SEU_SERVIDOR_VCALL/ice | python3 -c "
import json,sys
s=[x for x in json.load(sys.stdin)['iceServers'] if 'turn' in str(x['urls'])][0]
print(s['username']); print(s['credential'])")

turnutils_uclient -t -u "$(echo "$CREDS"|head -1)" \
                     -w "$(echo "$CREDS"|tail -1)" \
                     -n 4 -c -y turn.seudominio.com.br
```

No log do coturn (`/var/log/turnserver.log`) você deve ver:

```
incoming packet ALLOCATE processed, success
```

Esse `success` é a prova de que a autenticação funcionou. Um `401` ali significa
que o segredo do coturn e o `TURN_SECRET` do Vcall estão diferentes.

### O TURN funciona numa chamada real?

Force **todo** o tráfego pelo relay e faça uma chamada de verdade:

```bash
ICE_TRANSPORT_POLICY=relay TURN_URLS=... TURN_SECRET=... npm start
```

Se a chamada conectar nesse modo, o TURN está correto. Abra **Qualidade da
chamada** no painel lateral: a linha **Rota** deve dizer `via servidor TURN`.
Depois volte para `all` — nesse modo o relay só entra quando o caminho direto
falha, que é o comportamento desejado.

Para um teste isolado, sem o app, o
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
do próprio projeto WebRTC mostra os candidatos que o seu servidor devolve.
Procure por linhas com `typ relay`.

---

## Quando algo não funciona

| Sintoma | Causa provável |
| --- | --- |
| `401 Unauthorized` no log do coturn | `static-auth-secret` e `TURN_SECRET` diferentes |
| Autentica, mas nenhum candidato `relay` aparece | Faixa `49152-65535/udp` fechada no firewall ou no grupo de segurança da nuvem |
| Funciona em casa, falha na empresa | Falta o endereço `turns:` na porta 5349 |
| Candidatos `relay` com IP privado | Falta `external-ip` no `turnserver.conf` |
| Conecta, mas a chamada trava | Banda do servidor TURN saturada — tudo conta em dobro |
| Conta de nuvem com tráfego inesperado | Provavelmente senha fixa exposta no `/ice`: troque por `TURN_SECRET` |

---

## Quanto custa

| Opção | Custo |
| --- | --- |
| Oracle Cloud Always Free + coturn | **US$ 0** — 10 TB de saída por mês |
| Metered Open Relay | **US$ 0** até 20 GB por mês |
| VPS 1 vCPU / 1 GB / 1–2 TB de tráfego | US$ 5 a 7 por mês |
| Cloudflare Realtime | US$ 0,05 por GB retransmitido |

Uma chamada de vídeo de uma hora que passe **inteira** pelo relay gasta algo
entre 0,5 e 1,5 GB. Como só uma fração das chamadas precisa de relay, o volume
real costuma ser bem menor do que a conta do pior caso sugere.

---

## Fontes

- [Cloudflare Realtime — TURN Service](https://developers.cloudflare.com/realtime/turn/)
- [Cloudflare — Gerando credenciais TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [coturn — wiki do turnserver](https://github.com/coturn/coturn/wiki/turnserver)
- [Enable Security — guia de segurança do coturn](https://www.enablesecurity.com/blog/coturn-security-configuration-guide/)
- [Synapse — Configuring a TURN server](https://element-hq.github.io/synapse/latest/turn-howto.html)
- [Oracle — recursos Always Free](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [InfoQ — Oracle reduz pela metade a cota Ampere A1 do free tier (2026)](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [Metered — Open Relay Project](https://www.metered.ca/tools/openrelay/)
