/**
 * desktop/navegador.js — achar um navegador que sirva de janela do aplicativo.
 *
 * No Windows e no macOS isto é quase trivial: o Chrome e o Edge ficam sempre
 * no mesmo lugar. No Linux não existe "o mesmo lugar", e foi exatamente aí
 * que o Vcall deixou de abrir em várias distribuições.
 *
 * Três armadilhas, todas descobertas em uso real:
 *
 * 1. CAMINHO FIXO NÃO BASTA. Procurar só em /usr/bin ignora o Brave em
 *    /opt/brave.com, o que foi instalado em /usr/local/bin, o Flatpak em
 *    ~/.local/share/flatpak/exports/bin e o Snap em /snap/bin. Aqui o PATH é
 *    consultado de verdade, como qualquer programa faria.
 *
 * 2. SNAP É PRISÃO. No Ubuntu, `chromium` é um Snap, e o confinamento do Snap
 *    NÃO deixa o navegador escrever em pasta oculta dentro da pasta pessoal.
 *    O perfil do Vcall vivia em ~/.vcall/navegador — ou seja, oculto. O
 *    Chromium abortava com "Failed to create ... SingletonLock: Permission
 *    denied" e o aplicativo simplesmente não abria. Quando o navegador
 *    escolhido é um Snap, o perfil vai para dentro da área do próprio Snap.
 *
 * 3. CONFINADO É SEGUNDA OPÇÃO. Entre um navegador de pacote normal e um
 *    empacotado, o normal vem primeiro: é o que enxerga o resto do sistema.
 *
 * Nada aqui é específico do Vcall — é o preço de abrir o navegador de outra
 * pessoa, num sistema que ela montou do jeito dela.
 */
import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Executáveis conhecidos, do mais ao menos provável de estar instalado. */
const NOMES_LINUX = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "brave",
  "microsoft-edge-stable",
  "microsoft-edge",
  "vivaldi-stable",
  "vivaldi",
  "opera",
];

/**
 * Pastas vasculhadas além do PATH.
 *
 * O PATH de um processo iniciado por atalho de área de trabalho costuma ser
 * mais curto que o de um terminal — não dá para contar só com ele.
 */
function pastasLinux() {
  const lar = os.homedir();
  return [
    "/usr/bin",
    "/usr/local/bin",
    "/opt/google/chrome",
    "/opt/brave.com/brave",
    "/opt/microsoft/msedge",
    "/opt/vivaldi",
    "/var/lib/flatpak/exports/bin",
    path.join(lar, ".local", "share", "flatpak", "exports", "bin"),
    path.join(lar, ".local", "bin"),
    "/snap/bin",
  ];
}

/** Nomes alternativos usados por quem instala em /opt. */
const NOMES_OPT = {
  "/opt/google/chrome": ["chrome", "google-chrome"],
  "/opt/brave.com/brave": ["brave", "brave-browser"],
  "/opt/microsoft/msedge": ["msedge", "microsoft-edge"],
  "/opt/vivaldi": ["vivaldi", "vivaldi-bin"],
};

/** Identificadores de Flatpak, que não são executáveis soltos. */
const FLATPAK_LINUX = [
  "com.google.Chrome",
  "org.chromium.Chromium",
  "com.brave.Browser",
  "com.microsoft.Edge",
];

