# Instalação

O Vcall roda de três jeitos. Todos têm as mesmas funções de chamada; o
aplicativo acrescenta o seletor de janelas, as legendas offline, o link
público com um clique e a mini-janela sempre por cima.

| Jeito | Para quem |
| --- | --- |
| **Aplicativo de mesa** (Windows/Linux) | Quem vai usar no dia a dia |
| **Navegador** (Chrome, Edge, Firefox, Safari) | Quem recebeu um convite e não quer instalar nada |
| **Servidor próprio** (`npm start`) | Quem quer hospedar para um grupo |

Os instaladores estão em
[Releases](https://github.com/victor-kauan-coder/Vcall/releases/latest).
Cada Release traz também um `SHA256SUMS.txt` para conferir o download.

---

## Windows 10 e 11

1. Baixe **`VcallSetup-3.1.1.exe`**.
2. Execute. Se o Windows SmartScreen avisar "aplicativo não reconhecido",
   clique em **Mais informações → Executar assim mesmo** (o instalador ainda
   não tem assinatura digital paga).
3. Escolha a pasta (ou deixe a padrão) e conclua. Um atalho aparece na área
   de trabalho e no menu Iniciar.

O instalador já traz o `cloudflared` (o link público funciona sem baixar mais
nada) e registra os links `vcall://`.

---

## Linux

Escolha o formato da sua distribuição. Na dúvida, o **AppImage** roda em
qualquer uma.

### Fedora, openSUSE, RHEL, Rocky, Alma — `.rpm`

```bash
sudo dnf install ./Vcall-3.1.1-x86_64.rpm        # Fedora, RHEL, Rocky, Alma
sudo zypper install ./Vcall-3.1.1-x86_64.rpm     # openSUSE
```

### Arch, Manjaro, EndeavourOS, CachyOS — `pacman`

```bash
sudo pacman -U ./Vcall-3.1.1-x64.pacman
```

### Ubuntu, Debian, Mint, Pop!_OS, elementary — `.deb`

```bash
sudo apt install ./Vcall-3.1.1-amd64.deb
```

### Qualquer distribuição — AppImage

```bash
chmod +x Vcall-3.1.1-x86_64.AppImage
./Vcall-3.1.1-x86_64.AppImage
```

Na primeira execução o AppImage se registra no menu do usuário e passa a
abrir os links `vcall://` dos convites. Em distribuições que bloqueiam o
isolamento do Chromium para programas comuns (Ubuntu 24.04 ou mais novo, por
exemplo), o Vcall detecta isso sozinho e abre mesmo assim — veja
[Solução de problemas](Solucao-de-problemas#o-appimage-não-abre).

### Qualquer distribuição — `.tar.gz`

```bash
tar xzf Vcall-3.1.1-x64.tar.gz
cd Vcall-3.1.1-x64 && ./vcall
```

### Compartilhar tela no Wayland (GNOME, KDE Plasma, Sway, Hyprland)

No Wayland quem mostra a lista de telas e janelas é o **portal do sistema**.
Ele já vem instalado no Fedora Workstation, Ubuntu e KDE Neon. Em distros
montadas à mão (Arch, por exemplo) instale o portal do seu ambiente:

| Ambiente | Pacote (Arch) | Pacote (Fedora) |
| --- | --- | --- |
| GNOME | `xdg-desktop-portal-gnome` | `xdg-desktop-portal-gnome` |
| KDE Plasma | `xdg-desktop-portal-kde` | `xdg-desktop-portal-kde` |
| Sway, river, wlroots | `xdg-desktop-portal-wlr` | `xdg-desktop-portal-wlr` |
| Hyprland | `xdg-desktop-portal-hyprland` | `xdg-desktop-portal-hyprland` |

Mais o `pipewire` (padrão em todas as distros atuais).

---

## Navegador

Não precisa instalar nada: abra o link do convite. Funciona no Chrome, Edge,
Brave, Opera, Firefox e Safari, no computador e no celular. As legendas da
própria fala usam o reconhecimento do navegador e existem no Chrome e no Edge.

---

## Servidor próprio

```bash
git clone https://github.com/victor-kauan-coder/Vcall.git
cd Vcall
npm install
npm start          # http://localhost:3000
```

Para outras pessoas entrarem é preciso HTTPS — o jeito mais rápido é um túnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Configuração (TURN, limites, segurança) em
[`.env.example`](https://github.com/victor-kauan-coder/Vcall/blob/main/.env.example)
e no [README](https://github.com/victor-kauan-coder/Vcall#configuração).
