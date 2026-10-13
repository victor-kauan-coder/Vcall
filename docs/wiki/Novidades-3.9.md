# Novidades da 3.9

## Link pela sua rede Tailscale

No app de mesa, **Convidar › Pela sua rede Tailscale › Gerar link** publica a
sala em `https://seu-computador.sua-rede.ts.net`. É um link privado, que só
abre para quem está na sua tailnet, tem HTTPS de verdade e não depende do
túnel do Cloudflare. → [Tailscale](Tailscale)

![Link pelo Tailscale](imagens/tailscale-convidar.png)

- **Mais redes conectam.** Em 4G/5G, CGNAT, empresa e NAT duplo, a voz e o
  vídeo ganham o caminho pela rede privada do Tailscale. Onde o caminho direto
  comum já funciona, ele continua sendo usado, porque é o melhor.
- **Rota no painel.** *Qualidade da chamada › Rota* diz "direta pela rede
  Tailscale" quando é por ela que a chamada está indo.
- **Sem sobras.** A publicação vive junto com o Vcall: fechou o app, o link sai
  da rede, mesmo que ele tenha caído.
- **Sem pisar no que é seu.** Se a porta 443 do seu Tailscale já está em uso, o
  Vcall usa a 8443 ou a 10000.
- **Mensagens que dizem o que fazer**: Tailscale fechado, sem login, MagicDNS
  desligado, HTTPS a ligar (com botão), permissão no Linux.
