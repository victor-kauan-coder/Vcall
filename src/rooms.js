/**
 * src/rooms.js — registro de salas em memória.
 *
 * Uma sala é efêmera: nasce com o primeiro participante e desaparece com o
 * último. Nada é persistido, o que é uma decisão de privacidade, não uma
 * limitação — o servidor nunca deve ser capaz de reconstruir uma conversa.
 */
import { randomUUID, createHash, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

/**
 * Alfabeto do código curto: sem 0/O nem 1/I/L. Um código é ditado por
 * telefone, e um par ambíguo transforma "entrar na sala" em suporte técnico.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function newCode() {
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * A senha nunca é guardada nem devolvida. O id da sala entra como sal, para
 * que o mesmo "1234" em duas salas não produza o mesmo hash.
 */
function hashPass(roomId, pass) {
  return createHash("sha256").update(`${roomId}:${pass}`).digest();
}

function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class Participant {
  constructor(socket, { room, profile, state }) {
    this.id = randomUUID().slice(0, 12);
    this.socket = socket;
    this.room = room;
    this.profile = profile;
    this.state = state;
    this.joinedAt = Date.now();
    /**
     * O primeiro a entrar na sala é o anfitrião. Se ele sair, o papel passa
     * para quem está há mais tempo. Isso é uma convenção de UI (quem pode
     * limpar o quadro, por exemplo), não um controle de segurança.
     */
    this.host = false;
  }

  publicView() {
    return {
      id: this.id,
      name: this.profile.name,
      avatar: this.profile.avatar,
      state: this.state,
      host: this.host,
      joinedAt: this.joinedAt,
    };
  }

  send(payload) {
    if (this.socket.readyState !== 1) return false;
    this.socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    return true;
  }
}

export class Room {
  constructor(id, meta = null) {
    this.id = id;
    this.members = new Map(); // id -> Participant
    this.createdAt = Date.now();

    /**
     * Metadados são definidos por quem chega primeiro e não mudam depois.
     * Quem entra por link não renomeia nem torna pública a sala dos outros.
     */
    this.name = meta?.name || "";
    this.visibility = meta?.visibility === "public" ? "public" : "private";
    this.passHash = meta?.pass ? hashPass(id, meta.pass) : null;
    this.code = newCode();
  }

  get locked() {
    return !!this.passHash;
  }

  /** Confere a senha em tempo constante. Sala sem senha aceita qualquer coisa. */
  checkPass(pass) {
    if (!this.passHash) return true;
    if (typeof pass !== "string" || !pass) return false;
    return sameHash(this.passHash, hashPass(this.id, pass));
  }

  get host() {
    let oldest = null;
    for (const p of this.members.values()) {
      if (p.host) return p;
      if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p;
    }
    return oldest;
  }

  /**
   * O que o painel inicial mostra. O id vai junto porque, numa sala pública,
   * ele é justamente o endereço que se quer divulgar; salas privadas nunca
   * chegam a esta função.
   */
  card() {
    const host = this.host;
    return {
      id: this.id,
      code: this.code,
      name: this.name || "Sala sem nome",
      size: this.members.size,
      max: config.maxPeersPerRoom,
      full: this.isFull,
      locked: this.locked,
      createdAt: this.createdAt,
      host: host ? { name: host.profile.name, avatar: host.profile.avatar } : null,
      talking: [...this.members.values()].filter((p) => p.state?.mic).length,
      sharing: [...this.members.values()].some((p) => p.state?.screen),
    };
  }

  get size() {
    return this.members.size;
  }

  get isFull() {
    return this.members.size >= config.maxPeersPerRoom;
  }

  add(participant) {
    if (!this.members.size) participant.host = true;
    this.members.set(participant.id, participant);
  }

  remove(id) {
    const gone = this.members.get(id);
    this.members.delete(id);
    // Sucessão do anfitrião: o participante mais antigo assume.
    if (gone?.host && this.members.size) {
      const next = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      next.host = true;
      return next;
    }
    return null;
  }

  get(id) {
    return this.members.get(id);
  }

  roster(exceptId) {
    const out = [];
    for (const p of this.members.values()) {
      if (p.id !== exceptId) out.push(p.publicView());
    }
    return out;
  }

  /** Envia para todos menos `exceptId`. Serializa uma vez só. */
  broadcast(payload, exceptId) {
    const data = JSON.stringify(payload);
    for (const p of this.members.values()) {
      if (p.id !== exceptId) p.send(data);
    }
  }
}

export class RoomRegistry {
  constructor() {
    this.rooms = new Map();
    this.codes = new Map(); // código curto -> id da sala
  }

  ensure(id, meta = null) {
    let r = this.rooms.get(id);
    if (!r) {
      r = new Room(id, meta);
      // Colisão de código é improvável, mas barata de resolver.
      while (this.codes.has(r.code)) r.code = new Room(id, meta).code;
      this.rooms.set(id, r);
      this.codes.set(r.code, id);
    }
    return r;
  }

  /** Resolve um código curto digitado pelo usuário. */
  byCode(code) {
    if (typeof code !== "string") return null;
    const id = this.codes.get(code.trim().toUpperCase());
    return id ? this.rooms.get(id) || null : null;
  }

  /**
   * Diretório de salas públicas, para o painel inicial. Salas privadas não
   * aparecem aqui em hipótese alguma: o id delas é o próprio segredo.
   */
  directory() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.visibility !== "public" || !r.size) continue;
      out.push(r.card());
    }
    // Mais gente primeiro; empate resolve pela mais recente.
    out.sort((a, b) => b.size - a.size || b.createdAt - a.createdAt);
    return out;
  }

  get(id) {
    return this.rooms.get(id);
  }

  dropIfEmpty(id) {
    const r = this.rooms.get(id);
    if (r && !r.size) {
      this.rooms.delete(id);
      this.codes.delete(r.code);
      return true;
    }
    return false;
  }

  stats() {
    let participants = 0;
    let publicRooms = 0;
    for (const r of this.rooms.values()) {
      participants += r.size;
      if (r.visibility === "public") publicRooms += 1;
    }
    return { rooms: this.rooms.size, publicRooms, participants };
  }
}
