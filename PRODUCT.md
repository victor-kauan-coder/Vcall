# PRODUCT.md — Vcall

Verdade de produto. Não é documento de design: o que está aqui é o que o
Vcall É, e continua valendo quando o visual mudar.

## O mecanismo

A chamada vai **direto de uma máquina para a outra**. Áudio, vídeo e tela
trafegam criptografados entre os navegadores dos participantes; o servidor
só apresenta as pessoas umas às outras e nunca segura mídia nenhuma.

Isso não é um detalhe de arquitetura — é a coisa que o produto vende, e a
razão de não existir conta, mensalidade nem gravação na nuvem.

## Quem usa, onde

Amigos, família e times pequenos no Brasil. Num notebook, em casa ou numa
sala pequena, à noite com mais frequência do que de dia. A pessoa que
CONVIDA pode ter o programa instalado; quem é convidado quase nunca tem, e
entra pelo navegador, sem instalar nem criar conta.

## O que o produto faz

- Sala de vídeo para até 16 pessoas, malha ponto a ponto
- Compartilhar tela, com escolha de nitidez ou fluidez
- Quadro branco colaborativo infinito, com imagens em camadas
- Conversa por texto, imagens e arquivos até 25 MB
- Legendas ao vivo da própria fala
- Gravação local da chamada
- Link público sob demanda, por túnel Cloudflare, que morre ao fechar o app

## Compromissos de marca

- **Rosa e laranja** (`#fd4d87`, `#fe9c5f`) são a marca. O logotipo são duas
  figuras que se alcançam, em degradê desses dois.
- **Português do Brasil** em tudo: interface, código, comentários.
- **Desenvolvido por Victor Kauan** — `github.com/victor-kauan-coder`.

## Restrições que não se negociam

- **Nada é baixado de fora depois de instalado.** O executável carrega tudo:
  servidor, interface, fontes, o cloudflared. Uma fonte vinda de CDN quebra
  essa promessa.
- **O painel de controle do túnel só responde à própria máquina.**
- **Fechar a janela derruba o túnel.** Link público vivo depois de a pessoa
  achar que fechou tudo é o risco que o ciclo de vida existe para evitar.
- **Acessibilidade:** texto corrido a 4.5:1 no mínimo, em toda paleta e tema.
  Há um gerador que confere isso e se recusa a gravar quando falha.

## Modo por superfície

| Superfície | Modo | O sucesso é |
|---|---|---|
| Tela inicial | Convencer | A pessoa entende o que é e cria ou entra numa sala |
| Antessala | Operar, com personalidade | Ela se arruma e entra sem susto |
| Chamada | Operar | Ela esquece a interface e vê quem está falando |
