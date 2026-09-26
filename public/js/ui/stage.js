/**
 * ui/stage.js — a grade de vídeo.
 *
 * Cada participante pode ocupar até dois ladrilhos: a câmera e a tela
 * compartilhada. Tratá-los como ladrilhos independentes (em vez de um só que
 * alterna) é o que permite ver o rosto de quem apresenta ao lado do que ele
 * está apresentando.
 *
 * Regras de layout, nesta ordem de prioridade:
 *   1. alguém fixado manualmente vence;
 *   2. senão, uma tela compartilhada vai para o destaque;
 *   3. senão, quem está falando ocupa o destaque, se o modo destaque estiver
 *      ligado;
 *   4. senão, grade igualitária.
 */
import { el, icon, clear, setIcon } from "../lib/dom.js";
import { avatarEl, setAvatar } from "./avatars.js";
import { QUALITY_ICON, QUALITY_LABEL } from "../core/stats.js";
import { burst, flip } from "./motion.js";

const CONNECTION_TEXT = {
  new: "Conectando…",
  connecting: "Conectando…",
  restarting: "Reconectando…",
  disconnected: "Sinal instável…",
  failed: "Conexão perdida",
  exhausted: "Não foi possível reconectar",
  closed: "Desconectado",
};

class Tile {
  constructor({ id, peerId, kind, name, avatar, self }) {
    this.id = id;
    this.peerId = peerId;
    this.kind = kind; // "cam" | "screen"
    this.self = self;
    this.pinned = false;

    this.node = el("figure.tile", {
      class: kind === "screen" ? "tile--screen" : "",
      dataset: { tile: id, kind },
      tabindex: "0",
    });

    this.video = el("video.tile__video", {
      autoplay: true,
      playsInline: true,
      // Vídeo local é sempre mudo: o contrário produz microfonia imediata.
      muted: self,
    });
    this.video.setAttribute("playsinline", "");
    if (self && kind === "cam") this.video.classList.add("is-mirrored");

    this.avatarBox = el("div.tile__avatar", {}, [avatarEl(avatar, { title: name })]);

    this.netBox = el("div.tile__net", { dataset: { quality: "unknown" } }, [
      icon(QUALITY_ICON.unknown, { size: "sm", label: QUALITY_LABEL.unknown }),
    ]);

    this.micIcon = icon("mic", { size: "sm" });
    this.nameEl = el("span.truncate", { text: name });
    this.label = el("figcaption.tile__label", {}, [this.micIcon, this.nameEl]);

    this.actions = el("div.tile__actions");
    this.node.append(this.video, this.avatarBox, this.netBox, this.label, this.actions);

    this.setCamera(null);
  }

  /**
   * Volume deste participante, 0 a 150%. Vale para a voz e para o som da tela
   * dele — é a mesma pessoa, e separar os dois só confundiria.
   */
  addVolume({ value = 1, onChange, onToggle, name = "" }) {
    const wrap = el("div.vol");

    const btn = el("button.vol__btn", {
      type: "button",
      "aria-label": `Volume de ${name}`,
      dataset: { tip: "Silenciar", "tip-placement": "bottom" },
      onClick: (e) => {
        e.stopPropagation();
        onToggle();
      },
    });
    btn.append(icon("volume-2", { size: "sm" }));

    const slider = el("input.vol__slider", {
      type: "range",
      min: "0",
      max: "150",
      step: "5",
      value: String(Math.round(value * 100)),
      "aria-label": `Volume de ${name} em porcento`,
      onInput: (e) => onChange(Number(e.target.value) / 100),
      onClick: (e) => e.stopPropagation(),
      onPointerdown: (e) => e.stopPropagation(),
      onDblclick: (e) => e.stopPropagation(),
    });

    wrap.append(btn, slider);
    this.volumeEl = wrap;
    this.node.append(wrap);
    this.setVolume(value);
    return wrap;
  }

  setVolume(value) {
    if (!this.volumeEl) return;
    const pct = Math.round(value * 100);
    const slider = this.volumeEl.querySelector(".vol__slider");
    if (slider && document.activeElement !== slider) slider.value = String(pct);
    const btn = this.volumeEl.querySelector(".vol__btn");
    setIcon(btn.querySelector("svg"), pct === 0 ? "volume-x" : "volume-2");
    btn.classList.toggle("is-muted", pct === 0);
    btn.dataset.tip = pct === 0 ? "Ativar som" : `Silenciar · ${pct}%`;
    this.volumeEl.dataset.level = String(pct);
  }

