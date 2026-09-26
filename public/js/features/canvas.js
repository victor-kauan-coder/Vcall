/**
 * features/canvas.js — canvas colaborativo infinito.
 *
 * Substitui o quadro branco de tela fixa. As decisões que sustentam o resto
 * do arquivo:
 *
 * 1. COORDENADAS DE MUNDO, NÃO DE TELA. Cada objeto guarda posição num plano
 *    sem bordas, em unidades próprias. A tela é só uma janela sobre esse
 *    plano: `viewport = {x, y, scale}`. Foi a troca necessária para ter zoom
 *    e navegação — no modelo anterior, com coordenadas normalizadas de 0 a 1,
 *    "infinito" não tem como ser expresso.
 *
 * 2. CENA ORIENTADA A OBJETOS. Uma lista de objetos vetoriais (traço, forma,
 *    texto, imagem), cada um com id, autor e revisão. Isso é o que permite
 *    selecionar, mover, redimensionar, girar e apagar depois de desenhado —
 *    e é o modelo que bibliotecas como Fabric.js e Konva.js implementam.
 *    Aqui ele é próprio por uma razão concreta: a política de segurança do
 *    app proíbe script de terceiros, e o motor precisa conhecer o formato dos
 *    deltas que trafegam pelo DataChannel de qualquer maneira.
 *
 * 3. SÓ O DELTA VAI PELA REDE. Criar um objeto manda o objeto; arrastá-lo
 *    manda `{id, patch}`; um traço em andamento vai em pedaços enquanto é
 *    desenhado. A cena inteira só trafega uma vez, para quem chega depois.
 *
 * 4. IMAGENS POR UM CANAL À PARTE. Uma foto colada tem centenas de kilobytes.
 *    Mandá-la pelo mesmo canal dos deltas faz o desenho dos outros congelar
 *    até ela terminar; por isso ela é fatiada e vai pelo canal de carga
 *    pesada, fora do caminho do resto.
 *
 * 5. ORDEM DETERMINÍSTICA. Cada objeto carrega um `seq` (relógio lógico) e o
 *    id do autor. Todo mundo ordena por `(seq, autor)`, então a pilha de
 *    desenho é a mesma em todas as máquinas mesmo quando duas pessoas criam
 *    algo no mesmo instante. Alterações no mesmo objeto resolvem por `rev`
 *    mais alto — quem alterou por último ganha.
 */
import { Emitter } from "../lib/emitter.js";
import { el, icon, clear, on, disposer } from "../lib/dom.js";
import { prefs, throttle } from "../lib/util.js";
import { colorFor } from "../ui/avatars.js";

export const TOOLS = [
  { id: "select", icon: "pointer", label: "Selecionar e mover", key: "1" },
  { id: "hand", icon: "hand", label: "Navegar pelo canvas", key: "2" },
  { id: "pen", icon: "pencil", label: "Caneta", key: "3" },
  { id: "marker", icon: "highlighter", label: "Marca-texto", key: "4" },
  { id: "line", icon: "line", label: "Linha", key: "5" },
  { id: "arrow", icon: "arrow", label: "Seta", key: "6" },
  { id: "rect", icon: "square", label: "Retângulo", key: "7" },
  { id: "ellipse", icon: "circle", label: "Círculo", key: "8" },
  { id: "text", icon: "type", label: "Texto", key: "9" },
  { id: "note", icon: "message-square", label: "Nota adesiva", key: "n" },
  { id: "eraser", icon: "eraser", label: "Borracha", key: "0" },
  { id: "laser", icon: "pointer", label: "Ponteiro laser", key: "l" },
];

/** Tipos que guardam x/y/w/h em vez de uma lista de pontos. */
const BOXED = new Set(["image", "note"]);

const PALETTE = [
  "#fd4d87",
  "#fe9c5f",
  "#ffd166",
  "#37d399",
  "#6ec6ff",
  "#b98bff",
  "var(--board-ink)",
];

const SIZES = [
  { id: "s", width: 2, dot: 4 },
  { id: "m", width: 4, dot: 7 },
  { id: "l", width: 8, dot: 11 },
];

/** Passo da malha de encaixe, em unidades de mundo. É o passo base da grade. */
const SNAP = 20;
/** Lado padrão de uma nota adesiva criada com um clique simples. */
const NOTE_SIDE = 180;
/** Profundidade máxima da pilha de desfazer. */
const HISTORY_MAX = 60;
/** Quantas cores personalizadas ficam à mão na barra. */
const RECENT_MAX = 5;
/** Sem novos pedaços por este tempo, um traço em andamento é dado por encerrado. */
const LIVE_TTL_MS = 6000;
/** Uma imagem que parou de chegar é descartada depois disso. */
const INCOMPLETA_TTL_MS = 120_000;

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

/** Lado maior de uma imagem depois do redimensionamento, em pixels. */
const IMAGE_MAX_SIDE = 1600;
/** Pedaço de imagem no DataChannel. Abaixo do teto de 256 kB com folga. */
const CHUNK = 48 * 1024;

const HANDLE = 9; // lado do punho de redimensionamento, em pixels de tela
const ROTATE_OFFSET = 26;

let counter = 0;
const newId = (selfId) => `${selfId}-${Date.now().toString(36)}-${(counter += 1)}`;

export class InfiniteCanvas extends Emitter {
  /** Objetos da cena, por id. */ objects = new Map();
  /** Traços em andamento de outras pessoas. */ #live = new Map();
  /** Ponteiros laser. */ #lasers = new Map();
  /** Imagens já decodificadas, por id de objeto. */ #bitmaps = new Map();
  /** Pedaços de imagem chegando. */ #incoming = new Map();

  tool = "pen";
  color = PALETTE[0];
  size = SIZES[1];
  mode = "board"; // "board" | "annotate"
  /** Formas fechadas saem preenchidas com a própria cor, translúcida. */
  fill = false;
  /** Encaixe na malha ao criar e ao mover. */
  snap = false;
  /** Cores fora da paleta usadas recentemente, da mais nova para a mais velha. */
  recentColors = prefs.get("board:recent", []) || [];

  /** A janela sobre o plano. x,y são a coordenada de mundo no canto superior esquerdo. */
  view = { x: 0, y: 0, scale: 1 };

  /**
   * Seleção múltipla. Um conjunto, não um id: mover, apagar, duplicar e
   * recolorir valem para tudo o que estiver dentro dele. Os punhos de
   * redimensionar e girar só aparecem quando há exatamente um objeto — girar
   * um grupo exige um referencial comum que nada aqui usaria.
   */
  selection = new Set();
  #clock = 0;

  /**
   * Desfazer/refazer local. Cada entrada descreve o que mudou e sabe como
   * voltar atrás; a operação inversa também vai para a rede, senão o canvas
   * do outro lado fica diferente do seu.
   */
  #undo = [];
  #redo = [];
  /** Objetos copiados, já clonados: colar depois de apagar o original funciona. */
  #clipboard = [];

  #root = null;
  #canvas = null;
  #ctx = null;
  #dpr = 1;
  #drawing = null;
  #panning = null;
  #transform = null;
  #spaceHeld = false;
  #dispose = disposer();
  #textInput = null;
  /** Fecha a caixa de texto aberta gravando o que foi digitado. */
  #commitText = null;
  #marquee = null;
  #raf = 0;
  #zoomLabel = null;

  constructor({ selfId, selfName, getRoster }) {
    super();
    this.selfId = selfId;
    this.selfName = selfName;
    this.getRoster = getRoster || (() => []);
    this.color = colorFor(selfId);
  }

  /* ================================================================ *
   * Montagem
   * ================================================================ */

