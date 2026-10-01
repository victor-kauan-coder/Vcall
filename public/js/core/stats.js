/**
 * core/stats.js — leitura do getStats e controle adaptativo.
 *
 * Duas coisas acontecem aqui:
 *
 *   1. MEDIÇÃO. A cada ciclo, transformamos o relatório cru do WebRTC em algo
 *      legível: taxa real, quadros por segundo, resolução efetivamente
 *      codificada, latência, perda e congelamentos.
 *
 *   2. ADAPTAÇÃO. Com base nessas medidas, ajustamos o teto de banda da tela e
 *      da câmera. A regra é assimétrica de propósito — desce rápido, sobe
 *      devagar. Subir rápido é o que produz aquele ciclo de travar, recuperar
 *      e travar de novo.
 *
 * Detalhe que muda o diagnóstico: `qualityLimitationReason` só reporta UM
 * motivo por vez, e quando os dois acontecem ele diz "bandwidth". Por isso
 * olhamos a variação de `qualityLimitationDurations`, que é cumulativa e
 * mostra os dois.
 */
import { Emitter } from "../lib/emitter.js";
import { clamp, Ema } from "../lib/util.js";
import { cpuCeiling, meshBudget } from "./tuning.js";

const INTERVAL_MS = 2000;
const HISTORY = 30;

const FLOOR = { screen: 450_000, camera: 120_000 };
const CEIL = { screen: 6_000_000, camera: 1_500_000 };

/** Um snapshot legível por par. */
function emptySample() {
  return {
    outbound: { screen: null, cam: null, mic: null },
    inbound: { screen: null, cam: null, mic: null },
    transport: { rtt: null, availableOutgoing: null, availableIncoming: null, localType: null, remoteType: null },
    quality: "unknown",
    score: 0,
  };
}

export class StatsMonitor extends Emitter {
  #timer = 0;
  #prev = new Map(); // peerId -> Map(statId -> report)
  #budget = new Map(); // peerId -> { screen, camera }
  #ema = new Map(); // peerId -> { rtt, loss }
  #history = new Map(); // peerId -> number[] (kbps de saída)

  samples = new Map(); // peerId -> sample

  /**
   * @param {() => Iterable<import("./peer.js").Peer>} getPeers
   * @param {{ adaptive?: boolean }} opts
   */
  constructor(getPeers, { adaptive = true } = {}) {
    super();
    this.getPeers = getPeers;
    this.adaptive = adaptive;
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#tick(), INTERVAL_MS);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = 0;
  }

  forget(peerId) {
    this.#prev.delete(peerId);
    this.#budget.delete(peerId);
    this.#ema.delete(peerId);
    this.#history.delete(peerId);
    this.samples.delete(peerId);
  }

  historyFor(peerId) {
    return this.#history.get(peerId) || [];
  }

  /* ---------------------------------------------------------------- */

  async #tick() {
    const peers = [...this.getPeers()];
    if (!peers.length) return;

