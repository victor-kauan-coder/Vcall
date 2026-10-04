/**
 * ui/minicall.js — a mini-janela flutuante da chamada.
 *
 * Uma janela pequena, sempre por cima dos outros programas, com os vídeos de
 * quem está falando e os controles essenciais. É a Document Picture-in-Picture
 * API: a janela é um documento de verdade, então cabe interface completa, e
 * não só um vídeo como no Picture-in-Picture comum.
 *
 * Funciona igual no aplicativo de mesa (o Electron traz a API) e no Chrome
 * e no Edge. Os vídeos NÃO são movidos da tela principal: cada um ganha um
 * segundo <video> ligado ao mesmo stream, que custa só a decodificação já
 * feita. Esses vídeos são mudos — o som continua saindo por ui/audio.js; dois
 * caminhos tocando a mesma voz dariam eco.
 */
import { animate, SPRING } from "./motion.js";
import { uniquifyIds } from "./avatars.js";

const MAX_TILES = 4;
const TICK_MS = 400;

export class MiniCall {
  /** @type {Window|null} */ win = null;
  #timer = 0;
  #tiles = new Map();

  /**
   * @param {object} deps
   * @param {import("./stage.js").Stage} deps.stage
   * @param {() => {mic:boolean, cam:boolean}} deps.state
   * @param {(id:string) => void} deps.press  aperta um botão da barra principal
   * @param {() => string} deps.title
   */
  constructor({ stage, state, press, title }) {
    Object.assign(this, { stage, state, press, title });
  }

  /**
   * No app de mesa a mini-janela é a própria janela do Vcall em modo compacto:
   * o Electron anuncia a Document PiP API, mas a janela dela nasce e morre no
   * mesmo instante. No navegador, é a Document PiP de verdade.
   */
  static get native() {
    return typeof window.vcallDesktop?.mini === "function";
  }

  static get supported() {
    return MiniCall.native || "documentPictureInPicture" in window;
  }

  get open() {
    if (MiniCall.native) return !!this.root?.isConnected;
    return !!this.win && !this.win.closed;
  }

  async toggle() {
    if (this.open) return this.close();
    return this.show();
  }

  close() {
    if (!MiniCall.native) return this.win?.close();
    if (!this.open) return;
    this.root.remove();
    document.documentElement.classList.remove("is-mini");
    window.vcallDesktop.mini(false);
    this.#cleanup();
  }

  async show() {
    if (!MiniCall.supported || this.open) return false;
    let doc = document;
    if (MiniCall.native) {
      this.#css(document);
      document.documentElement.classList.add("is-mini");
      await window.vcallDesktop.mini(true);
    } else {
      const win = await window.documentPictureInPicture.requestWindow({ width: 380, height: 260 });
      this.win = win;
      doc = win.document;
      doc.documentElement.classList.add("pip-doc");
      for (const href of ["/css/tokens.css", "/css/base.css"]) this.#css(doc, href);
      this.#css(doc);
      const theme = document.documentElement.dataset.theme;
      if (theme) doc.documentElement.dataset.theme = theme;
      doc.title = this.title();
      win.addEventListener("pagehide", () => this.#cleanup(), { once: true });
    }
    this.#build(doc);
    return true;
  }

  /** Folha de estilo por endereço absoluto: a janela PiP é about:blank. */
  #css(doc, href = "/css/pip.css") {
    const url = new URL(href, location.href).href;
    if ([...doc.styleSheets].some((s) => s.href === url)) return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    doc.head.append(link);
  }

  #build(doc) {
    const grid = doc.createElement("div");
    grid.className = "pip__grid";
    const bar = doc.createElement("div");
    bar.className = "pip__bar";
    const root = doc.createElement("div");
    root.className = "pip";
    root.append(grid, bar);
    doc.body.append(root);
    this.root = root;