  mount(container, { mode = "board" } = {}) {
    this.unmount();
    this.mode = mode;

    this.#root = el("div.board", { class: mode === "annotate" ? "board--overlay" : "" });
    this.#canvas = el("canvas.board__surface", { dataset: { tool: this.tool } });
    this.#ctx = this.#canvas.getContext("2d");
    this.#root.append(
      this.#canvas,
      this.#buildToolbar(),
      this.#buildNavBar(),
      this.#buildPresence(),
    );
    container.append(this.#root);

    const ro = new ResizeObserver(() => this.#resize());
    ro.observe(this.#root);
    this.#dispose(() => ro.disconnect());

    this.#bindPointer();
    this.#bindWheel();
    this.#bindFiles();
    this.#dispose(on(window, "keydown", (e) => this.#onKeyDown(e)));
    this.#dispose(on(window, "keyup", (e) => this.#onKeyUp(e)));
    this.#dispose(on(window, "paste", (e) => this.#onPaste(e)));

    this.#resize();
    this.emit("mount", { mode });
    return this.#root;
  }

  unmount() {
    this.#dispose.dispose();
    this.#dispose = disposer();
    cancelAnimationFrame(this.#raf);
    this.#textInput?.remove();
    this.#textInput = null;
    this.#commitText = null;
    for (const l of this.#lasers.values()) clearTimeout(l.timer);
    this.#lasers.clear();
    this.#root?.remove();
    this.#root = null;
    this.#canvas = null;
    this.#ctx = null;
    this.selection.clear();
    this.#marquee = null;
  }

  get mounted() {
    return !!this.#root;
  }

  /* ================================================================ *
   * Conversão tela <-> mundo
   * ================================================================ */

  toWorld(sx, sy) {
    return { x: this.view.x + sx / this.view.scale, y: this.view.y + sy / this.view.scale };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.view.x) * this.view.scale, y: (wy - this.view.y) * this.view.scale };
  }

  #pointer(e) {
    const r = this.#canvas.getBoundingClientRect();
    return this.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  /** Posição de tela do ponteiro, para a faixa de seleção e os punhos. */
  #screenPointer(e) {
    const r = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Arredonda para a malha quando o encaixe está ligado. */
  #snap(p) {
    if (!this.snap) return p;
    return { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP };
  }

  /* ================================================================ *
   * Navegação
   * ================================================================ */

  /** Zoom mantendo fixo o ponto de tela indicado (padrão: centro). */
  zoomTo(scale, anchor = null) {
    const c = this.#canvas;
    const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
    const ax = anchor?.x ?? r.width / 2;
    const ay = anchor?.y ?? r.height / 2;
    const before = this.toWorld(ax, ay);
    this.view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const after = this.toWorld(ax, ay);
    this.view.x += before.x - after.x;
    this.view.y += before.y - after.y;
    this.#onViewChange();
  }

  zoomBy(factor, anchor = null) {
    this.zoomTo(this.view.scale * factor, anchor);
  }

  panBy(dxScreen, dyScreen) {
    this.view.x -= dxScreen / this.view.scale;
    this.view.y -= dyScreen / this.view.scale;
    this.#onViewChange();
  }

  /** Enquadra tudo o que existe na cena. Atalho: a tecla "F". */
  fitAll() {
    const box = this.#sceneBounds();
    const r = this.#canvas?.getBoundingClientRect();
    if (!box || !r?.width) return;
    const pad = 60;
    const scale = Math.min(
      (r.width - pad * 2) / Math.max(box.w, 1),
      (r.height - pad * 2) / Math.max(box.h, 1),
    );
    this.view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.view.x = box.x + box.w / 2 - r.width / 2 / this.view.scale;
    this.view.y = box.y + box.h / 2 - r.height / 2 / this.view.scale;
    this.#onViewChange();
  }

  resetView() {
    this.view = { x: 0, y: 0, scale: 1 };
    this.#onViewChange();
  }

  #onViewChange() {
    if (this.#zoomLabel) this.#zoomLabel.textContent = `${Math.round(this.view.scale * 100)}%`;
    // Antes isto jogava fora o que estava sendo digitado: bastava a roda do
    // mouse encostar para o texto sumir. Agora move a caixa junto com o plano.
    this.#repositionTextInput();
    // Os ponteiros laser apontam para um ponto do plano, não da tela: sem
    // isto, eles escorregam para longe do objeto assim que alguém dá zoom.
    for (const [, l] of this.#lasers) this.#placeLaser(l);
    this.#scheduleRender();
    this.emit("view", { ...this.view });
  }

  #repositionTextInput() {
    const input = this.#textInput;
    if (!input) return;
    const at = input.__world;
    const screen = this.toScreen(at.x, at.y);
    input.style.left = `${screen.x}px`;
    input.style.top = `${screen.y}px`;
    input.style.fontSize = `${Math.max(input.__size * this.view.scale, 8)}px`;
  }

  #sceneBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of this.objects.values()) {
      const b = bounds(o);
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1 };
  }

  /* ================================================================ *
   * Barras
   * ================================================================ */

  #buildToolbar() {
    const bar = el("div.board__tools", { role: "toolbar", "aria-label": "Ferramentas do canvas" });

    const toolButtons = new Map();
    for (const t of TOOLS) {
      const b = el("button.board__tool", {
        type: "button",
        "aria-pressed": String(this.tool === t.id),
        "aria-label": `${t.label} (${t.key})`,
        dataset: { tip: `${t.label} · ${t.key}`, "tip-placement": "bottom" },
        onClick: () => this.setTool(t.id),
      });
      b.append(icon(t.icon, { size: "sm" }));
      toolButtons.set(t.id, b);
      bar.append(b);
    }
    this.on("tool", (id) => {
      for (const [k, b] of toolButtons) b.setAttribute("aria-pressed", String(k === id));
      if (this.#canvas) this.#canvas.dataset.tool = id;
    });

    bar.append(el("div.board__sep"));

    const swatches = el("div.swatches", { role: "radiogroup", "aria-label": "Cor" });
    const swatchEls = new Map();

    const addSwatch = (c, { before = null } = {}) => {
      if (swatchEls.has(c)) return swatchEls.get(c);
      const b = el("button.swatch", {
        type: "button",
        role: "radio",
        "aria-checked": String(this.color === c),
        "aria-label": `Cor ${c}`,
        style: { "--swatch": c },
        onClick: () => this.setColor(c),
      });
      swatchEls.set(c, b);
      if (before) swatches.insertBefore(b, before);
      else swatches.append(b);
      return b;
    };

    for (const c of PALETTE) addSwatch(c);

    /*
     * Cores personalizadas. O seletor é o `<input type="color">` do próprio
     * navegador: ele já traz a roda de cores, o campo hexadecimal e o
     * histórico do sistema operacional, e vem com acessibilidade de teclado
     * que um seletor desenhado à mão levaria bem mais linhas para igualar.
     */
    const custom = el("input.swatch.swatch--custom", {
      type: "color",
      value: toHex(this.color) || "#ffffff",
      "aria-label": "Escolher outra cor",
      dataset: { tip: "Escolher outra cor", "tip-placement": "bottom" },
    });
    // `input` dispara enquanto se arrasta na roda: dá pré-visualização ao vivo.
    custom.addEventListener("input", () => this.setColor(custom.value));
    custom.addEventListener("change", () => this.rememberColor(custom.value));

    const recentBox = el("div.swatches", { "aria-label": "Cores recentes" });
    const renderRecent = () => {
      clear(recentBox);
      for (const c of this.recentColors) {
        swatchEls.delete(c);
        const b = el("button.swatch", {
          type: "button",
          role: "radio",
          "aria-checked": String(this.color === c),
          "aria-label": `Cor recente ${c}`,
          style: { "--swatch": c },
          onClick: () => this.setColor(c),
        });
        swatchEls.set(c, b);
        recentBox.append(b);
      }
    };
    this.on("recent", renderRecent);
    renderRecent();

    swatches.append(custom);
    bar.append(swatches, recentBox);

    // Conta-gotas: existe no Chrome e no Edge. Onde não existe, o botão não
    // aparece — melhor do que um botão que erra silenciosamente.
    if (typeof window.EyeDropper === "function") {
      const drop = el("button.board__tool", {
        type: "button",
        "aria-label": "Conta-gotas: copiar uma cor da tela",
        dataset: { tip: "Conta-gotas · I", "tip-placement": "bottom" },
        onClick: () => this.pickColorFromScreen(),
      });
      drop.append(icon("scan", { size: "sm" }));
      bar.append(drop);
    }

    bar.append(el("div.board__sep"));

    this.on("color", (c) => {
      for (const [k, b] of swatchEls) b.setAttribute("aria-checked", String(k === c));
      const hex = toHex(c);
      if (hex) custom.value = hex;
    });

    const sizes = el("div.board__sizes", { role: "radiogroup", "aria-label": "Espessura" });
    const sizeEls = new Map();
    for (const s of SIZES) {
      const b = el("button.sizeDot", {
        type: "button",
        role: "radio",
        "aria-checked": String(this.size.id === s.id),
        "aria-label": `Espessura ${s.id}`,
        style: { "--dot": `${s.dot}px` },
        onClick: () => this.setSize(s),
      });
      sizeEls.set(s.id, b);
      sizes.append(b);
    }
    this.on("size", (s) => {
      for (const [k, b] of sizeEls) b.setAttribute("aria-checked", String(k === s.id));
    });
    bar.append(sizes, el("div.board__sep"));

    const action = (iconName, label, fn) => {
      const b = el("button.board__tool", {
        type: "button",
        "aria-label": label,
        dataset: { tip: label, "tip-placement": "bottom" },
        onClick: fn,
      });
      b.append(icon(iconName, { size: "sm" }));
      return b;
    };

    /**
     * Botão de liga/desliga. O estado vem do evento, não do clique: o mesmo
     * ajuste também é alcançável pelo teclado, e o botão tem de acompanhar.
     */
    const toggle = (iconName, label, event, get, set) => {
      const b = el("button.board__tool", {
        type: "button",
        "aria-pressed": String(get()),
        "aria-label": label,
        dataset: { tip: label, "tip-placement": "bottom" },
        onClick: () => set(!get()),
      });
      b.append(icon(iconName, { size: "sm" }));
      this.on(event, (v) => b.setAttribute("aria-pressed", String(!!v)));
      return b;
    };

    bar.append(
      toggle("palette", "Preencher formas · G", "fill", () => this.fill, (v) => this.setFill(v)),
      toggle("layout-grid", "Encaixar na malha · X", "snap", () => this.snap, (v) => {
        this.snap = v;
        this.emit("snap", v);
      }),
      el("div.board__sep"),
      action("image", "Inserir imagem", () => this.#picker?.click()),
      action("undo-2", "Desfazer · Ctrl+Z", () => this.undo()),
      action("redo-2", "Refazer · Ctrl+Shift+Z", () => this.redo()),
      action("trash-2", "Limpar tudo", () => this.requestClear()),
      action("download", "Baixar como PNG", () => this.exportPng()),
      action("save", "Salvar o canvas em arquivo", () => this.exportJson()),
    );

    return bar;
  }

  #buildNavBar() {
    const bar = el("div.board__nav", { role: "group", "aria-label": "Navegação do canvas" });
    const btn = (iconName, label, fn) => {
      const b = el("button.board__tool", {
        type: "button",
        "aria-label": label,
        dataset: { tip: label, "tip-placement": "top" },
        onClick: fn,
      });
      b.append(icon(iconName, { size: "sm" }));
      return b;
    };
    this.#zoomLabel = el("button.board__zoom", {
      type: "button",
      text: "100%",
      "aria-label": "Voltar ao tamanho original",
      dataset: { tip: "Tamanho original", "tip-placement": "top" },
      onClick: () => this.zoomTo(1),
    });
    bar.append(
      btn("minus", "Afastar", () => this.zoomBy(1 / 1.25)),
      this.#zoomLabel,
      btn("plus", "Aproximar", () => this.zoomBy(1.25)),
      el("div.board__sep"),
      btn("maximize", "Enquadrar tudo (F)", () => this.fitAll()),
    );
    return bar;
  }

  #buildPresence() {
    const box = el("div.board__presence");
    const render = () => {
      clear(box);
      const authors = new Set();
      for (const o of this.objects.values()) authors.add(o.by);
      for (const live of this.#live.values()) authors.add(live.by);
      const roster = this.getRoster().filter((p) => authors.has(p.id));
      if (!roster.length) {
        box.append(el("span", { text: "Canvas vazio" }));
        return;
      }
      for (const p of roster.slice(0, 5)) {
        box.append(el("span.avatar", { style: { background: colorFor(p.id) } }));
      }
      box.append(el("span", { text: `${this.objects.size} objetos` }));
    };
    this.on("change", render);
    render();
    return box;
  }

  /* ================================================================ *
   * Ferramentas
   * ================================================================ */

  setTool(id) {
    this.tool = id;
    if (id !== "select") this.#select(null);
    this.emit("tool", id);
    this.#scheduleRender();
    return id;
  }
  setColor(c) {
    this.color = c;
    const targets = this.#selected().filter((o) => o.type !== "image");
    if (targets.length) {
      this.#recordPatch(targets, (o) => ({ color: c, ...(o.fill ? { fill: c } : {}) }));
    }
    this.emit("color", c);
    return c;
  }
  setSize(s) {
    this.size = s;
    const strokes = this.#selected().filter((o) => o.points);
    if (strokes.length) {
      this.#recordPatch(strokes, () => ({ width: s.width / this.view.scale }));
    }
    this.emit("size", s);
    return s;
  }
  setFill(v) {
    this.fill = !!v;
    const shapes = this.#selected().filter((o) => o.type === "rect" || o.type === "ellipse");
    if (shapes.length) this.#recordPatch(shapes, (o) => ({ fill: this.fill ? o.color : null }));
    this.emit("fill", this.fill);
    return this.fill;
  }

  /**
   * Guarda uma cor personalizada na lista de recentes. Sem isto, cada uso de
   * um tom fora da paleta exigiria reabrir o seletor do sistema e achá-lo de
   * novo — a cor usada há dez segundos é a que mais se repete.
   */
  rememberColor(hex) {
    const c = toHex(hex);
    if (!c || PALETTE.includes(c)) return this.recentColors;
    this.recentColors = [c, ...this.recentColors.filter((x) => x !== c)].slice(0, RECENT_MAX);
    prefs.set("board:recent", this.recentColors);
    this.emit("recent", this.recentColors);
    return this.recentColors;
  }

  /**
   * Conta-gotas do navegador: copia a cor de qualquer pixel da tela, inclusive
   * de um desenho que já está no canvas ou de uma tela compartilhada.
   */
  async pickColorFromScreen() {
    if (typeof window.EyeDropper !== "function") return null;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      this.setColor(sRGBHex);
      this.rememberColor(sRGBHex);
      return sRGBHex;
    } catch {
      // Cancelar com Escape cai aqui; não é erro.
      return null;
    }
  }

  /** Objetos atualmente selecionados, já resolvidos e sem ids órfãos. */
  #selected() {
    const out = [];
    for (const id of this.selection) {
      const o = this.objects.get(id);
      if (o) out.push(o);
      else this.selection.delete(id);
    }
    return out;
  }

  #onKeyDown(e) {
    if (!this.mounted) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.code === "Space" && !this.#spaceHeld) {
      // Espaço pressionado = mão temporária, como em qualquer editor gráfico.
      this.#spaceHeld = true;
      this.#canvas?.classList.add("is-grabbing");
      e.preventDefault();
      return;
    }

    const key = String(e.key || "").toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      switch (key) {
        case "z":
          e.preventDefault();
          e.shiftKey ? this.redo() : this.undo();
          return;
        case "y":
          e.preventDefault();
          this.redo();
          return;
        case "c":
          e.preventDefault();
          this.copySelection();
          return;
        case "x":
          e.preventDefault();
          this.copySelection();
          this.deleteSelection();
          return;
        case "v":
          // Colar imagem vem pelo evento `paste`, que traz os dados; aqui só
          // trata o que já está na área de transferência interna.
          if (this.#clipboard.length) {
            e.preventDefault();
            this.pasteClipboard();
          }
          return;
        case "d":
          e.preventDefault();
          this.duplicateSelection();
          return;
        case "a":
          e.preventDefault();
          this.setTool("select");
          this.#select([...this.objects.keys()]);
          return;
        case "0":
        case "1":
          e.preventDefault();
          this.zoomTo(1);
          return;
        case "+":
        case "=":
        case "-":
          e.preventDefault();
          this.zoomBy(key === "-" ? 1 / 1.25 : 1.25);
          return;
        default:
          return;
      }
    }
    if (e.altKey) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (!this.selection.size) return;
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (e.key === "Escape" && this.selection.size) {
      e.preventDefault();
      this.#select(null);
      return;
    }
    // Setas empurram a seleção. Com Shift o passo é dez vezes maior — é o
    // acerto fino contra o acerto grosso, como em qualquer editor.
    if (e.key.startsWith("Arrow") && this.selection.size) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / this.view.scale;
      const dx = (e.key === "ArrowRight" ? step : 0) - (e.key === "ArrowLeft" ? step : 0);
      const dy = (e.key === "ArrowDown" ? step : 0) - (e.key === "ArrowUp" ? step : 0);
      this.nudgeSelection(dx, dy);
      return;
    }
    if ((e.key === "]" || e.key === "[") && this.selection.size) {
      e.preventDefault();
      e.key === "]" ? this.bringToFront() : this.sendToBack();
      return;
    }
    if (key === "f") {
      this.fitAll();
      return;
    }
    if (key === "g") {
      this.setFill(!this.fill);
      return;
    }
    if (key === "i") {
      this.pickColorFromScreen();
      return;
    }
    if (key === "x") {
      this.snap = !this.snap;
      this.emit("snap", this.snap);
      return;
    }
    const tool = TOOLS.find((t) => t.key === key);
    if (tool) this.setTool(tool.id);
  }

  #onKeyUp(e) {
    if (e.code !== "Space") return;
    this.#spaceHeld = false;
    this.#canvas?.classList.remove("is-grabbing");
  }

  /* ================================================================ *
   * Ponteiro
   * ================================================================ */

  #bindWheel() {
    this.#dispose(
      on(
        this.#canvas,
        "wheel",
        (e) => {
          e.preventDefault();
          const r = this.#canvas.getBoundingClientRect();
          const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
          // Pinça de trackpad e Ctrl+roda chegam como wheel com ctrlKey: é a
          // convenção que todos os navegadores usam para "isto é zoom".
          if (e.ctrlKey || e.metaKey) {
            this.zoomBy(Math.exp(-e.deltaY / 220), anchor);
          } else if (e.shiftKey) {
            this.panBy(-e.deltaY, 0);
          } else {
            this.panBy(-e.deltaX, -e.deltaY);
          }
        },
        { passive: false },
      ),
    );
  }

  #bindPointer() {
    const c = this.#canvas;

    const sendLaser = throttle((p) => {
      this.emit("cursor", { x: p.x, y: p.y, name: this.selfName, color: this.color, world: true });
    }, 60);

    const flushStroke = throttle(() => {
      const d = this.#drawing;
      if (!d?.op || (d.op.type !== "pen" && d.op.type !== "marker")) return;
      const from = d.sentUpTo;
      const slice = d.op.points.slice(from);
      if (!slice.length) return;
      d.sentUpTo = d.op.points.length;
      this.emit("op", {
        type: "stroke-chunk",
        id: d.op.id,
        by: this.selfId,
        seq: d.op.seq,
        color: d.op.color,
        width: d.op.width,
        alpha: d.op.alpha,
        tool: d.op.type,
        from,
        points: slice.map(round2),
      });
    }, 70);

    this.#dispose(
      on(c, "pointerdown", (e) => {
        if (e.button === 1 || this.#spaceHeld || this.tool === "hand") {
          c.setPointerCapture(e.pointerId);
          this.#panning = { x: e.clientX, y: e.clientY };
          c.classList.add("is-grabbing");
          e.preventDefault();
          return;
        }
        if (e.button !== 0 && e.pointerType === "mouse") return;
        const p = this.#pointer(e);

        /*
         * A ferramenta de texto NÃO captura o ponteiro e cancela o padrão do
         * evento. Era exatamente isto que quebrava escrever no canvas: o
         * `mousedown` que vem depois do `pointerdown` move o foco para o
         * documento, a <textarea> recém-criada perdia o foco no mesmo quadro,
         * o `blur` gravava uma string vazia e a caixa desaparecia antes de
         * aceitar a primeira tecla.
         */
        if (this.tool === "text" || this.tool === "note") {
          e.preventDefault();
          if (this.tool === "note") this.#createNote(this.#snap(p));
          else this.#openTextInput(this.#snap(p));
          return;
        }

        c.setPointerCapture(e.pointerId);

        if (this.tool === "laser") {
          sendLaser(p);
          this.#drawing = { laser: true };
          return;
        }
        if (this.tool === "select") {
          this.#beginSelect(e, p);
          return;
        }
        if (this.tool === "eraser") {
          this.#eraseAt(p);
          this.#drawing = { erasing: true };
          return;
        }

        const start = this.#snap(p);
        const op = {
          id: newId(this.selfId),
          by: this.selfId,
          seq: this.#nextSeq(),
          rev: 1,
          type: this.tool,
          color: this.color,
          width: this.size.width / this.view.scale, // espessura constante na tela
          alpha: this.tool === "marker" ? 0.4 : 1,
          rotation: 0,
          points: [start],
        };
        if (this.fill && (this.tool === "rect" || this.tool === "ellipse")) op.fill = this.color;
        this.#drawing = { op, sentUpTo: 0 };
        this.#live.set(this.selfId, op);
        this.#scheduleRender();
      }),
    );

    this.#dispose(
      on(c, "pointermove", (e) => {
        if (this.#panning) {
          this.panBy(e.clientX - this.#panning.x, e.clientY - this.#panning.y);
          this.#panning = { x: e.clientX, y: e.clientY };
          return;
        }
        const p = this.#pointer(e);

        if (this.tool === "laser") {
          if (this.#drawing?.laser || e.buttons === 0) sendLaser(p);
          return;
        }
        if (this.#transform) {
          this.#applyTransform(p, e.shiftKey);
          return;
        }
        if (this.#marquee) {
          this.#marquee.cur = p;
          this.#scheduleRender();
          return;
        }
        if (this.tool === "select") {
          this.#hoverCursor(e, p);
          return;
        }
        if (!this.#drawing) return;
        if (this.#drawing.erasing) {
          this.#eraseAt(p);
          return;
        }
        const op = this.#drawing.op;
        if (!op) return;

        if (op.type !== "pen" && op.type !== "marker") {
          // Shift trava a forma em quadrado/círculo — e a linha e a seta em
          // múltiplos de 45°, que é o que se espera de um diagrama.
          op.points[1] = e.shiftKey ? constrain(op.points[0], p, op.type) : this.#snap(p);
          this.#scheduleRender();
          return;
        }

        {
          const last = op.points[op.points.length - 1];
          // Descarta micro-movimentos, medidos em pixels de tela para que o
          // filtro não fique áspero quando se está muito afastado.
          const minStep = 1.2 / this.view.scale;
          if (Math.hypot(p.x - last.x, p.y - last.y) < minStep) return;
          op.points.push(p);
          flushStroke();
        }
        this.#scheduleRender();
      }),
    );

    const finish = () => {
      if (this.#panning) {
        this.#panning = null;
        c.classList.remove("is-grabbing");
        if (this.#spaceHeld) c.classList.add("is-grabbing");
      }
      if (this.#transform) {
        this.#endTransform();
        return;
      }
      if (this.#marquee) {
        this.#endMarquee();
        return;
      }
      const d = this.#drawing;
      this.#drawing = null;
      if (!d?.op) return;
      this.#live.delete(this.selfId);
      const op = d.op;
      if (op.points.length < 2) {
        this.#scheduleRender();
        return;
      }
      if (op.type !== "pen" && op.type !== "marker") normalizeShape(op);
      this.add(op, { local: true, record: true });
    };

    this.#dispose(on(c, "pointerup", finish));
    this.#dispose(on(c, "pointercancel", finish));
    this.#dispose(on(c, "lostpointercapture", finish));
    this.#dispose(on(c, "dblclick", (e) => this.#onDoubleClick(e)));
  }

  #hoverCursor(e, p) {
    const only = this.selection.size === 1 ? this.objects.get([...this.selection][0]) : null;
    let cursor = "default";
    if (only) {
      const h = this.#handleAt(only, p);
      if (h === "rotate") cursor = "grab";
      else if (h) cursor = h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize";
      else if (hits(only, p, 6 / this.view.scale)) cursor = "move";
    }
    if (cursor === "default" && this.#hitTest(p)) cursor = "move";
    this.#canvas.style.cursor = cursor;
  }

  #onDoubleClick(e) {
    if (this.tool !== "select") return;
    const p = this.#pointer(e);
    const o = this.#hitTest(p);
    if (o?.type === "text" || o?.type === "note") this.#openTextInput({ x: o.x, y: o.y }, o);
  }

  /* ================================================================ *
   * Seleção, movimento, redimensionamento e rotação
   * ================================================================ */

  /** Aceita null, um id ou uma lista. Substitui a seleção inteira. */
  #select(ids) {
    const next = ids === null || ids === undefined ? [] : Array.isArray(ids) ? ids : [ids];
    const same = next.length === this.selection.size && next.every((id) => this.selection.has(id));
    if (same) return;
    this.selection = new Set(next.filter((id) => this.objects.has(id)));
    this.emit("selection", [...this.selection]);
    this.#scheduleRender();
  }

  #toggleSelected(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit("selection", [...this.selection]);
    this.#scheduleRender();
  }

  #hitTest(p) {
    const tol = 6 / this.view.scale;
    const list = this.#ordered();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (hits(list[i], p, tol)) return list[i];
    }
    return null;
  }

  /** Qual punho está sob o ponteiro, se algum. Em pixels de tela. */
  #handleAt(o, p) {
    const b = bounds(o);
    if (!b) return null;
    const s = this.view.scale;
    const tol = (HANDLE + 4) / s;
    const corners = {
      nw: { x: b.x, y: b.y },
      ne: { x: b.x + b.w, y: b.y },
      sw: { x: b.x, y: b.y + b.h },
      se: { x: b.x + b.w, y: b.y + b.h },
    };
    for (const [k, c] of Object.entries(corners)) {
      if (Math.abs(p.x - c.x) < tol && Math.abs(p.y - c.y) < tol) return k;
    }
    const rot = { x: b.x + b.w / 2, y: b.y - ROTATE_OFFSET / s };
    if (Math.hypot(p.x - rot.x, p.y - rot.y) < tol) return "rotate";
    return null;
  }

  #beginSelect(e, p) {
    // Punhos só existem para um objeto sozinho; num grupo não há eixo comum
    // que faça sentido para girar ou esticar.
    const only = this.selection.size === 1 ? this.objects.get([...this.selection][0]) : null;
    if (only) {
      const handle = this.#handleAt(only, p);
      if (handle) {
        this.#transform = {
          kind: handle === "rotate" ? "rotate" : "resize",
          handle,
          start: p,
          ids: [only.id],
          snapshots: new Map([[only.id, structuredClone(only)]]),
          box: bounds(only),
        };
        return;
      }
    }

    const hit = this.#hitTest(p);

    if (!hit) {
      // Clique no vazio: começa a faixa de seleção. Sem Shift, limpa o que
      // estava selecionado — arrastar por cima é somar, não recomeçar.
      if (!e.shiftKey) this.#select(null);
      this.#marquee = { start: p, cur: p, additive: e.shiftKey };
      this.#scheduleRender();
      return;
    }

    if (e.shiftKey) {
      this.#toggleSelected(hit.id);
      return;
    }
    // Arrastar um objeto de fora da seleção troca a seleção; arrastar um que
    // já está dentro dela move o grupo inteiro.
    if (!this.selection.has(hit.id)) this.#select(hit.id);

    const ids = this.#selected().map((o) => o.id);
    this.#transform = {
      kind: "move",
      start: p,
      ids,
      snapshots: new Map(ids.map((id) => [id, structuredClone(this.objects.get(id))])),
      box: bounds(hit),
    };
  }

  #endMarquee() {
    const m = this.#marquee;
    this.#marquee = null;
    if (!m) return;
    const box = {
      x: Math.min(m.start.x, m.cur.x),
      y: Math.min(m.start.y, m.cur.y),
      w: Math.abs(m.cur.x - m.start.x),
      h: Math.abs(m.cur.y - m.start.y),
    };
    // Um arrasto de poucos pixels é um clique com a mão trêmula, não uma
    // seleção: tratá-lo como faixa esvaziaria a seleção sem querer.
    if (box.w * this.view.scale < 4 && box.h * this.view.scale < 4) {
      this.#scheduleRender();
      return;
    }
    const inside = [...this.objects.values()]
      .filter((o) => {
        const b = bounds(o);
        return b && overlaps(b, box);
      })
      .map((o) => o.id);
    this.#select(m.additive ? [...this.selection, ...inside] : inside);
  }

  #applyTransform(p, shift) {
    const t = this.#transform;

    if (t.kind === "move") {
      let dx = p.x - t.start.x;
      let dy = p.y - t.start.y;
      if (shift) {
        // Shift trava o arrasto no eixo dominante.
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (this.snap && t.box) {
        // O encaixe olha para o canto da caixa, não para o ponteiro: é a
        // borda do objeto que precisa cair na linha da malha.
        const tx = Math.round((t.box.x + dx) / SNAP) * SNAP;
        const ty = Math.round((t.box.y + dy) / SNAP) * SNAP;
        dx = tx - t.box.x;
        dy = ty - t.box.y;
      }
      for (const id of t.ids) {
        const o = this.objects.get(id);
        const src = t.snapshots.get(id);
        if (o && src) translate(o, src, dx, dy);
      }
      this.#scheduleRender();
      this.#throttledPatch(t.ids);
      return;
    }

    const o = this.objects.get(t.ids[0]);
    if (!o) return;
    const src = t.snapshots.get(o.id);

    if (t.kind === "rotate") {
      const cx = t.box.x + t.box.w / 2;
      const cy = t.box.y + t.box.h / 2;
      let ang = Math.atan2(p.y - cy, p.x - cx) + Math.PI / 2;
      if (shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      o.rotation = ang;
    } else {
      // Redimensionamento pelo canto: a âncora é o canto oposto.
      const b = t.box;
      const anchor = {
        x: t.handle.includes("w") ? b.x + b.w : b.x,
        y: t.handle.includes("n") ? b.y + b.h : b.y,
      };
      let sx = (p.x - anchor.x) / ((t.handle.includes("w") ? -1 : 1) * b.w || 1);
      let sy = (p.y - anchor.y) / ((t.handle.includes("n") ? -1 : 1) * b.h || 1);
      if (shift || src.type === "image") {
        const k = Math.max(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * k;
        sy = Math.sign(sy || 1) * k;
      }
      // Limite inferior: sem ele, o objeto colapsa em zero e não há como
      // pegá-lo de volta.
      sx = clampScale(sx);
      sy = clampScale(sy);
      scaleAround(o, src, anchor, sx, sy);
    }
    this.#scheduleRender();
    this.#throttledPatch([o.id]);
  }

  #throttledPatch = throttle((ids) => {
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) this.emit("op", { type: "update", id, by: this.selfId, patch: geometryOf(o), rev: o.rev });
    }
  }, 60);

  #endTransform() {
    const t = this.#transform;
    this.#transform = null;
    if (!t) return;
    const after = new Map();
    for (const id of t.ids) {
      const o = this.objects.get(id);
      if (!o) continue;
      o.rev = (o.rev || 1) + 1;
      after.set(id, geometryOf(o));
      this.emit("op", { type: "update", id, by: this.selfId, patch: geometryOf(o), rev: o.rev });
    }
    if (!after.size) return;
    const before = new Map();
    for (const [id, snap] of t.snapshots) {
      if (after.has(id)) before.set(id, geometryOf(snap));
    }
    this.#push({ kind: "patch", before, after });
    this.emit("change", this.objects.size);
  }

  #patch(id, patch, { record = true } = {}) {
    const o = this.objects.get(id);
    if (!o) return;
    if (record) {
      const before = new Map([[id, pick(o, Object.keys(patch))]]);
      this.#push({ kind: "patch", before, after: new Map([[id, { ...patch }]]) });
    }
    Object.assign(o, patch);
    o.rev = (o.rev || 1) + 1;
    this.emit("op", { type: "update", id, by: this.selfId, patch, rev: o.rev });
    this.#scheduleRender();
  }

  /** Aplica o mesmo tipo de alteração a vários objetos como um passo só. */
  #recordPatch(targets, patchFor) {
    const before = new Map();
    const after = new Map();
    for (const o of targets) {
      const patch = patchFor(o);
      before.set(o.id, pick(o, Object.keys(patch)));
      after.set(o.id, patch);
    }
    this.#push({ kind: "patch", before, after });
    this.#applyPatches(after);
  }

  /** Grava as alterações localmente e manda cada uma para a rede. */
  #applyPatches(map) {
    for (const [id, patch] of map) {
      const o = this.objects.get(id);
      if (!o) continue;
      Object.assign(o, patch);
      o.rev = (o.rev || 1) + 1;
      this.emit("op", { type: "update", id, by: this.selfId, patch, rev: o.rev });
    }
    this.emit("change", this.objects.size);
    this.#scheduleRender();
  }

  /* ================================================================ *
   * Texto
   * ================================================================ */

  #openTextInput(p, existing = null) {
    this.#commitText?.();

    const isNote = existing?.type === "note";
    const size = existing?.size || this.textSize();
    const screen = this.toScreen(p.x, p.y);
    const input = el("textarea.board__textInput", {
      rows: 1,
      spellcheck: false,
      class: isNote ? "board__textInput--note" : "",
      style: {
        left: `${screen.x}px`,
        top: `${screen.y}px`,
        fontSize: `${Math.max(size * this.view.scale, 8)}px`,
        // Na nota, a tinta segue o papel — a mesma conta que o desenho usa,
        // senão o texto muda de cor ao sair da edição.
        color: isNote ? readableInk(existing.color) : existing?.color || this.color,
        width: isNote ? `${existing.w * this.view.scale}px` : "",
        height: isNote ? `${existing.h * this.view.scale}px` : "",
      },
    });
    input.value = existing?.text || "";
    // Guardados no nó: é o que permite reposicionar a caixa quando o plano se
    // move enquanto alguém digita, em vez de descartar o que foi escrito.
    input.__world = { x: p.x, y: p.y };
    input.__size = size;
    this.#textInput = input;
    this.#root.append(input);

    const grow = () => {
      if (isNote) return;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    grow();
    input.addEventListener("input", grow);

    /*
     * O foco vai num quadro seguinte de propósito. O `mousedown` nativo que
     * segue o `pointerdown` move o foco para o documento; pedir o foco agora
     * seria perdê-lo alguns microssegundos depois — a causa original de
     * "não consigo escrever no canvas".
     */
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      if (existing) input.select();
    });

    let done = false;
    const commit = (keep = true) => {
      if (done) return;
      done = true;
      const text = keep ? input.value.trim() : existing?.text || "";
      input.remove();
      this.#textInput = null;
      this.#commitText = null;

      if (existing) {
        if (!text && existing.type === "text") this.#removeRecorded([existing.id]);
        else if (text !== existing.text) this.#patch(existing.id, { text });
        return;
      }
      if (!text) return;
      const obj = {
        id: newId(this.selfId),
        by: this.selfId,
        seq: this.#nextSeq(),
        rev: 1,
        type: "text",
        color: this.color,
        alpha: 1,
        rotation: 0,
        size,
        text,
        x: p.x,
        y: p.y,
      };
      this.add(obj, { local: true, record: true });
      this.setTool("select");
      this.#select(obj.id);
    };
    this.#commitText = commit;

    input.addEventListener("blur", () => commit(true));
    input.addEventListener("keydown", (e) => {
      // Sem isto, as teclas de ferramenta (3 = caneta, 9 = texto) seriam
      // interpretadas como atalho em vez de entrarem no texto.
      e.stopPropagation();
      const enterCommits = !isNote; // numa nota, Enter é quebra de linha
      if (e.key === "Enter" && enterCommits && !e.shiftKey) {
        e.preventDefault();
        commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        commit(false);
      } else if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        commit(true);
      }
    });
  }

  /** Corpo do texto em unidades de mundo, derivado da espessura escolhida. */
  textSize() {
    return (this.size.width * 5 + 8) / this.view.scale;
  }

  /* ================================================================ *
   * Notas adesivas
   * ================================================================ */

  #createNote(p) {
    const side = NOTE_SIDE / this.view.scale;
    const obj = {
      id: newId(this.selfId),
      by: this.selfId,
      seq: this.#nextSeq(),
      rev: 1,
      type: "note",
      color: this.color === "var(--board-ink)" ? PALETTE[2] : this.color,
      alpha: 1,
      rotation: 0,
      size: Math.max(14, side / 10),
      text: "",
      x: p.x,
      y: p.y,
      w: side,
      h: side * 0.78,
    };
    this.add(obj, { local: true, record: true });
    this.setTool("select");
    this.#select(obj.id);
    this.#openTextInput({ x: obj.x, y: obj.y }, obj);
  }

  /* ================================================================ *
   * Imagens
   * ================================================================ */

  #bindFiles() {
    const picker = el("input.sr-only", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,image/gif,application/json,.json",
      multiple: true,
      tabIndex: -1,
    });
    picker.addEventListener("change", async () => {
      for (const f of picker.files || []) await this.#insertFile(f);
      picker.value = "";
    });
    this.#picker = picker;
    this.#root.append(picker);

    const stop = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    this.#dispose(on(this.#root, "dragover", stop));
    this.#dispose(on(this.#root, "dragenter", stop));
    this.#dispose(
      on(this.#root, "drop", async (e) => {
        e.preventDefault();
        const r = this.#canvas.getBoundingClientRect();
        const at = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        for (const f of e.dataTransfer?.files || []) await this.#insertFile(f, at);
      }),
    );
  }

  /** Imagem ou canvas salvo — decide pelo arquivo, não por qual botão abriu. */
  #insertFile(file, at = null) {
    if (!file) return null;
    if (file.type === "application/json" || /\.json$/i.test(file.name || "")) {
      return this.importJson(file);
    }
    if (file.type.startsWith("image/")) return this.insertImageFile(file, at);
    return null;
  }

  #picker = null;

  /** Abre o seletor de arquivos. Usado pelo menu da barra de controles. */
  openImagePicker() {
    this.#picker?.click();
  }

  async #onPaste(e) {
    if (!this.mounted) return;
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find((i) => i.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      const file = img.getAsFile();
      if (file) await this.insertImageFile(file);
      return;
    }
    // Objetos copiados aqui dentro têm prioridade sobre o texto do sistema:
    // copiar uma forma e colar não deveria virar o texto que estava antes na
    // área de transferência do computador.
    if (this.#clipboard.length) {
      e.preventDefault();
      this.pasteClipboard();
      return;
    }
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text) return;
    e.preventDefault();
    const at = this.#viewCenter();
    const obj = {
      id: newId(this.selfId),
      by: this.selfId,
      seq: this.#nextSeq(),
      rev: 1,
      type: "text",
      color: this.color,
      alpha: 1,
      rotation: 0,
      size: this.textSize(),
      text: text.slice(0, 4000),
      x: at.x,
      y: at.y,
    };
    this.add(obj, { local: true, record: true });
    this.setTool("select");
    this.#select(obj.id);
  }

  /**
   * Reduz, codifica e insere uma imagem.
   *
   * O redimensionamento não é economia de espaço em disco: é o que decide se
   * a imagem atravessa a rede em meio segundo ou em quinze. Uma foto de
   * celular tem 4000 px de largura e ninguém precisa disso num canvas.
   */
  async insertImageFile(file, at = null) {
    if (!file || !file.type.startsWith("image/")) return null;
    try {
      const { dataUrl, width, height } = await downscale(file);
      const center = at || this.#viewCenter();
      const scale = Math.min(1, 480 / Math.max(width, height));
      const w = width * scale;
      const h = height * scale;
      const obj = {
        id: newId(this.selfId),
        by: this.selfId,
        // Entra como camada de fundo: dá para desenhar por cima na hora.
        seq: this.#seqDoFundo(),
        rev: 1,
        type: "image",
        rotation: 0,
        alpha: 1,
        x: center.x - w / 2,
        y: center.y - h / 2,
        w,
        h,
        src: dataUrl,
      };
      this.add(obj, { local: true, record: true });
      this.setTool("select");
      this.#select(obj.id);
      return obj;
    } catch (err) {
      this.emit("error", err);
      return null;
    }
  }

  #viewCenter() {
    const r = this.#canvas.getBoundingClientRect();
    return this.toWorld(r.width / 2, r.height / 2);
  }

  /** Fatia uma imagem para o canal de carga pesada. */
  #sendImage(obj) {
    const meta = { ...obj, src: null };
    const src = obj.src;
    const total = Math.ceil(src.length / CHUNK);
    this.emit("blob", { type: "image-begin", id: obj.id, by: this.selfId, meta, total });
    for (let i = 0; i < total; i += 1) {
      this.emit("blob", {
        type: "image-chunk",
        id: obj.id,
        by: this.selfId,
        i,
        total,
        data: src.slice(i * CHUNK, (i + 1) * CHUNK),
      });
    }
  }

  /* ================================================================ *
   * Cena
   * ================================================================ */

  #nextSeq() {
    this.#clock += 1;
    return this.#clock;
  }

  /**
   * Descarta traços em andamento que pararam de receber pedaços.
   *
   * O `add` que encerra um traço pode se perder: a pessoa fechou a aba no meio
   * do gesto, o canal caiu, a mensagem foi descartada pelo limite de taxa.
   * Sem esta varredura, o traço fica desenhado para sempre sem nunca virar um
   * objeto de verdade — não dá para selecionar, apagar nem desfazer.
   */
  #sweepLive() {
    const limite = Date.now() - LIVE_TTL_MS;
    for (const [peerId, live] of this.#live) {
      if (peerId === this.selfId) continue; // o próprio traço é gerido pelo ponteiro
      if ((live.at || 0) > limite) continue;
      this.#live.delete(peerId);
      // Um traço com forma é melhor promovido do que perdido: quem desenhou
      // pode ter saído, mas o desenho dela continua fazendo sentido.
      if (live.points?.length >= 2 && !this.objects.has(live.id)) {
        this.objects.set(live.id, { ...live, rev: 1 });
      }
      this.#scheduleRender();
    }
  }

  /** Ordem de desenho: determinística e igual em todas as máquinas. */
  #ordered() {
    return [...this.objects.values()].sort(
      (a, b) => (a.seq || 0) - (b.seq || 0) || String(a.by).localeCompare(String(b.by)),
    );
  }

  add(obj, { local = false, record = false } = {}) {
    this.objects.set(obj.id, obj);
    this.#clock = Math.max(this.#clock, obj.seq || 0);
    if (obj.type === "image") this.#loadBitmap(obj);
    if (local) {
      if (obj.type === "image") this.#sendImage(obj);
      else this.emit("op", { type: "add", op: obj });
    }
    if (record) this.#push({ kind: "add", objs: [structuredClone(obj)] });
    this.emit("change", this.objects.size);
    this.#scheduleRender();
  }

  #remove(ids, { local = true } = {}) {
    let changed = false;
    for (const id of ids) {
      if (this.objects.delete(id)) {
        this.#bitmaps.delete(id);
        this.selection.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    if (local) this.emit("op", { type: "erase", ids: [...ids] });
    this.emit("change", this.objects.size);
    this.#scheduleRender();
  }

  /**
   * Apaga guardando o que foi apagado, para o desfazer poder recriar.
   * `tag` junta as remoções de um mesmo arrasto de borracha num passo só —
   * sem isso, desfazer uma passada de borracha exigiria vinte Ctrl+Z.
   */
  #removeRecorded(ids, tag = null) {
    const objs = ids.map((id) => this.objects.get(id)).filter(Boolean).map((o) => structuredClone(o));
    if (!objs.length) return;
    const last = this.#undo[this.#undo.length - 1];
    if (tag && last?.kind === "remove" && last.tag === tag) last.objs.push(...objs);
    else this.#push({ kind: "remove", objs, tag });
    this.#remove(ids);
  }

  /* ================================================================ *
   * Desfazer e refazer
   *
   * A pilha é local: cada pessoa desfaz o que ela mesma fez, e nunca o que
   * o outro acabou de desenhar. A operação inversa também vai para a rede —
   * desfazer só no seu lado deixaria as duas telas diferentes.
   * ================================================================ */

  #push(entry) {
    this.#undo.push(entry);
    if (this.#undo.length > HISTORY_MAX) this.#undo.shift();
    this.#redo.length = 0;
    this.emit("history", { undo: this.#undo.length, redo: 0 });
  }

  /**
   * A pilha guarda o que foi feito, não o que desfaz. Desfazer executa o
   * inverso; refazer executa a entrada de novo. Guardar o inverso direto
   * parecia mais curto e deixava refazer sem nada para reexecutar.
   */
  #invert(entry) {
    if (entry.kind === "add") return { kind: "remove", objs: entry.objs };
    if (entry.kind === "remove") return { kind: "add", objs: entry.objs };
    return { kind: "patch", before: entry.after, after: entry.before };
  }

  /** Executa uma entrada de histórico no sentido em que ela foi escrita. */
  #run(entry) {
    if (entry.kind === "remove") {
      this.#remove(entry.objs.map((o) => o.id));
    } else if (entry.kind === "add") {
      for (const o of entry.objs) {
        const copy = structuredClone(o);
        this.objects.set(copy.id, copy);
        this.#clock = Math.max(this.#clock, copy.seq || 0);
        if (copy.type === "image") {
          this.#loadBitmap(copy);
          this.#sendImage(copy);
        } else {
          this.emit("op", { type: "add", op: copy });
        }
      }
      this.emit("change", this.objects.size);
      this.#scheduleRender();
    } else {
      this.#applyPatches(entry.after);
    }
  }

  undo() {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#run(this.#invert(entry));
    this.#redo.push(entry);
    if (this.#redo.length > HISTORY_MAX) this.#redo.shift();
    this.emit("history", { undo: this.#undo.length, redo: this.#redo.length });
    return true;
  }

  redo() {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#run(entry);
    this.#undo.push(entry);
    this.emit("history", { undo: this.#undo.length, redo: this.#redo.length });
    return true;
  }

  /* ================================================================ *
   * Ações sobre a seleção
   * ================================================================ */

  deleteSelection() {
    const ids = this.#selected().map((o) => o.id);
    if (!ids.length) return false;
    this.#removeRecorded(ids);
    this.#select(null);
    return true;
  }

  copySelection() {
    const objs = this.#selected();
    if (!objs.length) return false;
    this.#clipboard = objs.map((o) => structuredClone(o));
    this.emit("copy", this.#clipboard.length);
    return true;
  }

  /** Cola o que foi copiado, deslocado, e deixa a cópia selecionada. */
  pasteClipboard(offset = 24) {
    return this.#cloneInto(this.#clipboard, offset / this.view.scale);
  }

  duplicateSelection() {
    return this.#cloneInto(this.#selected(), 24 / this.view.scale);
  }

  #cloneInto(source, delta) {
    if (!source?.length) return false;
    const made = [];
    for (const src of source) {
      const copy = structuredClone(src);
      copy.id = newId(this.selfId);
      copy.by = this.selfId;
      copy.seq = this.#nextSeq();
      copy.rev = 1;
      translate(copy, src, delta, delta);
      this.objects.set(copy.id, copy);
      if (copy.type === "image") {
        this.#loadBitmap(copy);
        this.#sendImage(copy);
      } else {
        this.emit("op", { type: "add", op: copy });
      }
      made.push(copy);
    }
    this.#push({ kind: "add", objs: made.map((o) => structuredClone(o)) });
    this.setTool("select");
    this.#select(made.map((o) => o.id));
    this.emit("change", this.objects.size);
    this.#scheduleRender();
    return true;
  }

  nudgeSelection(dx, dy) {
    const objs = this.#selected();
    if (!objs.length) return false;
    this.#recordPatch(objs, (o) => {
      const moved = structuredClone(o);
      translate(moved, o, dx, dy);
      return geometryOf(moved);
    });
    return true;
  }

  /**
   * Ordem de pilha. `seq` é o relógio lógico que decide quem desenha por
   * cima; empurrá-lo para fora dos extremos é a maneira mais barata de trazer
   * à frente ou mandar para trás sem um segundo campo só para isso.
   */
  bringToFront() {
    const objs = this.#selected();
    if (!objs.length) return false;
    let top = this.#clock;
    this.#recordPatch(objs, () => ({ seq: (top += 1) }));
    this.#clock = top;
    return true;
  }

  sendToBack() {
    const objs = this.#selected();
    if (!objs.length) return false;
    let low = Math.min(0, ...[...this.objects.values()].map((o) => o.seq || 0));
    this.#recordPatch(objs, () => ({ seq: (low -= 1) }));
    return true;
  }

  requestClear() {
    if (!this.objects.size) return;
    this.#push({ kind: "remove", objs: [...this.objects.values()].map((o) => structuredClone(o)) });
    this.objects.clear();
    this.#bitmaps.clear();
    this.#live.clear();
    this.#select(null);
    this.emit("op", { type: "clear" });
    this.emit("change", 0);
    this.#scheduleRender();
  }

  /**
   * Apaga o que estiver sob o ponteiro — MENOS as imagens.
   *
   * Uma imagem funciona como papel: você escreve em cima dela. Se a borracha
   * a apagasse junto, corrigir uma palavra escrita sobre uma foto apagaria a
   * foto inteira, e não há desfazer que devolva a confiança depois disso
   * acontecer no meio de uma reunião.
   *
   * Para tirar a imagem, existe o caminho explícito: selecionar e apertar
   * Delete. É a mesma distinção que qualquer editor faz entre o fundo e o que
   * está desenhado sobre ele.
   */
  /** Atalho para o teste: a borracha sem depender de evento de ponteiro. */
  apagarParaTeste(p) {
    this.#eraseAt(p);
  }

  #eraseAt(p) {
    const tol = 8 / this.view.scale;
    const hit = [];
    for (const o of this.objects.values()) {
      if (o.type === "image") continue;
      if (hits(o, p, tol)) hit.push(o.id);
    }
    if (hit.length) this.#removeRecorded(hit, this.#drawing?.erasing ? this.#drawing : null);
  }

  /**
   * O `seq` que põe um objeto atrás de todos os outros.
   *
   * A ordem de desenho é decidida por `seq`, e uma imagem inserida depois de
   * um traço cobriria o traço. Como imagem quase sempre é fundo — a planta que
   * se anota, a captura que se comenta —, ela entra por baixo e o que já estava
   * desenhado continua visível. Quem quiser o contrário usa a tecla `]`.
   */
  #seqDoFundo() {
    let menor = 0;
    for (const o of this.objects.values()) menor = Math.min(menor, o.seq || 0);
    return menor - 1;
  }

  /** Estado completo, para quem chega depois. */
  scene() {
    return { type: "scene", clock: this.#clock, objects: this.#ordered() };
  }

  /* ================================================================ *
   * Recepção
   * ================================================================ */

  apply(from, msg) {
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "add": {
        const op = msg.op;
        if (!op || op.by !== from || this.objects.has(op.id)) return;
        this.#clock = Math.max(this.#clock, op.seq || 0);
        this.objects.set(op.id, op);
        this.#live.delete(from);
        if (op.type === "image" && op.src) this.#loadBitmap(op);
        break;
      }

      case "update": {
        const o = this.objects.get(msg.id);
        if (!o) return;
        // Revisão mais alta ganha; empate resolve pelo id do autor, para que
        // as duas pontas cheguem à mesma conclusão.
        const incoming = msg.rev || 0;
        const mine = o.rev || 0;
        if (incoming < mine) return;
        if (incoming === mine && String(from) < String(o.by)) return;
        Object.assign(o, msg.patch || {});
        o.rev = incoming;
        break;
      }

      case "stroke-chunk": {
        /*
         * O traço já virou objeto. Um pedaço atrasado (o caminho pelo servidor
         * é mais lento que o DataChannel, então a ordem entre os dois não é
         * garantida) recriava um traço "em andamento" que nunca mais terminava
         * — o fantasma que ficava na tela até recarregar a página.
         */
        if (this.objects.has(msg.id)) return;

        let live = this.#live.get(from);
        if (!live || live.id !== msg.id) {
          live = {
            id: msg.id,
            by: from,
            seq: msg.seq || 0,
            type: msg.tool || "pen",
            color: msg.color,
            width: msg.width,
            alpha: msg.alpha ?? 1,
            rotation: 0,
            points: [],
          };
          this.#live.set(from, live);
        }
        live.at = Date.now();
        if (msg.from === live.points.length) live.points.push(...msg.points);
        else if (msg.from < live.points.length) {
          live.points.length = msg.from;
          live.points.push(...msg.points);
        }
        this.#sweepLive();
        break;
      }

      case "erase": {
        for (const id of msg.ids || []) {
          this.objects.delete(id);
          this.#bitmaps.delete(id);
          // Sem isto, os punhos continuavam desenhados sobre um objeto que já
          // não existe, e o próximo arrasto mexia no nada.
          this.selection.delete(id);
        }
        break;
      }

      case "undo": {
        const mine = this.#ordered().filter((o) => o.by === from);
        const last = mine[mine.length - 1];
        if (last) {
          this.objects.delete(last.id);
          this.selection.delete(last.id);
        }
        break;
      }

      case "clear": {
        this.objects.clear();
        this.#bitmaps.clear();
        this.#live.clear();
        this.selection.clear();
        this.#undo.length = 0;
        this.#redo.length = 0;
        break;
      }

      case "hello": {
        this.emit("sync-request", from);
        return;
      }

      case "scene": {
        // Funde em vez de substituir. Antes, quem já tivesse desenhado uma
        // linha antes da cena chegar ficava sem o quadro dos outros para
        // sempre; e substituir apagaria o que essa pessoa fez. Como cada id é
        // único por autor, juntar os dois lados é seguro.
        for (const o of msg.objects || []) {
          if (this.objects.has(o.id)) continue;
          this.objects.set(o.id, o);
          if (o.type === "image" && o.src) this.#loadBitmap(o);
        }
        this.#clock = Math.max(this.#clock, msg.clock || 0);
        break;
      }

      /* --- imagens em pedaços, pelo canal de carga pesada --- */
      case "image-begin": {
        this.#varrerIncompletas();
        this.#incoming.set(msg.id, { meta: msg.meta, total: msg.total, parts: [], at: Date.now() });
        return;
      }
      case "image-chunk": {
        const entry = this.#incoming.get(msg.id);
        if (!entry) return;
        entry.parts[msg.i] = msg.data;
        const done = entry.parts.filter(Boolean).length === entry.total;
        if (!done) return;
        this.#incoming.delete(msg.id);
        const obj = { ...entry.meta, src: entry.parts.join("") };
        if (!this.objects.has(obj.id)) {
          this.#clock = Math.max(this.#clock, obj.seq || 0);
          this.objects.set(obj.id, obj);
          this.#loadBitmap(obj);
        }
        break;
      }

      default:
        return;
    }

    this.emit("change", this.objects.size);
    this.#scheduleRender();
  }

  /**
   * Descarta imagens que pararam no meio do caminho.
   *
   * Quem estava mandando uma foto pode ter fechado a aba, caído da rede ou
   * tido a mensagem descartada pelo limite de taxa. Os pedaços já recebidos
   * ficavam na memória para sempre — e uma foto de celular chega a passar de
   * um megabyte em base64. Numa reunião longa, com várias tentativas, isso
   * soma.
   */
  #varrerIncompletas() {
    const limite = Date.now() - INCOMPLETA_TTL_MS;
    for (const [id, entrada] of this.#incoming) {
      if ((entrada.at || 0) < limite) this.#incoming.delete(id);
    }
  }

  #loadBitmap(obj) {
    if (!obj.src || this.#bitmaps.has(obj.id)) return;
    const img = new Image();
    img.onload = () => {
      this.#bitmaps.set(obj.id, img);
      this.#scheduleRender();
    };
    img.src = obj.src;
  }

  /* ================================================================ *
   * Ponteiro laser
   * ================================================================ */

  showLaser(from, { x, y, name, color }) {
    if (!this.#root) return;
    const prev = this.#lasers.get(from);
    let node = prev?.node;
    if (!node) {
      node = el("div.laser", { style: { "--laser-color": color || colorFor(from) } }, [
        el("span.laser__name", { text: name || "" }),
      ]);
      this.#root.append(node);
    }
    clearTimeout(prev?.timer);
    const timer = setTimeout(() => {
      node.remove();
      this.#lasers.delete(from);
    }, 2200);
    // Guarda a posição em mundo: cada pessoa pode estar com um zoom diferente,
    // e o ponteiro tem de apontar para o mesmo objeto — não para o mesmo
    // pixel. Guardado, ele também acompanha quando você mesmo navega.
    const entry = { node, timer, at: { x, y } };
    this.#lasers.set(from, entry);
    this.#placeLaser(entry);
  }

  #placeLaser(entry) {
    const p = this.toScreen(entry.at.x, entry.at.y);
    entry.node.style.left = `${p.x}px`;
    entry.node.style.top = `${p.y}px`;
  }

  /* ================================================================ *
   * Desenho
   * ================================================================ */

  #resize() {
    if (!this.#canvas || !this.#root) return;
    const r = this.#root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#canvas.width = Math.round(r.width * this.#dpr);
    this.#canvas.height = Math.round(r.height * this.#dpr);
    this.#render();
  }

  #scheduleRender() {
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(() => this.#render());
  }

  #render() {
    const ctx = this.#ctx;
    const c = this.#canvas;
    if (!ctx || !c) return;

    const w = c.width / this.#dpr;
    const h = c.height / this.#dpr;

    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (this.mode === "board") this.#drawGrid(ctx, w, h);

    const ink = getComputedStyle(this.#root).getPropertyValue("--board-ink").trim() || "#fff";
    // Janela visível em coordenadas de mundo, com folga para não cortar traços
    // grossos na borda.
    const viewBox = {
      x: this.view.x - 50 / this.view.scale,
      y: this.view.y - 50 / this.view.scale,
      w: w / this.view.scale + 100 / this.view.scale,
      h: h / this.view.scale + 100 / this.view.scale,
    };

    ctx.save();
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(-this.view.x, -this.view.y);

    const draw = (o) => {
      const b = bounds(o);
      // Culling: com centenas de objetos espalhados pelo plano, desenhar o
      // que está fora da janela é o que faz o zoom engasgar.
      if (b && !overlaps(b, viewBox)) return;
      this.#drawObject(ctx, o, ink);
    };
    for (const o of this.#ordered()) draw(o);
    for (const o of this.#live.values()) draw(o);
    if (this.#drawing?.op) draw(this.#drawing.op);

    ctx.restore();

    const sel = this.#selected();
    // Com um objeto, os punhos; com vários, só o contorno de cada um mais a
    // caixa do conjunto, que é o que dá a noção do que vai se mover junto.
    if (sel.length === 1) this.#drawSelection(ctx, sel[0]);
    else if (sel.length > 1) this.#drawGroupSelection(ctx, sel);
    if (this.#marquee) this.#drawMarquee(ctx);
  }

  #drawMarquee(ctx) {
    const a = this.toScreen(this.#marquee.start.x, this.#marquee.start.y);
    const b = this.toScreen(this.#marquee.cur.x, this.#marquee.cur.y);
    ctx.save();
    ctx.strokeStyle = "#6ec6ff";
    ctx.fillStyle = "rgba(110,198,255,.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  #drawGroupSelection(ctx, objs) {
    ctx.save();
    ctx.strokeStyle = "#6ec6ff";
    ctx.lineWidth = 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of objs) {
      const b = bounds(o);
      if (!b) continue;
      const tl = this.toScreen(b.x, b.y);
      const br = this.toScreen(b.x + b.w, b.y + b.h);
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      minX = Math.min(minX, tl.x);
      minY = Math.min(minY, tl.y);
      maxX = Math.max(maxX, br.x);
      maxY = Math.max(maxY, br.y);
    }
    if (Number.isFinite(minX)) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8);
    }
    ctx.restore();
  }

  #drawGrid(ctx, w, h) {
    // O passo dobra conforme se afasta, para que a malha nunca vire um borrão
    // nem desapareça.
    let step = 40;
    while (step * this.view.scale < 18) step *= 4;
    while (step * this.view.scale > 140) step /= 4;
    const s = step * this.view.scale;
    const ox = (-this.view.x * this.view.scale) % s;
    const oy = (-this.view.y * this.view.scale) % s;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = getComputedStyle(this.#root).getPropertyValue("--board-grid").trim() || "rgba(128,128,128,.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += s) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = oy; y < h; y += s) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawObject(ctx, o, ink) {
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.strokeStyle = o.color === "var(--board-ink)" ? ink : o.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = o.width || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Rotação em torno do centro da caixa.
    if (o.rotation) {
      const b = bounds(o);
      if (b) {
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.rotate(o.rotation);
        ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
      }
    }

    switch (o.type) {
      case "pen":
      case "marker": {
        const pts = o.points || [];
        if (!pts.length) break;
        if (o.type === "marker") {
          ctx.lineWidth = (o.width || 2) * 3;
          ctx.lineCap = "butt";
        }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i += 1) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        break;
      }
      case "line": {
        const [a, b] = o.points || [];
        if (!b) break;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case "arrow": {
        const [a, b] = o.points || [];
        if (!b) break;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(10, (o.width || 2) * 3.5);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "rect": {
        const [a, b] = o.points || [];
        if (!b) break;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(8, w / 8, h / 8));
        else ctx.rect(x, y, w, h);
        this.#strokeAndFill(ctx, o, ink);
        break;
      }
      case "ellipse": {
        const [a, b] = o.points || [];
        if (!b) break;
        ctx.beginPath();
        ctx.ellipse(
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2,
          Math.abs(b.y - a.y) / 2,
          0,
          0,
          Math.PI * 2,
        );
        this.#strokeAndFill(ctx, o, ink);
        break;
      }
      case "note": {
        // Papel, sombra e texto quebrado na largura: uma nota adesiva é só
        // isso, e ter a sombra é o que a separa visualmente de um retângulo.
        const paper = o.color === "var(--board-ink)" ? ink : o.color;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.18)";
        ctx.fillRect(o.x + 3, o.y + 4, o.w, o.h);
        ctx.fillStyle = paper;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        const size = o.size || 16;
        ctx.fillStyle = readableInk(paper);
        ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = "top";
        const pad = Math.max(8, size * 0.6);
        let y = o.y + pad;
        for (const line of wrapText(ctx, String(o.text || ""), o.w - pad * 2)) {
          if (y + size > o.y + o.h - pad / 2) break;
          ctx.fillText(line, o.x + pad, y);
          y += size * 1.3;
        }
        ctx.restore();
        break;
      }
      case "text": {
        const size = o.size || 20;
        ctx.font = `${size > 24 ? 600 : 500} ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = "top";
        String(o.text || "")
          .split("\n")
          .forEach((line, i) => ctx.fillText(line, o.x, o.y + i * size * 1.25));
        break;
      }
      case "image": {
        const img = this.#bitmaps.get(o.id);
        if (img) {
          ctx.drawImage(img, o.x, o.y, o.w, o.h);
        } else {
          // Placeholder enquanto os pedaços chegam: melhor um retângulo com
          // aviso do que um buraco inexplicável no canvas.
          ctx.globalAlpha = 0.35;
          ctx.strokeRect(o.x, o.y, o.w, o.h);
          ctx.font = `${Math.max(12, o.h / 12)}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillText("carregando imagem…", o.x + 8, o.y + 8);
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  /**
   * Preenchimento translúcido por baixo do traço. Opaco taparia o que estiver
   * atrás; uma forma de destaque num diagrama precisa deixar ver por baixo.
   */
  #strokeAndFill(ctx, o, ink) {
    if (o.fill) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * 0.25;
      ctx.fillStyle = o.fill === "var(--board-ink)" ? ink : o.fill;
      ctx.fill();
      ctx.globalAlpha = prev;
    }
    ctx.stroke();
  }

  #drawSelection(ctx, o) {
    const b = bounds(o);
    if (!b) return;
    const tl = this.toScreen(b.x, b.y);
    const br = this.toScreen(b.x + b.w, b.y + b.h);
    const w = br.x - tl.x;
    const h = br.y - tl.y;

    ctx.save();
    ctx.translate(tl.x + w / 2, tl.y + h / 2);
    if (o.rotation) ctx.rotate(o.rotation);
    ctx.translate(-w / 2, -h / 2);

    ctx.strokeStyle = "#6ec6ff";
    ctx.fillStyle = "#6ec6ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(0, 0, w, h);
    ctx.setLineDash([]);

    for (const [hx, hy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    }
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, -ROTATE_OFFSET);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, -ROTATE_OFFSET, HANDLE / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ================================================================ *
   * Exportação
   * ================================================================ */

  /** Exporta a cena inteira, não só o pedaço visível. */
  exportPng() {
    const box = this.#sceneBounds();
    if (!box) return null;
    const pad = 40;
    const scale = Math.min(2, 4000 / Math.max(box.w + pad * 2, box.h + pad * 2));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round((box.w + pad * 2) * scale));
    out.height = Math.max(1, Math.round((box.h + pad * 2) * scale));
    const ctx = out.getContext("2d");

    if (this.mode === "board") {
      ctx.fillStyle = getComputedStyle(this.#root).getPropertyValue("--board-paper").trim() || "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.scale(scale, scale);
    ctx.translate(-box.x + pad, -box.y + pad);
    const ink = getComputedStyle(this.#root).getPropertyValue("--board-ink").trim() || "#fff";
    for (const o of this.#ordered()) this.#drawObject(ctx, o, ink);

    out.toBlob((blob) => {
      if (blob) download(blob, `${stamp()}.png`);
    }, "image/png");
    this.emit("export");
    return true;
  }

  /**
   * Salva a cena como JSON. Diferente do PNG, isto volta a ser editável — é
   * o que permite retomar um quadro numa reunião seguinte.
   */
  exportJson() {
    const data = JSON.stringify({ v: 1, ...this.scene() });
    download(new Blob([data], { type: "application/json" }), `${stamp()}.json`);
    this.emit("export");
    return true;
  }

  /**
   * Carrega um arquivo salvo, somando ao que já existe. Os objetos recebem
   * ids e `seq` novos: colar um arquivo duas vezes tem de dar duas cópias, e
   * reaproveitar o id do autor original colidiria com o quadro de quem o fez.
   */
  async importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data?.objects) ? data.objects : [];
      if (!list.length) return false;
      const made = [];
      for (const src of list) {
        if (!src || typeof src !== "object" || typeof src.type !== "string") continue;
        const copy = { ...src, id: newId(this.selfId), by: this.selfId, seq: this.#nextSeq(), rev: 1 };
        this.objects.set(copy.id, copy);
        if (copy.type === "image") {
          this.#loadBitmap(copy);
          this.#sendImage(copy);
        } else {
          this.emit("op", { type: "add", op: copy });
        }
        made.push(copy);
      }
      if (!made.length) return false;
      this.#push({ kind: "add", objs: made.map((o) => structuredClone(o)) });
      this.emit("change", this.objects.size);
      this.fitAll();
      return made.length;
    } catch (err) {
      this.emit("error", err);
      return false;
    }
  }
}

const stamp = () =>
  `vcall-canvas-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================================================================== *
 * Geometria — funções puras sobre objetos da cena
 * ==================================================================== */

const round2 = (p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

function clampScale(s) {
  if (!Number.isFinite(s)) return 1;
  const sign = s < 0 ? -1 : 1;
  return sign * Math.max(Math.abs(s), 0.05);
}

/** Caixa envolvente, em coordenadas de mundo e sem rotação. */
export function bounds(o) {
  if (!o) return null;
  if (BOXED.has(o.type)) return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.type === "text") {
    const size = o.size || 20;
    const lines = String(o.text || "").split("\n");
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
    // Sem medir no contexto: 0,55 em relação ao corpo é uma aproximação boa o
    // bastante para seleção e enquadramento.
    return { x: o.x, y: o.y, w: longest * size * 0.55, h: lines.length * size * 1.25 };
  }
  const pts = o.points || [];
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = (o.width || 2) / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Quebra o texto na largura dada, respeitando as quebras já digitadas. */
export function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Tinta legível sobre um papel colorido. A fórmula é a luminância relativa
 * do sRGB: amarelo pede texto escuro, roxo pede texto claro, e adivinhar pela
 * cor "parecer clara" erra exatamente nos tons do meio.
 */
export function readableInk(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return "#101014";
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#101014" : "#ffffff";
}

/** Só o que a rede precisa saber quando um objeto é movido ou redimensionado. */
function geometryOf(o) {
  const g = { rotation: o.rotation || 0 };
  if (o.type === "image") Object.assign(g, { x: o.x, y: o.y, w: o.w, h: o.h });
  else if (o.type === "note") {
    Object.assign(g, { x: o.x, y: o.y, w: o.w, h: o.h, size: o.size, text: o.text, color: o.color });
  } else if (o.type === "text") {
    Object.assign(g, { x: o.x, y: o.y, size: o.size, text: o.text, color: o.color });
  } else {
    Object.assign(g, { points: (o.points || []).map(round2), width: o.width, color: o.color, fill: o.fill ?? null });
  }
  return g;
}

/**
 * Normaliza uma cor para `#rrggbb`, que é o único formato que o
 * `<input type="color">` aceita. A tinta do tema (`var(--board-ink)`) não tem
 * valor fixo aqui, então devolve null e o campo fica como estava.
 */
function toHex(color) {
  const v = String(color || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).replace(/./g, (c) => c + c)}`.toLowerCase();
  return null;
}

/** Recorta as chaves indicadas, para guardar o "antes" de uma alteração. */
function pick(o, keys) {
  const out = {};
  for (const k of keys) out[k] = structuredClone(o[k] ?? null);
  return out;
}

/**
 * Trava um segundo ponto: quadrado e círculo viram regulares, linha e seta
 * caem no múltiplo de 45° mais próximo.
 */
export function constrain(a, b, type) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (type === "rect" || type === "ellipse") {
    const k = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * k, y: a.y + Math.sign(dy || 1) * k };
  }
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

function translate(o, src, dx, dy) {
  if (src.points) {
    o.points = src.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    return;
  }
  o.x = src.x + dx;
  o.y = src.y + dy;
}

/**
 * Escala em torno do canto oposto ao punho arrastado. O sinal já vem embutido
 * em sx/sy (calculados em #applyTransform), então aqui não há inversão: repetir
 * a inversão dobraria o espelhamento e o objeto saltaria para o outro lado.
 */
function scaleAround(o, src, anchor, sx, sy) {
  const map = (x, y) => ({
    x: anchor.x + (x - anchor.x) * sx,
    y: anchor.y + (y - anchor.y) * sy,
  });
  if (src.points) {
    o.points = src.points.map((p) => map(p.x, p.y));
    o.width = Math.max(0.5, (src.width || 2) * Math.abs((sx + sy) / 2));
    return;
  }
  const a = map(src.x, src.y);
  o.x = a.x;
  o.y = a.y;
  if (BOXED.has(src.type)) {
    o.w = Math.max(8, src.w * Math.abs(sx));
    o.h = Math.max(8, src.h * Math.abs(sy));
    // O corpo do texto de uma nota acompanha o tamanho dela; senão, esticar
    // uma nota pequena deixaria duas palavras ocupando a folha inteira.
    if (src.type === "note") o.size = Math.max(8, (src.size || 16) * Math.abs((sx + sy) / 2));
  } else if (src.type === "text") {
    o.size = Math.max(6, (src.size || 20) * Math.abs((sx + sy) / 2));
  }
}

/** Formas guardam sempre dois pontos; o resto do código conta com isso. */
function normalizeShape(op) {
  if (!op.points[1]) op.points[1] = { ...op.points[0] };
}

export function hits(o, p, tol) {
  const b = bounds(o);
  if (!b) return false;

  // Objeto girado: leva-se o ponto para o referencial dele em vez de girar a
  // caixa — é a mesma conta, com um quarto das linhas.
  let q = p;
  if (o.rotation) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const cos = Math.cos(-o.rotation);
    const sin = Math.sin(-o.rotation);
    const dx = p.x - cx;
    const dy = p.y - cy;
    q = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  if (BOXED.has(o.type) || o.type === "text") {
    return q.x > b.x - tol && q.x < b.x + b.w + tol && q.y > b.y - tol && q.y < b.y + b.h + tol;
  }
  if (o.type === "rect" || o.type === "ellipse") {
    return q.x > b.x - tol && q.x < b.x + b.w + tol && q.y > b.y - tol && q.y < b.y + b.h + tol;
  }
  const pts = o.points || [];
  const reach = tol + (o.width || 2) / 2;
  for (let i = 0; i < pts.length; i += 1) {
    if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) < reach) return true;
    const n = pts[i + 1];
    if (n && distToSegment(q, pts[i], n) < reach) return true;
  }
  return false;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Reduz a imagem e devolve uma data URL. WebP quando o navegador aceita —
 * costuma ficar em um terço do JPEG na mesma qualidade visual.
 */
async function downscale(file) {
  const bitmap = await createImageBitmap(file).catch(async () => {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  });

  const sw = bitmap.width;
  const sh = bitmap.height;
  const k = Math.min(1, IMAGE_MAX_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let dataUrl = c.toDataURL("image/webp", 0.85);
  if (!dataUrl.startsWith("data:image/webp")) dataUrl = c.toDataURL("image/jpeg", 0.85);
  return { dataUrl, width: w, height: h };
}
