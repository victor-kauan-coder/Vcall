/**
 * desktop/linux.js — o que muda de uma distribuição Linux para outra.
 *
 * O Vcall é distribuído para Linux em cinco formatos (electron-builder.yml):
 * AppImage (qualquer distro), .deb (Debian, Ubuntu, Mint, Pop!_OS), .rpm
 * (Fedora, openSUSE, RHEL), pacman (Arch, Manjaro, EndeavourOS) e .tar.gz.
 * Os pacotes instalam o próprio .desktop e o chrome-sandbox setuid root
 * (scripts/linux/depois-de-instalar.tpl).
 *
 * O SANDBOX não é decidido aqui. Sem user namespaces (Ubuntu 24.04+ via
 * AppArmor, kernels endurecidos) e sem chrome-sandbox setuid (AppImage,
 * .tar.gz), o Chromium aborta com SIGTRAP antes de este código rodar; um
 * appendSwitch("no-sandbox") chega tarde. Quem decide é o lançador que o build
 * põe no lugar do executável (scripts/linux/vcall.sh); o Electron é o vcall-bin.
 *
 * O LINK vcall://. Sem .desktop instalado, clicar num convite não abria o
 * app. Rodando como AppImage (ou do .tar.gz), o Vcall registra um .desktop na
 * pasta do usuário apontando para o próprio arquivo (o lançador, no .tar.gz).
 *
 * Funções puras sobre o conteúdo de /proc e do ambiente: testáveis em qualquer
 * sistema (scripts/fixes-test.mjs).
 */
/** Rodando de dentro de um AppImage? (o runtime define APPIMAGE) */
export function ehAppImage(env = process.env) {
  return typeof env.APPIMAGE === "string" && env.APPIMAGE.length > 0;
}

/**
 * Opções de exibição do Chromium no Linux, como pares [chave, valor].
 *
 * GTK 3 fixo: o Electron 36+ usa GTK 4 no GNOME, e um processo que acabe
 * carregando GTK 3 junto (tema, método de entrada, bibliotecas do sistema)
 * aborta com "GTK 2/3 symbols detected". O GTK 3 é o que sempre foi usado.
 */
export function opcoesDeExibicao({ plataforma = process.platform } = {}) {
  return plataforma === "linux" ? [["gtk-version", "3"]] : [];
}

/**
 * Argumentos para reabrir o app pelo XWayland, ou `null` se não precisa.
 *
 * O Electron 38+ abre como app Wayland nativo numa sessão Wayland, e lá o
 * compositor não deixa o app posicionar janela: a mini-janela não vai para o
 * canto e a sobreposição do modo jogo não fica onde deveria. Com XWayland
 * disponível (DISPLAY definido), o Vcall segue por ele, como até a 3.6.
 *
 * A opção tem de estar na linha de comando DE VERDADE. O Electron escolhe
 * Wayland ou X11 antes de o main.js rodar; posta depois (appendSwitch), ela só
 * chegava ao processo da GPU. No Fedora (GNOME, XDG_SESSION_TYPE=wayland) a
 * janela nascia Wayland, a GPU tentava desenhar nela como X11 e caía três
 * vezes, e o app não abria. Quem passou --ozone-platform por conta própria
 * fica com a escolha.
 */
export function argsParaX11({ plataforma = process.platform, env = process.env, argv = process.argv } = {}) {
  if (plataforma !== "linux" || !env.DISPLAY) return null;
  const wayland = String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || !!env.WAYLAND_DISPLAY;
  if (!wayland || argv.some((a) => a.startsWith("--ozone-platform"))) return null;
  return [...argv.slice(1), "--ozone-platform=x11"];
}

/**
 * Como reabrir com a opção do X11, sem perder o AppImage.
 *
 * ANTES: `app.relaunch()` + `app.exit(0)`. No AppImage isso não abria nunca:
 * o programa roda de dentro de /tmp/.mount_*, que o AppImage desmonta assim
 * que o processo sai; a cópia reaberta nascia junto com o desmonte e caía em
 * "Cannot mount AppImage". Abrir pelo menu, sem a opção no .desktop, não
 * subia o app.
 *
 * AGORA: "execve" — o mesmo processo vira o novo (mesmo PID). O AppImage nem
 * percebe, a pasta continua montada, e não sobra processo nenhum. Existe no
 * Node 22.15+/24 (o Electron 44 traz o Node 24). Sem ele (Electron antigo),
 * "reabrir" à moda antiga, pelo próprio arquivo do AppImage.
 */
export function modoDeReabrir({ temExecve = typeof process.execve === "function" } = {}) {
  return temExecve ? "execve" : "reabrir";
}

/**
 * Qual executável o .desktop do usuário deve chamar — ou `null` quando o
 * sistema já cuida disso (pacote instalado em /opt ou /usr).
 */
export function executavelParaRegistrar({ plataforma = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (plataforma !== "linux") return null;
  if (ehAppImage(env)) return env.APPIMAGE;
  if (/^\/(opt|usr)\//.test(execPath)) return null; // .deb/.rpm/pacman
  return lancador(execPath); // .tar.gz descompactado em qualquer pasta
}

/** O lançador ao lado do Electron (vcall-bin → vcall): é ele quem decide o sandbox. */
export function lancador(execPath = process.execPath) {
  return execPath.replace(/-bin$/, "");
}
