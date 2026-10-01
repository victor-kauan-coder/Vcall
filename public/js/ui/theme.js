/**
 * ui/theme.js — tema claro/escuro.
 *
 * Três estados: "dark", "light" e "system". Sem escolha explícita, seguimos a
 * preferência do sistema operacional e reagimos quando ela muda no meio da
 * sessão (o modo noturno automático do macOS e do Windows faz isso).
 */
import { prefs } from "../lib/util.js";
import { setIcon } from "../lib/dom.js";
import { PALETAS, PADRAO } from "./paletas.js";

const KEY = "theme";
const KEY_PALETA = "paleta";
const ORDER = ["system", "light", "dark"];
const ICON = { system: "laptop", light: "sun", dark: "moon" };
const LABEL = { system: "Tema do sistema", light: "Tema claro", dark: "Tema escuro" };

const media = matchMedia("(prefers-color-scheme: light)");

export class Theme {
  constructor() {
    this.mode = prefs.get(KEY, "system");
    this.paleta = PALETAS.some((p) => p.id === prefs.get(KEY_PALETA, PADRAO))
      ? prefs.get(KEY_PALETA, PADRAO)
      : PADRAO;
    media.addEventListener("change", () => {
      if (this.mode === "system") this.#apply();
    });
    this.#apply();
  }

  get resolved() {
    if (this.mode !== "system") return this.mode;
    return media.matches ? "light" : "dark";
  }

  set(mode) {
    this.mode = ORDER.includes(mode) ? mode : "system";
    prefs.set(KEY, this.mode);
    this.#apply();
    return this.mode;
  }

  cycle() {
    return this.set(ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length]);
  }

  /**
   * Troca a paleta de cores.
   *
   * A paleta é ortogonal ao tema: "Ametista claro" e "Ametista escuro" são a
   * mesma paleta vista com duas luzes. Por isso são duas preferências
   * separadas, e não uma lista de dez combinações.
   */
  setPaleta(id) {
    this.paleta = PALETAS.some((p) => p.id === id) ? id : PADRAO;
    prefs.set(KEY_PALETA, this.paleta);
    this.#apply();
    return this.paleta;
  }

  label() {
    return LABEL[this.mode];
  }

  iconName() {
    return ICON[this.mode];
  }

  /** Mantém um botão sincronizado com o tema atual. */
  bindButton(button) {
    const sync = () => {
      const svg = button.querySelector("svg.icon");
      if (svg) setIcon(svg, this.iconName());
      button.setAttribute("aria-label", this.label());
      button.dataset.tip = this.label();
    };
    button.addEventListener("click", () => {
      this.cycle();
      sync();
    });
    sync();
    return sync;
  }

  #apply() {
    const root = document.documentElement;
    if (this.mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", this.mode);
    root.setAttribute("data-paleta", this.paleta);

    /*
     * A cor da barra do navegador em celular acompanha o tema E a paleta.
     * Lida do CSS já aplicado em vez de uma tabela à parte: uma tabela ficaria
     * desatualizada na primeira vez que alguém mexesse numa paleta.
     */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const fundo = getComputedStyle(root).getPropertyValue("--bg").trim();
      meta.setAttribute("content", fundo || (this.resolved === "light" ? "#f5f6f9" : "#0c0e13"));
    }

    document.dispatchEvent(new CustomEvent("themechange", { detail: this.resolved }));
  }
}
