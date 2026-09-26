/**
 * core/mesh.js — a sala.
 *
 * Costura sinalização, mídia local e conexões P2P num único objeto com o qual
 * a interface conversa. Topologia em malha: cada participante mantém uma
 * conexão direta com cada outro. É o que permite criptografia fim a fim sem
 * servidor de mídia, e é também por isso que o limite de participantes é baixo
 * — com N pessoas, cada uma codifica N−1 vezes.
 */
import { Emitter } from "../lib/emitter.js";
import { Peer } from "./peer.js";
import { StatsMonitor } from "./stats.js";
import { VoiceActivity } from "./vad.js";

export class Mesh extends Emitter {
  /** @type {Map<string, Peer>} */ peers = new Map();
  /** @type {Map<string, object>} */ profiles = new Map();
  /** @type {Map<string, object>} */ states = new Map();

  selfId = null;
  self = null;
  hostId = null;
  iceConfig = null;
  joinedAt = 0;

  constructor({ signaling, media, screen }) {
    super();
    this.signaling = signaling;
    this.media = media;
    this.screen = screen;

    this.vad = new VoiceActivity();
    this.stats = new StatsMonitor(() => this.peers.values());

    this.#wireSignaling();
    this.#wireMedia();
    this.#wireStats();
  }

  get size() {
    return this.peers.size + 1;
  }

  get isHost() {
    return this.hostId === this.selfId;
  }

  /* ---------------------------------------------------------------- *
   * Entrada e saída
   * ---------------------------------------------------------------- */

  async join({ room, profile, state, meta = null, pass = "" }) {
    this.iceConfig = await fetchIceConfig();
    this.emit("ice", this.iceConfig);
    this.room = room;
    this.roomMeta = meta;
    this.signaling.join({ room, profile, state, meta, pass });
  }

  /**
   * Passa a acompanhar o próprio microfone no detector de fala.
   *
   * Sem isto, o destaque de "está falando" aparecia para todo mundo menos
   * para quem fala — o analisador só via as trilhas que chegavam pela rede.
   * A origem é o stream local de captura, antes de qualquer conexão.
   */
  trackSelfAudio() {
    if (!this.selfId) return;
    const stream = this.media.stream;
    if (!stream || !stream.getAudioTracks().length) {
      this.vad.untrack(this.selfId);
      return;
    }
    if (this.#selfTracked === stream) return;
    this.#selfTracked = stream;
    this.vad.track(this.selfId, stream);
  }

  #selfTracked = null;

  leave() {
    this.stats.stop();
    this.vad.stop();
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.profiles.clear();
    this.states.clear();
    this.signaling.close();
    this.emit("left");
  }

  /* ---------------------------------------------------------------- *
   * Sinalização
   * ---------------------------------------------------------------- */

  #wireSignaling() {
    const sig = this.signaling;

    sig.on("welcome", (m) => {
      const first = !this.selfId;
      this.selfId = m.you.id;
      this.self = m.you;
      this.hostId = m.you.host ? m.you.id : this.hostId;
      if (first) this.joinedAt = Date.now();

      // Reconexão: pares que sumiram da lista devem ser descartados.
      const alive = new Set(m.peers.map((p) => p.id));
      for (const id of [...this.peers.keys()]) {
        if (!alive.has(id)) this.#dropPeer(id);
      }

      for (const p of m.peers) this.#addPeer(p);
      this.stats.start();
      this.trackSelfAudio();
      this.room = this.room || m.room?.id;
      this.roomInfo = m.room || null;
      this.emit("joined", { self: m.you, peers: m.peers, room: m.room, reconnected: !first });
      this.emit("roster", this.roster());
    });

    sig.on("peer-join", (m) => {
      this.#addPeer(m.peer);
      this.emit("peer-join", m.peer);
      this.emit("roster", this.roster());
    });

    sig.on("peer-leave", (m) => {
      const profile = this.profiles.get(m.id);
      this.#dropPeer(m.id);
      if (m.newHost) this.hostId = m.newHost;
      this.emit("peer-leave", { id: m.id, profile });
      this.emit("roster", this.roster());
    });

    sig.on("signal", (m) => {
      this.peers.get(m.from)?.handleSignal(m.d);
    });

    sig.on("profile", (m) => {
      const p = this.profiles.get(m.id) || {};
      const next = { ...p, name: m.name, avatar: m.avatar };
      this.profiles.set(m.id, next);
      const peer = this.peers.get(m.id);
      if (peer) peer.profile = next;
      this.emit("profile", { id: m.id, profile: next });
      this.emit("roster", this.roster());
    });

    sig.on("state", (m) => {
      this.states.set(m.id, m.state);
      this.emit("peer-state", { id: m.id, state: m.state });
      this.emit("roster", this.roster());
    });

    sig.on("chat", (m) => this.emit("chat", m));
    // Plano B do VAD: pares que ainda não abriram o canal de dados.
    sig.on("audio", (m) => {
      if (m.id === this.selfId) return;
      this.vad.levels.set(m.id, m.level || 0);
      this.emit("speaking", { id: m.id, speaking: !!m.speaking, level: m.level || 0, via: "server" });
    });
    sig.on("rooms", (m) => this.emit("rooms", m.rooms || []));
    sig.on("reaction", (m) => this.emit("reaction", m));
    // Fallback do quadro para pares que ainda não abriram o canal de dados.
    sig.on("board", (m) => this.emit("board", { from: m.id, op: m.op, via: "server" }));

    sig.on("reconnecting", (info) => this.emit("link", { status: "reconnecting", ...info }));
    sig.on("open", () => this.emit("link", { status: "online" }));
    sig.on("close", () => this.emit("link", { status: "offline" }));
    sig.on("error", (e) => this.emit("link", { status: "error", ...e }));
  }