    const budgets = meshBudget(peers.length, { uplink: this.#uplink() });
    const cpu = cpuCeiling(peers.length, navigator.hardwareConcurrency || 4);

    await Promise.all(peers.map((p) => this.#tickPeer(p, budgets, cpu)));
    this.emit("update", this.samples);
  }

  /**
   * Quanto esta máquina consegue ENVIAR, somando todas as conexões.
   *
   * Era aqui que a chamada desmanchava ao compartilhar tela. O orçamento da
   * malha partia de um palpite fixo de 8 Mbps de subida; quem tem 3 Mbps — ou
   * está no 4G, ou num Wi-Fi ruim — recebia um teto três vezes maior do que o
   * enlace aguenta. Cada conexão então enchia a fila do roteador até perder
   * pacote, e o congelamento aparecia em TODO MUNDO ao mesmo tempo, não só em
   * quem transmitia.
   *
   * `availableOutgoingBitrate` é a estimativa do controle de congestionamento
   * de cada conexão. Numa malha elas dividem o mesmo enlace, então a soma
   * aproxima a capacidade real — é o número que o navegador já descobriu na
   * prática, e não um palpite nosso.
   *
   * A suavização é PROPOSITALMENTE assimétrica: cai na hora, sobe devagar.
   * Reagir rápido à piora é o que evita o congelamento; subir devagar é o que
   * evita ficar oscilando entre nítido e borrado a cada segundo.
   *
   * ponytail: estimativa agregada, boa o bastante para dimensionar o teto.
   * Um medidor de verdade (sondagem ativa em banda) só se valer a pena.
   */
  #uplinkEma = 0;
  #uplink() {
    let total = 0;
    for (const amostra of this.samples.values()) {
      total += amostra?.transport?.availableOutgoing || 0;
    }
    if (!total) return this.#uplinkEma || undefined; // sem medida ainda: o padrão vale

    const teto = clamp(total, 400_000, 25_000_000);
    this.#uplinkEma = this.#uplinkEma
      ? teto < this.#uplinkEma
        ? teto // piorou: acompanha na hora
        : this.#uplinkEma + (teto - this.#uplinkEma) * 0.15 // melhorou: com calma
      : teto;
    return this.#uplinkEma;
  }

  async #tickPeer(peer, budgets, cpu) {
    const report = await peer.getStats();
    if (!report) return;

    const prev = this.#prev.get(peer.id);
    const sample = this.#read(peer, report, prev);
    this.#prev.set(peer.id, report);
    this.samples.set(peer.id, sample);

    const hist = this.#history.get(peer.id) || [];
    const outKbps = Math.round(
      ((sample.outbound.screen?.bitrate || 0) + (sample.outbound.cam?.bitrate || 0)) / 1000,
    );
    hist.push(outKbps);
    if (hist.length > HISTORY) hist.shift();
    this.#history.set(peer.id, hist);

    if (this.adaptive) await this.#adapt(peer, sample, budgets, cpu);
  }

  /* ---------------------------------------------------------------- *
   * Leitura
   * ---------------------------------------------------------------- */

  #read(peer, report, prev) {
    const sample = emptySample();
    const byId = new Map();
    report.forEach((r) => byId.set(r.id, r));

    /**
     * Resolve a qual papel (microfone, câmera, tela) um relatório pertence.
     * O `mid` é o caminho certo e estável, mas nem todo navegador o expõe nos
     * relatórios de RTP; nesse caso caímos no identificador da trilha, que
     * sempre está lá.
     */
    const roleOf = (r, direction) => {
      if (r.mid != null) {
        for (const [role, tx] of Object.entries(peer.tx)) {
          if (tx?.mid != null && String(tx.mid) === String(r.mid)) return role;
        }
      }
      const trackId = r.trackIdentifier;
      if (trackId) {
        for (const [role, tx] of Object.entries(peer.tx)) {
          const track = direction === "out" ? tx?.sender?.track : tx?.receiver?.track;
          if (track && track.id === trackId) return role;
        }
      }
      // Último recurso: o tipo de mídia basta para distinguir áudio de vídeo,
      // e entre os dois vídeos a tela é a que tem resolução maior.
      if (r.kind === "audio") return "mic";
      return null;
    };
    const keyOf = (role) =>
      role === "screen" ? "screen" : role === "cam" ? "cam" : role === "mic" ? "mic" : null;

    report.forEach((r) => {
      if (r.type === "outbound-rtp") {
        const key = keyOf(roleOf(r, "out"));
        if (!key) return;
        const before = prev?.get(r.id);
        sample.outbound[key] = this.#outbound(r, before, byId);
      } else if (r.type === "inbound-rtp") {
        const key = keyOf(roleOf(r, "in"));
        if (!key) return;
        const before = prev?.get(r.id);
        sample.inbound[key] = this.#inbound(r, before);
      } else if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") {
        sample.transport.rtt = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : null;
        sample.transport.availableOutgoing = r.availableOutgoingBitrate ?? null;
        sample.transport.availableIncoming = r.availableIncomingBitrate ?? null;
        sample.transport.localType = byId.get(r.localCandidateId)?.candidateType ?? null;
        sample.transport.remoteType = byId.get(r.remoteCandidateId)?.candidateType ?? null;
      }
    });

