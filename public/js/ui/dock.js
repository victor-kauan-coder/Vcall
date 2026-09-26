/**
 * ui/dock.js — a barra de controles da chamada.
 *
 * Cada botão é declarado uma vez, com rótulo, atalho e estado. Isso mantém a
 * dica flutuante, o `aria-label` e o atalho de teclado sempre sincronizados
 * com o que o botão realmente faz.
 */
import { el, icon, setIcon, on } from "../lib/dom.js";

export const REACTIONS = [
  { kind: "like", icon: "check", label: "Concordo" },
  { kind: "clap", icon: "sparkles", label: "Aplausos" },
  { kind: "heart", icon: "zap", label: "Boa!" },
  { kind: "laugh", icon: "smile", label: "Risos" },
  { kind: "question", icon: "circle-help", label: "Dúvida" },
];

export class Dock {
  buttons = new Map();
  #popover = null;
  #popoverOwner = null;

  constructor(node) {
    this.node = node;
    on(document, "click", (e) => {
      if (this.#popover && !this.#popover.contains(e.target) && e.target !== this.#popoverOwner) {
        this.closePopover();
      }
    });
    on(document, "keydown", (e) => {
      if (e.key === "Escape") this.closePopover();
    });
  }

  group() {
    const g = el("div.dock__group");
    this.node.append(g);
    return g;
  }

  /**
   * @param {object} spec
   * @param {string} spec.id
   * @param {string} spec.icon
   * @param {string} spec.label
   * @param {string} [spec.shortcut] tecla mostrada na dica
   * @param {"toggle"|"action"} [spec.kind]
   * @param {boolean} [spec.on] estado inicial de um toggle
   */
  add(group, spec) {
    const b = el("button.ctrl", {
      type: "button",
      class: spec.className || "",
      "aria-label": spec.label,
      dataset: { tip: spec.shortcut ? `${spec.label} · ${spec.shortcut}` : spec.label, id: spec.id },
      onClick: (e) => {
        e.stopPropagation();
        spec.onClick?.(b);
      },
    });
    b.append(icon(spec.icon, { size: "lg" }));
    if (spec.kind === "toggle") b.setAttribute("aria-pressed", String(spec.on ?? true));
    group.append(b);
    this.buttons.set(spec.id, { node: b, spec });
    return b;
  }

  /** Atualiza estado, ícone e rótulo de um botão de uma vez só. */
  update(id, { on: isOn, active, iconName, label, badge } = {}) {
    const entry = this.buttons.get(id);
    if (!entry) return;
    const { node } = entry;
    if (isOn !== undefined) node.setAttribute("aria-pressed", String(isOn));
    if (active !== undefined) node.dataset.active = String(active);
    if (iconName) setIcon(node.querySelector("svg.icon"), iconName);
    if (label) {
      node.setAttribute("aria-label", label);
      node.dataset.tip = entry.spec.shortcut ? `${label} · ${entry.spec.shortcut}` : label;
    }
    if (badge !== undefined) {
      let dot = node.querySelector(".ctrl__dot");
      if (badge) {
        if (!dot) {
          dot = el("span.ctrl__dot");
          node.append(dot);
        }
        dot.textContent = badge > 9 ? "9+" : String(badge);
      } else dot?.remove();
    }
  }

  get(id) {
    return this.buttons.get(id)?.node || null;
  }

  /* ---------------------------------------------------------------- *
   * Menus
   * ---------------------------------------------------------------- */

  openPopover(ownerId, build, { className = "" } = {}) {
    const owner = this.get(ownerId);
    if (!owner) return null;
    if (this.#popoverOwner === owner) return this.closePopover();

    this.closePopover();
    const pop = el("div.popover", { class: className, role: "menu" });
    build(pop, () => this.closePopover());

    // Ancorado ao grupo do botão, para não sair da tela em telas estreitas.
    owner.parentElement.style.position = "relative";
    owner.parentElement.append(pop);

    const ownerRect = owner.getBoundingClientRect();
    const parentRect = owner.parentElement.getBoundingClientRect();
    pop.style.left = `${ownerRect.left - parentRect.left + ownerRect.width / 2}px`;

    this.#popover = pop;
    this.#popoverOwner = owner;
    return pop;
  }

  closePopover() {
    this.#popover?.remove();
    this.#popover = null;
    this.#popoverOwner = null;
    return null;
  }

  static item({ iconName, label, onClick, checked = null, hint = "" }) {
    const b = el("button.popover__item", {
      type: "button",
      role: checked === null ? "menuitem" : "menuitemradio",
      onClick,
    });
    if (checked !== null) b.setAttribute("aria-checked", String(checked));
    b.append(icon(iconName, { size: "sm" }), el("span.truncate", { text: label }));
    if (hint) b.append(el("span.spacer"), el("span.muted", { text: hint, style: { fontSize: "11px" } }));
    return b;
  }
}