  /* ---------------------------------------------------------------- *
   * Pares
   * ---------------------------------------------------------------- */

  #addPeer(info) {
    if (this.peers.has(info.id) || info.id === this.selfId) return;

    this.profiles.set(info.id, { name: info.name, avatar: info.avatar });
    this.states.set(info.id, info.state || {});
    if (info.host) this.hostId = info.id;

    const peer = new Peer({
      id: info.id,
      selfId: this.selfId,
      config: this.iceConfig,
      profile: { name: info.name, avatar: info.avatar },
      local: this.#localSnapshot(),
      peerCount: this.peers.size + 1,
    });
    peer.screenProfile = this.screen.profile;

    peer.on("signal", (d) => this.signaling.signal(info.id, d));
    peer.on("media", ({ role, stream, live }) => {
      if (role === "mic" && stream) this.vad.track(info.id, stream);
      this.emit("media", { id: info.id, role, stream, live });
    });
    peer.on("state", (state) => this.emit("peer-connection", { id: info.id, state }));
    peer.on("restarting", (i) => this.emit("peer-connection", { id: info.id, state: "restarting", ...i }));
    peer.on("exhausted", () => this.emit("peer-connection", { id: info.id, state: "exhausted" }));
    peer.on("stable", () => {
      // Depois de cada negociação, os parâmetros do encoder podem ter sido
      // zerados pelo navegador. Reaplicar aqui é o que mantém a tela nítida
      // quando alguém entra ou sai no meio de uma apresentação.
      peer.retune(this.#localSnapshot());
    });
    peer.on("rebuilding", (i) => this.emit("peer-connection", { id: info.id, state: "rebuilding", ...i }));
    /*
     * O canal abriu — pela primeira vez, ou de novo depois de uma
     * reconstrução. Nos dois casos o outro lado pode ter perdido operações
     * enquanto o canal esteve fechado, e é aqui que a reconciliação começa.
     */
    peer.on("board:open", () => this.emit("board-channel", { id: info.id }));
    peer.on("board:message", (raw) => this.#onPeerData(info.id, raw, "board"));
    peer.on("cursor:message", (raw) => this.#onPeerData(info.id, raw, "cursor"));
    peer.on("audio:message", (raw) => this.#onPeerData(info.id, raw, "audio"));
    peer.on("blob:message", (raw) => this.#onPeerData(info.id, raw, "board"));

    this.peers.set(info.id, peer);
    this.emit("peer-added", { id: info.id, peer });
  }

  #dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.close();
    this.peers.delete(id);
    this.profiles.delete(id);
    this.states.delete(id);
    this.vad.untrack(id);
    this.stats.forget(id);
    this.emit("peer-removed", { id });
  }

  #onPeerData(from, raw, channel) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (channel === "cursor") {
      this.emit("cursor", { from, ...msg });
      return;
    }
    if (channel === "audio") {
      // O nível chega quadro a quadro; guardá-lo aqui é o que faz a barrinha
      // do participante remoto se mexer junto com a voz dele.
      this.vad.levels.set(from, msg.level || 0);
      this.emit("speaking", { id: from, speaking: !!msg.speaking, level: msg.level || 0, via: "p2p" });
      return;
    }
    this.emit("board", { from, op: msg, via: "p2p" });
  }

  /* ---------------------------------------------------------------- *
   * Mídia local -> todos os pares
   * ---------------------------------------------------------------- */

  #localSnapshot() {
    return {
      mic: this.media.micTrack,
      cam: this.media.camTrack,
      screen: this.screen.videoTrack,
      screenAudio: this.screen.audioTrack,
      screenProfile: this.screen.profile,
    };
  }

