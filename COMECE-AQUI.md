# Começando

## Sozinho, na sua máquina — 3 comandos

```bash
npm install
npm start
```

Abra **http://localhost:3000**, digite seu nome, clique em **Criar sala**.
Pronto. Não precisa de `.env`, nem de TURN, nem de conta em lugar nenhum.

A instalação leva menos de um segundo: só um pacote (`ws`). Ícones e avatares
já vêm prontos dentro do projeto.

---

## Com outras pessoas — 1 comando a mais

O `localhost` só existe na sua máquina, e o navegador exige HTTPS para liberar
câmera e microfone. Um túnel resolve as duas coisas:

```bash
# terminal 1
npm start

# terminal 2
cloudflared tunnel --url http://localhost:3000
```

Ele imprime um endereço `https://algo.trycloudflare.com`. Abra esse endereço,
crie a sala e mande o link do botão **Convidar**.

> O endereço muda toda vez que você reinicia o `cloudflared`. Link de sala
> antigo para de funcionar.

**Isto é tudo o que a maioria das pessoas precisa.** Pode parar de ler aqui.

---

## Se alguém não conseguir entrar

Acontece quando a rede de um dos dois é restritiva demais — internet de empresa,
4G/5G, Wi-Fi de hotel. O sistema avisa na tela quando é esse o caso.

A solução chama-se TURN, e a mais rápida é gratuita e leva cinco minutos:

1. Crie conta em [metered.ca/tools/openrelay](https://www.metered.ca/tools/openrelay/)
2. No painel: **TURN Server → Credentials → Create**, copie a `apiKey`
3. Crie um arquivo `.env` na pasta do projeto com uma linha:

   ```
   TURN_API_URL=https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=SUA_APIKEY
   ```

4. Reinicie o `npm start`

Para conferir, o servidor avisa no arranque:

```
info  Vcall no ar {"turn":"provedor por REST (seuapp.metered.live)"}
```

Outras opções (incluindo servidor próprio de graça, com 10 TB por mês) estão
em [TURN.md](TURN.md).

---

## Deixando no ar o tempo todo

Num servidor Linux (VPS de US$ 5, ou o Oracle Always Free):

```bash
git clone SEU_REPO vcall && cd vcall
npm install
sudo npm install -g pm2
pm2 start server.js --name vcall
pm2 save && pm2 startup
```

E um Nginx na frente para o HTTPS — **atenção ao bloco do WebSocket**, que é o
esquecimento clássico e faz a página abrir mas a sala ficar vazia:

```nginx
server {
    server_name vcall.seudominio.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # sem estas duas linhas, a sinalização nunca conecta
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

Certificado: `sudo certbot --nginx -d vcall.seudominio.com.br`.

---

## Resumo do que é obrigatório

| | Obrigatório? |
| --- | --- |
| `npm install` e `npm start` | **sim** |
| Arquivo `.env` | não |
| TURN | não (mas resolve os casos que não conectam) |
| Túnel ou HTTPS | só para outras pessoas entrarem |
| Domínio próprio | não |
| Conta em algum serviço | não |

---

## Os outros arquivos, e quando abrir cada um

| Arquivo | Quando |
| --- | --- |
| **COMECE-AQUI.md** | agora |
| [TUNEL.md](TUNEL.md) | quando quiser entender ou trocar o túnel |
| [TURN.md](TURN.md) | quando alguém não conseguir conectar |
| [README.md](README.md) | quando quiser mexer no código |

---

## Problemas comuns

**"Permissão para a câmera foi negada"** — o navegador só libera em HTTPS ou em
`localhost`. Se abriu por IP (`http://192.168.0.5:3000`), use o túnel.

**A página abre mas ninguém aparece na sala** — a sinalização não conectou. Se
estiver atrás de Nginx, faltam as duas linhas de `Upgrade`/`Connection`.

**"Sala cheia"** — o limite é 8 pessoas. Numa malha ponto a ponto cada um envia
vídeo para todos os outros; mais que isso exigiria um servidor de mídia no
meio, e a conversa deixaria de ser criptografada fim a fim.

**Quero mexer no código** — as dependências de desenvolvimento estão
desativadas por padrão (para a instalação ser rápida). Para tê-las:

```bash
npm install --include=dev
npm test
```
