/**
 * src/protocol.js — contrato de sinalização.
 *
 * O servidor é um roteador burro: ele não entende SDP nem ICE, só garante que
 * cada mensagem tem a forma certa, cabe nos limites e vai para alguém da mesma
 * sala. Toda validação fica concentrada aqui para que o resto do servidor possa
 * confiar cegamente nos objetos que recebe.
 */
import { config } from "./config.js";

const L = config.limits;

/** Cliente -> servidor */
export const C2S = Object.freeze({
  JOIN: "join",
  SIGNAL: "signal",
  PROFILE: "profile",
  CHAT: "chat",
  STATE: "state",
  REACTION: "reaction",
  BOARD: "board",
  /** Estado de voz (VAD). Caminho normal é o DataChannel; isto é o plano B. */
  AUDIO: "audio",
  /** Pede o diretório de salas públicas (usado pelo painel inicial). */
  LIST_ROOMS: "list-rooms",
  /** Ação do anfitrião: silenciar, desligar câmera, remover, trancar. */
  MODERATE: "moderate",
  LEAVE: "leave",
  PING: "ping",
});

/** Servidor -> cliente */
export const S2C = Object.freeze({
  WELCOME: "welcome",
  PEER_JOIN: "peer-join",
  PEER_LEAVE: "peer-leave",
  SIGNAL: "signal",
  PROFILE: "profile",
  CHAT: "chat",
  STATE: "state",
  REACTION: "reaction",
  BOARD: "board",
  AUDIO: "audio",
  ROOMS: "rooms",
  /** Uma ação do anfitrião chegou até você (ou um aviso para a sala). */
  MODERATED: "moderated",
  /** Quem é o anfitrião agora. */
  HOST: "host",
  /** A sala foi trancada ou destrancada pelo anfitrião. */
  ROOM: "room",
  /** Você está na sala de espera: o anfitrião decide se entra. */
  WAITING: "waiting",
  /** (Para o anfitrião) alguém bateu à porta / desistiu de esperar. */
  KNOCK: "knock",
  KNOCK_GONE: "knock-gone",
  ERROR: "error",
  PONG: "pong",
});

export const ERRORS = Object.freeze({
  BAD_ROOM: "bad-room",
  ROOM_FULL: "room-full",
  ALREADY_JOINED: "already-joined",
  NOT_JOINED: "not-joined",
  RATE_LIMITED: "rate-limited",
  MALFORMED: "malformed",
  TOO_LARGE: "too-large",
  BAD_PASSWORD: "bad-password",
  /** O anfitrião removeu você desta sala. */
  KICKED: "kicked",
  /** O anfitrião trancou a sala: ninguém novo entra. */
  ROOM_LOCKED: "room-locked",
  /** Ação de moderação pedida por quem não é o anfitrião. */
  NOT_HOST: "not-host",
});

/** Ações que só o anfitrião pode pedir. */
export const MOD_ACTIONS = new Set([
  "mute",
  "mute-all",
  "cam-off",
  "kick",
  "lock",
  "unlock",
  "lower-hand",
  "admit",
  "deny",
]);
/** As que miram uma pessoa específica. */
const MOD_TARGETED = new Set(["mute", "cam-off", "kick", "lower-hand", "admit", "deny"]);

/** IDs de sala são segredos de 22+ caracteres gerados no cliente. */
const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isRoomId = (v) => typeof v === "string" && ROOM_RE.test(v);

/**
 * Segredos gerados no cliente: chave de anfitrião, sessão da aba e aparelho.
 * Só letras, números, `_` e `-`; tamanho fixo o bastante para não ser
 * adivinhado. Qualquer outra coisa vira "não informado".
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const token = (v) => (typeof v === "string" && TOKEN_RE.test(v) ? v : "");

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max).trim() : "";

/**
 * Avatares são especificações, não imagens: {style, seed}. O cliente renderiza
 * o SVG localmente com o DiceBear, então nenhum base64 trafega pelo servidor.
 */
const AVATAR_STYLE_RE = /^[A-Za-z]{2,32}$/;

/**
 * Fotos enviadas pelo usuário chegam como data URL. O cliente já reduz para
 * 256×256 antes de mandar; o limite aqui é a rede de proteção contra um
 * cliente modificado. Só formatos de imagem conhecidos, e nada de SVG — SVG
 * é um documento que pode conter script.
 */
const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function normalizeAvatar(a) {
  if (!a || typeof a !== "object") return null;

  // Foto enviada pelo usuário.
  if (typeof a.photo === "string") {
    const photo = a.photo.trim();
    if (photo.length > L.avatarPhoto || !PHOTO_RE.test(photo)) return null;
    return { photo };
  }

  // Avatar gerado: só a receita trafega, e o desenho acontece no navegador.
  const style = typeof a.style === "string" && AVATAR_STYLE_RE.test(a.style) ? a.style : null;
  if (!style) return null;
  const seed = clean(a.seed, 64) || "vcall";
  return { style, seed };
}

export function normalizeProfile(p) {
  const name = clean(p?.name, L.displayName) || "Convidado";
  return { name, avatar: normalizeAvatar(p?.avatar) };
}