  #wireMedia() {
    const push = () => {
      const local = this.#localSnapshot();
      for (const peer of this.peers.values()) {
        peer.screenProfile = local.screenProfile;
        peer.attachLocal(local);
      }
      this.publishState();
    };

    this.media.on("change", () => {
      // Trocar de microfone cria um stream novo; o detector precisa segui-lo.
      this.#selfTracked = null;
      this.trackSelfAudio();
      push();
    });
    this.screen.on("change", push);
    // Trocar entre "texto" e "movimento" muda a dica de conteúdo e a política
    // de degradação; basta reaplicar o perfil, sem renegociar nada.
    this.screen.on("mode", () => {
      const local = this.#localSnapshot();
      for (const peer of this.peers.values()) {
        peer.screenProfile = local.screenProfile;
        peer.retune(local);
      }
    });

    this.on("peer-added", ({ peer }) => peer.attachLocal(this.#localSnapshot()));
  }

  #wireStats() {
    this.stats.on("update", (samples) => this.emit("stats", samples));
    this.stats.on("limited", (info) => this.emit("limited", info));
    this.vad.on("speaking", (e) => {
      this.emit("speaking", e);
      // A própria transição fala/cala vai para todo mundo: quem me silenciou
      // localmente, ou está com o áudio desligado, continua vendo que eu falo.
      if (e.id === this.selfId) this.#publishSpeaking(e.speaking, e.level);
    });
    this.vad.on("active", (id) => this.emit("active-speaker", id));

    // Nível contínuo do próprio microfone, só pelo DataChannel. Não vai pelo
    // servidor de propósito: seriam dezenas de mensagens por segundo.
    setInterval(() => {
      if (!this.selfId || !this.peers.size) return;
      const level = this.vad.levelOf(this.selfId);
      if (level < 0.004 && !this.#lastSpeaking) return;
      const payload = { speaking: this.#lastSpeaking, level: Number(level.toFixed(3)) };
      for (const peer of this.peers.values()) peer.sendAudio(payload);
    }, 120);
  }

  #lastSpeaking = false;

  #publishSpeaking(speaking, level = 0) {
    this.#lastSpeaking = speaking;
    const payload = { speaking, level: Number((level || 0).toFixed(3)) };
    let needsFallback = false;
    for (const peer of this.peers.values()) {
      if (!peer.sendAudio(payload)) needsFallback = true;
    }
    if (needsFallback) this.signaling.audio(payload);
  }

  /** Pede ao servidor o diretório de salas públicas. */
  listRooms() {
    this.signaling.send({ t: "list-rooms" });
  }

  /* ---------------------------------------------------------------- *
   * Publicação de estado
   * ---------------------------------------------------------------- */

  publishState(extra = {}) {
    const state = {
      mic: this.media.micEnabled,
      cam: this.media.camEnabled,
      screen: this.screen.active,
      hand: !!this.localState?.hand,
      board: !!this.localState?.board,
      ...extra,
    };
    this.localState = state;
    this.signaling.updateState(state);
    this.emit("self-state", state);
    return state;
  }

  updateProfile(profile) {
    this.self = { ...this.self, ...profile };
    this.signaling.updateProfile(profile);
    this.emit("roster", this.roster());
  }

  /* ---------------------------------------------------------------- *
   * Difusão
   * ---------------------------------------------------------------- */

  /**
   * Manda uma operação do quadro para todos. O caminho normal é o DataChannel
   * (direto, sem servidor). Se algum par ainda não abriu o canal, aquele par
   * recebe pelo servidor — sem duplicar para quem já recebeu por P2P.
   */
  broadcastBoard(op, { fallback = true } = {}) {
    let needsFallback = false;
    for (const peer of this.peers.values()) {
      if (!peer.sendBoard(op)) needsFallback = true;
    }
    /*
     * `fallback: false` para conteúdo descartável — legenda parcial, por
     * exemplo. O caminho pelo servidor reentrega a mensagem para TODOS, e não
     * só para quem ficou sem canal direto; com legendas ao vivo isso virava
     * dezenas de mensagens por segundo multiplicadas pela sala inteira, e era
     * o que estourava o limite de taxa e derrubava a conexão.
     */
    if (needsFallback && fallback) this.signaling.board(op);
  }

  broadcastCursor(payload) {
    for (const peer of this.peers.values()) peer.sendCursor(payload);
  }

  /**
   * Carga pesada do canvas (imagens). Vai pelo canal separado, e espera o
   * buffer esvaziar entre os pedaços em vez de empurrar tudo de uma vez.
   */
  async broadcastBlob(payload) {
    const data = JSON.stringify(payload);
    for (const peer of this.peers.values()) {
      if (!peer.sendBlob(data)) {
        await peer.drainBlob();
        peer.sendBlob(data);
      }
    }
  }

  sendChat(text) {
    this.signaling.chat(text);
  }

  sendReaction(kind) {
    this.signaling.reaction(kind);
  }

  /* ---------------------------------------------------------------- */

  roster() {
    const list = [];
    if (this.self) {
      list.push({
        id: this.selfId,
        self: true,
        name: this.self.name,
        avatar: this.self.avatar,
        state: this.localState || {},
        host: this.hostId === this.selfId,
        connection: "connected",
        quality: "good",
      });
    }
    for (const [id, peer] of this.peers) {
      const profile = this.profiles.get(id) || {};
      list.push({
        id,
        self: false,
        name: profile.name,
        avatar: profile.avatar,
        state: this.states.get(id) || {},
        host: this.hostId === id,
        connection: peer.connectionState,
        quality: this.stats.samples.get(id)?.quality || "unknown",
      });
    }
    return list;
  }
}

/** Busca a configuração de ICE no servidor. Nunca embutida no HTML. */
async function fetchIceConfig() {
  const fallback = {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 4,
    hasTurn: false,
  };
  try {
    const res = await fetch("/ice", { cache: "no-store" });
    if (!res.ok) return fallback;
    const cfg = await res.json();
    return cfg?.iceServers?.length ? cfg : fallback;
  } catch {
    return fallback;
  }
}
