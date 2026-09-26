/**
 * desktop/main.js — o aplicativo de mesa do Vcall (Electron), Windows e Linux.
 *
 * Uma janela própria, com motor embutido: não abre o navegador da pessoa, não
 * depende de qual navegador ela tem, e a chamada funciona igual em qualquer
 * máquina — é o mesmo modelo de Discord, Slack e Teams.
 *
 * O app SOBE O PRÓPRIO SERVIDOR em 127.0.0.1 e a janela carrega dele:
 *
 *   - câmera, microfone e tela exigem origem segura, e `http://127.0.0.1`
 *     conta como segura; `file://` não;
 *   - a política de segurança de conteúdo é a mesma da versão web, sem
 *     exceção criada só para o desktop;
 *   - o túnel do Cloudflare (link público) aponta para esse mesmo servidor.
 *
 * PORTA FIXA (7718, com recuo). O navegador guarda nome, avatar, volumes e
 * preferências por ORIGEM, e a origem inclui a porta: com porta sorteada a
 * cada abertura, a pessoa perderia tudo toda vez que abrisse o app.
 */
import { app, BrowserWindow, Menu, dialog, desktopCapturer, ipcMain, nativeTheme, screen, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHttpServer } from "../src/http.js";
import { attachSignaling } from "../src/signaling.js";
import { RoomRegistry } from "../src/rooms.js";
import { hostControl } from "./guard.js";
import { Tunnel } from "./tunnel.js";
import { ESQUEMA, destinoDoLink, linkDosArgumentos } from "./protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(__dirname, "..", "public", "assets", "icon-512.png");
const PORTAS = [7718, 7719, 7720, 0];

/** Segredo desta execução: libera o painel do túnel só para a nossa janela. */
const TOKEN = randomBytes(24).toString("base64url");

let win = null;
let baseUrl = "";
let tunnel = null;
/** Destino pedido por link antes de a janela existir. */
let pendente = null;
/** Origens de salas de outras pessoas que o usuário abriu por convite. */
const origensConfiaveis = new Set();

/*
 * Ajustes do motor para um app de chamada:
 *  - áudio remoto toca sem exigir clique (a janela é nossa; não é um site
 *    tentando tocar som sozinho) — evita a chamada começar muda;
 *  - a janela minimizada continua recebendo e mandando vídeo em tempo real.
 */
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
if (process.platform === "linux") {
  // Compartilhar tela no Wayland passa pelo portal do sistema (PipeWire).
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
}

/* ==================================================================== *
 * Servidor embutido
 * ==================================================================== */

function escutar(server, porta) {
  return new Promise((resolve) => {
    const falhou = () => resolve(null);
    server.once("error", falhou);
    server.listen(porta, "127.0.0.1", () => {
      server.removeListener("error", falhou);
      resolve(server.address().port);
    });
  });
}

async function subirServidor() {
  const registry = new RoomRegistry();
  let porta = 0;

  const control = hostControl({
    token: TOKEN,
    abertas: {
      // A página pergunta "estou no app?" e recebe o token do painel do túnel.
      hello: async () => ({ app: true, token: TOKEN, porta, batimento: 60_000 }),
      // No Electron a vida do app é a vida da janela; o batimento não decide nada.
      vivo: async () => ({ ok: true }),
      tchau: async () => ({ ok: true }),
    },
    acoes: {
      status: async () => ({ estado: tunnel?.state || "parado", url: tunnel?.url || null, porta }),
      "tunnel/abrir": async () => {
        if (tunnel?.url) return { estado: "pronto", url: tunnel.url };
        tunnel = tunnel || new Tunnel(porta);
        return { estado: "pronto", url: await tunnel.start() };
      },
      "tunnel/fechar": async () => {
        tunnel?.stop();
        return { estado: "parado", url: null };
      },
    },
  });

  const server = createHttpServer({ registry, control });
  attachSignaling(server, { registry });

  for (const p of PORTAS) {
    const obtida = await escutar(server, p);
    if (obtida) {
      porta = obtida;
      return `http://127.0.0.1:${porta}`;
    }
  }
  throw new Error("nenhuma porta disponível");
}

/* ==================================================================== *
 * Janela
 * ==================================================================== */

/** Endereço para um destino de link (ou a tela inicial). */
function enderecoPara(destino) {
  if (destino?.tipo === "remoto") {
    origensConfiaveis.add(new URL(destino.url).origin);
    return destino.url;
  }
  return `${baseUrl}/?host=${TOKEN}${destino?.room ? `#${destino.room}` : ""}`;
}

function abrirDestino(destino) {
  if (!destino) return;
  if (!win) {
    pendente = destino;
    return;
  }
  win.loadURL(enderecoPara(destino));
  focar();
}

function focar() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const origemPermitida = (url) => {
  try {
    const o = new URL(url).origin;
    return o === baseUrl || origensConfiaveis.has(o);
  } catch {
    return false;
  }
};

/** Cores da barra de título seguindo o tema da página. */
function coresDaBarra(escuro) {
  return escuro
    ? { color: "#00000000", symbolColor: "#c4bce9", height: 40 }
    : { color: "#00000000", symbolColor: "#453c72", height: 40 };
}

