/**
 * src/logger.js — log estruturado mínimo, sem dependências.
 * Nunca registra conteúdo de mídia, chat ou identificadores de sala completos.
 */
import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (config.dev ? LEVELS.debug : LEVELS.info);

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(config.dev ? prettify(line) : `${JSON.stringify(line)}\n`);
}

const COLOR = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
function prettify({ t, level, msg, ...rest }) {
  const extra = Object.keys(rest).length ? ` \x1b[90m${JSON.stringify(rest)}\x1b[0m` : "";
  return `${COLOR[level]}${level.padEnd(5)}\x1b[0m ${t.slice(11, 19)} ${msg}${extra}\n`;
}

export const log = {
  debug: (m, f) => emit("debug", m, f),
  info: (m, f) => emit("info", m, f),
  warn: (m, f) => emit("warn", m, f),
  error: (m, f) => emit("error", m, f),
};

/** Salas são segredos compartilháveis: nos logs só aparece um prefixo. */
export const redactRoom = (id) => (typeof id === "string" ? `${id.slice(0, 6)}…` : "?");
