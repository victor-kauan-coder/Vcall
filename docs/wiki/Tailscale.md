# Tailscale

Se você e as pessoas que você chama usam [Tailscale](https://tailscale.com),
o Vcall gera um link da sala que **só abre dentro da sua rede Tailscale**. A
voz e o vídeo passam a ter um caminho a mais pela sua rede privada.

![Link pelo Tailscale no Convidar](imagens/tailscale-convidar.png)

## Quando ajuda (e quando não muda nada)

O Vcall já manda voz e vídeo **direto** de um computador para o outro. Na
maioria das casas esse caminho direto funciona, e aí ele é o melhor possível:
o Tailscale não deixa a imagem mais nítida nem a voz mais limpa.

Ele faz diferença quando o caminho direto **não acontece**:

- 4G/5G e provedores com CGNAT;
- redes de empresa, faculdade ou hotel;
- roteadores com NAT duplo (o modem da operadora mais o seu).

Sem um servidor TURN, nessas redes a chamada nem conectava. O Tailscale
acerta o caminho direto em muito mais redes, porque abre portas no roteador e
tem truques para NAT difícil. Quando nem ele consegue, usa os servidores DERP
dele, o que funciona mas com mais atraso.

Outras vantagens do link do Tailscale:

- **Privado:** só abre para quem está na sua rede (tailnet), não para qualquer
  um com o link.
- **Sem depender do Cloudflare:** o link é `https://seu-computador.sua-rede.ts.net`,
  com certificado de verdade. Não cai com os erros 530/1033 do túnel rápido.
- **Fixo:** é sempre o mesmo endereço enquanto o seu computador tiver o mesmo
  nome no Tailscale (só a sala muda).

> A "chamada ruim" que muita gente via até a 3.7 não era a rede: era a câmera
> presa em baixa resolução, corrigida na 3.8.0.

## Como usar

1. Instale o Tailscale em **todos** os computadores
   ([tailscale.com/download](https://tailscale.com/download)) e entre na mesma
   rede (a sua conta, ou convide as pessoas para a sua tailnet).
2. No Vcall de quem cria a sala: **Convidar › Pela sua rede Tailscale › Gerar link**.
3. Na primeira vez, se o HTTPS da sua rede estiver desligado, aparece
   **Ligar o HTTPS no Tailscale**. Abra, confirme na página do Tailscale e
   volte: o link sai sozinho, sem clicar de novo.

   ![Primeira vez: ligar o HTTPS da rede](imagens/tailscale-habilitar.png)

4. Mande o link (ou use **Enviar pelo WhatsApp**: sem link público aberto, o
   convite usa o do Tailscale). Quem recebe precisa estar com o Tailscale
   ligado. Pode abrir no navegador ou no app.

**Desligar este link** tira a sala da rede na hora. Fechar o Vcall também.

## Como saber se a chamada está indo pelo Tailscale

Abra **Qualidade da chamada** (o gráfico na barra) e veja **Rota**:

| Rota | O que é |
| --- | --- |
| direta (P2P) | Caminho direto comum. É o melhor, e o Tailscale nem é usado |
| direta pela rede Tailscale | O caminho comum não passou, e a chamada foi pela sua rede privada |
| via servidor TURN | Passou por um servidor de retransmissão |

O Vcall não força o Tailscale. Os dois caminhos são testados ao mesmo tempo, e
o navegador fica com o caminho comum sempre que ele funciona.

## Requisitos e problemas comuns

| Mensagem | O que fazer |
| --- | --- |
| *O Tailscale não está instalado* | Instale e entre na sua conta |
| *O Tailscale está instalado, mas não está aberto* | Abra o Tailscale (ícone na bandeja/barra) |
| *Entre na sua conta do Tailscale* | Ícone do Tailscale › Log in |
| *Ligue o MagicDNS* | Painel do Tailscale › DNS › MagicDNS: é ele que dá o nome do link |
| *No Linux, o Tailscale só deixa o administrador publicar* | Rode uma vez: `sudo tailscale set --operator=$USER` |
| *Este Tailscale é antigo demais* | Atualize para a versão 1.52 ou mais nova |
| As portas 443, 8443 e 10000 em uso | Você já publica outras coisas no Tailscale; libere uma delas |

Se você já publica algo na porta 443 do Tailscale, o Vcall usa a 8443 (ou a
10000) e não mexe na sua configuração.

## Como funciona por dentro

- O app roda `tailscale serve --https=443 http://127.0.0.1:<porta>` **em
  primeiro plano**. A publicação pertence a esse processo: se o Vcall fechar
  ou cair, o Tailscale desfaz tudo sozinho.
- O link é conferido conectando direto no IP do Tailscale (com o nome no
  certificado), então funciona mesmo que o DNS deste computador ainda não
  conheça o nome. Na primeira vez o Tailscale emite o certificado, e isso leva
  alguns segundos.
- Quem entra pelo Tailscale chega ao servidor do Vcall vindo de `127.0.0.1`.
  O endereço real (100.x) vem no `X-Forwarded-For`, que o `tailscale serve`
  substitui, e o Vcall só aceita endereços da tailnet. O painel do anfitrião
  (que liga e desliga os links) continua invisível para quem vem de fora.
- A voz e o vídeo não passam pelo `serve`: vão de computador para computador.
  O Tailscale entra como mais uma "placa de rede" com endereço 100.x, e o
  navegador a usa quando o caminho comum falha.

### Servidor próprio (`npm start`)

Num servidor que roda o Vcall com Node, o mesmo vale à mão:

```bash
TRUST_TAILSCALE=1 npm start            # aceita o IP da tailnet no X-Forwarded-For
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

O link fica `https://nome-do-servidor.sua-rede.ts.net/`.