async function executavel(p) {
  try {
    await access(p, constants.X_OK);
    const info = await stat(p);
    return info.isFile() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * O binário é um Snap?
 *
 * Dois sinais, porque as distribuições disfarçam de formas diferentes: o
 * caminho real cai dentro de /snap, ou o arquivo é um script curto que chama
 * o snap (é assim que o Ubuntu mantém /usr/bin/chromium funcionando depois de
 * o pacote deb virar um encaminhamento).
 */
async function ehSnap(p) {
  try {
    const real = await realpath(p);
    if (real.startsWith("/snap/") || real.includes("/snapd/")) return true;
  } catch {
    /* segue para o conteúdo */
  }
  try {
    const info = await stat(p);
    if (info.size > 64 * 1024) return false; // binário de verdade, não script
    const texto = await readFile(p, "latin1");
    return /\bsnap\b/.test(texto) && texto.startsWith("#!");
  } catch {
    return false;
  }
}

/**
 * Onde o perfil do Vcall pode viver para este navegador.
 *
 * Fora do Snap, a pasta oculta de sempre. Dentro do Snap, a área que o
 * confinamento libera para o próprio pacote — a única que ele consegue
 * escrever.
 */
export function perfilPara(navegador) {
  const lar = os.homedir();
  if (navegador?.snap) {
    return path.join(lar, "snap", navegador.snap, "common", "vcall-perfil");
  }
  return path.join(lar, ".vcall", "navegador");
}

/** O nome do pacote Snap, deduzido do executável (`chromium`, `brave`…). */
function nomeDoSnap(p) {
  const base = path.basename(p).replace(/-(stable|browser|bin)$/, "");
  return base === "google-chrome" ? "chromium" : base;
}

function candidatosWindows() {
  const bases = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
    Boolean,
  );
  const alvos = [
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
  ];
  const saida = [];
  for (const alvo of alvos) for (const base of bases) saida.push(path.join(base, ...alvo));
  return saida;
}

function candidatosMac() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
  ];
}

/** Todos os caminhos plausíveis no Linux, sem repetir. */
function candidatosLinux() {
  const vistos = new Set();
  const saida = [];
  const juntar = (p) => {
    if (p && !vistos.has(p)) {
      vistos.add(p);
      saida.push(p);
    }
  };

  // 1. Escotilha de emergência: quem sabe o que tem na máquina manda.
  if (process.env.VCALL_NAVEGADOR) juntar(process.env.VCALL_NAVEGADOR);

  // 2. Pastas conhecidas e o PATH de verdade.
  const doPath = (process.env.PATH || "").split(":").filter(Boolean);
  const pastas = [...pastasLinux(), ...doPath];
  for (const pasta of pastas) {
    const nomes = NOMES_OPT[pasta] || NOMES_LINUX;
    for (const nome of nomes) juntar(path.join(pasta, nome));
  }
  return saida;
}

/**
 * Procura um navegador utilizável.
 *
 * Devolve `{ bin, snap, flatpak, rotulo }` ou `null`. Os confinados ficam
 * para o fim: funcionam, mas com o perfil dentro da própria caixa.
 */
export async function acharNavegador() {
  if (process.platform === "win32") {
    for (const bin of candidatosWindows()) {
      if (await executavel(bin)) return { bin, snap: null, flatpak: null, rotulo: path.basename(bin) };
    }
    return null;
  }
  if (process.platform === "darwin") {
    for (const bin of candidatosMac()) {
      if (await executavel(bin)) return { bin, snap: null, flatpak: null, rotulo: path.basename(bin) };
    }
    return null;
  }

  const confinados = [];
  for (const bin of candidatosLinux()) {
    if (!(await executavel(bin))) continue;
    if (await ehSnap(bin)) {
      confinados.push({ bin, snap: nomeDoSnap(bin), flatpak: null, rotulo: `${path.basename(bin)} (snap)` });
      continue;
    }
    return { bin, snap: null, flatpak: null, rotulo: path.basename(bin) };
  }
  if (confinados.length) return confinados[0];

  // Último recurso: Flatpak, que não deixa executável solto no PATH.
  const flatpak = (await executavel("/usr/bin/flatpak")) ? "/usr/bin/flatpak" : null;
  if (flatpak) {
    for (const id of FLATPAK_LINUX) {
      const instalado =
        (await executavel(`/var/lib/flatpak/app/${id}`)) ||
        (await executavel(path.join(os.homedir(), ".local/share/flatpak/app", id)));
      if (instalado) {
        return { bin: flatpak, snap: null, flatpak: id, rotulo: `${id} (flatpak)` };
      }
    }
  }
  return null;
}
