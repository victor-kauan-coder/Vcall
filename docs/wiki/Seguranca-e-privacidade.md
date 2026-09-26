# Segurança e privacidade

## O que passa pelo servidor

Só a **sinalização**: quem está em qual sala, nome, avatar, estado do
microfone/câmera e as mensagens de negociação das conexões. O chat de texto
também passa por ele (sem ser guardado).

## O que NÃO passa

Áudio, vídeo, tela, canvas e **arquivos** vão direto de um participante ao
outro, cifrados por **DTLS-SRTP** (o mesmo padrão do Meet e do WhatsApp). As
legendas também — só a frase final tem um plano B pelo servidor, para quem
ainda não abriu a conexão direta. Nada disso é gravado em disco no servidor.

## Proteções

- **Senha da sala** conferida no servidor contra um SHA-256 com o id da sala
  como sal, em tempo constante; erros seguidos bloqueiam o endereço.
  (Na 3.0 a senha não era conferida — corrigido na 3.1.)
- **Anfitrião** com chave própria (guardada com hash); moderação só é aceita
  dele, conferida no servidor.
- **Removido não volta** pelo mesmo aparelho; **sala trancada** + **sala de
  espera** para decidir quem entra.
- **CSP fechada:** nenhum script externo, nenhuma conexão fora da própria
  origem, sem `eval` (o reconhecedor de fala foi adaptado para isso).
- **WebSocket só da própria origem** (bloqueia o "cross-site WebSocket
  hijacking") e limite de mensagens por conexão e de conexões por endereço.
- **Arquivos recebidos** nunca são executados: HTML aparece como texto.
- **App de mesa:** a página não ganha acesso ao sistema; a lista de janelas
  só é entregue logo depois de um clique seu e para a origem do próprio app;
  o painel do túnel só responde à própria máquina.
- **Legendas no app** são reconhecidas no seu computador; com o microfone
  mudo, nada é transcrito.

## Limites honestos

- O id da sala é o segredo dela: quem tiver o link entra (a não ser que haja
  senha ou a sala esteja trancada). Mande só para quem deve participar.
- Remover alguém bloqueia o **aparelho**; uma pessoa decidida pode usar outro
  navegador. Para reuniões sensíveis, **tranque a sala**.
- Salas com mais de 16 pessoas exigiriam um servidor de mídia no meio — e a
  criptografia deixaria de ser ponta a ponta. Por isso o limite.
