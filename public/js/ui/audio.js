/**
 * ui/audio.js — saída de áudio dos participantes.
 *
 * Receber a trilha não faz som: ela precisa chegar a uma saída. Aqui existem
 * dois caminhos, e o segundo é a garantia de que o primeiro nunca deixe a
 * chamada muda:
 *
 *   1. WEB AUDIO (origem compartilhada → ganho → saída). Permite volume por
 *      participante e ganho acima de 100%.
 *   2. ELEMENTO <audio> tocando direto. Limitado a 100%, mas é o caminho mais
 *      testado que existe num navegador.
 *
 * O elemento é criado sempre, porque é ele que mantém a trilha "puxando"
 * dados da conexão. Enquanto o Web Audio está no comando, ele fica mudo.
 *
 * VERIFICAÇÃO AUTOMÁTICA: há um medidor na entrada e outro na saída do grafo.
 * Se entra sinal e não sai nada, o Web Audio é abandonado e o elemento assume
 * — para a chamada inteira, porque o problema é da máquina. Silêncio nos dois
 * medidores significa apenas que ninguém falou, e não dispara nada. Isso
 * existe porque esse caminho falha em silêncio em algumas máquinas, e um app
 * de chamada mudo sem avisar é pior do que um sem controle de volume.
 *
 * A origem do áudio vem de core/audio-graph.js e é COMPARTILHADA com a
 * detecção de fala. Criar uma segunda origem para o mesmo stream faz o Chrome
 * entregar silêncio a um dos dois — foi exatamente o que deixou a chamada
 * muda numa versão anterior.
 */
import { Emitter } from "../lib/emitter.js";
import { prefs, clamp } from "../lib/util.js";
import { audioContext, contextState, resumeAudio, sourceFor, releaseSource, graphDebug } from "../core/audio-graph.js";

const MAX_GAIN = 1.5; // 150%, como no sistema original
/** Janela da verificação de saída. Generosa: o áudio demora a começar. */
const VERIFY_WINDOW_MS = 6000;

export class RemoteAudio extends Emitter {
  /** chave "peerId:role" -> saída */
  #outputs = new Map();
  #blocked = false;

  #volumes = prefs.get("volumes", {}) || {};
  master = prefs.get("volume:master", 1);

  /**
   * Modo surdo: corta toda a saída remota de uma vez, sem mexer no volume
   * individual de ninguém. Ao desligar, cada pessoa volta exatamente ao
   * volume que tinha — por isso é um interruptor à parte, e não "volume 0".
   */
  deafened = false;
  sinkId = prefs.get("device:spk", null);

  /** Vira true se a verificação reprovar o Web Audio nesta máquina. */
  webAudioDisabled = false;

  get blocked() {
    return this.#blocked;
  }

  /** Chamar dentro de um clique: é o que libera o som. */
  async resume() {
    const running = await resumeAudio();

    const pending = [];
    for (const out of this.#outputs.values()) {
      if (out.el.paused) pending.push(out.el.play().catch(() => {}));
    }
    await Promise.all(pending);

    const stillBlocked =
      (!running && contextState() !== "unavailable") ||
      [...this.#outputs.values()].some((o) => o.el.paused);
    this.#setBlocked(stillBlocked);
    return !stillBlocked;
  }

  #setBlocked(value) {
    if (this.#blocked === value) return;
    this.#blocked = value;
    this.emit("blocked", value);
  }

  /* ---------------------------------------------------------------- *
   * Trilhas
   * ---------------------------------------------------------------- */

  attach(peerId, role, stream) {
    const key = `${peerId}:${role}`;
    if (!stream || !stream.getAudioTracks().length) {
      this.detach(peerId, role);
      return null;
    }

    const existing = this.#outputs.get(key);
    if (existing && existing.stream === stream) return existing;
    if (existing) this.detach(peerId, role);

    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.style.display = "none";
    document.body.append(el);

    const out = {
      key,
      peerId,
      role,
      el,
      stream,
      source: null,
      gain: null,
      inAnalyser: null,
      outAnalyser: null,
      mode: "element",
      volume: this.volumeFor(peerId),
      level: 0,
    };
    this.#outputs.set(key, out);

    this.#useWebAudio(out);
    this.#applySink(el);
    this.#applyVolume(out);

    el.play().catch(() => this.#setBlocked(true));
    if (contextState() === "suspended") this.#setBlocked(true);

    if (out.mode === "webaudio") this.#verify(out);
    return out;
  }

  /** Tenta pôr a saída no Web Audio. Silencioso se não der. */
  #useWebAudio(out) {
    if (this.webAudioDisabled) return false;
    const ctx = audioContext();
    if (!ctx) return false;

    const source = sourceFor(out.stream);
    if (!source) return false;

    try {
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);

      // Dois medidores: um na ENTRADA (o que chega do participante) e outro na
      // SAÍDA (o que de fato vai para os alto-falantes). Comparar os dois é o
      // que distingue "ninguém está falando" de "o som está se perdendo no
      // caminho" — sem essa distinção, qualquer momento de silêncio pareceria
      // uma falha.
      const inAnalyser = ctx.createAnalyser();
      inAnalyser.fftSize = 512;
      source.connect(inAnalyser);

      const outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 512;
      gain.connect(outAnalyser);

      out.source = source;
      out.gain = gain;
      out.inAnalyser = inAnalyser;
      out.outAnalyser = outAnalyser;
      out.meterData = new Uint8Array(512);
      out.mode = "webaudio";
      // O elemento vira só a bomba que mantém a trilha viva.
      out.el.muted = true;
      return true;
    } catch {
      releaseSource(out.stream);
      out.source = null;
      return false;
    }
  }

