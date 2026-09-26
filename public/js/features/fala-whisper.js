/**
 * features/fala-whisper.js — legendas no app de mesa com o Whisper.
 *
 *   microfone ─► AudioWorklet (16 kHz) ──MessageChannel──► worker
 *                                                         (Silero + Whisper)
 *
 * Esta parte, que roda na página, só liga os fios: abre o modelo, entrega ao
 * worker um canal direto com o AudioWorklet e repassa o texto que volta. O
 * áudio nunca atravessa a thread da página, que fica livre para o vídeo, o
 * canvas e o jogo. Toda a lógica (quando é fala, quando transcrever, o que já
 * está confirmado) vive em features/whisper-worker.js.
 *
 * Nada sai do computador: o modelo roda aqui, e só o texto vai para a sala.
 */
import { Emitter } from "../lib/emitter.js";

const TAXA = 16_000;
/** Legenda desligada por este tempo: o modelo sai da memória. */
const LIBERAR_MS = 5 * 60_000;

let worker = null;
/** Promessa do modelo aberto no worker, por "nível:idioma". */
let aberto = null;
let chaveAberta = "";
let liberar = 0;

export const whisperDisponivel = () => typeof window.vcallDesktop?.prepararWhisper === "function";

function descartarWorker() {
  worker?.terminate();
  worker = null;
  aberto = null;
  chaveAberta = "";
}

export class FalaWhisper extends Emitter {
  #ativo = false;
  #ctx = null;
  #no = null;
  #fonte = null;
  #clone = null;
  #acompanhar = 0;

  /** @param {{lang:string, nivel:string, trilha:() => MediaStreamTrack|null}} opts */
  constructor({ lang, nivel = "equilibrada", trilha }) {
    super();
    this.lang = lang;
    this.nivel = nivel;
    this.trilha = trilha;
  }

  get ativo() {
    return this.#ativo;
  }

  async start() {
    if (this.#ativo) return;
    this.#ativo = true;
    clearTimeout(liberar);
    try {
      await this.#abrirModelo();
      if (!this.#ativo) return;
      await this.#ligarAudio();
      this.emit("status", { fase: "pronto" });
    } catch (err) {
      this.#ativo = false;
      this.#desligarAudio();
      throw err;
    }
  }

  async #abrirModelo() {
    const chave = `${this.nivel}:${this.lang}`;
    if (aberto && chaveAberta === chave) return aberto;
    descartarWorker();
    const exp = window.__vcallExp ? `?exp=${encodeURIComponent(window.__vcallExp)}` : "";
    worker = new Worker(`/js/features/whisper-worker.js${exp}`, { type: "module" });
    chaveAberta = chave;
    const w = worker;
    aberto = (async () => {
      this.emit("status", { fase: "baixando", p: 0 });
      const { base, modelo, curto, dtype, folgaS } = await window.vcallDesktop.prepararWhisper(this.nivel, (p) =>
        this.emit("status", { fase: "baixando", p }),
      );
      this.emit("status", { fase: "carregando" });
      return new Promise((resolve, reject) => {
        const aoMsg = ({ data }) => {
          if (data.tipo === "pronto") {
            w.removeEventListener("message", aoMsg);
            resolve(data);
          } else if (data.tipo === "erro" && data.id == null) {
            w.removeEventListener("message", aoMsg);
            reject(new Error(data.mensagem));
          }
        };
        w.addEventListener("message", aoMsg);
        w.addEventListener("error", (e) => reject(new Error(e.message || "o reconhecedor de fala não abriu")), { once: true });
        w.postMessage({
          tipo: "abrir",
          base,
          modelo,
          curto: !!curto,
          folgaS,
          dtype: dtype === "fp32" ? { encoder_model: "fp32", decoder_model_merged: "q8" } : null,
          idioma: this.lang,
          vad: "/vendor/whisper/silero_vad_v5.onnx",
        });
      });
    })();
    try {
      await aberto;
    } catch (err) {
      descartarWorker();
      // Modelo corrompido: apaga, para a próxima tentativa baixar de novo.
      if (/não abriu|onnx|protobuf/i.test(err?.message || "")) window.vcallDesktop?.descartarWhisper?.(this.nivel);
      throw err;
    }
    return aberto;
  }

  async #ligarAudio() {
    const trilha = this.trilha();
    if (!trilha) throw new Error("sem microfone para legendar");

    // O navegador converte para 16 kHz sozinho: é a taxa que o Whisper lê.
    const ctx = new AudioContext({ sampleRate: TAXA });
    await ctx.audioWorklet.addModule("/js/features/captura-worklet.js");
    // Uma trilha própria (clone): parar a legenda não pode parar o microfone
    // da chamada. Mudo = o worker nem processa (zero CPU).
    const clone = trilha.clone();
    const acompanhar = () => {
      if (clone.enabled === trilha.enabled) return;
      clone.enabled = trilha.enabled;
      worker?.postMessage({ tipo: "pausa", on: !trilha.enabled });
    };
    this.#acompanhar = setInterval(acompanhar, 250);
    clone.enabled = trilha.enabled;

    const fonte = ctx.createMediaStreamSource(new MediaStream([clone]));
    const no = new AudioWorkletNode(ctx, "vcall-captura");
    // Canal direto AudioWorklet → worker.
    const canal = new MessageChannel();
    no.port.postMessage({ porta: canal.port1 }, [canal.port1]);
    worker.postMessage({ tipo: "reiniciar" });
    worker.postMessage({ tipo: "pausa", on: !trilha.enabled });
    worker.postMessage({ tipo: "audio", porta: canal.port2 }, [canal.port2]);
    fonte.connect(no);
    // Nó sem saída audível: ligado ao destino só para o navegador rodá-lo.
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    no.connect(mudo).connect(ctx.destination);

    worker.onmessage = ({ data }) => this.#aoWorker(data);

    this.#ctx = ctx;
    this.#no = no;
    this.#fonte = fonte;
    this.#clone = clone;
  }

  #aoWorker(data) {
    if (!this.#ativo) return;
    if (data.tipo === "falando") this.emit("falando", !!data.on);
    else if (data.tipo === "parcial") {
      const text = [data.confirmado, data.provisorio].filter(Boolean).join(" ");
      if (text) this.emit("result", { text, final: false, confirmado: data.confirmado || "" });
    } else if (data.tipo === "final" && data.texto) {
      this.emit("result", { text: data.texto, final: true, ms: data.ms });
    } else if (data.tipo === "erro") {
      console.warn("[legendas]", data.mensagem);
    }
  }

  #desligarAudio() {
    clearInterval(this.#acompanhar);
    try {
      this.#no?.disconnect();
      this.#fonte?.disconnect();
    } catch {
      /* já desligados */
    }
    this.#clone?.stop();
    this.#ctx?.close().catch(() => {});
    this.#ctx = this.#no = this.#fonte = this.#clone = null;
  }

  stop() {
    if (!this.#ativo) return;
    this.#ativo = false;
    worker?.postMessage({ tipo: "pausa", on: true });
    this.#desligarAudio();
    // O modelo fica na memória por um tempo (religar é instantâneo) e depois
    // sai: centenas de MB não ficam presos por uma legenda desligada.
    clearTimeout(liberar);
    liberar = setTimeout(descartarWorker, LIBERAR_MS);
  }
}