    this.buttons = {
      mic: this.#button(doc, bar, "mic", "Microfone"),
      cam: this.#button(doc, bar, "video", "Câmera"),
      back: this.#button(doc, bar, "maximize-2", "Voltar para a chamada", () => {
        this.close();
        window.focus();
      }),
      leave: this.#button(doc, bar, "phone-off", "Sair da chamada", () => {
        this.close();
        this.press("leave");
      }),
    };
    this.buttons.leave.classList.add("pip__btn--hangup");
    this.grid = grid;

    this.#render();
    this.#timer = setInterval(() => this.#render(), TICK_MS);
    animate(root, [{ opacity: 0, scale: "0.94" }, { opacity: 1, scale: "1" }], SPRING.bouncy);
  }

  #button(doc, bar, iconName, label, onClick) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "pip__btn";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${location.origin}/vendor/icons.svg#i-${iconName}"/></svg>`;
    b.addEventListener("click", onClick || (() => this.press(iconName === "video" ? "cam" : iconName)));
    bar.append(b);
    return b;
  }

  /** Quem aparece: o destaque, quem fala e, depois, os demais — até quatro. */
  #pick() {
    const all = [...this.stage.tiles.values()];
    const featured = this.stage.featured?.();
    const score = (t) =>
      (t === featured ? 8 : 0) +
      (t.node.classList.contains("is-speaking") ? 4 : 0) +
      (t.kind === "screen" ? 2 : 0) +
      (t.self ? -1 : 0);
    return all.sort((a, b) => score(b) - score(a)).slice(0, MAX_TILES);
  }

  #render() {
    if (!this.open) return this.#cleanup();
    const doc = this.root.ownerDocument;
    const picked = this.#pick();
    const keep = new Set(picked.map((t) => t.id));

    for (const [id, cell] of this.#tiles) {
      if (!keep.has(id)) {
        cell.root.remove();
        this.#tiles.delete(id);
      }
    }

    for (const tile of picked) {
      let cell = this.#tiles.get(tile.id);
      if (!cell) {
        const root = doc.createElement("figure");
        root.className = "pip__tile";
        const video = doc.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        if (tile.self && tile.kind === "cam") video.classList.add("is-mirrored");
        const avatar = doc.createElement("div");
        avatar.className = "pip__avatar";
        const name = doc.createElement("figcaption");
        root.append(video, avatar, name);
        // `undefined`, e não `null`: um quadro novo de quem está sem câmera
        // tem stream `null`, e começar em `null` fazia a comparação abaixo
        // concluir "nada mudou" — o avatar nunca era desenhado.
        cell = { root, video, avatar, name, stream: undefined, avatarHtml: "" };
        this.#tiles.set(tile.id, cell);
        animate(root, [{ opacity: 0, scale: "0.9" }, { opacity: 1, scale: "1" }], SPRING.bouncy);
      }
      // Reinsere só se a ordem mudou: mover um <video> tocando pelo DOM pode
      // pausá-lo, e isto roda a cada 400 ms.
      if (this.grid.children[picked.indexOf(tile)] !== cell.root) {
        this.grid.insertBefore(cell.root, this.grid.children[picked.indexOf(tile)] || null);
      }

      // Câmera ligada ou tela compartilhada: o vídeo. Senão: o avatar.
      const stream = tile.video.hidden ? null : tile.video.srcObject || null;
      if (cell.stream !== stream) {
        cell.stream = stream;
        cell.video.srcObject = stream;
        cell.video.hidden = !stream;
        if (stream) cell.video.play?.().catch(() => {});
      }
      if (!stream) {
        // O avatar é copiado de novo se a pessoa trocar de foto no meio da
        // chamada; a comparação pelo HTML é barata para quatro quadros.
        const src = tile.avatarBox.firstElementChild;
        const html = src?.outerHTML || "";
        if (html !== cell.avatarHtml) {
          cell.avatarHtml = html;
          /*
           * Cópia com ids próprios. No app de mesa a mini-janela é o MESMO
           * documento da chamada, e o degradê do avatar é achado pelo id: com
           * a cópia exata, `url(#…)` apontava para o original, que fica oculto
           * no modo compacto — e o avatar saía desbotado, quase branco.
           */
          const copia = src ? src.cloneNode(false) : null;
          if (copia) copia.innerHTML = uniquifyIds(src.innerHTML);
          cell.avatar.replaceChildren(...(copia ? [copia] : []));
        }
      }
      cell.avatar.hidden = !!stream;
      cell.video.hidden = !stream;
      cell.name.textContent = tile.nameEl.textContent;
      cell.root.classList.toggle("is-speaking", tile.node.classList.contains("is-speaking"));
    }
    this.grid.dataset.count = String(picked.length);

    const { mic, cam } = this.state();
    this.buttons.mic.setAttribute("aria-pressed", String(mic));
    this.buttons.mic.querySelector("use").setAttribute("href", `${location.origin}/vendor/icons.svg#i-${mic ? "mic" : "mic-off"}`);
    this.buttons.cam.setAttribute("aria-pressed", String(cam));
    this.buttons.cam.querySelector("use").setAttribute("href", `${location.origin}/vendor/icons.svg#i-${cam ? "video" : "video-off"}`);
  }

  #cleanup() {
    clearInterval(this.#timer);
    this.#timer = 0;
    for (const cell of this.#tiles.values()) cell.video.srcObject = null;
    this.#tiles.clear();
    this.win = null;
    this.onClose?.();
  }
}
