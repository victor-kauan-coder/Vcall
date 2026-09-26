/**
 * core/peer.js — uma conexão P2P com um participante.
 *
 * Três decisões de arquitetura carregam este arquivo:
 *
 * 1. QUATRO LINHAS DE MÍDIA FIXAS. Microfone, câmera, tela e áudio da tela
 *    recebem cada um a sua própria linha, criadas de uma vez antes da primeira
 *    oferta. Depois disso, ligar e desligar a câmera ou a tela é só
 *    `replaceTrack` — sem nova linha, sem renegociação, sem janela de conflito.
 *    Era exatamente essa renegociação no meio da chamada que fazia o
 *    compartilhamento de tela funcionar só de um lado, ou chegar preto no
 *    outro.
 *
 *    Só UM dos lados chama `addTransceiver`. Isso não é detalhe: pela
 *    especificação, uma linha criada com `addTransceiver` nunca é reaproveitada
 *    para casar com uma linha da oferta remota — ela é um pedido explícito de
 *    linha própria. Se os dois lados criassem as suas, cada navegador acabaria
 *    com oito linhas: quatro enviando para o vazio e quatro recebendo. O lado
 *    que responde adota as linhas que chegaram na oferta, vira a direção para
 *    `sendrecv` ANTES de montar a resposta e usa essas mesmas. Resultado:
 *    quatro linhas, os mesmos `mid` nas duas pontas, uma única negociação.
 *
 * 2. PERFECT NEGOTIATION. Quando os dois lados tentam negociar ao mesmo tempo,
 *    um deles é "educado" e desfaz a própria oferta em vez de brigar. O papel
 *    é decidido comparando os ids, então é estável e sempre oposto nas duas
 *    pontas.
 *
 * 3. CANAIS DE DADOS NEGOCIADOS. O quadro branco e o ponteiro laser usam
 *    DataChannels com `negotiated: true` e id fixo: existem desde o primeiro
 *    instante, iguais dos dois lados, sem disparar renegociação.
 */
import { Emitter } from "../lib/emitter.js";
import { jitter } from "../lib/util.js";
import { applyProfile, preferCodecs, PROFILES, screenCodecPreference } from "./tuning.js";

/** Ordem canônica das linhas de mídia. Não altere sem versionar o protocolo. */
export const ROLES = ["mic", "cam", "screen", "screenAudio"];

const ROLE_KIND = { mic: "audio", cam: "video", screen: "video", screenAudio: "audio" };

/** Há servidor TURN nesta entrada de configuração? */
function hasTurn(server) {
  const urls = server?.urls;
  const list = Array.isArray(urls) ? urls : [urls];
  return list.some((u) => String(u || "").startsWith("turn"));
}

/**
 * Canais separados por prioridade. Um canal só tem uma fila: misturar uma
 * imagem de 300 kB com o estado de voz faz o indicador de quem está falando
 * chegar segundos atrasado. Por isso são quatro.
 *
 *   canvas-sync   deltas do canvas — ordenado e confiável, é o estado do desenho
 *   cursor        ponteiro laser — posição velha não serve, sem ordem nem reenvio
 *   audio-control estado de voz (VAD) — minúsculo, frequente, descartável
 *   canvas-blob   imagens em pedaços — grande e lento, fica fora do caminho do resto
 */
const DC_BOARD = { label: "canvas-sync", id: 0, negotiated: true, ordered: true };
const DC_CURSOR = { label: "cursor", id: 1, negotiated: true, ordered: false, maxRetransmits: 0 };
const DC_AUDIO = { label: "audio-control", id: 2, negotiated: true, ordered: false, maxRetransmits: 0 };
const DC_BLOB = { label: "canvas-blob", id: 3, negotiated: true, ordered: true };

/** Acima disto o canal está congestionado; o remetente espera antes de empurrar mais. */
const BLOB_HIGH_WATER = 512 * 1024;

const GRACE_MS = 2500;
const RESTART_BACKOFF = [0, 1000, 2500, 5000, 8000, 12_000, 20_000];
/**
 * Reinícios de ICE antes de jogar fora a conexão e montar outra do zero.
 *
 * `restartIce()` troca as credenciais e refaz a coleta de candidatos, mas
 * mantém o mesmo RTCPeerConnection — e há estados de onde ele não sai: DTLS
 * que falhou, transceiver órfão, porta que o sistema operacional não devolve.
 * Depois de algumas tentativas, o que resolve é recomeçar.
 */