  addAction({ iconName, label, onClick, pressed = null }) {
    const b = el("button.tile__action", {
      type: "button",
      "aria-label": label,
      dataset: { tip: label, "tip-placement": "bottom" },
      onClick: (e) => {
        e.stopPropagation();
        onClick(b);
      },
    });
    if (pressed !== null) b.setAttribute("aria-pressed", String(pressed));
    b.append(icon(iconName, { size: "sm" }));
    this.actions.append(b);
    return b;
  }

  /** Liga o <video> a um stream. */
  setStream(stream) {
    if (!stream) {
      this.video.srcObject = null;
      this.video.hidden = true;
      this.avatarBox.hidden = false;
      return;
    }
    if (this.video.srcObject !== stream) this.video.srcObject = stream;
    this.video.hidden = false;
    this.avatarBox.hidden = true;
    // Autoplay pode ser recusado; o catch evita uma promessa rejeitada solta.
    this.video.play?.().catch(() => {});
  }

  setCamera(stream) {
    if (this.kind !== "cam") return;
    this.setStream(stream);
  }

  setName(name) {
    this.nameEl.textContent = name;
  }

  setAvatarSpec(spec, name) {
    setAvatar(this.avatarBox.firstElementChild, spec);
    this.avatarBox.firstElementChild?.setAttribute("aria-label", `Avatar de ${name}`);
  }

  setMic(on) {
    setIcon(this.micIcon, on ? "mic" : "mic-off");
    this.micIcon.classList.toggle("icon--muted", !on);
  }

  setSpeaking(on) {
    if (this.kind !== "cam") return;
    this.node.classList.toggle("is-speaking", !!on);
  }

  /**
   * Intensidade da voz, 0 a 1. Alimenta a barrinha ao lado do nome: o contorno
   * diz "está falando", a barra diz "quanto" — e juntas tornam óbvio de quem é
   * a voz que se está ouvindo.
   */
  /**
   * Intensidade da voz, 0 a 1.
   *
   * Vira um equalizador de três barras ao lado do nome. A barra única anterior
   * dizia a mesma coisa, mas parecia uma barra de progresso — e "progresso" não
   * é o que uma voz tem. Três barras de alturas diferentes é a forma que todo
   * mundo já lê como som, e ocupa menos espaço.
   *
   * O valor sai daqui como número puro, sem unidade, e o CSS o usa em
   * `scaleY`. Isso importa para o consumo: `transform` e `opacity` são as duas
   * únicas propriedades que o navegador anima sem refazer layout nem pintura,
   * e esta função roda a cada quadro para cada participante.
   */
  setLevel(level) {
    if (this.kind !== "cam") return;
    if (!this.eqEl) {
      this.eqEl = el("span.tile__eq", { "aria-hidden": "true" }, [
        el("i"),
        el("i"),
        el("i"),
      ]);
      this.label.insertBefore(this.eqEl, this.nameEl);
    }
    // A voz normal ocupa uma fatia pequena do medidor; sem este ganho as
    // barras mal sairiam do lugar em quem fala baixo.
    const v = Math.min(1, level * 3.2);
    // O anel da marca gira na velocidade da voz: fala mais alto, gira mais
    // rápido; em silêncio ele para onde estava. É a voz desenhada, não um
    // pulso de relógio.
    if (v > 0.05) {
      this.spin = ((this.spin || 0) + 1.5 + v * 9) % 360;
      this.node.style.setProperty("--spin", `${this.spin.toFixed(1)}deg`);
    }
    if (Math.abs(v - (this.lastLevel || 0)) < 0.02) return; // evita escrita inútil
    this.lastLevel = v;
    this.node.style.setProperty("--lv", v.toFixed(2));
    this.eqEl.classList.toggle("is-live", v > 0.05);
  }

  setPinned(on) {
    this.pinned = on;
    this.node.classList.toggle("is-pinned", on);
  }

  setQuality(quality) {
    this.netBox.dataset.quality = quality;
    const svg = this.netBox.querySelector("svg.icon");
    setIcon(svg, QUALITY_ICON[quality] || QUALITY_ICON.unknown);
    svg?.querySelector("title")?.replaceChildren(QUALITY_LABEL[quality] || "");
  }

  setHand(up) {
    if (up && !this.handEl) {
      this.handEl = el("div.tile__hand", {}, [icon("hand", { size: "sm", label: "Mão levantada" })]);
      this.node.append(this.handEl);
    } else if (!up && this.handEl) {
      this.handEl.remove();
      this.handEl = null;
    }
  }

  setConnection(state) {
    const text = CONNECTION_TEXT[state];
    if (!text) {
      this.statusEl?.remove();
      this.statusEl = null;
      return;
    }
    if (!this.statusEl) {
      this.statusEl = el("div.tile__status");
      this.node.append(this.statusEl);
    }
    clear(this.statusEl);
    const spinning = state === "connecting" || state === "new" || state === "restarting";
    this.statusEl.append(
      icon(spinning ? "spinner" : "wifi-off", { size: "lg", className: spinning ? "icon--spin" : "" }),
      el("span", { text }),
    );
  }

