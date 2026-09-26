/**
 * main.js — a costura.
 *
 * Este arquivo não implementa nada: ele liga os módulos. Mídia, pares,
 * estatísticas e quadro vivem em `core/` e `features/`, sem saber que existe
 * uma tela; a UI vive em `ui/`, sem saber o que é um transceiver. Aqui os dois
 * lados se encontram.
 */
import { $, el, icon, on } from "./lib/dom.js";
import { env, formatDuration, isRoomId, newRoomId, prefs, throttle } from "./lib/util.js";

import { Signaling } from "./core/signaling.js";
import { LocalMedia, describeMediaError } from "./core/media.js";
import { ScreenShare, SCREEN_QUALITY, describeScreenError } from "./core/screen.js";
import { Mesh } from "./core/mesh.js";

import { Theme } from "./ui/theme.js";
import { Lobby } from "./ui/lobby.js";
import { Stage } from "./ui/stage.js";
import { Panel } from "./ui/panel.js";
import { Dock, REACTIONS } from "./ui/dock.js";
import { toast, chime } from "./ui/toast.js";
import { colorFor } from "./ui/avatars.js";
import { RemoteAudio } from "./ui/audio.js";
import { closeAudio } from "./core/audio-graph.js";
import { InfiniteCanvas } from "./features/canvas.js";
import { createBoardNotice } from "./features/board-notice.js";
import { Captions, captionsSupported, idiomaPadrao } from "./features/captions.js";
import { CallRecorder, canRecord } from "./features/recorder.js";
import { FileTransfer, MAX_FILE, formatSize } from "./features/transfer.js";
import { HostPanel } from "./features/host.js";
import { pedirPermissoes, revisarPermissoes } from "./ui/permissions.js";
import { escolherCompartilhamento } from "./ui/sharesheet.js";
import { profileSection } from "./ui/profile-editor.js";
import { Dashboard, copy, linkFor } from "./ui/dashboard.js";
import { linkAbrir, linkWhatsApp } from "./lib/invite.js";
import { installMotion, magnifyDock, playIntro, signal, swap, stagger } from "./ui/motion.js";
import { MiniCall } from "./ui/minicall.js";
import { watchHandsFree } from "./ui/handsfree.js";

// Antes de qualquer tela ser montada: é ele que anima o que aparece.
installMotion();

/* ================================================================== *
 * Estado do aplicativo
 * ================================================================== */

const theme = new Theme();
const media = new LocalMedia();
const screen = new ScreenShare();
const signaling = new Signaling();
const mesh = new Mesh({ signaling, media, screen });

/**
 * Saída de áudio. Receber a trilha não produz som: ela precisa ser ligada a
 * uma saída, e é isto que faz.
 */
const audio = new RemoteAudio();

/** Legendas ao vivo, gravação local e anexos: recursos da chamada, não da mídia. */
const captions = new Captions({ lang: idiomaPadrao(prefs.get("captions:lang", null)) });
// O motor offline (app de mesa) ouve o MESMO microfone da chamada.
captions.micTrack = () => media.micTrack;
const recorder = new CallRecorder();
const transfer = new FileTransfer();

/** Controle do túnel. Inerte fora do aplicativo de mesa. */
const host = new HostPanel();

/** "Fulano está desenhando no canvas": uma vez por chamada, não a cada traço. */
const boardNotice = createBoardNotice();
const shouldAnnounceBoard = (op) => boardNotice.shouldAnnounce(op);

const app = {
  room: null,
  roomMeta: null,
  roomName: "",
  roomCode: "",
  roomPass: "",
  profile: null,
  joined: false,
  hand: false,
  boardMode: null, // null | "board" | "annotate"
  timerId: 0,
  startedAt: 0,
  maxPeers: 16,
  /** Avisos do sistema quando a aba está em segundo plano. */
  notify: prefs.get("notify", false),
};

let stage;
let panel;
let dock;
let board;

/* ================================================================== *
 * Início
 * ================================================================== */

mesh.vad.setThreshold(prefs.get("vad:threshold", 0.055));

theme.bindButton($("#themeBtn"));
theme.bindButton($("#themeBtn2"));

const hashRoom = location.hash.slice(1);
const isGuest = isRoomId(hashRoom);
app.room = isGuest ? hashRoom : newRoomId();

const lobby = new Lobby({ media, theme, onJoin: enterCall });
let dashboard = null;

/**
 * Duas portas de entrada. Quem chega por link (ou pelo protocolo vcall:// do
 * aplicativo desktop) já sabe para onde vai e passa direto à antessala. Quem
 * abre o app sem destino vê primeiro o painel de chamadas ativas — criar uma
 * sala às cegas era a única opção antes, e não é a mais comum.
 */
/*
 * A tela de permissões vem antes de tudo, e só na primeira vez. Pedir câmera e
 * microfone no meio da entrada na sala — que é quando o navegador pergunta por
 * conta própria — faz a pessoa clicar em "Bloquear" por reflexo, e a chamada
 * começa muda sem explicação.
 */
// Depois da intro: a janela de permissões por cima da logo animada esconderia as duas.
const introPronta = new Promise((r) =>
  document.getElementById("intro") ? document.addEventListener("vcall:intro-done", r, { once: true }) : r(),
);
introPronta.then(pedirPermissoes).then((resultado) => {
  // Os nomes dos dispositivos ("Webcam HD da Logitech") só chegam depois de uma
  // permissão concedida; antes disso a lista vem com rótulos vazios. Reler
  // agora é o que faz a antessala mostrar os aparelhos pelo nome de verdade.
  if (resultado) media.enumerate();
});

if (isGuest) {
  showLobby({ isGuest: true });
} else {
  $("#lobby").hidden = true;
  dashboard = new Dashboard({
    onEnter: ({ roomId, pass, meta, roomName }) => {
      app.room = roomId;
      app.roomPass = pass || "";
      app.roomMeta = meta || null;
      app.roomName = roomName || "";
      history.replaceState(null, "", `#${roomId}`);
      swap(() => {
        dashboard.hide();
        dashboard = null;
        showLobby({ isGuest: !meta });
      });
    },
  });
  dashboard.mount($(".app"));
}
playIntro();

function showLobby({ isGuest: guest }) {
  $("#lobby").hidden = false;
  lobby.mount(document, { isGuest: guest });
  stagger($("#lobby").querySelectorAll(".lobby__preview, .lobby__form > *"), { delay: 60, gap: 40 });
}

if (!env.canShareScreen) {
  console.info("[vcall] este navegador não oferece captura de tela");
}

/* ================================================================== *
 * Entrar na chamada
 * ================================================================== */

async function enterCall(profile) {
  app.profile = profile;
  app.joined = true;

  if (location.hash.slice(1) !== app.room) {
    history.replaceState(null, "", `#${app.room}`);
  }

  await swap(() => {
    lobby.hide();
    $("#topbar").hidden = false;
    $("#stage").hidden = false;
    $("#dock").hidden = false;

    buildStage();
    buildPanel();
    buildDock();
    buildBoard();
    wireCaptions();
    wireRecorder();
    wireTransfer();
    bindShortcuts();
    startTimer();
  });
  stagger($("#dock").querySelectorAll(".ctrl"), { gap: 22, y: 18, blur: 0 });
  watchHandsFree(media);

  // O contexto de áudio só pode começar depois de um gesto do usuário — e
  // clicar em "entrar" é esse gesto.
  mesh.vad.resume();
  audio.resume();

  wireMesh();

  await mesh.join({
    room: app.room,
    profile,
    state: { mic: media.micEnabled, cam: media.camEnabled, screen: false, hand: false, board: false },
    meta: app.roomMeta,
    pass: app.roomPass,
  });
}

/* ================================================================== *
 * Palco
 * ================================================================== */

function buildStage() {
  stage = new Stage({
    root: $("#stage"),
    gridEl: $("#grid"),
    spotlightEl: $("#spotlight"),
    onPin: () => refreshBoardHost(),
  });

  const self = stage.ensure("self", "cam", {
    name: `${app.profile.name} (você)`,
    avatar: app.profile.avatar,
    self: true,
  });
  self.setCamera(media.camEnabled ? media.stream : null);
  self.setMic(media.micEnabled);
  self.setQuality("good");
  buildWaiting();

  media.on("change", () => {
    const tile = stage.get("self", "cam");
    if (!tile) return;
    tile.setCamera(media.camEnabled ? media.stream : null);
    tile.setMic(media.micEnabled);
    syncDockMedia();
  });
}

/**
 * Sala de espera: enquanto só você está na chamada, o palco mostra o código
 * da sala, os atalhos para convidar e um sinal pulsando da logo — em vez do
 * seu próprio rosto em tela cheia, que é o que a pessoa menos precisa ver.
 * Some sozinha quando a primeira pessoa entra.
 */
let waitingSignal = null;

function buildWaiting() {
  const rings = [0, 1, 2].map(() => el("span.waiting__ring"));
  const code = el("span.waiting__code", { text: app.roomCode || "······" });
  const box = el("section.waiting", { id: "waiting", "aria-label": "Aguardando participantes", hidden: true }, [
    el("div.waiting__signal", { "aria-hidden": "true" }, [
      ...rings,
      el("img.waiting__mark", { src: "/assets/logo-mark.png", alt: "", width: 72, height: 72 }),
    ]),
    el("h2.waiting__title", { text: "Só você por aqui, por enquanto" }),
    el("p.waiting__lead", {
      text: "Mande o link ou dite o código. A chamada começa no instante em que alguém entrar.",
    }),
    el("button.waiting__codeBtn", {
      type: "button",
      "aria-label": "Copiar código da sala",
      onClick: () => copy(app.roomCode || "", "Código copiado"),
    }, [code, icon("copy", { size: "sm" })]),
    el("div.waiting__actions", {}, [
      el("button.btn.btn--primary.btn--lg", { type: "button", onClick: () => copy(roomLink(), "Link copiado") }, [
        icon("link"),
        el("span", { text: "Copiar link da sala" }),
      ]),
      el("button.btn.btn--lg", { type: "button", onClick: () => openInvite() }, [
        icon("user-plus"),
        el("span", { text: "Mais formas de convidar" }),
      ]),
    ]),
  ]);
  box._rings = rings;
  box._code = code;
  $("#stageMain").prepend(box);
}

function syncWaiting(alone) {
  const box = $("#waiting");
  if (!box) return;
  if (app.roomCode) box._code.textContent = app.roomCode;
  if (box.hidden === !alone) return;
  // A troca é uma reorganização de layout: a transição de tela explica que o
  // seu vídeo foi para o lado (ou voltou para a grade).
  swap(() => {
    box.hidden = !alone;
    $("#stage").classList.toggle("stage--alone", alone);
    stage?.relayout();
  });
  waitingSignal?.stop();
  waitingSignal = alone ? signal(box._rings) : null;
  if (alone) stagger(box.querySelectorAll(".waiting__title, .waiting__lead, .waiting__codeBtn, .waiting__actions"), { delay: 120, gap: 60 });
}

/* ================================================================== *
 * Painel
 * ================================================================== */

