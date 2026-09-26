/**
 * ui/toast.js — avisos passageiros e um chime discreto.
 */
import { el, icon, $ } from "../lib/dom.js";

const ICONS = { ok: "check", warn: "alert-triangle", danger: "alert-triangle", info: "info" };
const DEFAULT_MS = 4200;

let host = null;
const active = new Map(); // chave -> nó, para não empilhar o mesmo aviso

function ensureHost() {
  if (host?.isConnected) return host;
  host = $(".toasts") || el("div.toasts", { role: "status", "aria-live": "polite" });
  if (!host.isConnected) document.body.append(host);
  return host;
}

/**
 * @param {string} message
 * @param {{ tone?: "ok"|"warn"|"danger"|"info", ms?: number, key?: string, action?: {label:string,onClick:Function} }} opts
 */
export function toast(message, { tone = "info", ms = DEFAULT_MS, key = null, action = null } = {}) {
  const parent = ensureHost();
  const id = key || message;

  const existing = active.get(id);
  if (existing) {
    existing.node.remove();
    clearTimeout(existing.timer);
  }

  const node = el("div.toast", { dataset: { tone } }, [
    icon(ICONS[tone] || "info", { size: "sm" }),
    el("span", { text: message }),
  ]);

  if (action) {
    node.append(
      el("button.btn.btn--ghost", {
        text: action.label,
        style: { minHeight: "28px", padding: "0 10px", marginLeft: "auto" },
        onClick: () => {
          action.onClick();
          dismiss();
        },
      }),
    );
  }

  parent.append(node);

  const dismiss = () => {
    node.classList.add("is-leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
    active.delete(id);
  };

  const timer = setTimeout(dismiss, ms);
  active.set(id, { node, timer });
  node.addEventListener("click", () => {
    if (!action) {
      clearTimeout(timer);
      dismiss();
    }
  });

  return dismiss;
}

/* ------------------------------------------------------------------ *
 * Sons
 * ------------------------------------------------------------------ */

let audioCtx = null;

function ctx() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Dois tons curtos: subindo para "entrou", descendo para "saiu". */
export function chime(kind = "join") {
  const c = ctx();
  if (!c) return;
  const notes = kind === "leave" ? [660, 494] : [523, 784];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t0 = c.currentTime + i * 0.09;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  });
}