  /**
   * Verifica se o som realmente atravessa o Web Audio.
   *
   * A troca só acontece com uma evidência inequívoca: entra sinal e não sai
   * nada. Silêncio nos dois lados significa apenas que ninguém falou, e trocar
   * de caminho nesse caso seria trocar o que funciona por outra coisa sem
   * motivo — foi o que aconteceu numa versão anterior desta verificação.
   */
  #verify(out) {
    const started = performance.now();
    let inPeak = 0;
    let outPeak = 0;

    const tick = () => {
      if (!this.#outputs.has(out.key) || out.mode !== "webaudio") return;
      if (this.webAudioDisabled) return;

      inPeak = Math.max(inPeak, this.#read(out.inAnalyser, out) || 0);
      outPeak = Math.max(outPeak, this.#read(out.outAnalyser, out) || 0);

      // Saiu som: está tudo certo, nada mais a fazer.
      if (outPeak > 0.0005) return;

      const level = out.level;
      const track = out.stream.getAudioTracks()[0];
      const podeSoar = level > 0 && track?.readyState === "live" && !track.muted;

      // Entrou som e não saiu: aí sim é falha do caminho.
      if (podeSoar && inPeak > 0.002 && performance.now() - started > 1200) {
        this.#fallbackToElement("o áudio entra no Web Audio e não chega à saída");
        return;
      }

      if (performance.now() - started < VERIFY_WINDOW_MS) setTimeout(tick, 150);
      // Janela encerrada sem sinal de entrada: ninguém falou. Mantém como está.
    };

    setTimeout(tick, 300);
  }

  /** Passa todas as saídas para o elemento e não tenta o Web Audio de novo. */
  #fallbackToElement(reason) {
    if (this.webAudioDisabled) return;
    this.webAudioDisabled = true;
    console.warn(`[vcall] usando o <audio> para a saída: ${reason}`);

    for (const out of this.#outputs.values()) {
      try {
        out.gain?.disconnect();
        out.outAnalyser?.disconnect();
      } catch {
        /* já desconectado */
      }
      // A entrada continua: é ela que alimenta o medidor e a detecção de fala.
      out.gain = null;
      out.outAnalyser = null;
      out.mode = "element";
      out.el.muted = false;
      this.#applyVolume(out);
      out.el.play().catch(() => this.#setBlocked(true));
    }
    this.emit("fallback", reason);
  }

  /**
   * Os streams de áudio remotos que estão tocando agora. Usado pela gravação
   * para misturar as vozes; ler daqui evita uma segunda lista das mesmas
   * trilhas, que ficaria desatualizada quando alguém saísse da sala.
   */
  streams() {
    return [...this.#outputs.values()].map((o) => o.stream).filter(Boolean);
  }

  detach(peerId, role) {
    const key = `${peerId}:${role}`;
    const out = this.#outputs.get(key);
    if (!out) return;
    try {
      out.gain?.disconnect();
      out.inAnalyser?.disconnect();
      out.outAnalyser?.disconnect();
    } catch {
      /* já desconectado */
    }
    if (out.source) releaseSource(out.stream);
    out.el.pause();
    out.el.srcObject = null;
    out.el.remove();
    this.#outputs.delete(key);
  }

  detachPeer(peerId) {
    for (const role of ["mic", "screenAudio"]) this.detach(peerId, role);
  }

  /* ---------------------------------------------------------------- *
   * Volume
   * ---------------------------------------------------------------- */

  volumeFor(peerId) {
    const v = this.#volumes[peerId];
    return typeof v === "number" ? clamp(v, 0, MAX_GAIN) : 1;
  }

  setVolume(peerId, value) {
    const v = clamp(Number(value) || 0, 0, MAX_GAIN);
    this.#volumes[peerId] = v;
    prefs.set("volumes", this.#volumes);

    for (const role of ["mic", "screenAudio"]) {
      const out = this.#outputs.get(`${peerId}:${role}`);
      if (out) {
        out.volume = v;
        this.#applyVolume(out);
      }
    }
    this.emit("volume", { peerId, value: v });
    return v;
  }

  /** Este participante está silenciado só para mim? */
  isMuted(peerId) {
    return this.volumeFor(peerId) === 0;
  }

  setDeafen(value) {
    const v = !!value;
    if (this.deafened === v) return v;
    this.deafened = v;
    for (const out of this.#outputs.values()) this.#applyVolume(out);
    this.emit("deafen", v);
    return v;
  }

  toggleDeafen() {
    return this.setDeafen(!this.deafened);
  }

  toggleMute(peerId) {
    const current = this.volumeFor(peerId);
    if (current > 0) {
      this.#volumes[`${peerId}:last`] = current;
      return this.setVolume(peerId, 0);
    }
    return this.setVolume(peerId, this.#volumes[`${peerId}:last`] || 1);
  }

  setMaster(value) {
    this.master = clamp(Number(value) || 0, 0, MAX_GAIN);
    prefs.set("volume:master", this.master);
    for (const out of this.#outputs.values()) this.#applyVolume(out);
    this.emit("master", this.master);
    return this.master;
  }

  #applyVolume(out) {
    const level = this.deafened ? 0 : out.volume * this.master;
    out.level = level;

    if (out.mode === "webaudio" && out.gain) {
      const ctx = audioContext();
      try {
        out.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
      } catch {
        out.gain.gain.value = level;
      }
      return;
    }
    // O elemento não passa de 100%; acima disso ele fica no máximo.
    out.el.volume = clamp(level, 0, 1);
    out.el.muted = level === 0;
  }

  /* ---------------------------------------------------------------- *
   * Dispositivo de saída
   * ---------------------------------------------------------------- */

  async setSink(deviceId) {
    this.sinkId = deviceId;
    prefs.set("device:spk", deviceId);
    const ctx = audioContext();
    if (ctx?.setSinkId) {
      try {
        await ctx.setSinkId(deviceId || "");
      } catch {
        /* sem suporte */
      }
    }
    await Promise.all([...this.#outputs.values()].map((o) => this.#applySink(o.el)));
    return deviceId;
  }

  async #applySink(el) {
    if (!this.sinkId || typeof el.setSinkId !== "function") return;
    try {
      await el.setSinkId(this.sinkId);
    } catch {
      /* dispositivo sumiu */
    }
  }

  /* ---------------------------------------------------------------- *
   * Medição
   * ---------------------------------------------------------------- */

  #read(analyser, out) {
    if (!analyser || !out?.meterData) return null;
    analyser.getByteTimeDomainData(out.meterData);
    let sum = 0;
    for (const v of out.meterData) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.sqrt(sum / out.meterData.length);
  }

  /**
   * Nível instantâneo, 0..1. Prefere a saída (o que se ouve); se ela não
   * existir — modo elemento —, devolve o que está chegando.
   */
  meter(peerId, role = "mic") {
    const out = this.#outputs.get(`${peerId}:${role}`);
    if (!out) return null;
    return this.#read(out.outAnalyser, out) ?? this.#read(out.inAnalyser, out);
  }

  /** Nível de entrada: o que chega do participante, antes do volume. */
  inputMeter(peerId, role = "mic") {
    const out = this.#outputs.get(`${peerId}:${role}`);
    return out ? this.#read(out.inAnalyser, out) : null;
  }

  debug() {
    return {
      contextState: contextState(),
      graph: graphDebug(),
      webAudio: !this.webAudioDisabled,
      blocked: this.#blocked,
      deafened: this.deafened,
      master: this.master,
      outputs: [...this.#outputs.values()].map((o) => ({
        key: o.key,
        mode: o.mode,
        paused: o.el.paused,
        muted: o.el.muted,
        elVolume: o.el.volume,
        gain: o.level,
        entrada: Number((this.#read(o.inAnalyser, o) ?? -1).toFixed(4)),
        tracks: o.stream.getAudioTracks().length,
        live: o.stream.getAudioTracks()[0]?.readyState,
        trackMuted: o.stream.getAudioTracks()[0]?.muted,
      })),
    };
  }

  stop() {
    for (const key of [...this.#outputs.keys()]) {
      const idx = key.lastIndexOf(":");
      this.detach(key.slice(0, idx), key.slice(idx + 1));
    }
  }
}