/** Estado publicado de um participante (o que os outros precisam desenhar). */
export function normalizeState(s) {
  return {
    mic: !!s?.mic,
    cam: !!s?.cam,
    screen: !!s?.screen,
    hand: !!s?.hand,
    board: !!s?.board,
  };
}

/**
 * Metadados de sala, enviados por quem cria.
 *
 * Só o que o painel inicial precisa mostrar. `pass` nunca é guardada em claro
 * nem devolvida a ninguém — o registro de salas a converte em hash na hora.
 */
export function normalizeRoomMeta(m) {
  if (!m || typeof m !== "object") return null;
  const visibility = m.visibility === "public" ? "public" : "private";
  return {
    name: clean(m.name, 48),
    visibility,
    pass: typeof m.pass === "string" ? m.pass.slice(0, 128) : "",
  };
}

const REACTIONS = new Set(["like", "clap", "heart", "laugh", "wow", "question"]);

/**
 * Valida uma mensagem já parseada. Retorna `{ ok: true, msg }` normalizado
 * ou `{ ok: false, error }`.
 */
export function parseClientMessage(raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return { ok: false, error: ERRORS.MALFORMED };
  }
  if (!m || typeof m !== "object" || typeof m.t !== "string") {
    return { ok: false, error: ERRORS.MALFORMED };
  }

  switch (m.t) {
    case C2S.JOIN: {
      if (!isRoomId(m.room)) return { ok: false, error: ERRORS.BAD_ROOM };
      return {
        ok: true,
        msg: {
          t: C2S.JOIN,
          room: m.room,
          profile: normalizeProfile(m.profile),
          state: normalizeState(m.state),
          meta: normalizeRoomMeta(m.meta),
          pass: typeof m.pass === "string" ? m.pass.slice(0, 128) : "",
          // Prova de que quem entra é quem criou a sala (volta a ser
          // anfitrião depois de uma queda).
          hostKey: token(m.hostKey),
          // Identifica ESTA aba: ao reconectar, substitui a conexão antiga em
          // vez de aparecer duplicado para os outros.
          session: token(m.session),
          // Identifica o aparelho, para que um participante removido não
          // volte só recarregando a página.
          device: token(m.device),
        },
      };
    }

    case C2S.MODERATE: {
      if (!MOD_ACTIONS.has(m.action)) return { ok: false, error: ERRORS.MALFORMED };
      const target = typeof m.target === "string" ? m.target.slice(0, 64) : "";
      if (MOD_TARGETED.has(m.action) && !target) return { ok: false, error: ERRORS.MALFORMED };
      return { ok: true, msg: { t: C2S.MODERATE, action: m.action, target } };
    }

    case C2S.SIGNAL: {
      // `to` é o id de um par; `d` é SDP ou candidato ICE, opaco para nós.
      if (typeof m.to !== "string" || !m.to || !m.d || typeof m.d !== "object") {
        return { ok: false, error: ERRORS.MALFORMED };
      }
      return { ok: true, msg: { t: C2S.SIGNAL, to: m.to, d: m.d } };
    }

    case C2S.PROFILE:
      return { ok: true, msg: { t: C2S.PROFILE, profile: normalizeProfile(m.profile) } };

    case C2S.STATE:
      return { ok: true, msg: { t: C2S.STATE, state: normalizeState(m.state) } };

    case C2S.CHAT: {
      const text = clean(m.text, L.chatMessage);
      if (!text) return { ok: false, error: ERRORS.MALFORMED };
      return { ok: true, msg: { t: C2S.CHAT, text } };
    }

    case C2S.REACTION: {
      if (!REACTIONS.has(m.kind)) return { ok: false, error: ERRORS.MALFORMED };
      return { ok: true, msg: { t: C2S.REACTION, kind: m.kind } };
    }

    case C2S.BOARD: {
      // Operações do quadro branco. O DataChannel é o caminho normal; este
      // fallback pelo servidor cobre pares que ainda não conectaram P2P.
      if (!m.op || typeof m.op !== "object") return { ok: false, error: ERRORS.MALFORMED };
      return { ok: true, msg: { t: C2S.BOARD, op: m.op } };
    }

    case C2S.AUDIO: {
      // Só a transição fala/cala passa pelo servidor. O nível instantâneo vai
      // pelo DataChannel: mandá-lo aqui estouraria o limite de mensagens sem
      // acrescentar nada que a interface não consiga interpolar sozinha.
      const level = Number(m.level);
      return {
        ok: true,
        msg: {
          t: C2S.AUDIO,
          speaking: !!m.speaking,
          level: Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0,
        },
      };
    }

    case C2S.LIST_ROOMS:
      return { ok: true, msg: { t: C2S.LIST_ROOMS } };

    case C2S.LEAVE:
      return { ok: true, msg: { t: C2S.LEAVE } };

    case C2S.PING:
      return { ok: true, msg: { t: C2S.PING, n: Number(m.n) || 0 } };

    default:
      return { ok: false, error: ERRORS.MALFORMED };
  }
}
