/**
 * ui/lobby.js — a antessala.
 *
 * Existe por um motivo prático: ninguém deveria descobrir que está com a
 * câmera apontada para o teto ou com o microfone errado depois de entrar. Aqui
 * a pessoa se vê, escolhe dispositivo, nome e avatar, e só então entra.
 */
import { el, icon, clear, setIcon, $ } from "../lib/dom.js";
import { avatarEl, sampleAvatars, STYLE_LABELS, defaultAvatar, isPhoto } from "./avatars.js";
import { preparePhoto, ACCEPTED } from "./photo.js";
import { prefs, randomSeed, env } from "../lib/util.js";
import { describeMediaError } from "../core/media.js";
import { toast } from "./toast.js";

export class Lobby {
  constructor({ media, theme, onJoin }) {
    this.media = media;
    this.theme = theme;
    this.onJoin = onJoin;

    this.name = prefs.get("name", "");
    this.avatar = prefs.get("avatar", null) || defaultAvatar();
    this.node = null;
  }

  mount(root, { isGuest }) {
    this.node = $(".lobby", root);
    this.video = $("#lobbyVideo");
    this.placeholder = $("#lobbyPlaceholder");
    this.nameInput = $("#nameInput");
    this.joinBtn = $("#joinBtn");
    this.micBtn = $("#lobbyMic");
    this.camBtn = $("#lobbyCam");
    this.shuffleBtn = $("#avatarShuffle");
    this.photoBtn = $("#avatarPhoto");
    this.photoInput = $("#avatarPhotoInput");
    this.avatarGrid = $("#avatarGrid");
    this.deviceRow = $("#lobbyDevices");
    this.hint = $("#lobbyHint");

    this.nameInput.value = this.name;
    this.joinBtn.querySelector("span").textContent = isGuest ? "Entrar na sala" : "Criar sala";

    this.#renderAvatars();
    this.#renderPlaceholder();
    this.#bind();
    this.#startPreview();

    if (!env.isSecure) {
      this.hint.hidden = false;
      clear(this.hint).append(
        icon("alert-triangle", { size: "sm" }),
        el("span", {
          text: "Câmera e microfone só funcionam em HTTPS ou em localhost.",
        }),
      );
    }
    return this.node;
  }