function buildPanel() {
  panel = new Panel({
    onSend: (text) => {
      mesh.sendChat(text);
      panel.addMessage({
        id: mesh.selfId || "self",
        name: app.profile.name,
        avatar: app.profile.avatar,
        text,
        self: true,
      });
    },
    onClose: () => panel.setOpen(false),
    onFiles: (files) => sendFiles(files),
    // Clicar numa pessoa da lista: você mesmo abre o seu perfil; os outros
    // vão para o destaque (e clicar de novo tira).
    onPerson: (p) => {
      if (p.self) {
        openSettings();
        return;
      }
      const id = stage.tileId(p.id, "cam");
      if (stage.tiles.has(id)) stage.togglePin(id);
    },
    onChange: ({ open, tab, unread }) => {
      // A lista de pessoas só era desenhada quando alguém entrava ou saía:
      // abrir a aba numa sala estável mostrava um painel em branco. Agora ela
      // é desenhada ao abrir, com quem já está na sala.
      if (open && tab === "people" && panel) renderPeopleNow();
      if (open && tab === "stats" && panel) {
        panel.renderStats(mesh.stats.samples, mesh.roster(), { history: (id) => mesh.stats.historyFor(id) });
      }
      dock?.update("chat", { active: open && tab === "chat", badge: unread });
      dock?.update("people", { active: open && tab === "people" });
      dock?.update("stats", { active: open && tab === "stats" });
    },
  });
  $("#stage").append(panel.node);
}

/* ================================================================== *
 * Moderação (anfitrião)
 * ================================================================== */

/** Desenha a lista de pessoas, com os controles de anfitrião quando cabe. */
function renderPeopleNow(roster = mesh.roster()) {
  const mod = mesh.isHost
    ? {
        closed: !!mesh.roomInfo?.closed,
        onMute: (p) => {
          mesh.moderate("mute", p.id);
          toast(`Pedido enviado: ${p.name} foi silenciado`, { tone: "ok", ms: 2200, key: "mod" });
        },
        onCamOff: (p) => {
          mesh.moderate("cam-off", p.id);
          toast(`Câmera de ${p.name} desligada`, { tone: "ok", ms: 2200, key: "mod" });
        },
        onKick: (p) => confirmKick(p),
        onMuteAll: () => {
          mesh.moderate("mute-all");
          toast("Todos foram silenciados", { tone: "ok", ms: 2200, key: "mod" });
        },
        onLock: (fechar) => mesh.moderate(fechar ? "lock" : "unlock"),
      }
    : null;
  panel.renderPeople(roster, mod);
}

/** Remover alguém é definitivo nesta sala: pede confirmação antes. */
function confirmKick(p) {
  const dlg = el("dialog.modal");
  const remover = el("button.btn.btn--danger", { type: "button" }, [icon("user-x", { size: "sm" }), el("span", { text: "Remover" })]);
  const cancelar = el("button.btn.btn--ghost", { type: "button", text: "Cancelar" });
  dlg.append(
    el("div.modal__card", {}, [
      el("div.modal__head", {}, [el("h2.modal__title", { text: `Remover ${p.name || "participante"}?` })]),
      el("div.modal__body", {}, [
        el("p.muted", {
          text: "A pessoa sai da chamada na hora e não consegue voltar para esta sala pelo mesmo aparelho enquanto ela existir.",
        }),
        el("div.row", { style: { justifyContent: "flex-end", gap: "var(--sp-2)" } }, [cancelar, remover]),
      ]),
    ]),
  );
  const fechar = () => (dlg.close(), dlg.remove());
  cancelar.addEventListener("click", fechar);
  dlg.addEventListener("close", () => dlg.remove());
  remover.addEventListener("click", () => {
    mesh.moderate("kick", p.id);
    fechar();
  });
  document.body.append(dlg);
  dlg.showModal();
  cancelar.focus();
}

function wireModeration() {
  mesh.on("moderated", (m) => {
    const por = m.by || "O anfitrião";
    if (m.action === "mute") {
      if (media.micEnabled) {
        media.setMic(false);
        syncDockMedia();
      }
      toast(`${por} silenciou o seu microfone. Ligue de novo quando quiser falar.`, {
        tone: "info",
        ms: 5000,
        key: "mod-mute",
      });
    } else if (m.action === "cam-off") {
      if (media.camEnabled) media.setCam(false).then(syncDockMedia);
      toast(`${por} desligou a sua câmera.`, { tone: "info", ms: 5000, key: "mod-cam" });
    } else if (m.action === "kick") {
      leaveCall({ motivo: "kicked", por });
    } else if (m.action === "kicked") {
      panel.addSystem(`${m.name || "Alguém"} foi removido da sala por ${por}`);
    }
  });

  mesh.on("room-closed", ({ closed, by }) => {
    toast(closed ? `${by || "O anfitrião"} trancou a sala: ninguém novo entra` : `${by || "O anfitrião"} destrancou a sala`, {
      tone: "info",
      ms: 3500,
      key: "room-closed",
    });
    if (panel.open && panel.tab === "people") renderPeopleNow();
  });

  mesh.on("host", ({ self }) => {
    if (self) toast("Você é o anfitrião desta sala", { tone: "ok", ms: 2600, key: "host" });
    if (panel.open && panel.tab === "people") renderPeopleNow();
  });
}

/* ================================================================== *
 * Arquivos na conversa
 * ================================================================== */

async function sendFiles(files) {
  for (const f of files) {
    if (f.size > MAX_FILE) {
      toast(`“${f.name}” tem ${formatSize(f.size)} — o limite por arquivo é ${formatSize(MAX_FILE)}.`, {
        tone: "warn",
        ms: 6000,
      });
      continue;
    }
    if (!mesh.peers.size) {
      toast("Não há mais ninguém na sala para receber o arquivo.", { tone: "warn" });
      return;
    }
    const sent = await transfer.send(f);
    if (!sent) continue;
    panel.addFile({
      id: mesh.selfId || "self",
      name: app.profile.name,
      avatar: app.profile.avatar,
      file: sent,
      self: true,
    });
    panel.setFileProgress(sent.id, 1);
  }
}

function wireTransfer() {
  // O arquivo segue o mesmo caminho das imagens do canvas: canal de carga
  // pesada, fatiado, com espera de buffer entre os pedaços.
  transfer.on("blob", (payload) => mesh.broadcastBlob(payload));

  transfer.on("start", ({ id, from, meta }) => {
    const profile = mesh.profiles.get(from) || {};
    panel.addFile({
      id: from,
      name: profile.name || "Alguém",
      avatar: profile.avatar,
      file: { ...meta, url: "", mime: meta.mime },
      at: meta.at,
    });
    panel.setFileProgress(id, 0.02);
  });

  transfer.on("progress", ({ id, sent, total, outgoing }) => {
    if (!outgoing) panel.setFileProgress(id, sent / total);
  });

  transfer.on("file", (file) => {
    // O cartão já está na conversa desde o "file-begin"; agora ele ganha o
    // endereço do arquivo pronto e a barra de progresso sai.
    panel.completeFile(file.id, file.url);
    const who = mesh.profiles.get(file.from)?.name || "Alguém";
    notify(`${who} enviou um arquivo`, file.name);
    if (!panel.open || panel.tab !== "chat") {
      toast(`${who} enviou “${file.name}”`, {
        tone: "info",
        key: "file",
        action: { label: "Abrir", onClick: () => panel.setOpen(true, "chat") },
      });
    }
  });

  transfer.on("error", ({ reason, file }) => {
    toast(
      reason === "too-large"
        ? `“${file?.name || "O arquivo"}” passa do limite de ${formatSize(MAX_FILE)}.`
        : "Um arquivo chegou corrompido.",
      { tone: "warn" },
    );
  });

  mesh.on("peer-removed", ({ id }) => transfer.forget(id));
}

/* ================================================================== *
 * Controles
 * ================================================================== */

function buildDock() {
  dock = new Dock($("#dock"));

  const g1 = dock.group();
  dock.add(g1, {
    id: "mic",
    icon: "mic",
    label: "Microfone",
    shortcut: "M",
    kind: "toggle",
    on: media.micEnabled,
    onClick: () => {
      media.toggleMic();
      syncDockMedia();
    },
  });
  dock.add(g1, {
    id: "cam",
    icon: "video",
    label: "Câmera",
    shortcut: "V",
    kind: "toggle",
    on: media.camEnabled,
    onClick: async () => {
      await media.toggleCam();
      syncDockMedia();
    },
  });

  dock.add(g1, {
    id: "deafen",
    icon: "volume-2",
    label: "Silenciar tudo",
    shortcut: "D",
    kind: "toggle",
    // "on" = ouvindo. Começava em false, e o botão nascia vermelho como se o
    // som estivesse cortado — toggleDeafen() já usa esta mesma convenção.
    on: true,
    onClick: () => toggleDeafen(),
  });

  const g2 = dock.group();
  if (env.canShareScreen) {
    dock.add(g2, {
      id: "screen",
      icon: "screen-share",
      label: "Compartilhar tela",
      shortcut: "S",
      onClick: () => toggleScreen(),
    });
    dock.add(g2, {
      id: "screenOpts",
      icon: "chevron-down",
      label: "Opções de compartilhamento",
      className: "ctrl--slim",
      onClick: () => openScreenMenu(),
    });
    dock.get("screenOpts").style.width = "30px";
  }

  dock.add(g2, {
    id: "board",
    icon: "pencil",
    label: "Quadro branco",
    shortcut: "Q",
    onClick: () => openBoardMenu(),
  });

  const g3 = dock.group();
  dock.add(g3, {
    id: "hand",
    icon: "hand",
    label: "Levantar a mão",
    shortcut: "H",
    onClick: () => toggleHand(),
  });
  dock.add(g3, {
    id: "react",
    icon: "smile",
    label: "Reagir",
    shortcut: "R",
    onClick: () => openReactionMenu(),
  });
  dock.add(g3, {
    id: "captions",
    icon: "eye-off",
    label: "Legendar minha fala",
    shortcut: "T",
    onClick: () => toggleCaptions(),
  });
  if (canRecord) {
    dock.add(g3, {
      id: "record",
      icon: "radio",
      label: "Gravar a chamada",
      onClick: () => toggleRecording(),
    });
  }

  const g4 = dock.group();
  dock.add(g4, {
    id: "chat",
    icon: "message-square",
    label: "Conversa",
    shortcut: "C",
    onClick: () => panel.toggle("chat"),
  });
  dock.add(g4, {
    id: "people",
    icon: "users",
    label: "Pessoas",
    shortcut: "P",
    onClick: () => panel.toggle("people"),
  });
  dock.add(g4, {
    id: "stats",
    icon: "activity",
    label: "Qualidade da chamada",
    onClick: () => panel.toggle("stats"),
  });
  dock.add(g4, {
    id: "layout",
    icon: "layout-grid",
    label: "Alternar layout",
    shortcut: "L",
    onClick: () => {
      const next = stage.setLayout(stage.layout === "auto" ? "grid" : "auto");
      dock.update("layout", {
        iconName: next === "grid" ? "layout-grid" : "presentation",
        label: next === "grid" ? "Grade igualitária" : "Destaque automático",
      });
      toast(next === "grid" ? "Todos no mesmo tamanho" : "Destaque automático ligado", { tone: "info", ms: 1800 });
    },
  });
  dock.add(g4, {
    id: "settings",
    icon: "settings",
    label: "Configurações",
    onClick: () => openSettings(),
  });
  // Só aparece em telas estreitas (ver app.css): reúne o que não cabe na barra.
  dock.add(g4, {
    id: "more",
    icon: "more-vertical",
    label: "Mais opções",
    onClick: () => openMoreMenu(),
  });

  const g5 = dock.group();
  if (MiniCall.supported) {
    const mini = (app.mini = new MiniCall({
      stage,
      state: () => ({ mic: media.micEnabled, cam: media.camEnabled }),
      press: (id) => dock.get(id)?.click(),
      title: () => (app.roomName ? `Vcall · ${app.roomName}` : "Vcall"),
    }));
    mini.onClose = () => dock.update("mini", { active: false });
    dock.add(g5, {
      id: "mini",
      icon: "picture-in-picture-2",
      label: "Mini-janela flutuante",
      shortcut: "J",
      onClick: async () => {
        try {
          await mini.toggle();
          dock.update("mini", { active: mini.open });
        } catch {
          toast("Não foi possível abrir a mini-janela agora.", { tone: "warn" });
        }
      },
    });
  }
  dock.add(g5, {
    id: "leave",
    icon: "phone-off",
    label: "Sair da chamada",
    className: "ctrl--hangup",
    onClick: () => leaveCall(),
  });

  syncDockMedia();
  magnifyDock(dock.node);
}