  /** Mostra uma reação flutuante sobre o ladrilho. */
  react(iconName) {
    const node = el("div.reaction-float", {}, [icon(iconName, { size: "xl" })]);
    this.node.append(node);
    node.addEventListener("animationend", () => node.remove(), { once: true });
    burst(this.node);
  }

  destroy() {
    this.video.srcObject = null;
    this.node.remove();
  }
}

export class Stage {
  /** @type {Map<string, Tile>} */ tiles = new Map();
  layout = "auto"; // "auto" | "grid"
  pinnedId = null;
  activeSpeaker = null;
  /** O quadro branco ocupa o destaque; os vídeos vão para a faixa lateral. */
  boardActive = false;

  constructor({ root, gridEl, spotlightEl, onPin }) {
    this.root = root;
    this.grid = gridEl;
    this.spotlight = spotlightEl;
    this.onPin = onPin || (() => {});
  }

  /* ---------------------------------------------------------------- */

  tileId(peerId, kind) {
    return `${peerId}:${kind}`;
  }

  ensure(peerId, kind, { name, avatar, self = false }) {
    const id = this.tileId(peerId, kind);
    let tile = this.tiles.get(id);
    if (tile) return tile;

    tile = new Tile({ id, peerId, kind, name, avatar, self });

    tile.addAction({
      iconName: "pin",
      label: "Fixar na tela",
      pressed: false,
      onClick: () => this.togglePin(id),
    });
    tile.addAction({
      iconName: "maximize-2",
      label: "Tela cheia",
      onClick: () => this.fullscreen(id),
    });

    // Janela flutuante: o vídeo continua visível por cima de outros programas
    // enquanto a pessoa trabalha fora do navegador. O Firefox tem o recurso,
    // mas só pelo controle nativo dele, então o botão não aparece lá.
    if (document.pictureInPictureEnabled) {
      tile.addAction({
        iconName: "panel-right-open",
        label: "Janela flutuante",
        onClick: () => this.pictureInPicture(id),
      });
    }

    tile.node.addEventListener("dblclick", () => this.togglePin(id));

    this.tiles.set(id, tile);
    this.relayout();
    return tile;
  }

  get(peerId, kind) {
    return this.tiles.get(this.tileId(peerId, kind));
  }

  remove(peerId, kind) {
    const id = this.tileId(peerId, kind);
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.destroy();
    this.tiles.delete(id);
    if (this.pinnedId === id) this.pinnedId = null;
    this.relayout();
  }

  removePeer(peerId) {
    for (const kind of ["cam", "screen"]) this.remove(peerId, kind);
  }

  /* ---------------------------------------------------------------- */

  togglePin(id) {
    this.pinnedId = this.pinnedId === id ? null : id;
    for (const [tid, tile] of this.tiles) {
      tile.setPinned(tid === this.pinnedId);
      const btn = tile.actions.firstElementChild;
      if (btn) {
        btn.setAttribute("aria-pressed", String(tid === this.pinnedId));
        setIcon(btn.querySelector("svg"), tid === this.pinnedId ? "pin-off" : "pin");
        btn.dataset.tip = tid === this.pinnedId ? "Desafixar" : "Fixar na tela";
      }
    }
    this.onPin(this.pinnedId);
    this.relayout();
    return this.pinnedId;
  }

  fullscreen(id) {
    const tile = this.tiles.get(id);
    if (!tile) return;
    const node = tile.node;
    const isFull = document.fullscreenElement === node || document.webkitFullscreenElement === node;
    if (isFull) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    else (node.requestFullscreen || node.webkitRequestFullscreen)?.call(node)?.catch?.(() => {});
  }

  async pictureInPicture(id) {
    const tile = this.tiles.get(id);
    if (!tile || !document.pictureInPictureEnabled || tile.video.hidden) return false;
    try {
      if (document.pictureInPictureElement === tile.video) {
        await document.exitPictureInPicture();
        return false;
      }
      await tile.video.requestPictureInPicture();
      return true;
    } catch {
      // Sem faixa de vídeo ainda, ou o usuário fechou a janela: não é erro.
      return false;
    }
  }

  /**
   * O ladrilho em destaque agora. É o que a gravação precisa saber para gravar
   * "o que está sendo visto" sem ter de repetir aqui a regra de destaque.
   */
  featured() {
    const id = this.#featured();
    return (id && this.tiles.get(id)) || null;
  }

  setLayout(mode) {
    this.layout = mode;
    this.relayout();
    return this.layout;
  }