const RESTARTS_BEFORE_REBUILD = 3;
/**
 * Reconstruções antes de desistir. Antes eram três reinícios e pronto: a
 * conexão morria para sempre e a pessoa só voltava recarregando a página.
 */
const MAX_REBUILDS = 4;

export class Peer extends Emitter {
  /** @type {RTCPeerConnection|null} */ pc = null;
  /** @type {Record<string, RTCRtpTransceiver>} */ tx = {};
  /** mid -> papel, para saber o que é cada trilha que chega. */ #midRole = new Map();
  /** papel -> MediaStream remoto. */ remote = { mic: null, cam: null, screen: null, screenAudio: null };

  #polite;
  /**
   * O lado educado não abre a negociação. Os dois criam exatamente as mesmas
   * linhas de mídia, na mesma ordem; se ambos ofertassem, haveria colisão em
   * *toda* conexão, e o desfazimento da oferta do lado educado deixa no Chrome
   * transceivers órfãos — linhas de mídia que existem mas não chegam ao outro
   * lado. É uma das razões clássicas de "a tela só aparece de um lado".
   * O perfect negotiation continua valendo para tudo que vier depois
   * (reinício de ICE, mudança de perfil): a partir da primeira negociação
   * concluída, o lado educado também pode ofertar.
   */
  #mayOffer;
  #makingOffer = false;
  #lastLocal = {};
  #ignoreOffer = false;
  #settingRemoteAnswer = false;
  #pendingCandidates = [];
  #graceTimer = 0;
  #restarts = 0;
  #rebuilds = 0;
  #restartWatch = 0;
  #closed = false;
  #config;

  constructor({ id, selfId, config, profile, local, peerCount = 1 }) {
    super();
    this.id = id;
    this.profile = profile;
    this.#config = config;
    this.#polite = String(selfId) > String(id); // estável e oposto nas duas pontas
    this.#mayOffer = !this.#polite;
    this.peerCount = peerCount;
    this.#build(local);
  }

  get polite() {
    return this.#polite;
  }
  get connectionState() {
    return this.pc?.connectionState || "closed";
  }

  /* ---------------------------------------------------------------- *
   * Construção
   * ---------------------------------------------------------------- */

