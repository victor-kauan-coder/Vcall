/**
 * lib/util.js — formatação, preferências locais e pequenos utilitários.
 */

/* ---------------- preferências ---------------- */

const NS = "vcall:";

/**
 * localStorage pode lançar (modo privado, cookies bloqueados) e pode voltar
 * vazio. Guardamos aqui só conveniências por navegador: nome, avatar, tema,
 * dispositivo preferido. Nada que a chamada dependa para funcionar.
 */
export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      /* sem persistência: o app continua funcionando */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(NS + key);
    } catch {
      /* idem */
    }
  },
};

/* ---------------- formatação ---------------- */

const nf = (min, max = min) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const nf0 = nf(0);
const nf1 = nf(0, 1);

export function formatBitrate(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  if (bps >= 1e6) return `${nf1.format(bps / 1e6)} Mb/s`;
  if (bps >= 1e3) return `${nf0.format(bps / 1e3)} kb/s`;
  return `${nf0.format(bps)} b/s`;
}

export function formatBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(b) / 3));
  return `${nf1.format(b / 1000 ** i)} ${units[i]}`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return "—";
  return `${nf0.format(ms)} ms`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const formatClock = (ts) =>
  new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/* ---------------- identificadores ---------------- */

/** Segredo de sala: 128 bits em base64url. Nunca derivado do nome. */
export function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isRoomId = (v) => typeof v === "string" && ROOM_RE.test(v);

/** Semente estável para o avatar, quando o usuário não escolheu uma. */
export function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------------- tempo ---------------- */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera com jitter total — evita que todos os pares tentem ao mesmo tempo. */
export const jitter = (ms) => sleep(ms * (0.5 + Math.random() * 0.5));

export function throttle(fn, ms) {
  let last = 0;
  let pending = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(
        () => {
          pending = null;
          last = performance.now();
          fn(...args);
        },
        ms - (now - last),
      );
    }
  };
}

export function debounce(fn, ms) {
  let id = 0;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- números ---------------- */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Média móvel exponencial — suaviza métricas sem guardar histórico. */
export class Ema {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.value = null;
  }
  push(v) {
    if (!Number.isFinite(v)) return this.value;
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }
}

/* ---------------- texto ---------------- */

/**
 * Renderiza texto de chat com links clicáveis, montando nós — nunca
 * concatenando HTML. Isto é o que impede injeção via mensagem.
 */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const a = document.createElement("a");
    a.href = m[0];
    a.textContent = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    frag.append(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* ---------------- ambiente ---------------- */

export const env = {
  get isSecure() {
    return window.isSecureContext;
  },
  get canShareScreen() {
    return typeof navigator.mediaDevices?.getDisplayMedia === "function";
  },
  get canFullscreen() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  },
  get isTouch() {
    return matchMedia("(pointer: coarse)").matches;
  },
  get isFirefox() {
    return /firefox/i.test(navigator.userAgent);
  },
  get isSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  },
  /** Número de encoders simultâneos que a máquina aguenta sem sofrer. */
  get hardwareConcurrency() {
    return navigator.hardwareConcurrency || 4;
  },
};