    const ema = this.#ema.get(peer.id) || { rtt: new Ema(0.35), loss: new Ema(0.35) };
    this.#ema.set(peer.id, ema);
    if (sample.transport.rtt != null) ema.rtt.push(sample.transport.rtt);
    const loss = Math.max(
      sample.outbound.screen?.lossPct ?? 0,
      sample.outbound.cam?.lossPct ?? 0,
      sample.inbound.screen?.lossPct ?? 0,
      sample.inbound.cam?.lossPct ?? 0,
    );
    ema.loss.push(loss);

    const { quality, score } = gradeConnection({
      rtt: ema.rtt.value,
      lossPct: ema.loss.value,
      limited:
        sample.outbound.screen?.limitedBy || sample.outbound.cam?.limitedBy || "none",
      state: peer.connectionState,
      freezes: sample.inbound.screen?.freezeRatio ?? sample.inbound.cam?.freezeRatio ?? 0,
    });
    sample.quality = quality;
    sample.score = score;
    sample.rttSmoothed = ema.rtt.value;
    sample.lossSmoothed = ema.loss.value;
    sample.relay = sample.transport.localType === "relay" || sample.transport.remoteType === "relay";

    return sample;
  }

  #outbound(r, before, byId) {
    const dt = before ? (r.timestamp - before.timestamp) / 1000 : 0;
    const bitrate = dt > 0 ? ((r.bytesSent - before.bytesSent) * 8) / dt : 0;

    const durations = r.qualityLimitationDurations || {};
    const beforeDur = before?.qualityLimitationDurations || {};
    const share = (k) => (dt > 0 ? ((durations[k] || 0) - (beforeDur[k] || 0)) / dt : 0);

    // O relatório remoto conta a perda que o OUTRO lado viu na nossa trilha.
    let lossPct = null;
    if (r.remoteId) {
      const rem = byId.get(r.remoteId);
      if (rem?.fractionLost != null) lossPct = rem.fractionLost * 100;
    }

    const encodeMs =
      before && r.framesEncoded > before.framesEncoded
        ? ((r.totalEncodeTime - before.totalEncodeTime) /
            (r.framesEncoded - before.framesEncoded)) *
          1000
        : null;

    return {
      bitrate,
      fps: r.framesPerSecond ?? null,
      width: r.frameWidth ?? null,
      height: r.frameHeight ?? null,
      limitedBy: r.qualityLimitationReason || "none",
      cpuShare: share("cpu"),
      bwShare: share("bandwidth"),
      resolutionChanges: r.qualityLimitationResolutionChanges ?? 0,
      targetBitrate: r.targetBitrate ?? null,
      encodeMs,
      lossPct,
      codec: byId.get(r.codecId)?.mimeType?.replace("video/", "").replace("audio/", "") ?? null,
      bytes: r.bytesSent ?? 0,
    };
  }

  #inbound(r, before) {
    const dt = before ? (r.timestamp - before.timestamp) / 1000 : 0;
    const bitrate = dt > 0 ? ((r.bytesReceived - before.bytesReceived) * 8) / dt : 0;

    let lossPct = null;
    if (before) {
      const dLost = (r.packetsLost || 0) - (before.packetsLost || 0);
      const dRecv = (r.packetsReceived || 0) - (before.packetsReceived || 0);
      const total = dLost + dRecv;
      if (total > 0) lossPct = clamp((dLost / total) * 100, 0, 100);
    }

    const freezeDelta = before
      ? (r.totalFreezesDuration || 0) - (before.totalFreezesDuration || 0)
      : 0;

    return {
      bitrate,
      fps: r.framesPerSecond ?? null,
      width: r.frameWidth ?? null,
      height: r.frameHeight ?? null,
      jitter: r.jitter != null ? r.jitter * 1000 : null,
      lossPct,
      freezeCount: r.freezeCount ?? 0,
      freezeRatio: dt > 0 ? clamp(freezeDelta / dt, 0, 1) : 0,
      jitterBufferMs:
        r.jitterBufferEmittedCount > 0
          ? (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000
          : null,
      bytes: r.bytesReceived ?? 0,
    };
  }

  /* ---------------------------------------------------------------- *
   * Adaptação
   * ---------------------------------------------------------------- */

  async #adapt(peer, sample, budgets, cpu) {
    const screen = sample.outbound.screen;
    const hasScreen = !!peer.tx.screen?.sender?.track;
    if (!hasScreen || !screen) return;

    let budget = this.#budget.get(peer.id);
    if (!budget) {
      budget = { screen: budgets.screen, camera: budgets.camera };
      this.#budget.set(peer.id, budget);
    }

    const avail = sample.transport.availableOutgoing;
    const before = budget.screen;

    if (screen.cpuShare > 0.3) {
      // Limitado por processador: derrubar quadros preserva a legibilidade
      // muito melhor do que encolher a imagem.
      budget.screen = Math.max(FLOOR.screen, budget.screen * 0.8);
      budget.framerate = Math.min(budget.framerate ?? cpu.maxFramerate, 15);
      this.emit("limited", { peerId: peer.id, reason: "cpu" });
    } else if (screen.bwShare > 0.3 || (sample.lossSmoothed ?? 0) > 3) {
      budget.screen = Math.max(
        FLOOR.screen,
        Math.min(budget.screen * 0.75, (avail || budget.screen) * 0.9),
      );
      this.emit("limited", { peerId: peer.id, reason: "bandwidth" });
    } else if ((screen.fps ?? 0) >= 15 && avail && avail > budget.screen * 1.4) {
      // Recuperação deliberadamente lenta.
      budget.screen = Math.min(CEIL.screen, budgets.screen, budget.screen * 1.15);
      budget.framerate = cpu.maxFramerate;
    }

    budget.screen = clamp(budget.screen, FLOOR.screen, Math.min(CEIL.screen, budgets.screen));

    if (Math.abs(budget.screen - before) / Math.max(1, before) > 0.05 || budget.framerate) {
      await peer.setScreenBudget({
        maxBitrate: budget.screen,
        maxFramerate: budget.framerate ?? cpu.maxFramerate,
        scaleResolutionDownBy: cpu.scaleResolutionDownBy,
        profile: peer.screenProfile,
      });
    }

    // A câmera cede espaço para a tela quando as duas estão ligadas.
    if (peer.tx.cam?.sender?.track) {
      const camTarget = clamp(budgets.camera, FLOOR.camera, CEIL.camera);
      if (camTarget !== budget.camera) {
        budget.camera = camTarget;
        await peer.setCameraBudget({ maxBitrate: camTarget, maxFramerate: cpu.maxFramerate });
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Nota de qualidade
 * ------------------------------------------------------------------ */

/**
 * Converte as métricas em uma nota de 0 a 4 e um rótulo. Serve para as
 * barrinhas de sinal em cada participante — e para avisar antes de a chamada
 * ficar ruim, não depois.
 */
export function gradeConnection({ rtt, lossPct, limited, state, freezes }) {
  if (state === "failed" || state === "closed") return { quality: "poor", score: 0 };
  if (state !== "connected") return { quality: "unknown", score: 0 };
  if (rtt == null && lossPct == null) return { quality: "unknown", score: 0 };

  let score = 4;
  const r = rtt ?? 0;
  const l = lossPct ?? 0;

  if (r > 500) score -= 3;
  else if (r > 300) score -= 2;
  else if (r > 150) score -= 1;

  if (l > 8) score -= 3;
  else if (l > 4) score -= 2;
  else if (l > 1.5) score -= 1;

  if ((freezes ?? 0) > 0.15) score -= 1;
  if (limited === "bandwidth") score -= 1;
  else if (limited === "cpu") score -= 0.5;

  score = clamp(Math.round(score), 0, 4);
  const quality = score >= 3 ? "good" : score >= 2 ? "fair" : "poor";
  return { quality, score };
}

export const QUALITY_ICON = {
  good: "network-4",
  fair: "network-2",
  poor: "network-1",
  unknown: "network-0",
};

export const QUALITY_LABEL = {
  good: "Conexão boa",
  fair: "Conexão instável",
  poor: "Conexão ruim",
  unknown: "Medindo a conexão",
};
