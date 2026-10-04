/**
 * desktop/linux.js — o que muda de uma distribuição Linux para outra.
 *
 * O Vcall é distribuído para Linux em cinco formatos (electron-builder.yml):
 * AppImage (qualquer distro), .deb (Debian, Ubuntu, Mint, Pop!_OS), .rpm
 * (Fedora, openSUSE, RHEL), pacman (Arch, Manjaro, EndeavourOS) e .tar.gz.
 * Os pacotes instalam o próprio .desktop e o chrome-sandbox com as
 * permissões certas. O AppImage não instala nada — e é aí que moram as duas
 * diferenças tratadas aqui.
 *
 * 1. SANDBOX. O Chromium isola cada página usando "user namespaces". Algumas
 *    distros restringem esse recurso (Ubuntu 23.10+ via AppArmor, kernels
 *    endurecidos, Debian antigo). Dentro de um AppImage não há como usar o
 *    plano B (o chrome-sandbox com setuid, porque a montagem é `nosuid`), e o
 *    app simplesmente não abria. Aqui o sandbox só é desligado quando o
 *    kernel de fato não oferece namespaces — o mesmo que o runtime oficial do
 *    AppImage faz. Nos pacotes .deb/.rpm/pacman ele continua ligado sempre.
 *
 * 2. LINK vcall://. Sem .desktop instalado, clicar num convite não abria o
 *    app. Rodando como AppImage (ou do .tar.gz), o Vcall registra um .desktop
 *    na pasta do usuário apontando para o próprio arquivo.
 *
 * Funções puras sobre o conteúdo de /proc e do ambiente: testáveis em qualquer
 * sistema (scripts/fixes-test.mjs).
 */
import { readFileSync } from "node:fs";

/** Lê um arquivo de /proc; `null` se não existir (outro kernel, outro SO). */
function lerProc(caminho, ler = readFileSync) {
  try {
    return String(ler(caminho, "utf8")).trim();
  } catch {
    return null;
  }
}

/**
 * O kernel deixa um processo comum criar user namespaces?
 *
 * @param {(p:string, enc:string)=>string} ler injetável nos testes
 */
export function namespacesDisponiveis(ler = readFileSync) {
  // Ubuntu 23.10+: AppArmor restringe (1) a menos que haja um perfil.
  if (lerProc("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", ler) === "1") return false;
  // Debian e kernels com o patch antigo.
  if (lerProc("/proc/sys/kernel/unprivileged_userns_clone", ler) === "0") return false;
  // Desligado de vez.
  if (lerProc("/proc/sys/user/max_user_namespaces", ler) === "0") return false;
  return true;
}

/** Rodando de dentro de um AppImage? (o runtime define APPIMAGE) */
export function ehAppImage(env = process.env) {
  return typeof env.APPIMAGE === "string" && env.APPIMAGE.length > 0;
}

/**
 * Precisa desligar o sandbox para o app abrir?
 * Só no AppImage, só no Linux, e só quando não há namespaces.
 */
export function precisaSemSandbox({ plataforma = process.platform, env = process.env, ler = readFileSync } = {}) {
  if (plataforma !== "linux" || !ehAppImage(env)) return false;
  return !namespacesDisponiveis(ler);
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
 * Qual executável o .desktop do usuário deve chamar — ou `null` quando o
 * sistema já cuida disso (pacote instalado em /opt ou /usr).
 */
export function executavelParaRegistrar({ plataforma = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (plataforma !== "linux") return null;
  if (ehAppImage(env)) return env.APPIMAGE;
  if (/^\/(opt|usr)\//.test(execPath)) return null; // .deb/.rpm/pacman
  return execPath; // .tar.gz descompactado em qualquer pasta
}