  #build(local) {
    const pc = new RTCPeerConnection(this.#config);
    this.pc = pc;

    // Só quem oferta cria as linhas. Quem responde as adota da oferta.
    if (this.#mayOffer) {
      for (const role of ROLES) {
        const init = { direction: "sendrecv" };
        if (role === "screen") {
          init.sendEncodings = [{ maxBitrate: PROFILES.screenText.maxBitrate, maxFramerate: 30 }];
        } else if (role === "cam") {
          init.sendEncodings = [{ maxBitrate: PROFILES.camera.maxBitrate, maxFramerate: 30 }];
        }
        this.tx[role] = pc.addTransceiver(ROLE_KIND[role], init);
      }
      // Preferência de codec por linha: tela pede VP9/AV1, câmera fica no padrão.
      preferCodecs(this.tx.screen, screenCodecPreference(this.peerCount));
    }

    // Canais de dados: existem antes de qualquer oferta, nos dois lados.
    this.board = pc.createDataChannel(DC_BOARD.label, DC_BOARD);
    this.cursor = pc.createDataChannel(DC_CURSOR.label, DC_CURSOR);
    this.audioCtl = pc.createDataChannel(DC_AUDIO.label, DC_AUDIO);
    this.blob = pc.createDataChannel(DC_BLOB.label, DC_BLOB);
    this.board.binaryType = "arraybuffer";
    this.blob.bufferedAmountLowThreshold = BLOB_HIGH_WATER / 2;
    this.#wireChannel(this.board, "board");
    this.#wireChannel(this.cursor, "cursor");
    this.#wireChannel(this.audioCtl, "audio");
    this.#wireChannel(this.blob, "blob");

    pc.addEventListener("negotiationneeded", () => this.#onNegotiationNeeded());
    pc.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate) this.emit("signal", { candidate: candidate.toJSON() });
    });
    pc.addEventListener("track", (ev) => this.#onTrack(ev));
    pc.addEventListener("connectionstatechange", () => this.#onConnectionState());
    pc.addEventListener("iceconnectionstatechange", () => {
      this.emit("ice", this.pc?.iceConnectionState);
    });
    pc.addEventListener("signalingstatechange", () => {
      // Uma renegociação pode zerar os parâmetros do encoder no Chrome.
      // Reaplicar ao voltar para "stable" é o que impede a tela de degradar
      // silenciosamente depois de alguém entrar ou sair da sala.
      if (pc.signalingState === "stable") this.emit("stable");
    });

    // Anexa o que já estiver ligado localmente.
    this.attachLocal(local);
  }

  #wireChannel(channel, name) {
    channel.addEventListener("open", () => this.emit(`${name}:open`));
    channel.addEventListener("message", (ev) => this.emit(`${name}:message`, ev.data));
    channel.addEventListener("error", () => {
      /* canal de dados caindo não derruba a chamada */
    });
  }

  /* ---------------------------------------------------------------- *
   * Mídia local
   * ---------------------------------------------------------------- */

  /**
   * Sincroniza as quatro trilhas locais com esta conexão. Chamado quando o
   * usuário liga/desliga câmera, microfone ou tela. Nunca renegocia.
   */
  async attachLocal(local = {}) {
    if (!this.pc || this.#closed) return;
    // Guardado porque o lado que responde só ganha as linhas depois da oferta,
    // e precisa reanexar o que já estava ligado localmente.
    this.#lastLocal = local;
    await Promise.all([
      this.#setTrack("mic", local.mic, PROFILES.mic),
      this.#setTrack("cam", local.cam, PROFILES.camera),
      this.#setTrack("screen", local.screen, local.screenProfile || PROFILES.screenText),
      this.#setTrack("screenAudio", local.screenAudio, PROFILES.screenAudio),
    ]);
  }

  async #setTrack(role, track, profile) {
    const sender = this.tx[role]?.sender;
    if (!sender) return;
    if (sender.track === (track || null)) {
      // Mesma trilha: ainda assim reaplica o perfil, porque contentHint e
      // parâmetros podem ter sido zerados por uma renegociação.
      if (track) await applyProfile(sender, profile);
      return;
    }
    try {
      await sender.replaceTrack(track || null);
    } catch (err) {
      console.warn(`[peer ${this.id}] replaceTrack(${role}) falhou`, err);
      return;
    }
    if (track) await applyProfile(sender, profile);
  }

  /** Reaplica os perfis — usado depois de cada negociação concluída. */
  async retune(local = {}) {
    await Promise.all([
      applyProfile(this.tx.mic?.sender, PROFILES.mic),
      applyProfile(this.tx.cam?.sender, PROFILES.camera),
      applyProfile(this.tx.screen?.sender, local.screenProfile || PROFILES.screenText),
      applyProfile(this.tx.screenAudio?.sender, PROFILES.screenAudio),
    ]);
  }

  /** Ajusta o teto da trilha de tela (usado pelo controle adaptativo). */
  async setScreenBudget({ maxBitrate, maxFramerate, scaleResolutionDownBy, profile }) {
    return applyProfile(this.tx.screen?.sender, profile || PROFILES.screenText, {
      maxBitrate,
      maxFramerate,
      scaleResolutionDownBy,
    });
  }

  async setCameraBudget({ maxBitrate, maxFramerate }) {
    return applyProfile(this.tx.cam?.sender, PROFILES.camera, { maxBitrate, maxFramerate });
  }

  /* ---------------------------------------------------------------- *
   * Negociação
   * ---------------------------------------------------------------- */

  async #onNegotiationNeeded() {
    if (!this.pc || this.#closed) return;
    if (!this.#mayOffer) return; // o lado educado espera a primeira oferta
    if (this.pc.signalingState !== "stable") return;
    try {
      this.#makingOffer = true;
      // Sem argumentos: o navegador cria a descrição certa para o estado atual
      // e não existe intervalo entre criar e aplicar onde o estado possa mudar.
      await this.pc.setLocalDescription();
      this.emit("signal", {
        description: this.pc.localDescription,
        roles: this.#roleMap(),
      });
    } catch (err) {
      console.warn(`[peer ${this.id}] negociação falhou`, err);
    } finally {
      this.#makingOffer = false;
    }
  }

  /**
   * mid -> papel, publicado junto com a descrição para o outro lado. De quebra,
   * alimenta o mapa local: os `mid` são os mesmos nas duas pontas, então quem
   * oferta já sabe interpretar as trilhas que chegarem, mesmo antes da resposta.
   */
  #roleMap() {
    const map = {};
    for (const role of ROLES) {
      const mid = this.tx[role]?.mid;
      if (mid != null) {
        map[mid] = role;
        this.#midRole.set(String(mid), role);
      }
    }
    this.#claimPendingTracks();
    return map;
  }

  /** Processa uma mensagem de sinalização vinda deste par. */
  async handleSignal({ description, candidate, roles, rebuild }) {
    if (this.#closed) return;

    /*
     * O outro lado jogou fora a conexão dele e montou outra. Continuar com a
     * nossa deixaria meia conexão de cada lado: DTLS de um, ICE de outro, e
     * nenhuma mídia atravessando. Recomeçar junto é o que fecha a conta.
     * `echo: false` corta o pingue-pongue — quem recebe não avisa de volta.
     */
    if (rebuild) {
      await this.#rebuild({ echo: false });
      return;
    }

    if (!this.pc) return;

    if (roles) {
      for (const [mid, role] of Object.entries(roles)) this.#midRole.set(String(mid), role);
      this.#claimPendingTracks();
    }

    try {
      if (description) {
        const readyForOffer =
          !this.#makingOffer &&
          (this.pc.signalingState === "stable" || this.#settingRemoteAnswer);
        const collision = description.type === "offer" && !readyForOffer;

        this.#ignoreOffer = !this.#polite && collision;
        if (this.#ignoreOffer) return; // o impolido mantém a própria oferta

        this.#settingRemoteAnswer = description.type === "answer";
        // No lado educado, isto desfaz implicitamente a oferta local pendente.
        await this.pc.setRemoteDescription(description);
        this.#settingRemoteAnswer = false;

        await this.#drainCandidates();

        if (description.type === "offer") {
          // Adota as linhas da oferta e vira a direção ANTES de responder —
          // assim a resposta já sai `sendrecv` e não é preciso uma segunda
          // rodada de negociação só para começar a enviar.
          await this.#adoptTransceivers();
          await this.pc.setLocalDescription();
          this.emit("signal", {
            description: this.pc.localDescription,
            roles: this.#roleMap(),
          });
          // A partir daqui o lado educado também pode iniciar negociações
          // (reinício de ICE, troca de perfil de tela).
          this.#mayOffer = true;
        }
      } else if (candidate) {
        if (!this.pc.remoteDescription) {
          // Candidatos podem chegar antes da descrição: guarde, não descarte.
          this.#pendingCandidates.push(candidate);
          return;
        }
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.#ignoreOffer) console.debug(`[peer ${this.id}] candidato recusado`, err?.name);
        }
      }
    } catch (err) {
      console.warn(`[peer ${this.id}] sinalização falhou`, err);
    }
  }

  /**
   * Casa cada linha recebida na oferta com o seu papel e prepara-a para
   * enviar. Chamado só no lado que responde, e só uma vez: nas renegociações
   * seguintes as linhas já estão adotadas.
   */
  async #adoptTransceivers() {
    if (!this.pc) return;
    const byMid = new Map();
    for (const t of this.pc.getTransceivers()) {
      if (t.mid != null) byMid.set(String(t.mid), t);
    }

    let adoptedAny = false;
    for (const [mid, role] of this.#midRole) {
      if (!ROLES.includes(role)) continue;
      const t = byMid.get(String(mid));
      if (!t || this.tx[role] === t) continue;
      this.tx[role] = t;
      adoptedAny = true;
      // A oferta chegou como sendrecv/recvonly; precisamos poder enviar.
      if (t.direction !== "sendrecv") t.direction = "sendrecv";
      if (role === "screen") preferCodecs(t, screenCodecPreference(this.peerCount));
    }

    if (adoptedAny) {
      await this.attachLocal(this.#lastLocal);
      this.emit("adopted", Object.keys(this.tx));
    }
  }

  async #drainCandidates() {
    const list = this.#pendingCandidates;
    this.#pendingCandidates = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* candidato obsoleto */
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Mídia remota
   * ---------------------------------------------------------------- */

  #pendingTracks = [];

  #onTrack(ev) {
    const { track, transceiver } = ev;
    const mid = String(transceiver.mid ?? "");
    const role = this.#midRole.get(mid);

    if (!role) {
      // O mapa de papéis pode chegar logo depois; não perca a trilha.
      this.#pendingTracks.push(ev);
      return;
    }
    this.#adoptTrack(role, track, transceiver);
  }

  #claimPendingTracks() {
    if (!this.#pendingTracks.length) return;
    const list = this.#pendingTracks;
    this.#pendingTracks = [];
    for (const ev of list) this.#onTrack(ev);
  }

  #adoptTrack(role, track, transceiver) {
    let stream = this.remote[role];
    if (!stream) {
      stream = new MediaStream();
      this.remote[role] = stream;
    }
    for (const old of stream.getTracks()) {
      if (old !== track) stream.removeTrack(old);
    }
    stream.addTrack(track);

    const publish = () => this.emit("media", { role, stream, track, live: !track.muted });

    // `unmute` é o sinal de que quadros começaram a chegar de verdade. Ligar o
    // <video> antes disso é o que produz aquele retângulo preto que nunca sai.
    if (track.muted) track.addEventListener("unmute", publish, { once: true });
    else publish();

    track.addEventListener("mute", () => this.emit("media", { role, stream, track, live: false }));
    track.addEventListener("ended", () => {
      stream.removeTrack(track);
      this.emit("media", { role, stream: null, track: null, live: false });
    });

    if (transceiver) this.#midRole.set(String(transceiver.mid), role);
  }

  /* ---------------------------------------------------------------- *
   * Resiliência
   * ---------------------------------------------------------------- */

  #onConnectionState() {
    const state = this.pc?.connectionState;
    this.emit("state", state);
    clearTimeout(this.#graceTimer);

    if (state === "connected") {
      this.#restarts = 0;
      this.#rebuilds = 0;
      clearTimeout(this.#restartWatch);
      return;
    }
    if (state === "disconnected") {
      // "disconnected" às vezes se resolve sozinho em um ou dois segundos.
      // Reiniciar o ICE imediatamente atrapalharia mais do que ajudaria.
      this.#graceTimer = setTimeout(() => this.#tryRestart(), GRACE_MS);
    } else if (state === "failed") {
      this.#tryRestart();
    }
  }

  async #tryRestart() {
    if (this.#closed || !this.pc) return;
    if (this.pc.connectionState === "connected") return;

    if (this.#restarts >= RESTARTS_BEFORE_REBUILD) {
      await this.#rebuild();
      return;
    }
    const wait = RESTART_BACKOFF[Math.min(this.#restarts, RESTART_BACKOFF.length - 1)];
    this.#restarts += 1;
    this.emit("restarting", { attempt: this.#restarts });

    if (wait) await jitter(wait);
    if (this.#closed || this.pc?.connectionState === "connected") return;

    try {
      // Marca a conexão para renegociar com credenciais ICE novas; o fluxo de
      // perfect negotiation cuida do resto, inclusive de um conflito simultâneo.
      this.pc.restartIce();
      // restartIce() só pede uma renegociação; se a sinalização não estiver
      // estável naquele instante, o pedido se perde em silêncio. Este alarme
      // é o que garante que a tentativa não morra aí.
      this.#armRestartWatchdog();
    } catch (err) {
      console.warn(`[peer ${this.id}] restartIce falhou`, err);
    }
  }

  #armRestartWatchdog() {
    clearTimeout(this.#restartWatch);
    this.#restartWatch = setTimeout(() => {
      if (this.#closed || this.pc?.connectionState === "connected") return;
      this.#tryRestart();
    }, 9000);
  }

  /**
   * Descarta o RTCPeerConnection e monta outro do zero.
   *
   * A partir da segunda reconstrução, força o tráfego por TURN
   * (`iceTransportPolicy: "relay"`). Se a conexão direta já falhou várias
   * vezes, insistir nela é gastar mais uma rodada no caminho que não funciona:
   * quase sempre há um NAT simétrico ou um firewall corporativo no meio, e o
   * relay é o único que atravessa. Sem TURN configurado, não há o que forçar —
   * e aí a mensagem para o usuário é a única saída honesta.
   */
  async #rebuild({ echo = true } = {}) {
    if (this.#closed) return;

    if (this.#rebuilds >= MAX_REBUILDS) {
      this.emit("exhausted");
      return;
    }
    this.#rebuilds += 1;
    this.#restarts = 0;
    clearTimeout(this.#restartWatch);

    const viaRelay =
      this.#rebuilds >= 2 && (this.#config?.iceServers || []).some((s) => hasTurn(s));
    this.emit("rebuilding", { attempt: this.#rebuilds, relay: viaRelay });
    // Avisa antes de derrubar: a mensagem ainda sai pela sinalização, que é
    // independente do P2P que está sendo descartado.
    if (echo) this.emit("signal", { rebuild: true });

    await jitter(1200 * this.#rebuilds);
    if (this.#closed) return;

    const old = this.pc;
    this.pc = null;
    try {
      old?.close();
    } catch {
      /* já fechado */
    }

    // Estado que pertencia à conexão anterior. Mantê-lo faria o novo
    // RTCPeerConnection herdar mids e candidatos que não existem mais.
    this.#midRole.clear();
    this.#pendingCandidates = [];
    this.#pendingTracks = [];
    this.remote = { mic: null, cam: null, screen: null, screenAudio: null };
    this.tx = {};
    this.#makingOffer = false;
    this.#ignoreOffer = false;
    this.#settingRemoteAnswer = false;

    /*
     * Volta à assimetria do começo: só o lado impolido cria as linhas e
     * oferta. Deixar os dois ofertando sobre RTCPeerConnections novos é
     * exatamente o cenário descrito no cabeçalho deste arquivo — cada
     * navegador acabaria com oito linhas, quatro delas enviando para o vazio,
     * e a tela apareceria só de um lado. Como o aviso de reconstrução vai para
     * o outro lado, os dois recomeçam e o impolido oferta.
     */
    this.#mayOffer = !this.#polite;

    const config = viaRelay ? { ...this.#config, iceTransportPolicy: "relay" } : this.#config;
    this.#config = config;
    this.#build(this.#lastLocal);
    this.emit("rebuilt", { relay: viaRelay });
  }

  /** Força uma renegociação completa (usada depois de trocar o perfil de tela). */
  renegotiate() {
    this.#onNegotiationNeeded();
  }

  /* ---------------------------------------------------------------- *
   * Dados
   * ---------------------------------------------------------------- */

  sendBoard(payload) {
    if (this.board?.readyState !== "open") return false;
    try {
      this.board.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  sendCursor(payload) {
    if (this.cursor?.readyState !== "open") return false;
    try {
      this.cursor.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Estado de voz. Perder um pacote aqui não custa nada: vem outro em 100 ms. */
  sendAudio(payload) {
    if (this.audioCtl?.readyState !== "open") return false;
    try {
      this.audioCtl.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Carga pesada (imagens do canvas). Devolve false quando o canal está
   * cheio, para que o remetente espere em vez de estourar a memória do
   * navegador — um `send` que ignora o buffer derruba a conexão inteira.
   */
  sendBlob(payload) {
    if (this.blob?.readyState !== "open") return false;
    if (this.blob.bufferedAmount > BLOB_HIGH_WATER) return false;
    try {
      this.blob.send(typeof payload === "string" ? payload : JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Espera o canal de carga pesada esvaziar. Usado entre pedaços de imagem. */
  drainBlob() {
    const ch = this.blob;
    if (!ch || ch.readyState !== "open" || ch.bufferedAmount <= BLOB_HIGH_WATER) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        ch.removeEventListener("bufferedamountlow", done);
        resolve();
      };
      ch.addEventListener("bufferedamountlow", done);
      setTimeout(done, 3000);
    });
  }

  /* ---------------------------------------------------------------- */

  async getStats() {
    if (!this.pc || this.#closed) return null;
    try {
      return await this.pc.getStats();
    } catch {
      return null;
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#graceTimer);
    clearTimeout(this.#restartWatch);
    try {
      this.board?.close();
      this.cursor?.close();
      this.audioCtl?.close();
      this.blob?.close();
    } catch {
      /* já fechado */
    }
    try {
      this.pc?.close();
    } catch {
      /* idem */
    }
    this.pc = null;
    this.clear();
  }
}
