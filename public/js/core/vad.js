/**
 * core/vad.js — detecção de quem está falando.
 *
 * Um único AudioContext analisa todas as trilhas. A escolha de quem vai para o
 * destaque tem histerese: sem ela, o vídeo principal pisca a cada tosse e a
 * chamada fica cansativa de assistir.
 */
import { Emitter } from "../lib/emitter.js";
import { audioContext, resumeAudio, sourceFor, releaseSource, contextState } from "./audio-graph.js";

const FFT_SIZE = 512;
const DEFAULT_THRESHOLD = 0.055; // energia RMS normalizada
const RELEASE_MS = 900; // silêncio necessário para "parou de falar"
const SWITCH_MS = 1500; // tempo mínimo no destaque antes de trocar

export class VoiceActivity extends Emitter {
  #sources = new Map(); // id -> { analyser, data, stream, speaking, lastLoud }
  #raf = 0;
  #activeId = null;
  #activeSince = 0;

  levels = new Map(); // id -> 0..1

  /**
   * Limiar de fala, ajustável. Microfone de notebook em sala barulhenta pede
   * um valor mais alto; headset num escritório silencioso pede mais baixo.
   */
  threshold = DEFAULT_THRESHOLD;

  setThreshold(v) {
    const n = Number(v);
    if (Number.isFinite(n)) this.threshold = Math.min(Math.max(n, 0.005), 0.4);
    return this.threshold;
  }

  /** Nível atual de um participante, 0..1. */
  levelOf(id) {
    return this.levels.get(id) || 0;
  }

  get activeSpeaker() {
    return this.#activeId;
  }

  /** O contexto só pode começar depois de um gesto do usuário. */
  resume() {
    resumeAudio();
    return audioContext();
  }

  /**
   * Passa a acompanhar o áudio de um participante.
   *
   * A origem vem do grafo compartilhado (core/audio-graph.js), e não de um
   * `createMediaStreamSource` próprio: criar uma segunda origem para o mesmo
   * stream faz o Chrome entregar silêncio a um dos consumidores — e quem
   * perdia era a saída de áudio, deixando a chamada muda.
   */
  track(id, stream) {
    if (!stream || !stream.getAudioTracks().length) return;
    const ctx = this.resume();
    if (!ctx) return;
    this.untrack(id);

    const source = sourceFor(stream);
    if (!source) return;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    // Só escuta: o analisador não é ligado ao destino, senão haveria eco.
    source.connect(analyser);

    this.#sources.set(id, {
      stream,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      speaking: false,
      lastLoud: 0,
    });
    this.#ensureLoop();
  }

  untrack(id) {
    const entry = this.#sources.get(id);
    if (!entry) return;
    try {
      entry.analyser.disconnect();
    } catch {
      /* já desconectado */
    }
    releaseSource(entry.stream);
    this.#sources.delete(id);
    this.levels.delete(id);
    if (this.#activeId === id) this.#activeId = null;
  }

  stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    for (const id of [...this.#sources.keys()]) this.untrack(id);
    // O contexto é compartilhado; quem o fecha é quem encerra a chamada.
  }

  /** Diagnóstico. */
  debug() {
    return {
      context: contextState(),
      tracked: [...this.#sources.keys()],
      levels: Object.fromEntries(this.levels),
    };
  }

  /* ---------------------------------------------------------------- */

  #ensureLoop() {
    if (this.#raf) return;
    const loop = () => {
      this.#raf = requestAnimationFrame(loop);
      this.#measure();
    };
    this.#raf = requestAnimationFrame(loop);
  }

  #measure() {
    if (!this.#sources.size) return;
    const now = performance.now();
    let loudest = null;
    let loudestLevel = 0;

    for (const [id, s] of this.#sources) {
      s.analyser.getByteTimeDomainData(s.data);
      // RMS sobre a forma de onda: mede energia, não brilho espectral.
      let sum = 0;
      for (let i = 0; i < s.data.length; i += 1) {
        const v = (s.data[i] - 128) / 128;
        sum += v * v;
      }
      const level = Math.sqrt(sum / s.data.length);
      this.levels.set(id, level);

      const loud = level > this.threshold;
      if (loud) s.lastLoud = now;
      const speaking = loud || now - s.lastLoud < RELEASE_MS;

      if (speaking !== s.speaking) {
        s.speaking = speaking;
        this.emit("speaking", { id, speaking, level });
      }

      if (loud && level > loudestLevel) {
        loudestLevel = level;
        loudest = id;
      }
    }

    // Histerese: só troca o destaque se alguém novo fala e o atual já ficou
    // tempo suficiente na tela.
    if (loudest && loudest !== this.#activeId && now - this.#activeSince > SWITCH_MS) {
      this.#activeId = loudest;
      this.#activeSince = now;
      this.emit("active", loudest);
    }
  }
}