  #bind() {
    this.nameInput.addEventListener("input", () => {
      this.name = this.nameInput.value.slice(0, 32);
      this.joinBtn.disabled = !this.name.trim();
    });
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.name.trim()) this.#join();
    });
    this.joinBtn.addEventListener("click", () => this.#join());
    this.joinBtn.disabled = !this.name.trim();

    this.micBtn.addEventListener("click", () => {
      const on = this.media.toggleMic();
      this.#syncMic(on);
    });
    this.camBtn.addEventListener("click", async () => {
      const on = await this.media.toggleCam();
      this.#syncCam(on);
    });
    this.shuffleBtn.addEventListener("click", () => {
      const style = isPhoto(this.avatar) ? prefs.get("avatar:style", null) : this.avatar.style;
      this.avatar = { style: style || defaultAvatar().style, seed: randomSeed() };
      this.#renderAvatars();
      this.#renderPlaceholder();
    });

    this.photoInput.accept = ACCEPTED;
    this.photoBtn.addEventListener("click", () => this.photoInput.click());
    this.photoInput.addEventListener("change", () => this.#usePhoto(this.photoInput.files?.[0]));

    // Arrastar a foto para cima da prévia também funciona.
    for (const type of ["dragover", "drop"]) {
      this.node.addEventListener(type, (e) => {
        e.preventDefault();
        if (type === "drop") this.#usePhoto(e.dataTransfer?.files?.[0]);
      });
    }

    this.media.on("change", () => {
      this.#attachPreview();
      this.#syncMic(this.media.micEnabled);
      this.#syncCam(this.media.camEnabled);
    });
    this.media.on("devices", () => this.#renderDevices());
    this.media.on("error", ({ kind, err }) => toast(describeMediaError(err, kind), { tone: "warn" }));
  }

  async #startPreview() {
    const result = await this.media.start({ audio: true, video: true });
    for (const { kind, err } of result.errors) {
      toast(describeMediaError(err, kind), { tone: "warn", key: `media-${kind}` });
    }
    this.#attachPreview();
    this.#syncMic(this.media.micEnabled);
    this.#syncCam(this.media.camEnabled);
    this.#renderDevices();
  }

  #attachPreview() {
    const has = this.media.camEnabled;
    this.video.hidden = !has;
    this.placeholder.hidden = has;
    if (has) {
      if (this.video.srcObject !== this.media.stream) this.video.srcObject = this.media.stream;
      this.video.play?.().catch(() => {});
    } else {
      this.video.srcObject = null;
    }
  }

  #renderPlaceholder() {
    clear(this.placeholder).append(
      avatarEl(this.avatar, { title: "Seu avatar" }),
      el("p.muted", { text: "Câmera desligada" }),
    );
  }

  #syncMic(on) {
    this.micBtn.setAttribute("aria-pressed", String(on));
    this.micBtn.setAttribute("aria-label", on ? "Desligar microfone" : "Ligar microfone");
    this.micBtn.dataset.tip = on ? "Microfone ligado" : "Microfone mudo";
    setIcon(this.micBtn.querySelector("svg.icon"), on ? "mic" : "mic-off");
  }

  #syncCam(on) {
    this.camBtn.setAttribute("aria-pressed", String(on));
    this.camBtn.setAttribute("aria-label", on ? "Desligar câmera" : "Ligar câmera");
    this.camBtn.dataset.tip = on ? "Câmera ligada" : "Câmera desligada";
    setIcon(this.camBtn.querySelector("svg.icon"), on ? "video" : "video-off");
  }

  async #usePhoto(file) {
    if (!file) return;
    try {
      const { photo, bytes } = await preparePhoto(file);
      if (this.avatar.style) prefs.set("avatar:style", this.avatar.style);
      this.avatar = { photo };
      this.#renderAvatars();
      this.#renderPlaceholder();
      toast(`Foto definida (${Math.round(bytes / 1024)} kB)`, { tone: "ok", ms: 2200 });
    } catch (err) {
      toast(err.message || "Não foi possível usar essa imagem.", { tone: "warn" });
    } finally {
      this.photoInput.value = "";
    }
  }

  /* ---------------------------------------------------------------- */

  #renderAvatars() {
    clear(this.avatarGrid);
    const usingPhoto = isPhoto(this.avatar);
    const seed = usingPhoto ? prefs.get("avatar:seed", null) || randomSeed() : this.avatar.seed;
    prefs.set("avatar:seed", seed);

    if (usingPhoto) {
      const b = el("button.avatarPicker__option", {
        type: "button",
        role: "radio",
        "aria-checked": "true",
        "aria-label": "Sua foto",
        dataset: { tip: "Sua foto", "tip-placement": "bottom" },
        onClick: () => this.photoInput.click(),
      });
      b.append(avatarEl(this.avatar, { title: "Sua foto" }));
      this.avatarGrid.append(b);
    }

    for (const spec of sampleAvatars(seed)) {
      const b = el("button.avatarPicker__option", {
        type: "button",
        role: "radio",
        "aria-checked": String(!usingPhoto && spec.style === this.avatar.style),
        "aria-label": STYLE_LABELS[spec.style] || spec.style,
        dataset: { tip: STYLE_LABELS[spec.style] || spec.style, "tip-placement": "bottom" },
        onClick: () => {
          this.avatar = { ...spec };
          this.#renderAvatars();
          this.#renderPlaceholder();
        },
      });
      b.append(avatarEl(spec, { title: STYLE_LABELS[spec.style] || spec.style }));
      this.avatarGrid.append(b);
    }
  }

  #renderDevices() {
    const { audioinput, videoinput } = this.media.devices;
    clear(this.deviceRow);
    if (!audioinput.length && !videoinput.length) return;

    const select = (kind, list, iconName, label) => {
      if (list.length < 2) return null;
      const sel = el("select.input", { "aria-label": label, style: { minHeight: "38px", paddingInline: "8px" } });
      for (const d of list) {
        sel.append(
          el("option", {
            value: d.deviceId,
            text: d.label || `${label} ${sel.childElementCount + 1}`,
            selected: this.media.selected[kind] === d.deviceId,
          }),
        );
      }
      sel.addEventListener("change", () => this.media.selectDevice(kind, sel.value));
      return el("label.row.row--tight", { style: { flex: "1", minWidth: "0" } }, [
        icon(iconName, { size: "sm" }),
        sel,
      ]);
    };

    const mic = select("audioinput", audioinput, "mic", "Microfone");
    const cam = select("videoinput", videoinput, "video", "Câmera");
    if (mic) this.deviceRow.append(mic);
    if (cam) this.deviceRow.append(cam);
  }

  /* ---------------------------------------------------------------- */

  #join() {
    const name = this.name.trim();
    if (!name) {
      this.nameInput.focus();
      return;
    }
    prefs.set("name", name);
    prefs.set("avatar", this.avatar);
    this.joinBtn.disabled = true;
    this.onJoin({ name, avatar: this.avatar });
  }

  hide() {
    if (this.node) this.node.hidden = true;
    this.video.srcObject = null;
  }
}