function criarJanela() {
  const escuro = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Vcall",
    icon: ICON,
    backgroundColor: "#0b0722",
    // Sem moldura do sistema: a interface vai até o topo e os botões de
    // minimizar/maximizar/fechar ficam por cima, nativos, com a cor do tema.
    titleBarStyle: "hidden",
    titleBarOverlay: coresDaBarra(escuro),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      // Chamada não pode desacelerar só porque a janela saiu da frente.
      backgroundThrottling: false,
    },
  });

  // A página já nasce com a intro animada por cima: mostrar no primeiro
  // quadro pintado evita a janela branca/vazia antes do conteúdo.
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    // A mini-janela (Document Picture-in-Picture) é aberta pela própria página,
    // sem endereço: é um documento em branco que ela mesma preenche.
    if (!url || url === "about:blank") return { action: "allow" };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!origemPermitida(url)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  // Atalhos de desenvolvedor só em desenvolvimento.
  if (app.isPackaged) {
    win.webContents.on("before-input-event", (e, input) => {
      if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i") e.preventDefault();
    });
  }

  win.on("closed", () => {
    win = null;
  });

  const alvo = pendente;
  pendente = null;
  win.loadURL(enderecoPara(alvo));
}

ipcMain.on("vcall:tema", (_e, escuro) => {
  try {
    win?.setTitleBarOverlay(coresDaBarra(!!escuro));
  } catch {
    /* plataforma sem sobreposição (macOS) */
  }
});
/*
 * Mini-janela. O Electron anuncia a Document Picture-in-Picture API mas não a
 * implementa (a janela nasce e morre no mesmo instante), então o modo
 * compacto é a própria janela: encolhe, vai para o canto da tela e fica por
 * cima de tudo. Os vídeos continuam os mesmos — nada é recriado.
 */
let tamanhoNormal = null;
ipcMain.handle("vcall:mini", (_e, ligar) => {
  if (!win) return false;
  if (ligar && !tamanhoNormal) {
    tamanhoNormal = { bounds: win.getBounds(), max: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    const { workArea } = screen.getDisplayMatching(win.getBounds());
    const w = 400;
    const h = 280;
    win.setMinimumSize(280, 190);
    win.setBounds({ x: workArea.x + workArea.width - w - 24, y: workArea.y + workArea.height - h - 24, width: w, height: h }, true);
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setTitleBarOverlay?.({ height: 30 });
  } else if (!ligar && tamanhoNormal) {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    win.setMinimumSize(900, 600);
    win.setBounds(tamanhoNormal.bounds, true);
    if (tamanhoNormal.max) win.maximize();
    win.setTitleBarOverlay?.({ height: 40 });
    tamanhoNormal = null;
    focar();
  }
  return true;
});

ipcMain.handle("vcall:info", () => ({
  version: app.getVersion(),
  platform: process.platform,
}));

/* ==================================================================== *
 * Permissões de mídia
 * ==================================================================== */

/*
 * Sem cache HTTP para o servidor local. A interface vem de 127.0.0.1, da
 * memória deste mesmo processo: guardar cópia em disco não economiza nada. E
 * custava caro — uma entrada corrompida (app fechado à força) fazia o servidor
 * responder "304, use a sua cópia" para uma cópia quebrada, e a página abria
 * sem uma folha de estilo: telas ocultas aparecendo e ícones gigantes.
 * (A opção `disable-http-cache` do Chromium é ignorada pelo Electron.)
 */
function semCache() {
  const ses = session.defaultSession;
  const filtro = { urls: [`${baseUrl}/*`] };
  ses.webRequest.onBeforeSendHeaders(filtro, ({ requestHeaders }, cb) => {
    delete requestHeaders["If-None-Match"];
    delete requestHeaders["If-Modified-Since"];
    cb({ requestHeaders });
  });
  ses.webRequest.onHeadersReceived(filtro, ({ responseHeaders }, cb) => {
    for (const k of Object.keys(responseHeaders)) if (k.toLowerCase() === "cache-control") delete responseHeaders[k];
    cb({ responseHeaders: { ...responseHeaders, "Cache-Control": ["no-store"] } });
  });
  // O que ficou guardado por versões anteriores também sai.
  return ses.clearCache().catch(() => {});
}

function permissoes() {
  const ses = session.defaultSession;
  const liberadas = new Set(["media", "display-capture", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen"]);

  // O padrão do Electron é conceder tudo a qualquer página; aqui, só à nossa
  // origem e às salas que o usuário abriu por convite.
  ses.setPermissionRequestHandler((contents, permissao, callback) => {
    callback(liberadas.has(permissao) && origemPermitida(contents.getURL()));
  });
  ses.setPermissionCheckHandler((_c, permissao, origem) => liberadas.has(permissao) && origemPermitida(origem));

  /*
   * Compartilhar tela: o seletor nativo do sistema quando existe (Windows 11
   * e portal do Wayland); senão, a tela principal. O áudio do sistema vai
   * junto no Windows ("loopback") — é o som do vídeo que a pessoa mostra.
   */
  ses.setDisplayMediaRequestHandler(
    async (_req, callback) => {
      try {
        const [tela] = await desktopCapturer.getSources({ types: ["screen"] });
        callback(tela ? { video: tela, audio: process.platform === "win32" ? "loopback" : undefined } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

/* ==================================================================== *
 * Ciclo de vida
 * ==================================================================== */

if (!app.requestSingleInstanceLock()) {
  // Já existe um Vcall aberto: ele recebe o link (evento second-instance).
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const destino = destinoDoLink(linkDosArgumentos(argv));
    if (destino) abrirDestino(destino);
    else focar();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(ESQUEMA, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(ESQUEMA);
    }

    try {
      baseUrl = await subirServidor();
    } catch (err) {
      dialog.showErrorBox("Não foi possível iniciar o Vcall", `O servidor interno não subiu: ${err?.message || err}`);
      app.quit();
      return;
    }

    await semCache();
    permissoes();
    pendente = destinoDoLink(linkDosArgumentos(process.argv));
    criarJanela();
  });

  app.on("window-all-closed", () => app.quit());

  // O túnel é a parte exposta à internet: cai junto com o app, sempre.
  app.on("before-quit", () => tunnel?.stop());
  process.on("exit", () => tunnel?.stop());
}
