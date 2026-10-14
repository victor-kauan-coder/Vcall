# Solução de problemas

O aplicativo guarda um registro do que aconteceu (quedas da janela, falhas de
captura, do reconhecedor de fala). Anexe-o ao relatar um problema:

- **Windows:** `%APPDATA%\Vcall\logs\vcall.log`
- **Linux:** `~/.config/Vcall/logs/vcall.log`

---

## Alguém não consegue entrar / a chamada não conecta

Quase sempre é uma rede restritiva (empresa, 4G/5G, hotel) que bloqueia a
conexão direta. O Vcall avisa na tela quando é esse o caso. Duas saídas:

- se todos usam **Tailscale**, gere o link pela sua rede Tailscale: a chamada
  ganha o caminho pela rede privada (veja [Tailscale](Tailscale));
- ou um servidor **TURN**: há opção gratuita que leva cinco minutos, veja
  [TURN.md](https://github.com/victor-kauan-coder/Vcall/blob/main/TURN.md).

## Caio da chamada ao compartilhar a tela

Corrigido na 3.1. As causas eram três: a prévia da tela inteira criando o
efeito espelho (saturava CPU e rede), o som do sistema indo junto sem pedir, e
no Linux uma falha que travava a captura. Se ainda acontecer:

1. Prefira compartilhar **uma janela** em vez da tela inteira.
2. Em **Opções de compartilhamento**, escolha **720p · econômica**.
3. Se a janela do app caiu, ela volta sozinha para a mesma sala; mande o
   `vcall.log`.

## A tela de alguém some e volta sem parar

Corrigido na 3.3 (atualize os **dois** lados). A captura do Linux só manda
imagem quando a tela muda. Parada, a transmissão parecia ter caído e o
ladrilho sumia. Agora a última imagem é repetida enquanto a tela está parada.

## Linux: não consigo compartilhar a tela

- **Wayland (Fedora, Ubuntu 22.04+, Arch com GNOME/KDE):** a lista é do
  sistema. Se nada aparecer, instale o portal do seu ambiente
  (`xdg-desktop-portal-gnome`, `-kde`, `-wlr` ou `-hyprland`) e o `pipewire`, e
  reinicie a sessão. Veja [Instalação](Instalacao#compartilhar-tela-no-wayland-gnome-kde-plasma-sway-hyprland).
- **X11:** a lista aparece dentro do Vcall. Janelas minimizadas podem não ter
  miniatura, mas funcionam.
- **Tela preta:** atualize os drivers de vídeo e confira se o `pipewire` está
  rodando (`systemctl --user status pipewire`).

## Atualizar no Linux

**Até a 3.11.0, "Reiniciar e atualizar" no AppImage fechava o Vcall e ele não
voltava**, e o atalho do menu parava de funcionar: o arquivo era apagado e a
versão nova salva com outro nome, e ela abria cedo demais e se fechava. Na
3.11.1 o arquivo é trocado no mesmo lugar e a versão nova só abre depois que
a antiga fecha. Quem está numa versão anterior baixa a 3.11.1 uma última vez
em [Releases](https://github.com/victor-kauan-coder/Vcall/releases/latest);
dali em diante a atualização é pelo próprio app.

Se a pasta do AppImage não aceitar escrita (por exemplo, `/opt`), o Vcall
avisa nas Configurações e aponta a página de download.

## O AppImage não abre

**"Cannot mount AppImage" no Wayland (Fedora, Ubuntu GNOME, KDE), até a
3.10:** o app se fechava para se reabrir pelo XWayland, e fechar desmontava a
pasta do AppImage antes de a cópia nova subir. Corrigido na 3.11: o próprio
processo passa para o XWayland, sem sair. Atualize; não precisa editar o
`.desktop` (se você pôs `--ozone-platform=x11` nele, pode deixar).

Em distribuições que bloqueiam o isolamento do Chromium para programas comuns
(Ubuntu 24.04+, alguns kernels endurecidos), o Vcall detecta e abre mesmo
assim. Se ainda falhar:

```bash
./Vcall-3.4.0-x86_64.AppImage --no-sandbox
```

Ou instale o pacote da sua distro (`.deb`, `.rpm`, `pacman`), que configura o
isolamento do jeito certo. Sem FUSE instalado:
`./Vcall-3.4.0-x86_64.AppImage --appimage-extract-and-run`.

## O link do WhatsApp não abre o aplicativo

- O link público muda quando o Vcall é fechado: gere e mande de novo.
- **Linux com AppImage:** abra o AppImage uma vez — ele se registra.
- O navegador pergunta "Abrir o Vcall?": marque **Sempre permitir**.
- Sem o app, use **Entrar pelo navegador** na mesma página.

## Legendas erradas ou lentas no app

Em Configurações → Legendas e avisos → **Precisão das legendas**, use a
**Equilibrada** ou a **Máxima** (mais precisas). Em computadores lentos, a
**Rápida** responde mais depressa. Confira também o **idioma das legendas**.

## Legendas não funcionam

- **App:** a primeira vez baixa o modelo; se a internet cair no meio, ligue
  de novo (o download recomeça). Confira o microfone em Configurações.
- **Navegador:** só Chrome e Edge reconhecem fala. No Firefox você lê as
  legendas dos outros.
- **Microfone mudo** pausa a legenda — é proposital.

## Eco ou microfonia

Use fones. Se estiver compartilhando o **som do computador**, desligue essa
opção ou use fones — sem eles as vozes da chamada voltam para os outros.

## Um arquivo não chegou

A barra mostra o progresso real. Se a conexão direta com alguém caiu no meio,
aparece o aviso "não chegou para Fulano" — mande de novo. Quem entra depois
do envio não recebe anexos antigos (eles não ficam em servidor nenhum).

## A mesma pessoa aparece duas vezes

Corrigido na 3.1: quem cai e volta substitui a conexão antiga na hora.