function openMoreMenu() {
  dock.openPopover("more", (pop, close) => {
    const item = (iconName, label, fn, checked = null) =>
      pop.append(Dock.item({ iconName, label, checked, onClick: () => (close(), fn()) }));

    // No celular a barra guarda só cinco botões: o que ela esconde
    // precisa reaparecer aqui, senão fica inalcançável.
    if (matchMedia("(max-width: 820px)").matches) {
      item(
        "pencil",
        app.boardMode ? "Fechar o quadro" : "Quadro branco",
        () => (app.boardMode ? closeBoard() : openBoard("board")),
        !!app.boardMode,
      );
      item(
        audio.deafened ? "volume-x" : "volume-2",
        audio.deafened ? "Voltar a ouvir" : "Silenciar tudo",
        toggleDeafen,
        audio.deafened,
      );
      pop.append(el("div.popover__sep"));
    }
    item("hand", app.hand ? "Baixar a mão" : "Levantar a mão", toggleHand, app.hand);
    item("smile", "Reagir", () => {
      // Reabre como menu de reações, ancorado no mesmo botão.
      setTimeout(() => dock.openPopover("more", (p2, c2) => {
        for (const r of REACTIONS) {
          p2.append(
            Dock.item({
              iconName: r.icon,
              label: r.label,
              onClick: () => {
                mesh.sendReaction(r.kind);
                showReaction(mesh.selfId || "self", r.kind);
                c2();
              },
            }),
          );
        }
      }), 0);
    });
    item("eye", captions.enabled ? "Parar de legendar" : "Legendar minha fala", toggleCaptions, captions.enabled);
    if (canRecord) {
      item("radio", recorder.recording ? "Parar a gravação" : "Gravar a chamada", toggleRecording, recorder.recording);
    }
    pop.append(el("div.popover__sep"));
    item("users", "Pessoas", () => panel.setOpen(true, "people"));
    item("activity", "Qualidade da chamada", () => panel.setOpen(true, "stats"));
    item("layout-grid", "Alternar layout", () => dock.get("layout")?.click());
    if (env.canShareScreen) item("monitor", "Opções de compartilhamento", () => openScreenMenu("more"));
    pop.append(el("div.popover__sep"));
    item("circle-help", "Atalhos do teclado", openShortcuts);
    item("settings", "Configurações", () => openSettings());
  });
}

/* ================================================================== *
 * Folha de atalhos
 *
 * Um app de chamada tem atalho para quase tudo e ninguém decora nenhum. A
 * lista sai daqui e não de um texto no README porque é aqui que ela é
 * procurada — no meio da reunião.
 * ================================================================== */