  setActiveSpeaker(peerId) {
    this.activeSpeaker = peerId;
    if (this.layout === "auto" && !this.pinnedId) this.relayout();
  }

  /** Quem deve ocupar o destaque agora — ou null para grade igualitária. */
  #featured() {
    if (this.pinnedId && this.tiles.has(this.pinnedId)) return this.pinnedId;
    if (this.layout === "grid") return null;

    // Uma tela compartilhada é quase sempre o motivo da reunião.
    for (const [id, tile] of this.tiles) {
      if (tile.kind === "screen") return id;
    }

    // Com muita gente, destacar quem fala evita miniaturas ilegíveis.
    if (this.tiles.size > 4 && this.activeSpeaker) {
      const id = this.tileId(this.activeSpeaker, "cam");
      if (this.tiles.has(id)) return id;
    }
    return null;
  }

  /**
   * O quadro branco entra no lugar do destaque, e não por cima de tudo: quem
   * desenha continua vendo quem está falando na faixa ao lado.
   */
  setBoard(active) {
    this.boardActive = active;
    this.relayout();
    return active;
  }

  /** Reorganiza deslizando: cada ladrilho parte de onde estava. */
  relayout() {
    flip(() => [...this.tiles.values()].map((t) => t.node), () => this.#relayout());
  }

  #relayout() {
    const featured = this.boardActive ? null : this.#featured();
    const isSpotlight = !!featured || this.boardActive;

    this.root.classList.toggle("stage--spotlight", isSpotlight);
    this.spotlight.hidden = !isSpotlight;

    const ordered = [...this.tiles.values()].sort((a, b) => {
      // Telas primeiro, depois o próprio usuário por último na faixa.
      if (a.kind !== b.kind) return a.kind === "screen" ? -1 : 1;
      if (a.self !== b.self) return a.self ? 1 : -1;
      return 0;
    });

    for (const tile of ordered) {
      const target = tile.id === featured ? this.spotlight : this.grid;
      if (tile.node.parentElement !== target) target.append(tile.node);
    }

    const gridCount = ordered.length - (featured ? 1 : 0);
    this.grid.dataset.count = String(Math.max(0, gridCount));
    // Degrau de enxugamento do ladrilho (fonte menor, sem barra de volume).
    // Em degraus, e não contínuo, para não mudar a cada pessoa que entra.
    this.grid.dataset.size =
      gridCount > 12 ? "xl" : gridCount > 8 ? "lg" : gridCount > 4 ? "md" : "sm";
    this.grid.hidden = gridCount === 0;
    this.#fitColumns(gridCount);
  }

  /**
   * Escolhe quantas colunas a grade terá.
   *
   * `auto-fit` com uma largura mínima fixa parecia resolver, mas ele só olha
   * para a largura: com dezesseis pessoas numa tela larga ele fazia onze
   * colunas e duas linhas, e cada ladrilho saía 111×276 — um retrato estreito,
   * a pior forma possível para vídeo, que é deitado. A conta certa envolve a
   * proporção do espaço disponível: procura-se o número de colunas que deixa
   * cada ladrilho mais perto de 16:9.
   */
  #fitColumns(count) {
    if (!count) return;
    const r = this.grid.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.grid.style.setProperty("--cols", String(bestColumns(count, r.width, r.height)));
  }

  clearAll() {
    for (const tile of this.tiles.values()) tile.destroy();
    this.tiles.clear();
    this.pinnedId = null;
    clear(this.grid);
    clear(this.spotlight);
  }
}

/** Peso de cada espaço vazio na última fileira, contra o erro de proporção. */
const RAGGED_PENALTY = 0.03;

/**
 * Quantas colunas deixam os ladrilhos mais perto de 16:9.
 *
 * Duas coisas entram na conta:
 *
 * 1. O erro de proporção, medido em logaritmo para ser simétrico — um ladrilho
 *    duas vezes largo demais é tão ruim quanto um duas vezes alto demais, e
 *    uma diferença linear trataria os dois casos de forma desigual.
 *
 * 2. As sobras na última fileira. Só a proporção escolheria cinco colunas para
 *    dezesseis pessoas: as vagas ficam 5+5+5+1, com um ladrilho solitário
 *    embaixo. Quatro por quatro fecha certo e é o que se espera de uma grade.
 */
export function bestColumns(count, width, height, aspect = 16 / 9) {
  if (!count || width <= 0 || height <= 0) return 1;
  let melhor = 1;
  let menorErro = Infinity;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const proporcao = Math.abs(Math.log(width / cols / (height / rows) / aspect));
    const erro = proporcao + (cols * rows - count) * RAGGED_PENALTY;
    if (erro < menorErro) {
      menorErro = erro;
      melhor = cols;
    }
  }
  return melhor;
}
