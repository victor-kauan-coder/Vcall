/**
 * features/recorder.js — gravação local da chamada.
 *
 * O que decide o desenho deste arquivo:
 *
 * 1. A GRAVAÇÃO É SUA, NA SUA MÁQUINA. Nada sobe para servidor nenhum: o
 *    arquivo nasce e morre no seu computador. Numa chamada criptografada
 *    ponta a ponta, gravar no servidor exigiria quebrar a criptografia — é
 *    justamente o que o app não faz.
 *
 * 2. O VÍDEO É UMA TRILHA SÓ. Compor N câmeras num mosaico exigiria desenhar
 *    cada quadro num canvas e recodificar tudo, e o custo disso aparece como
 *    engasgo na chamada ao vivo — quem grava iria prejudicar quem só
 *    conversa. Grava-se a trilha em destaque (a tela compartilhada, ou a
 *    câmera de quem estiver em foco), que é o que importa em quase toda
 *    reunião gravada.
 *
 * 3. O ÁUDIO É DE TODO MUNDO. Aí sim vale misturar: somar trilhas de áudio é
 *    barato e uma gravação sem as respostas não serve para nada. A mistura
 *    sai do MESMO contexto de áudio da chamada (core/audio-graph.js) — criar
 *    um segundo contexto para o mesmo stream faz o Chrome entregar silêncio a
 *    um dos dois, que é o problema que aquele módulo existe para evitar.
 */
import { Emitter } from "../lib/emitter.js";
import { audioContext, sourceFor, releaseSource } from "../core/audio-graph.js";

/** Candidatos em ordem de preferência: o primeiro que o navegador aceitar. */
const TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

const AUDIO_ONLY_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export const canRecord = typeof window.MediaRecorder === "function";

function pickType(list) {
  if (!canRecord) return null;
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

export class CallRecorder extends Emitter {
  recording = false;
  startedAt = 0;

  #rec = null;
  #chunks = [];
  #dest = null;
  #mixed = [];
  #stream = null;
  #type = "";

  /**
   * @param {object} opts
   * @param {MediaStreamTrack|null} opts.video trilha em destaque; null grava só o áudio
   * @param {MediaStream[]} opts.audioStreams todos os streams a misturar
   */
  start({ video = null, audioStreams = [] } = {}) {
    if (!canRecord || this.recording) return false;

    const tracks = [];
    if (video && video.readyState === "live") tracks.push(video);

    const audio = this.#mixAudio(audioStreams);
    if (audio) tracks.push(audio);

    if (!tracks.length) {
      this.emit("error", new Error("nada para gravar"));
      return false;
    }

    this.#type = pickType(video ? TYPES : AUDIO_ONLY_TYPES) || "";
    this.#stream = new MediaStream(tracks);
    try {
      this.#rec = new MediaRecorder(this.#stream, this.#type ? { mimeType: this.#type } : undefined);
    } catch (err) {
      this.#cleanup();
      this.emit("error", err);
      return false;
    }

    this.#chunks = [];
    this.#rec.ondataavailable = (e) => {
      if (e.data?.size) this.#chunks.push(e.data);
    };
    this.#rec.onerror = (e) => this.emit("error", e.error || e);
    this.#rec.onstop = () => this.#finish();

    // Pedaços de um segundo: se o navegador fechar no meio, o que já foi
    // entregue continua sendo um arquivo aproveitável.
    this.#rec.start(1000);
    this.recording = true;
    this.startedAt = Date.now();
    this.emit("state", { recording: true });

    // A tela compartilhada pode acabar antes de a gravação parar. Encerrar
    // junto evita um arquivo com meia hora de quadro congelado no fim.
    if (video) video.addEventListener("ended", () => this.stop(), { once: true });
    return true;
  }

  stop() {
    if (!this.recording || !this.#rec) return false;
    this.recording = false;
    try {
      this.#rec.stop();
    } catch {
      this.#finish();
    }
    return true;
  }

  toggle(opts) {
    return this.recording ? this.stop() : this.start(opts);
  }

  get elapsed() {
    return this.recording ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  /* ---------------------------------------------------------------- */

  #mixAudio(streams) {
    const ctx = audioContext();
    const live = streams.filter((s) => s && s.getAudioTracks().some((t) => t.readyState === "live"));
    if (!ctx || !live.length) return null;

    const dest = ctx.createMediaStreamDestination();
    for (const s of live) {
      const src = sourceFor(s);
      if (!src) continue;
      // Ligar a mesma origem a um segundo destino não tira som dos alto-falantes:
      // um nó do Web Audio alimenta quantas saídas forem ligadas nele.
      src.connect(dest);
      this.#mixed.push({ stream: s, node: src });
    }
    if (!this.#mixed.length) return null;
    this.#dest = dest;
    return dest.stream.getAudioTracks()[0] || null;
  }

  #finish() {
    const chunks = this.#chunks;
    this.#chunks = [];
    this.#cleanup();
    this.recording = false;
    this.emit("state", { recording: false });
    if (!chunks.length) {
      this.emit("error", new Error("gravação vazia"));
      return;
    }
    const blob = new Blob(chunks, { type: this.#type || "video/webm" });
    this.emit("done", { blob, type: this.#type, ext: this.#type.includes("mp4") ? "mp4" : "webm" });
  }

  #cleanup() {
    for (const m of this.#mixed) {
      try {
        m.node.disconnect(this.#dest);
      } catch {
        /* já desconectado */
      }
      releaseSource(m.stream);
    }
    this.#mixed = [];
    this.#dest = null;
    this.#stream = null;
    this.#rec = null;
  }
}