const SHORTCUTS = [
  ["Chamada", [
    ["M", "Ligar e desligar o microfone"],
    ["Espaço", "Falar enquanto segura (com o microfone mudo)"],
    ["V", "Ligar e desligar a câmera"],
    ["S", "Compartilhar a tela"],
    ["D", "Silenciar todo mundo para você"],
    ["H", "Levantar e baixar a mão"],
    ["R", "Reagir"],
    ["T", "Legendar sua fala"],
  ]],
  ["Tela e painéis", [
    ["C", "Conversa"],
    ["P", "Pessoas"],
    ["L", "Alternar o layout"],
    ["J", "Mini-janela flutuante, por cima dos outros programas"],
    ["Q", "Abrir e fechar o canvas"],
    ["?", "Esta lista"],
    ["Esc", "Fechar o que estiver aberto"],
  ]],
  ["Canvas", [
    ["1 – 0", "Escolher a ferramenta"],
    ["N", "Nota adesiva"],
    ["I", "Conta-gotas"],
    ["G", "Preencher formas"],
    ["X", "Encaixar na malha"],
    ["F", "Enquadrar tudo"],
    ["Espaço", "Arrastar o plano"],
    ["Ctrl + roda", "Zoom"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Desfazer e refazer"],
    ["Ctrl+C / V / D", "Copiar, colar, duplicar"],
    ["Ctrl+A", "Selecionar tudo"],
    ["Setas", "Empurrar a seleção (Shift: dez vezes mais)"],
    ["[ e ]", "Mandar para trás, trazer à frente"],
    ["Shift ao desenhar", "Travar quadrado, círculo e 45°"],
  ]],
];

function openShortcuts() {
  const body = $("#settingsBody");
  body.replaceChildren();
  $("#settingsTitle").textContent = "Atalhos do teclado";

  for (const [title, rows] of SHORTCUTS) {
    body.append(
      el("div.stack", {}, [
        el("h3", { text: title, style: { fontSize: "var(--text-md)" } }),
        el(
          "div.keysheet",
          {},
          rows.map(([key, what]) =>
            el("div.keysheet__row", {}, [
              el("kbd.keysheet__key", { text: key }),
              el("span", { text: what }),
            ]),
          ),
        ),
      ]),
    );
  }
  $("#settingsModal").showModal();
}

/**
 * Modo surdo: corta a saída de áudio de todos os participantes de uma vez.
 *
 * É diferente de baixar o volume geral: ao desligar, cada pessoa volta ao
 * volume individual que tinha. E é diferente de mutar o próprio microfone —
 * por isso, quando a pessoa fica surda, o microfone também é desligado: falar
 * sem ouvir a resposta é a pior das duas situações, e é o que todo aplicativo
 * de chamada faz neste caso.
 */
function toggleDeafen() {
  const deaf = audio.toggleDeafen();
  dock.update("deafen", {
    on: !deaf,
    active: deaf,
    iconName: deaf ? "volume-x" : "volume-2",
    label: deaf ? "Voltar a ouvir" : "Silenciar tudo",
  });
  if (deaf && media.micEnabled) {
    app.micBeforeDeafen = true;
    media.setMic(false);
    syncDockMedia();
  } else if (!deaf && app.micBeforeDeafen) {
    app.micBeforeDeafen = false;
    media.setMic(true);
    syncDockMedia();
  }
  toast(
    deaf
      ? "Você não está ouvindo ninguém (e seu microfone foi desligado)"
      : "Áudio de volta",
    { tone: "info", ms: 2400, key: "deafen" },
  );
}

/** Instala o controle de volume num ladrilho remoto. */
function addVolumeTo(tile, peerId, name) {
  if (!tile || tile.self || tile.volumeEl) return;
  // Mutar aqui é local: só este computador para de ouvir essa pessoa; os
  // outros participantes continuam escutando-a normalmente.
  tile.addVolume({
    name,
    value: audio.volumeFor(peerId),
    onChange: (v) => audio.setVolume(peerId, v),
    onToggle: () => {
      const v = audio.toggleMute(peerId);
      toast(
        v === 0 ? `${name} silenciado só para você` : `${name} audível de novo`,
        { tone: "info", ms: 2000, key: `mute-${peerId}` },
      );
    },
  });
}

function syncDockMedia() {
  dock?.update("mic", {
    on: media.micEnabled,
    iconName: media.micEnabled ? "mic" : "mic-off",
    label: media.micEnabled ? "Microfone ligado" : "Microfone mudo",
  });
  dock?.update("cam", {
    on: media.camEnabled,
    iconName: media.camEnabled ? "video" : "video-off",
    label: media.camEnabled ? "Câmera ligada" : "Câmera desligada",
  });
  if (mesh.selfId) mesh.publishState();
}

/* ================================================================== *
 * Compartilhamento de tela
 * ================================================================== */

async function toggleScreen(opts = {}) {
  if (screen.active) {
    screen.stop("user");
    return;
  }

  /*
   * O painel próprio vem primeiro; a janela do navegador vem depois e é
   * obrigatória — nenhuma página consegue listar as suas janelas ou escolher
   * uma sozinha. O que o painel faz é decidir COMO perguntar: a escolha de
   * tela/janela/aba vira a preferência `displaySurface`, e o seletor do
   * navegador já abre na aba certa em vez de a pessoa ter que procurar.
   */
  // No app de mesa a lista de telas e janelas é nossa (desktop/main.js).
  const desktop = window.vcallDesktop?.fontes ? window.vcallDesktop : null;
  const escolha = opts.pular ? null : await escolherCompartilhamento({ podeAudio: true, desktop });
  if (!opts.pular && !escolha) return; // desistiu no painel

  try {
    // Avisa o processo principal do que foi escolhido ANTES de pedir a
    // captura: é ele quem responde ao getDisplayMedia no app de mesa.
    if (desktop && escolha) await desktop.escolherFonte(escolha.fonte || "", escolha.withAudio);
    await screen.start({
      quality: escolha?.quality || prefs.get("screen:quality", "auto"),
      mode: escolha?.mode || screen.mode,
      // Sem painel (atalho direto), sem som: o som só vai quando pedido.
      withAudio: escolha ? escolha.withAudio : false,
      surface: escolha?.surface || null,
      ...opts,
    });
  } catch (err) {
    // Falhar ao compartilhar nunca tira ninguém da chamada: só avisa.
    if (err?.name !== "NotAllowedError") toast(describeScreenError(err), { tone: "warn" });
  }
}

function openScreenMenu(ownerId = "screenOpts") {
  dock.openPopover(ownerId, (pop, close) => {
    pop.append(el("div.popover__label", { text: "Qualidade" }));
    const current = prefs.get("screen:quality", "auto");
    for (const [id, q] of Object.entries(SCREEN_QUALITY)) {
      pop.append(
        Dock.item({
          iconName: "monitor",
          label: q.label,
          checked: current === id,
          onClick: async () => {
            prefs.set("screen:quality", id);
            if (screen.active) await screen.setQuality(id);
            close();
            toast(`Qualidade: ${q.label}`, { tone: "info", ms: 1600 });
          },
        }),
      );
    }

    pop.append(el("div.popover__sep"), el("div.popover__label", { text: "O que você está mostrando" }));
    for (const [mode, label, iconName] of [
      ["text", "Texto, código ou slides", "type"],
      ["motion", "Vídeo ou animação", "zap"],
    ]) {
      pop.append(
        Dock.item({
          iconName,
          label,
          checked: screen.mode === mode,
          onClick: () => {
            screen.setMode(mode);
            close();
            toast(
              mode === "text"
                ? "Priorizando nitidez: a imagem para de perder detalhe quando a rede aperta"
                : "Priorizando fluidez: a imagem fica menor antes de engasgar",
              { tone: "info", ms: 3200 },
            );
          },
        }),
      );
    }

    if (screen.active) {
      pop.append(
        el("div.popover__sep"),
        Dock.item({
          iconName: "screen-share-off",
          label: "Parar de compartilhar",
          onClick: () => {
            screen.stop("user");
            close();
          },
        }),
      );
    }
  });
}

screen.on("start", () => {
  dock?.update("screen", {
    active: true,
    iconName: "screen-share-off",
    label: "Parar de compartilhar",
  });

  const tile = stage.ensure("self", "screen", {
    name: `Sua tela`,
    avatar: app.profile.avatar,
    self: true,
  });
  tile.setStream(screen.stream);
  tile.setMic(true);
  tile.setQuality("good");
  // Tela inteira: nada de prévia ao vivo (efeito espelho). Janela: a prévia
  // fica, porque não tem como a janela conter a chamada.
  const superficie = screen.videoTrack?.getSettings?.().displaySurface || screen.surface;
  tile.setPresenting(superficie === "monitor");
  stage.relayout();

  const s = screen.settings;
  const detail = s?.width ? `${s.width}×${s.height} a ${Math.round(s.frameRate || 0)} fps` : "";
  toast(`Compartilhando sua tela${detail ? ` · ${detail}` : ""}`, { tone: "ok" });

  // Só avisa sobre o som quando a pessoa pediu som e ele não veio.
  if (screen.wantedAudio && !screen.audioTrack) {
    toast(
      window.vcallDesktop
        ? "O som do computador não foi capturado — neste sistema a tela vai sem som."
        : "O som não foi capturado. No Chrome, marque “Compartilhar áudio” na janela de seleção; no Firefox e no Safari isso ainda não existe.",
      { tone: "info", ms: 6000, key: "screen-audio" },
    );
  }
});

screen.on("stop", ({ reason }) => {
  dock?.update("screen", { active: false, iconName: "screen-share", label: "Compartilhar tela" });
  stage.remove("self", "screen");
  if (app.boardMode === "annotate") closeBoard();
  if (reason === "browser") toast("Compartilhamento encerrado", { tone: "info", ms: 2000 });
});

screen.on("surface", (s) => {
  // A resolução mudou no meio do caminho (o usuário trocou de janela). O teto
  // do encoder já foi reavaliado em core/screen.js; aqui só se atualiza a
  // prévia. Sem aviso na tela: ele disparava logo no começo de todo
  // compartilhamento e era só mais uma notificação pulando.
  const tile = stage.get("self", "screen");
  if (tile) tile.setPresenting((s.displaySurface || screen.surface) === "monitor");
});

screen.on("error", (err) => {
  if (err?.name !== "NotAllowedError") toast(describeScreenError(err), { tone: "warn" });
});

/* ================================================================== *
 * Quadro branco
 * ================================================================== */

function buildBoard() {
  board = new InfiniteCanvas({
    selfId: mesh.selfId || "self",
    selfName: app.profile.name,
    getRoster: () => mesh.roster(),
  });

  board.on("op", (op) => mesh.broadcastBoard(op));
  board.on("cursor", (payload) => mesh.broadcastCursor(payload));
  // Imagens vão pelo canal de carga pesada, fatiadas, para não travar os
  // deltas de desenho de quem está no meio de um traço.
  board.on("blob", (payload) => mesh.broadcastBlob(payload));
  board.on("error", () => toast("Não consegui ler essa imagem.", { tone: "warn" }));
  board.on("sync-request", (peerId) => {
    // Só um participante responde, senão quem chega recebe N cópias.
    const ids = mesh.roster().map((p) => p.id).filter((id) => id !== peerId);
    if (ids.sort()[0] !== mesh.selfId) return;
    mesh.peers.get(peerId)?.sendBoard(board.scene());
  });

  /*
   * Reconciliação quando o canal (re)abre.
   *
   * Enquanto o canal esteve fechado — queda de rede, reconstrução da conexão —
   * cada lado continuou desenhando sem que o outro visse. Trocar a cena aqui
   * junta os dois desenhos: `apply("scene")` funde em vez de substituir, e
   * cada objeto tem id único por autor, então nada é sobrescrito nem duplicado.
   * Sem isto, os dois canvas ficavam permanentemente diferentes e a única
   * saída era limpar tudo.
   */
  mesh.on("board-channel", ({ id }) => {
    if (!board?.objects.size) return;
    mesh.peers.get(id)?.sendBoard(board.scene());
  });
}

function openBoardMenu() {
  dock.openPopover("board", (pop, close) => {
    pop.append(
      Dock.item({
        iconName: "pencil",
        label: "Canvas colaborativo",
        checked: app.boardMode === "board",
        onClick: () => {
          close();
          app.boardMode === "board" ? closeBoard() : openBoard("board");
        },
      }),
    );
    const canAnnotate = screen.active || [...mesh.states.values()].some((s) => s.screen);
    pop.append(
      Dock.item({
        iconName: "highlighter",
        label: canAnnotate ? "Anotar sobre a tela" : "Anotar (nenhuma tela em exibição)",
        checked: app.boardMode === "annotate",
        onClick: () => {
          close();
          if (!canAnnotate) {
            toast("Compartilhe uma tela primeiro para poder anotar sobre ela.", { tone: "info" });
            return;
          }
          app.boardMode === "annotate" ? closeBoard() : openBoard("annotate");
        },
      }),
    );
    if (app.boardMode) {
      pop.append(
        el("div.popover__sep"),
        Dock.item({ iconName: "image", label: "Inserir imagem ou canvas salvo", onClick: () => (close(), board.openImagePicker()) }),
        Dock.item({ iconName: "maximize", label: "Enquadrar tudo · F", onClick: () => (close(), board.fitAll()) }),
        Dock.item({ iconName: "undo-2", label: "Desfazer · Ctrl+Z", onClick: () => (close(), board.undo()) }),
        Dock.item({ iconName: "redo-2", label: "Refazer · Ctrl+Shift+Z", onClick: () => (close(), board.redo()) }),
        Dock.item({ iconName: "download", label: "Baixar como PNG", onClick: () => (close(), board.exportPng()) }),
        Dock.item({ iconName: "save", label: "Salvar canvas (.json)", onClick: () => (close(), board.exportJson()) }),
        Dock.item({ iconName: "x", label: "Fechar canvas", onClick: () => (close(), closeBoard()) }),
      );
    }
  });
}

function openBoard(mode) {
  closeBoard();
  app.boardMode = mode;
  boardNotice.seen();

  // O quadro ocupa o lugar do destaque, não a tela inteira: quem desenha
  // continua vendo os outros na faixa ao lado. No modo anotação ele é uma
  // camada transparente sobre a tela que já está em destaque.
  if (mode === "board") stage.setBoard(true);
  board.mount($("#spotlight"), { mode });

  dock.update("board", { active: true, label: mode === "board" ? "Fechar canvas" : "Parar de anotar" });
  mesh.publishState({ board: true });

  // Pede o estado atual a quem já estava no quadro.
  mesh.broadcastBoard({ type: "hello" });
  // A dica de atalhos também é uma vez só: quem abre e fecha o canvas várias
  // vezes numa chamada não precisa reler o mesmo texto a cada abertura.
  if (!app.boardTipShown?.[mode]) {
    app.boardTipShown = { ...app.boardTipShown, [mode]: true };
    toast(
      mode === "board"
        ? "Canvas aberto · espaço arrasta, Ctrl+roda dá zoom, N cria nota, Ctrl+Z desfaz"
        : "Anotando sobre a tela",
      { tone: "info", ms: 4000, key: "board-tip" },
    );
  }
}

function closeBoard() {
  if (!app.boardMode) return;
  app.boardMode = null;
  board?.unmount();
  stage?.setBoard(false);
  dock?.update("board", { active: false, label: "Canvas colaborativo" });
  mesh.publishState({ board: false });
}

/**
 * Se a tela que estava em destaque some, a camada de anotação perde o que
 * anotava — fecha em vez de ficar sobrando sobre outra coisa.
 */
function refreshBoardHost() {
  if (app.boardMode !== "annotate" || !board?.mounted) return;
  const stillSharing = screen.active || [...mesh.states.values()].some((s) => s.screen);
  if (!stillSharing) closeBoard();
}

/* ================================================================== *
 * Legendas ao vivo
 * ================================================================== */

function wireCaptions() {
  // Dentro de #stageMain, não de #stage: é o #stageMain que tem posição
  // relativa e cobre só a área de vídeo. Ancorado no #stage, o bloco cai no
  // rodapé da janela, atrás da barra de controles.
  captions.mount($("#stageMain"));

  /*
   * O reconhecedor entrega um palpite novo a cada palavra — várias vezes por
   * segundo. Mandar cada um deles para a rede inundava a sinalização e
   * estourava o limite de mensagens do servidor, que fechava a conexão. Agora
   * o palpite é limitado a um a cada 350 ms e NÃO usa o caminho pelo servidor:
   * legenda parcial que chega atrasada não serve para nada, e a frase final
   * vem logo atrás de qualquer jeito.
   */
  const sendInterim = throttle((text) => {
    mesh.broadcastBoard({ type: "caption", text: text.slice(0, 300), final: false }, { fallback: false });
  }, 350);

  captions.on("local", ({ text, final }) => {
    // A própria fala aparece na sua tela e vai para os outros como texto.
    captions.show(mesh.selfId || "self", {
      name: `${app.profile.name} (você)`,
      text,
      final,
      color: colorFor(mesh.selfId || "self"),
    });
    // A frase encerrada vai inteira e com direito ao plano B: é ela que entra
    // na transcrição de quem está do outro lado.
    if (final) mesh.broadcastBoard({ type: "caption", text: text.slice(0, 300), final: true });
    else sendInterim(text);
  });

  captions.on("state", (on) => {
    dock?.update("captions", {
      active: on,
      iconName: on ? "eye" : "eye-off",
      label: on ? "Parar de legendar minha fala" : "Legendar minha fala",
    });
  });

  captions.on("error", (err) => {
    const texto =
      err === "not-allowed" || err === "service-not-allowed"
        ? "O navegador não liberou o reconhecimento de fala. Verifique a permissão do microfone."
        : err === "network"
          ? "O reconhecimento de fala do navegador precisa de internet e não respondeu. Tente de novo em instantes."
          : err === "audio-capture"
            ? "Nenhum microfone disponível para a legenda."
            : `Legendas interrompidas: ${String(err).replace(/\.+$/, "")}.`;
    toast(texto, { tone: "warn", key: "captions", ms: 6000 });
  });

  // App de mesa: o reconhecedor offline baixa o modelo do idioma na primeira vez.
  captions.on("status", ({ fase, p }) => {
    if (fase === "baixando") {
      toast(`Baixando o reconhecedor de fala (só na primeira vez)… ${Math.round((p || 0) * 100)}%`, {
        tone: "info",
        key: "fala",
        ms: 60_000,
      });
    } else if (fase === "carregando") {
      toast("Preparando as legendas…", { tone: "info", key: "fala", ms: 30_000 });
    } else if (fase === "pronto") {
      toast("Legendas ligadas. A sua fala é reconhecida aqui mesmo, sem sair do computador.", {
        tone: "ok",
        key: "fala",
        ms: 3500,
      });
    }
  });

  // Microfone mudo = legenda em pausa (nada do que é dito no mudo vai para a
  // sala). Trocar de microfone religa o reconhecedor na trilha nova.
  let ultimaTrilha = media.micTrack;
  media.on("change", () => {
    captions.setPaused(!media.micEnabled);
    if (captions.enabled && media.micTrack && media.micTrack !== ultimaTrilha && window.vcallDesktop) {
      captions.stop();
      captions.start();
    }
    ultimaTrilha = media.micTrack;
  });
  captions.setPaused(!media.micEnabled);
}

function toggleCaptions() {
  if (!captionsSupported) {
    toast(
      "Este navegador não transcreve fala. No Chrome ou no Edge funciona — e mesmo aqui você continua LENDO as legendas de quem ligar o recurso.",
      { tone: "info", ms: 7000 },
    );
    return;
  }
  const on = captions.toggle();
  // No app de mesa o aviso vem do próprio reconhecedor (baixando, pronto).
  if (on && window.vcallDesktop) return;
  toast(
    on
      ? media.micEnabled
        ? "Legendando sua fala. Todos na sala leem o que você diz."
        : "Legenda ligada — ela começa quando você ligar o microfone."
      : "Legendas desligadas.",
    { tone: "info", ms: 3000, key: "captions" },
  );
}

/* ================================================================== *
 * Gravação local
 * ================================================================== */

function wireRecorder() {
  recorder.on("state", ({ recording }) => {
    dock?.update("record", {
      active: recording,
      label: recording ? "Parar a gravação" : "Gravar a chamada",
    });
    document.body.classList.toggle("is-recording", recording);
  });

  recorder.on("done", ({ blob, ext }) => {
    const url = URL.createObjectURL(blob);
    const name = `vcall-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast(`Gravação salva (${formatSize(blob.size)}) em ${name}`, { tone: "ok", ms: 7000 });
  });

  recorder.on("error", (err) => {
    toast(`Não consegui gravar: ${err?.message || err}`, { tone: "warn", ms: 6000 });
  });
}

function toggleRecording() {
  if (!canRecord) {
    toast("Este navegador não grava mídia.", { tone: "warn" });
    return;
  }
  if (recorder.recording) {
    recorder.stop();
    return;
  }

  // Grava o que está em destaque; sem destaque, a própria câmera. É a trilha
  // que o mosaico teria como assunto principal, sem o custo de recompor N
  // vídeos num canvas a cada quadro.
  const featured = stage.featured() || stage.get("self", "cam");
  const videoTrack =
    featured?.video?.srcObject?.getVideoTracks?.().find((t) => t.readyState === "live") || null;

  const audioStreams = [media.stream, screen.stream, ...audio.streams()].filter(Boolean);

  const ok = recorder.start({ video: videoTrack, audioStreams });
  if (!ok) return;
  toast(
    videoTrack
      ? "Gravando nesta máquina. Avise os outros — eles não são notificados automaticamente."
      : "Gravando só o áudio (não há vídeo em destaque). Avise os outros.",
    { tone: "warn", ms: 8000 },
  );
}

/* ================================================================== *
 * Avisos do sistema
 *
 * Só quando a aba está em segundo plano: notificar alguém sobre algo que já
 * está na tela dela é só barulho.
 * ================================================================== */

function notify(title, body) {
  if (!app.notify || document.visibilityState === "visible") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/assets/icon-192.png", tag: "vcall" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* alguns navegadores só permitem por Service Worker; ignorado */
  }
}

async function setNotifications(want) {
  if (!("Notification" in window)) {
    toast("Este navegador não tem avisos de sistema.", { tone: "warn" });
    return false;
  }
  if (!want) {
    app.notify = false;
    prefs.set("notify", false);
    return false;
  }
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  app.notify = perm === "granted";
  prefs.set("notify", app.notify);
  if (!app.notify) toast("Os avisos ficaram bloqueados nas permissões do site.", { tone: "warn" });
  return app.notify;
}

/* ================================================================== *
 * Mão levantada e reações
 * ================================================================== */

function toggleHand() {
  app.hand = !app.hand;
  mesh.publishState({ hand: app.hand });
  dock.update("hand", { active: app.hand, label: app.hand ? "Baixar a mão" : "Levantar a mão" });
  stage.get("self", "cam")?.setHand(app.hand);
  if (app.hand) toast("Você levantou a mão", { tone: "info", ms: 2000 });
}

function openReactionMenu() {
  dock.openPopover(
    "react",
    (pop, close) => {
      for (const r of REACTIONS) {
        const b = Dock.item({
          iconName: r.icon,
          label: "",
          onClick: () => {
            mesh.sendReaction(r.kind);
            showReaction(mesh.selfId || "self", r.kind);
            close();
          },
        });
        b.setAttribute("aria-label", r.label);
        b.dataset.tip = r.label;
        b.dataset.tipPlacement = "bottom";
        pop.append(b);
      }
    },
    { className: "popover--reactions" },
  );
}

function showReaction(peerId, kind) {
  const r = REACTIONS.find((x) => x.kind === kind);
  if (!r) return;
  const tileId = peerId === mesh.selfId ? "self" : peerId;
  stage.get(tileId, "cam")?.react(r.icon);
}

/* ================================================================== *
 * Ligação com a malha
 * ================================================================== */

function wireMesh() {
  mesh.on("joined", ({ self, peers, room, reconnected }) => {
    app.maxPeers = room?.max || app.maxPeers;
    app.roomName = room?.name || app.roomName;
    app.roomCode = room?.code || app.roomCode;
    if (app.roomName) $("#roomName").textContent = app.roomName;
    $("#roomName").hidden = !app.roomName;
    board.selfId = self.id;
    board.color = colorFor(self.id);

    const tile = stage.get("self", "cam");
    tile?.setQuality("good");

    if (reconnected) {
      toast("Reconectado à sala", { tone: "ok" });
    }
    // Sala vazia não precisa de aviso: a sala de espera no palco já diz tudo.
    updateHeader();
  });

  // "peer-added" cobre os dois caminhos: alguém que chega agora e alguém que
  // já estava na sala quando nós chegamos. Criar o ladrilho só no "peer-join"
  // deixava quem entra numa sala cheia sem ver ninguém.
  mesh.on("peer-added", ({ id }) => {
    const profile = mesh.profiles.get(id) || {};
    const state = mesh.states.get(id) || {};
    const tile = stage.ensure(id, "cam", { name: profile.name || "Convidado", avatar: profile.avatar });
    addVolumeTo(tile, id, profile.name || "participante");
    tile.setConnection("connecting");
    tile.setMic(!!state.mic);
    tile.setHand(!!state.hand);
    updateHeader();
  });

  mesh.on("peer-join", (peer) => {
    // Quem caiu e voltou não "entrou" de novo: sem som e sem aviso de sistema.
    if (peer.reconnected) {
      panel.addSystem(`${peer.name} reconectou`);
      return;
    }
    panel.addSystem(`${peer.name} entrou`);
    chime("join");
    notify("Alguém entrou na sala", `${peer.name} está na chamada`);
  });

  mesh.on("peer-leave", ({ id, profile, replaced }) => {
    stage.removePeer(id);
    updateHeader();
    if (replaced) return; // a mesma pessoa está voltando com outra conexão
    panel.addSystem(`${profile?.name || "Alguém"} saiu`);
    chime("leave");
  });

  wireModeration();

  /**
   * As trilhas recebidas e o estado anunciado chegam em ordens diferentes, e o
   * navegador cria uma trilha receptora para a linha de tela mesmo quando
   * ninguém está compartilhando — isso criava um ladrilho preto fantasma. A
   * regra aqui é: o ladrilho existe quando há mídia viva E a pessoa declarou
   * que está enviando aquilo.
   */
  const remoteMedia = new Map(); // id -> { cam, screen }

  function syncTiles(id) {
    const got = remoteMedia.get(id) || {};
    const state = mesh.states.get(id) || {};
    const profile = mesh.profiles.get(id) || {};

    stage.get(id, "cam")?.setCamera(state.cam && got.cam ? got.cam : null);

    if (state.screen && got.screen) {
      const tile = stage.ensure(id, "screen", {
        name: `Tela de ${profile.name || "participante"}`,
        avatar: profile.avatar,
      });
      addVolumeTo(tile, id, profile.name || "participante");
      tile.setStream(got.screen);
      tile.setQuality(mesh.stats.samples.get(id)?.quality || "unknown");
      stage.relayout();
    } else if (stage.get(id, "screen")) {
      stage.remove(id, "screen");
    }
    refreshBoardHost();
  }

  mesh.on("media", ({ id, role, stream, live }) => {
    // Voz e som da tela vão para a saída de áudio. Sem esta linha a chamada
    // conecta, o vídeo aparece e não sai som nenhum.
    if (role === "mic" || role === "screenAudio") {
      audio.attach(id, role, live ? stream : null);
      // A linha de som da tela existe desde o começo da chamada e pode "acordar"
      // sem ninguém compartilhar nada (o navegador recebe silêncio). O aviso só
      // vale quando a pessoa está de fato compartilhando a tela — antes ele
      // aparecia do nada, para todo mundo.
      if (role === "screenAudio" && live && stream && mesh.states.get(id)?.screen) {
        toast(`${mesh.profiles.get(id)?.name || "Alguém"} está compartilhando o som da tela`, {
          tone: "info",
          ms: 3500,
          key: `scraudio-${id}`,
        });
      }
      return;
    }
    if (role !== "cam" && role !== "screen") return;
    const got = remoteMedia.get(id) || {};
    got[role] = live ? stream : null;
    remoteMedia.set(id, got);
    syncTiles(id);
  });

  mesh.on("peer-state", ({ id, state }) => {
    const cam = stage.get(id, "cam");
    if (cam) {
      cam.setMic(!!state.mic);
      cam.setHand(!!state.hand);
    }
    const wasSharing = !!stage.get(id, "screen");
    syncTiles(id);
    if (state.screen && !wasSharing && stage.get(id, "screen")) {
      const name = mesh.profiles.get(id)?.name || "Alguém";
      toast(`${name} está compartilhando a tela`, { tone: "info" });
    }
  });

  mesh.on("peer-removed", ({ id }) => {
    remoteMedia.delete(id);
    audio.detachPeer(id);
  });

  mesh.on("profile", ({ id, profile }) => {
    const tile = stage.get(id, "cam");
    tile?.setName(profile.name);
    tile?.setAvatarSpec(profile.avatar, profile.name);
  });

  /**
   * Quando uma conexão P2P não fecha, a causa quase sempre é a mesma: um dos
   * lados está atrás de um NAT que só um servidor TURN atravessa. Dizer isso
   * na hora poupa a pessoa de procurar culpa na própria internet — e distingue
   * este caso de uma queda passageira.
   */
  const slowPeers = new Map();

  function explainNoTurn(id, { failed = false } = {}) {
    const name = mesh.profiles.get(id)?.name || "Um participante";
    if (mesh.iceConfig?.hasTurn) {
      toast(
        failed
          ? `Não foi possível manter a conexão com ${name}. Peça para recarregar a página.`
          : `A conexão com ${name} está demorando.`,
        { tone: "warn", ms: 7000, key: `conn-${id}` },
      );
      return;
    }
    toast(
      `Não foi possível conectar com ${name}. A rede de um dos dois (empresa, 4G ou Wi-Fi público) ` +
        `não permite conexão direta — esse caso precisa de um servidor TURN, que não está configurado.`,
      { tone: "warn", ms: 12_000, key: "no-turn" },
    );
  }

  mesh.on("peer-connection", ({ id, state, relay }) => {
    const tile = stage.get(id, "cam");
    if (tile) tile.setConnection(state === "connected" ? null : state);

    clearTimeout(slowPeers.get(id));
    slowPeers.delete(id);

    if (state === "connected") return;

    if (state === "rebuilding") {
      const name = mesh.profiles.get(id)?.name || "um participante";
      toast(
        `Refazendo a conexão com ${name}${relay ? " pelo servidor de retransmissão" : ""}…`,
        { tone: "info", ms: 3500, key: `rebuild-${id}` },
      );
      return;
    }

    if (state === "exhausted") {
      explainNoTurn(id, { failed: true });
      return;
    }

    // Sem TURN, uma conexão que não fecha em 20 segundos raramente fecha
    // depois. Avisar antes de esgotar as tentativas evita a espera silenciosa.
    if (state === "new" || state === "connecting") {
      slowPeers.set(
        id,
        setTimeout(() => {
          if (mesh.peers.get(id)?.connectionState !== "connected") explainNoTurn(id);
        }, 20_000),
      );
    }
  });

  mesh.on("peer-removed", ({ id }) => {
    clearTimeout(slowPeers.get(id));
    slowPeers.delete(id);
  });

  mesh.on("chat", (m) => {
    const profile = mesh.profiles.get(m.id) || {};
    panel.addMessage({ id: m.id, name: m.name, avatar: profile.avatar, text: m.text, at: m.at });
    notify(m.name, m.text.slice(0, 160));
    if (!panel.open || panel.tab !== "chat") {
      toast(`${m.name}: ${m.text.slice(0, 80)}`, {
        tone: "info",
        key: "chat",
        action: { label: "Abrir", onClick: () => panel.setOpen(true, "chat") },
      });
    }
  });

  mesh.on("reaction", ({ id, kind }) => showReaction(id, kind));

  mesh.on("board", ({ from, op }) => {
    /*
     * O canal do quadro carrega JSON solto, e legendas e arquivos são JSON
     * solto também. Passá-los por aqui evita abrir um terceiro DataChannel
     * (mais uma negociação por par) e um par de mensagens novas no servidor
     * para algo que o caminho existente já entrega. Cada destinatário
     * reconhece o que é seu pelo `type` e devolve o resto.
     */
    if (transfer.apply(from, op)) return;
    if (op?.type === "caption") {
      const profile = mesh.profiles.get(from) || {};
      captions.show(from, {
        name: profile.name || "Alguém",
        text: String(op.text || "").slice(0, 300),
        final: !!op.final,
        color: colorFor(from),
      });
      return;
    }
    if (!board) return;
    board.apply(from, op);
    // Abrir o quadro por conta própria tiraria a pessoa do que ela estava
    // vendo. Melhor avisar e deixá-la decidir; as operações já ficam guardadas,
    // então ao abrir ela vê tudo o que foi desenhado até ali.
    //
    // O aviso aparece UMA vez por chamada. Antes ele renascia a cada traço
    // (cada pedaço de traço é uma operação), e quem não estava no canvas via
    // a mesma notificação pulando na tela sem parar enquanto alguém desenhava.
    if (!app.boardMode && shouldAnnounceBoard(op)) {
      const who = mesh.profiles.get(from)?.name || "Alguém";
      toast(`${who} está desenhando no canvas`, {
        tone: "info",
        key: "board-invite",
        ms: 6000,
        action: { label: "Ver", onClick: () => openBoard("board") },
      });
    }
  });

  mesh.on("cursor", ({ from, x, y, name, color }) => {
    board?.showLaser(from, { x, y, name, color });
  });

  mesh.on("speaking", ({ id, speaking }) => {
    stage.get(id === mesh.selfId ? "self" : id, "cam")?.setSpeaking(speaking);
  });

  // A barrinha de nível acompanha a voz quadro a quadro. É barato: os valores
  // já foram medidos pelo detector de fala, aqui só se pintam.
  let levelRaf = 0;
  const paintLevels = () => {
    levelRaf = requestAnimationFrame(paintLevels);
    for (const [id, level] of mesh.vad.levels) {
      stage.get(id === mesh.selfId ? "self" : id, "cam")?.setLevel(level);
      // A própria voz também acende o botão do microfone: dá para saber que
      // o microfone está pegando sem procurar o seu ladrilho na grade.
      if (id === mesh.selfId) dock?.get("mic")?.style.setProperty("--lv", Math.min(1, level * 3.2).toFixed(2));
    }
  };
  levelRaf = requestAnimationFrame(paintLevels);
  on(window, "pagehide", () => cancelAnimationFrame(levelRaf));

  mesh.on("active-speaker", (id) => stage.setActiveSpeaker(id));

  mesh.on("roster", (roster) => {
    if (panel.open && panel.tab === "people") renderPeopleNow(roster);
    updateHeader(roster);
  });

  mesh.on("stats", (samples) => {
    for (const [id, s] of samples) {
      stage.get(id, "cam")?.setQuality(s.quality);
      stage.get(id, "screen")?.setQuality(s.quality);
    }
    panel.renderStats(samples, mesh.roster(), { history: (id) => mesh.stats.historyFor(id) });
  });

  mesh.on("limited", throttle(({ reason }) => {
    toast(
      reason === "cpu"
        ? "O processador está no limite — reduzindo a taxa de quadros para manter a imagem legível."
        : "A rede apertou — ajustando a qualidade automaticamente.",
      { tone: "warn", key: "limited", ms: 4000 },
    );
  }, 20_000));

  // O socket parou de responder e foi derrubado de propósito para reconectar.
  signaling.on("stale", () => {
    toast("A conexão com a sala travou; reconectando…", { tone: "warn", ms: 3000, key: "stale" });
  });

  mesh.on("link", ({ status, reason }) => {
    const badge = $("#linkBadge");
    const text = $("#linkText");
    if (status === "reconnecting" || status === "offline") {
      badge.className = "badge badge--warn";
      text.textContent = "Reconectando à sala…";
    } else if (status === "error") {
      // Removido ou barrado pelo anfitrião: não há o que reconectar.
      if (reason === "kicked" || reason === "room-locked") {
        leaveCall({ motivo: reason });
        return;
      }
      badge.className = "badge badge--danger";
      text.textContent = reason === "room-full" ? "Sala cheia" : "Erro de conexão";
      if (reason === "room-full") {
        toast(`Esta sala já tem ${app.maxPeers} pessoas — o limite da conexão direta.`, {
          tone: "danger",
          ms: 9000,
        });
      }
    } else {
      badge.className = "badge badge--ok";
      text.textContent = "Criptografada ponta a ponta";
    }
  });

  mesh.on("ice", (cfg) => {
    if (!cfg.hasTurn) {
      console.info(
        "[vcall] sem servidor TURN configurado: participantes em redes corporativas ou atrás de NAT restritivo podem não conseguir conectar.",
      );
    }
  });

  media.on("error", ({ kind, err }) => toast(describeMediaError(err, kind), { tone: "warn" }));

  // O navegador bloqueia som antes de um gesto do usuário. Em vez de deixar a
  // pessoa achando que a sala está muda, mostramos um botão explícito.
  audio.on("blocked", (blocked) => {
    let gate = $(".audioGate");
    if (!blocked) {
      gate?.remove();
      return;
    }
    if (gate) return;
    gate = el("button.audioGate", { type: "button" }, [
      icon("volume-2", { size: "sm" }),
      el("span", { text: "Clique para ativar o som" }),
    ]);
    gate.addEventListener("click", async () => {
      const okNow = await audio.resume();
      if (okNow) gate.remove();
    });
    document.body.append(gate);
  });

  // Qualquer clique serve para liberar o áudio.
  on(document, "pointerdown", () => audio.resume(), { once: true });

  // Troca de alto-falante nas configurações.
  media.on("sink", (deviceId) => audio.setSink(deviceId));

  audio.on("fallback", () => {
    toast(
      "O som passou a sair pelo caminho simples deste navegador. O volume de cada pessoa agora vai só até 100%.",
      { tone: "info", ms: 6000, key: "audio-fallback" },
    );
  });

  audio.on("volume", ({ peerId, value }) => {
    stage.get(peerId, "cam")?.setVolume(value);
    stage.get(peerId, "screen")?.setVolume(value);
  });
}

/* ================================================================== *
 * Cabeçalho
 * ================================================================== */

function updateHeader(roster = null) {
  const list = roster || mesh.roster();
  const n = list.length;
  $("#peerCount").textContent = n === 1 ? "só você" : `${n} pessoas`;
  syncWaiting(n <= 1);
}

function startTimer() {
  app.startedAt = Date.now();
  clearInterval(app.timerId);
  app.timerId = setInterval(() => {
    $("#callTimer").textContent = formatDuration((Date.now() - app.startedAt) / 1000);
  }, 1000);
}

/* ================================================================== *
 * Convite
 * ================================================================== */

function roomLink() {
  return linkFor(app.room);
}

function openInvite() {
  const dlg = $("#inviteModal");
  $("#inviteLink").value = roomLink();
  $("#inviteCode").value = app.roomCode || "—";
  $("#inviteCapacity").textContent =
    `Até ${app.maxPeers} pessoas ao mesmo tempo. Como cada participante envia vídeo diretamente para todos os outros, salas maiores exigiriam um servidor de mídia no meio — e a conversa deixaria de ser criptografada ponta a ponta.`;
  syncTunnelUi();
  syncAppLink();
  dlg.showModal();
  requestAnimationFrame(() => $("#inviteLink").select());
}

/* ================================================================== *
 * Link público (só no aplicativo de mesa)
 * ================================================================== */

/**
 * O campo do link `vcall://`.
 *
 * Só aparece dentro do aplicativo: no navegador comum não há como saber se
 * quem vai receber tem o Vcall instalado, e oferecer um link que pode não
 * abrir nada é pior do que não oferecer.
 */
function syncAppLink() {
  const box = $("#appLinkBox");
  if (!box) return;
  $("#appLink").value = inviteLink() || "";
  const local = /^http:\/\/(127\.|localhost)/.test(inviteLink() || "");
  $("#appLinkHint").textContent = local
    ? "Este endereço só funciona neste computador. Gere o link público abaixo para mandar pelo WhatsApp."
    : host.url || !host.disponivel
      ? "Clicável no WhatsApp. Abre direto no Vcall de quem tem o aplicativo; quem não tem entra pelo navegador."
      : "Funciona para quem está na mesma rede que você. Para quem está fora dela, gere o link público abaixo.";
}

/**
 * O convite para mensageiros: a página /abrir (https, clicável no WhatsApp)
 * sobre o endereço público quando o túnel está de pé, ou sobre o atual.
 */
function inviteLink() {
  const base = (host.url && host.linkPublico(roomLink())) || roomLink();
  return linkAbrir(base);
}

function syncTunnelUi() {
  const box = $("#hostTunnel");
  if (!box) return;
  box.hidden = !host.disponivel;
  if (!host.disponivel) return;

  const campo = $("#tunnelLink");
  const btn = $("#tunnelBtn");
  const texto = $("#tunnelBtnText");
  const dica = $("#tunnelHint");
  const ocupado = host.estado === "abrindo" || host.estado === "baixando";

  btn.disabled = ocupado;
  campo.value = host.url ? host.linkPublico(roomLink()) || "" : "";

  if (host.estado === "pronto") {
    texto.textContent = "Copiar";
    dica.textContent =
      "Qualquer pessoa com este link entra na sala, de qualquer rede. Ele deixa de valer quando você fechar o Vcall.";
  } else if (ocupado) {
    texto.textContent = host.estado === "baixando" ? "Baixando…" : "Abrindo…";
    dica.textContent =
      host.estado === "baixando"
        ? "Baixando o cloudflared do site oficial do Cloudflare. Só acontece na primeira vez."
        : "Pedindo um endereço ao Cloudflare…";
  } else {
    texto.textContent = "Gerar link";
    dica.textContent =
      host.estado === "erro"
        ? "Não consegui abrir o túnel. Veja se há internet e tente de novo."
        : "O link acima só funciona nesta rede. Gere um link público para quem está fora dela.";
  }
}

if ($("#tunnelBtn")) {
  host.on("status", () => (syncTunnelUi(), syncAppLink()));
  host.on("disponivel", () => (syncTunnelUi(), syncAppLink()));

  /*
   * Pergunta ao servidor local se estamos dentro do aplicativo. Feito uma vez
   * na carga da página, antes de qualquer clique: assim o painel do túnel já
   * está certo quando a pessoa abre o "Convidar" pela primeira vez.
   */
  // Também mantém o batimento quando o token já veio na URL de abertura.
  if (host.disponivel) host.manterVivo();

  host.descobrir().then((sim) => {
    if (sim) {
      syncTunnelUi();
      syncAppLink();
      host.status().catch(() => {});
    }
  });


  on($("#tunnelBtn"), "click", async () => {
    // Com o túnel já de pé, o botão vira "copiar": é o que se quer fazer em
    // seguida, e evita um segundo botão só para isso.
    if (host.estado === "pronto") {
      const link = host.linkPublico(roomLink());
      if (link) copy(link, "Link público copiado");
      return;
    }
    try {
      await host.abrirTunel();
      const link = host.linkPublico(roomLink());
      if (link) copy(link, "Link público criado e copiado");
    } catch (err) {
      toast(`Não consegui abrir o túnel: ${err.message}`, { tone: "warn", ms: 8000 });
    }
  });

}

on($("#inviteBtn"), "click", openInvite);

on($("#copyAppLinkBtn"), "click", () => {
  const link = inviteLink();
  if (link) copy(link, "Convite copiado");
});
on($("#whatsappBtn"), "click", () => {
  const link = inviteLink();
  if (!link) return;
  if (/^http:\/\/(127\.|localhost)/.test(link)) {
    toast("Esse link só abre neste computador. Gere o link público antes de mandar pelo WhatsApp.", {
      tone: "warn",
      ms: 6000,
    });
    return;
  }
  window.open(linkWhatsApp(link, { nomeSala: app.roomName || "" }), "_blank", "noopener");
});

on($("#copyLinkBtn"), "click", () => copy(roomLink(), "Link copiado"));
on($("#copyCodeBtn"), "click", () => {
  if (!app.roomCode) return;
  copy(app.roomCode, `Código ${app.roomCode} copiado`);
});

/* ================================================================== *
 * Configurações
 * ================================================================== */

/** Nome ou avatar trocados no meio da chamada: vale aqui e para os outros. */
function applyProfile(profile) {
  app.profile = { ...app.profile, ...profile };
  mesh.updateProfile(app.profile);
  const tile = stage.get("self", "cam");
  tile?.setName(`${app.profile.name} (você)`);
  tile?.setAvatarSpec(app.profile.avatar, app.profile.name);
  stage.get("self", "screen")?.setAvatarSpec(app.profile.avatar, app.profile.name);
  if (panel?.open && panel.tab === "people") renderPeopleNow();
}

function openSettings() {
  const body = $("#settingsBody");
  body.replaceChildren();
  // A folha de atalhos usa o mesmo diálogo e troca o título; devolver aqui
  // evita "Atalhos do teclado" em cima das configurações.
  $("#settingsTitle").textContent = "Configurações";

  const section = (title, children) =>
    body.append(el("div.stack", {}, [el("h3", { text: title, style: { fontSize: "var(--text-md)" } }), ...children]));

  // -- identidade --
  // O avatar é um botão: abre a grade de avatares (estilos, sortear, foto) e
  // a troca vale na hora, para você e para todo mundo da sala.
  body.append(
    profileSection({
      profile: app.profile,
      onChange: (profile) => applyProfile(profile),
    }),
  );

  // -- dispositivos --
  const deviceRows = [];
  const mk = (kind, list, label) => {
    if (!list.length) return;
    const sel = el("select.input", { "aria-label": label });
    for (const d of list) {
      sel.append(
        el("option", {
          value: d.deviceId,
          text: d.label || label,
          selected: media.selected[kind] === d.deviceId,
        }),
      );
    }
    sel.addEventListener("change", () => media.selectDevice(kind, sel.value));
    deviceRows.push(el("label.field", {}, [el("span.field__label", { text: label }), sel]));
  };
  mk("audioinput", media.devices.audioinput, "Microfone");
  mk("videoinput", media.devices.videoinput, "Câmera");
  mk("audiooutput", media.devices.audiooutput, "Alto-falante");
  if (deviceRows.length) section("Dispositivos", deviceRows);

  // -- áudio --
  const procToggle = el("input", { type: "checkbox", checked: media.processing });
  procToggle.addEventListener("change", async () => {
    await media.setProcessing(procToggle.checked);
    toast(
      procToggle.checked
        ? "Supressão de ruído ligada"
        : "Processamento desligado — melhor para música e instrumentos",
      { tone: "ok", ms: 3000 },
    );
  });
  const master = el("input", {
    type: "range",
    min: "0",
    max: "150",
    step: "5",
    value: String(Math.round(audio.master * 100)),
    style: { flex: "1" },
    "aria-label": "Volume geral",
  });
  const masterLabel = el("span.mono", { text: `${Math.round(audio.master * 100)}%` });
  master.addEventListener("input", () => {
    const v = audio.setMaster(Number(master.value) / 100);
    masterLabel.textContent = `${Math.round(v * 100)}%`;
  });

  const vad = el("input", {
    type: "range",
    min: "1",
    max: "20",
    step: "1",
    value: String(Math.round(mesh.vad.threshold * 100)),
    style: { flex: "1" },
    "aria-label": "Sensibilidade do detector de fala",
  });
  const vadLabel = el("span.mono", { text: `${Math.round(mesh.vad.threshold * 100)}` });
  vad.addEventListener("input", () => {
    const v = mesh.vad.setThreshold(Number(vad.value) / 100);
    vadLabel.textContent = String(Math.round(v * 100));
    prefs.set("vad:threshold", v);
  });

  section("Áudio", [
    el("label.field", {}, [
      el("span.field__label", { text: "Volume geral" }),
      el("div.row", {}, [icon("volume-2", { size: "sm" }), master, masterLabel]),
      el("div.field__hint", {
        text: "O volume de cada pessoa é ajustado no próprio quadradinho dela, passando o mouse por cima.",
      }),
    ]),
    el("label.field", {}, [
      el("span.field__label", { text: "Sensibilidade do indicador de fala" }),
      el("div.row", {}, [icon("mic", { size: "sm" }), vad, vadLabel]),
      el("div.field__hint", {
        text: "Mais baixo detecta sussurro e também o ventilador. Mais alto só acende quando você fala de verdade. O indicador aparece no seu próprio quadradinho e no dos outros.",
      }),
    ]),
    el("label.row", {}, [
      procToggle,
      el("div", {}, [
        el("div", { text: "Cancelamento de eco e supressão de ruído" }),
        el("div.field__hint", {
          text: "Feito para voz. Desligue se alguém for tocar um instrumento ou compartilhar som.",
        }),
      ]),
    ]),
  ]);

  // -- legendas, transcrição e avisos --
  const notifyToggle = el("input", { type: "checkbox", checked: app.notify });
  notifyToggle.addEventListener("change", async () => {
    notifyToggle.checked = await setNotifications(notifyToggle.checked);
  });

  const capRows = [
    el("label.row", {}, [
      notifyToggle,
      el("div", {}, [
        el("div", { text: "Avisar quando a aba estiver em segundo plano" }),
        el("div.field__hint", {
          text: "Mensagens novas, arquivos e quem entra na sala. Nada aparece enquanto a aba estiver à vista.",
        }),
      ]),
    ]),
  ];

  if (captionsSupported) {
    const langs = [
      ["pt-BR", "Português (Brasil)"],
      ["pt-PT", "Português (Portugal)"],
      ["en-US", "Inglês"],
      ["es-ES", "Espanhol"],
      ["fr-FR", "Francês"],
      ["de-DE", "Alemão"],
      ["it-IT", "Italiano"],
      ["ja-JP", "Japonês"],
    ];
    const sel = el("select.input", { "aria-label": "Idioma das legendas" });
    for (const [code, label] of langs) {
      sel.append(el("option", { value: code, text: label, selected: captions.lang === code }));
    }
    sel.addEventListener("change", () => {
      captions.lang = sel.value;
      prefs.set("captions:lang", sel.value);
      // O idioma entra no reconhecedor na criação: religar é o que o aplica.
      if (captions.enabled) {
        captions.stop();
        captions.start();
      }
    });
    capRows.push(
      el("label.field", {}, [
        el("span.field__label", { text: "Idioma das legendas" }),
        sel,
        el("div.field__hint", {
          text: "O reconhecimento é do navegador e acontece só no seu microfone. Os outros recebem texto, não áudio.",
        }),
      ]),
    );
  } else {
    capRows.push(
      el("div.field__hint", {
        text: "Este navegador não transcreve fala — no Chrome ou no Edge funciona. Ler as legendas de quem ligar o recurso funciona em qualquer navegador.",
      }),
    );
  }

  const saveTranscript = el("button.btn", {
    type: "button",
    text: "Baixar a transcrição",
    onClick: () => {
      const text = captions.asText();
      if (!text) {
        toast("Nada foi legendado nesta chamada ainda.", { tone: "info" });
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `vcall-transcricao-${Date.now()}.txt` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  });
  capRows.push(
    el("div.row", {}, [
      saveTranscript,
      el("span.muted", { text: `${captions.transcript.length} falas registradas` }),
    ]),
  );

  capRows.push(
    el("button.btn", {
      type: "button",
      text: "Revisar permissões de câmera, microfone e avisos",
      onClick: () => revisarPermissoes(),
    }),
  );

  section("Legendas e avisos", capRows);

  // -- tema --
  const themeRow = el("div.row");
  for (const [mode, label, iconName] of [
    ["system", "Sistema", "laptop"],
    ["light", "Claro", "sun"],
    ["dark", "Escuro", "moon"],
  ]) {
    const b = el("button.btn", {
      type: "button",
      class: theme.mode === mode ? "btn--primary" : "",
      onClick: () => {
        theme.set(mode);
        openSettings();
      },
    });
    b.append(icon(iconName, { size: "sm" }), el("span", { text: label }));
    themeRow.append(b);
  }
  section("Aparência", [themeRow]);

  // -- diagnóstico de áudio: responde "por que não ouço ninguém?" --
  const audioReport = el("div.field__hint", { text: "Medindo…" });
  const refreshAudio = async () => {
    const dbg = audio.debug();
    const peers = mesh.roster().filter((p) => !p.self);
    if (!peers.length) {
      audioReport.textContent = "Ninguém mais na sala para medir.";
      return;
    }
    const linhas = [];
    for (const p of peers) {
      let pico = 0;
      for (let i = 0; i < 10; i += 1) {
        const l = audio.meter(p.id, "mic");
        if (l != null) pico = Math.max(pico, l);
        await new Promise((r) => setTimeout(r, 40));
      }
      const saida = dbg.outputs.find((o) => o.key === `${p.id}:mic`);
      linhas.push(
        `${p.name}: ${saida ? (saida.paused ? "pausado" : "tocando") : "SEM SAÍDA"}` +
          `, volume ${Math.round((saida?.gain ?? 0) * 100)}%` +
          `, sinal ${pico > 0.005 ? "sim" : "NÃO"}`,
      );
    }
    audioReport.textContent =
      `Contexto: ${dbg.contextState}${dbg.blocked ? " (BLOQUEADO)" : ""} · ` +
      `saída: ${dbg.webAudio ? "Web Audio" : "elemento"} · geral ${Math.round(dbg.master * 100)}%\n` +
      linhas.join("\n");
  };
  audioReport.style.whiteSpace = "pre-line";
  audioReport.style.fontFamily = "var(--font-mono)";
  refreshAudio();

  section("Diagnóstico do áudio", [
    audioReport,
    el("button.btn", { type: "button", text: "Medir de novo", onClick: refreshAudio }),
    el("div.field__hint", {
      text: 'Se aparecer "SEM SAÍDA" ou "BLOQUEADO", me mande este texto: ele diz exatamente onde o som está parando.',
    }),
  ]);

  // -- sobre --
  const about = el("div.field__hint", { text: "Consultando o servidor…" });
  fetch("/healthz", { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => {
      about.textContent = `Versão ${v.version} · compilação ${v.build} · ${v.files} arquivos` +
        (v.builtAt ? ` · ${new Date(v.builtAt).toLocaleString("pt-BR")}` : "");
    })
    .catch(() => {
      about.textContent = "Não foi possível consultar a versão.";
    });
  section("Sobre esta versão", [
    about,
    el("div.field__hint", {
      text: "Compare com o que o terminal mostra ao rodar npm start. Se forem diferentes, há duas cópias do sistema na máquina.",
    }),
    el("div.field__hint", { style: { opacity: "0.6" } }, [
      "Desenvolvido por Victor Kauan · ",
      el("a", {
        href: "https://github.com/victor-kauan-coder",
        target: "_blank",
        rel: "noopener noreferrer",
        text: "victor-kauan-coder",
      }),
    ]),
  ]);

  // -- conexão --
  const cfg = mesh.iceConfig || {};
  section("Conexão", [
    el("div.field__hint", {
      text: cfg.hasTurn
        ? "Servidor TURN configurado: a chamada consegue atravessar redes corporativas e NAT restritivo."
        : "Sem servidor TURN. Em redes corporativas ou em algumas operadoras móveis a chamada pode não conectar. Configure TURN_URLS no servidor.",
    }),
    el("div.field__hint", {
      text: `Limite da sala: ${app.maxPeers} participantes. Numa malha ponto a ponto cada pessoa codifica o vídeo uma vez para cada outra — é isso que limita o tamanho.`,
    }),
  ]);

  $("#settingsModal").showModal();
}

/* ================================================================== *
 * Atalhos
 * ================================================================== */

function bindShortcuts() {
  on(document, "keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.target instanceof HTMLSelectElement || e.target?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Com um diálogo aberto (Configurações, perfil, convite), as teclas são
    // dele. Antes o Escape era capturado aqui e o diálogo não fechava, e uma
    // letra como "P" mexia no painel por trás dele.
    if (document.querySelector("dialog[open]")) return;

    /*
     * Com o canvas aberto, as letras pertencem a ele. Antes as duas camadas
     * ouviam a mesma tecla: "L" escolhia o ponteiro laser e ao mesmo tempo
     * trocava o layout do palco, e "N", "F" ou "G" disparavam o que não devia.
     * Escape continua chegando aqui, porque é como se fecha o canvas.
     */
    // "?" passa também: é com o canvas aberto que a lista de atalhos é mais
    // procurada, e a maioria deles é dele.
    if (app.boardMode && e.key !== "Escape" && e.key !== "?") return;

    switch (e.key.toLowerCase()) {
      case "m":
        media.toggleMic();
        syncDockMedia();
        break;
      case "v":
        media.toggleCam().then(syncDockMedia);
        break;
      case "s":
        if (env.canShareScreen) toggleScreen();
        break;
      case "q":
        app.boardMode ? closeBoard() : openBoard(screen.active ? "annotate" : "board");
        break;
      case "d":
        toggleDeafen();
        break;
      case "h":
        toggleHand();
        break;
      case "t":
        toggleCaptions();
        break;
      case "?":
      case "/":
        openShortcuts();
        break;
      case "c":
        panel.toggle("chat");
        break;
      case "p":
        panel.toggle("people");
        break;
      case "l":
        dock.get("layout")?.click();
        break;
      case "j":
        dock.get("mini")?.click();
        break;
      case "escape":
        // Com algo selecionado, Escape desfaz a seleção — fechar o canvas
        // inteiro por causa de um clique errado seria um exagero. O próprio
        // canvas cuida de limpá-la; aqui só não se atropela isso.
        if (app.boardMode && board?.selection.size) return;
        if (app.boardMode) closeBoard();
        else if (panel.open) panel.setOpen(false);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Barra de espaço: fala enquanto segura (como um rádio).
  let pushed = false;
  on(document, "keydown", (e) => {
    if (e.code !== "Space" || e.repeat || pushed) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // No canvas, segurar espaço é arrastar o plano. Abrir o microfone junto
    // punha a pessoa no ar sem que ela soubesse, só por ter navegado.
    if (app.boardMode) return;
    if (media.micEnabled) return;
    pushed = true;
    media.setMic(true);
    syncDockMedia();
    toast("Falando enquanto a barra de espaço estiver pressionada", { tone: "info", ms: 1500, key: "ptt" });
    e.preventDefault();
  });
  on(document, "keyup", (e) => {
    if (e.code !== "Space" || !pushed) return;
    pushed = false;
    media.setMic(false);
    syncDockMedia();
  });
}

/* ================================================================== *
 * Saída
 * ================================================================== */

function leaveCall({ motivo = null, por = "" } = {}) {
  if (app.left) return;
  app.left = true;
  clearInterval(app.timerId);
  app.mini?.close();
  closeBoard();
  captions.stop();
  captions.unmount();
  if (recorder.recording) recorder.stop();
  screen.stop("leave");
  audio.stop();
  mesh.leave();
  closeAudio();
  media.stop();
  stage.clearAll();

  // A faixa de arrastar do app de mesa sobrevive à troca de tela.
  const drag = $(".win-drag");
  const minutos = formatDuration((Date.now() - app.startedAt) / 1000);
  const inicio = () => location.assign(location.origin + location.pathname);
  const tela = el("main.leave", { "aria-labelledby": "leaveTitle" }, [
    el("div.leave__art", { "aria-hidden": "true" }, [
      el("img", { src: "/assets/illustrations/calling.svg", alt: "", width: 320, height: 275 }),
    ]),
    el("div.leave__body", {}, [
      el("img.brand__mark", { src: "/assets/logo-mark.png", alt: "", width: 48, height: 48 }),
      el("h1.leave__title", {
        id: "leaveTitle",
        text:
          motivo === "kicked"
            ? "Você foi removido da sala"
            : motivo === "room-locked"
              ? "Esta sala está trancada"
              : "Você saiu da chamada",
      }),
      el("p.leave__lead", {
        text:
          motivo === "kicked"
            ? `${por || "O anfitrião"} removeu você desta chamada. Se foi um engano, peça um novo convite.`
            : motivo === "room-locked"
              ? "O anfitrião trancou a sala e ninguém novo pode entrar agora. Peça para destrancarem e tente de novo."
              : `Foram ${minutos} de conversa. A sala continua aberta enquanto alguém estiver nela — dá para voltar pelo mesmo link.`,
      }),
      el("div.leave__actions", {}, [
        motivo === "kicked"
          ? null
          : el("button.btn.btn--primary.btn--lg", { type: "button", onClick: () => location.reload() }, [
              icon("rotate-ccw"),
              el("span", { text: motivo === "room-locked" ? "Tentar de novo" : "Voltar para a sala" }),
            ]),
        el("button.btn.btn--lg", { type: "button", onClick: inicio }, [
          icon("layout-grid"),
          el("span", { text: "Ir para o início" }),
        ]),
        el("button.btn.btn--ghost.btn--lg", {
          type: "button",
          onClick: () => {
            location.hash = newRoomId();
            location.reload();
          },
        }, [icon("plus"), el("span", { text: "Nova sala" })]),
      ]),
    ]),
  ]);
  swap(() =>
    document.body.replaceChildren(...[drag, el("div.ambient", { "aria-hidden": "true" }), tela].filter(Boolean)),
  ).then(() =>
    stagger(tela.querySelectorAll(".leave__art, .leave__body > *"), { gap: 60 }),
  );
}

// Sair fechando a aba: avisa os outros em vez de deixar um retângulo fantasma.
on(window, "pagehide", () => {
  if (app.joined) signaling.close();
});

/* ================================================================== *
 * Diagnóstico no console
 * ================================================================== */

window.vcall = {
  mesh,
  media,
  screen,
  audio,
  captions,
  recorder,
  transfer,
  get board() {
    return board;
  },
  get stage() {
    return stage;
  },
  get stats() {
    return mesh.stats.samples;
  },
};
console.info(
  "%cVcall%c — mídia ponto a ponto, criptografada. `window.vcall` expõe o estado para depuração." +
    "\nDesenvolvido por Victor Kauan · github.com/victor-kauan-coder",
  "font-weight:700;color:#fd4d87",
  "color:inherit",
);
