/**
 * features/fala-whisper.js — legendas no app de mesa com o Whisper.
 *
 * O caminho do áudio:
 *
 *   microfone da chamada ─► AudioWorklet (16 kHz) ─► Segmentador ─► worker
 *                                                   (quem fala?)   (Whisper)
 *
 * O Whisper não é um reconhecedor "ao vivo": ele lê um trecho de áudio e
 * devolve o texto. Por isso o Segmentador corta a fala em frases — começa
 * quando a voz sobe acima do ruído de fundo e termina depois de uma pausa
 * curta. Enquanto a pessoa ainda está falando, o trecho parcial é mandado de
 * tempos em tempos e a legenda vai aparecendo; quando a frase termina, sai o
 * texto final, que é o que entra na transcrição.
 *
 * Nada sai do computador: o modelo roda aqui, e só o texto vai para a sala.
 */
import { Emitter } from "../lib/emitter.js";

const TAXA = 16_000;
const QUADRO = 320; // 20 ms

/**
 * Corta o áudio em frases. Puro (sem Web Audio): testável em Node.
 *
 * - O limiar acompanha o ruído de fundo: numa sala com ventilador, o que
 *   conta como "voz" sobe junto com ele.
 * - A frase leva 300 ms de antes de a voz ser detectada — sem isso a
 *   primeira sílaba ("Bom dia") saía cortada ("om dia").
 * - Pausa de 700 ms encerra a frase; 14 s é o máximo (depois disso a
 *   legenda ficaria esperando demais).
 */
export class Segmentador extends Emitter {
  #ruido = 0.004;
  #acima = 0;
  #silencio = 0;
  #falando = false;
  /** @type {Float32Array[]} */ #frase = [];
  #amostras = 0;
  /** @type {Float32Array[]} */ #antes = [];
  #resto = new Float32Array(0);
  #ultimoParcial = 0;

  constructor({ preRollMs = 300, pausaMs = 700, maxMs = 14_000, parcialMs = 1200, minMs = 350 } = {}) {
    super();
    this.preRoll = Math.round(preRollMs / 20);
    this.pausa = Math.round(pausaMs / 20);
    this.maxAmostras = (maxMs / 1000) * TAXA;
    this.parcialAmostras = (parcialMs / 1000) * TAXA;
    this.minAmostras = (minMs / 1000) * TAXA;
  }

  get falando() {
    return this.#falando;
  }

  /** Recebe áudio (16 kHz, mono) em blocos de qualquer tamanho. */
  alimentar(bloco) {
    let dados = bloco;
    if (this.#resto.length) {
      dados = new Float32Array(this.#resto.length + bloco.length);
      dados.set(this.#resto);
      dados.set(bloco, this.#resto.length);
    }
    let i = 0;
    for (; i + QUADRO <= dados.length; i += QUADRO) this.#quadro(dados.subarray(i, i + QUADRO));
    this.#resto = dados.slice(i);
  }

  /** Encerra a frase em andamento (a legenda foi desligada, o microfone mutado). */
  encerrar() {
    if (this.#falando) this.#fim();
  }

  #quadro(q) {
    let soma = 0;
    for (let k = 0; k < q.length; k += 1) soma += q[k] * q[k];
    const rms = Math.sqrt(soma / q.length);
    const limiar = Math.max(0.008, this.#ruido * 3.2);
    const voz = rms > limiar;
    const copia = q.slice(0);

    if (!this.#falando) {
      // Fora da fala, o nível médio É o ruído de fundo.
      this.#ruido = this.#ruido * 0.97 + Math.min(rms, 0.05) * 0.03;
      this.#antes.push(copia);
      if (this.#antes.length > this.preRoll) this.#antes.shift();
      this.#acima = voz ? this.#acima + 1 : 0;
      if (this.#acima >= 3) {
        this.#falando = true;
        this.#silencio = 0;
        this.#frase = [...this.#antes];
        this.#amostras = this.#frase.length * QUADRO;
        this.#antes = [];
        this.#ultimoParcial = this.#amostras;
        this.emit("inicio");
      }
      return;
    }

    this.#frase.push(copia);
    this.#amostras += QUADRO;
    this.#silencio = voz ? 0 : this.#silencio + 1;

    if (this.#silencio >= this.pausa || this.#amostras >= this.maxAmostras) {
      this.#fim();
      return;
    }
    if (this.#amostras - this.#ultimoParcial >= this.parcialAmostras) {
      this.#ultimoParcial = this.#amostras;
      this.emit("parcial", this.#juntar());
    }
  }

  #fim() {
    const audio = this.#juntar();
    const curta = this.#amostras < this.minAmostras;
    this.#falando = false;
    this.#frase = [];
    this.#amostras = 0;
    this.#acima = 0;
    // Uma "frase" curtíssima quase sempre é clique, tosse ou teclado.
    this.emit("fim", curta ? null : audio);
  }

  #juntar() {
    const out = new Float32Array(this.#frase.length * QUADRO);
    this.#frase.forEach((q, k) => out.set(q, k * QUADRO));
    return out;
  }
}

/* ------------------------------------------------------------------ */

let worker = null;
/** Promessa do modelo aberto no worker, por "nível:idioma". */
let aberto = null;
let chaveAberta = "";

export const whisperDisponivel = () => typeof window.vcallDesktop?.prepararWhisper === "function";

export class FalaWhisper extends Emitter {
  #ativo = false;
  #ctx = null;
  #no = null;
  #fonte = null;
  #clone = null;
  #acompanhar = 0;
  #seg = null;
  #proxId = 1;
  /** id da frase atual: parciais de uma frase já encerrada são descartados. */
  #frase = 0;
  #ocupado = false;
  /** Finais esperando o worker (nunca descartados). */
  #fila = [];
  #parcialPendente = null;

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
    worker?.terminate();
    worker = new Worker("/js/features/whisper-worker.js", { type: "module" });
    chaveAberta = chave;
    aberto = (async () => {
      this.emit("status", { fase: "baixando", p: 0 });
      const { base, modelo } = await window.vcallDesktop.prepararWhisper(this.nivel, (p) =>
        this.emit("status", { fase: "baixando", p }),
      );
      this.emit("status", { fase: "carregando" });
      await new Promise((resolve, reject) => {
        const aoMsg = ({ data }) => {
          if (data.tipo === "pronto") {
            worker.removeEventListener("message", aoMsg);
            resolve(data);
          } else if (data.tipo === "erro" && data.id == null) {
            worker.removeEventListener("message", aoMsg);
            reject(new Error(data.mensagem));
          }
        };
        worker.addEventListener("message", aoMsg);
        worker.addEventListener("error", (e) => reject(new Error(e.message || "o reconhecedor de fala não abriu")), { once: true });
        worker.postMessage({ tipo: "abrir", base, modelo, idioma: this.lang });
      });
    })();
    try {
      await aberto;
    } catch (err) {
      aberto = null;
      chaveAberta = "";
      worker?.terminate();
      worker = null;
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
    // da chamada. O `enabled` acompanha o original — mudo é silêncio.
    const clone = trilha.clone();
    const acompanhar = () => {
      if (clone.enabled !== trilha.enabled) {
        clone.enabled = trilha.enabled;
        if (!trilha.enabled) this.#seg?.encerrar();
      }
    };
    this.#acompanhar = setInterval(acompanhar, 250);
    clone.enabled = trilha.enabled;

    const fonte = ctx.createMediaStreamSource(new MediaStream([clone]));
    const no = new AudioWorkletNode(ctx, "vcall-captura");
    const seg = new Segmentador();
    seg.on("inicio", () => {
      this.#frase = this.#proxId++;
      this.emit("falando", true);
    });
    seg.on("parcial", (audio) => this.#pedir(audio, false));
    seg.on("fim", (audio) => {
      this.emit("falando", false);
      if (audio) this.#pedir(audio, true);
    });
    no.port.onmessage = ({ data }) => seg.alimentar(data);
    fonte.connect(no);
    // Nó sem saída audível: ligado ao destino só para o navegador rodá-lo.
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    no.connect(mudo).connect(ctx.destination);

    worker.onmessage = ({ data }) => this.#aoTexto(data);

    this.#ctx = ctx;
    this.#no = no;
    this.#fonte = fonte;
    this.#clone = clone;
    this.#seg = seg;
  }

  /**
   * Finais nunca se perdem (vão para a fila); parciais só saem com o worker
   * livre — um parcial velho não vale a espera, logo vem outro.
   */
  #pedir(audio, final) {
    const pedido = { id: this.#frase, audio, final };
    if (final) {
      this.#parcialPendente = null;
      this.#fila.push(pedido);
    } else {
      this.#parcialPendente = pedido;
    }
    this.#proximo();
  }

  #proximo() {
    if (this.#ocupado || !worker) return;
    const pedido = this.#fila.shift() || this.#parcialPendente;
    if (!pedido) return;
    if (pedido === this.#parcialPendente) this.#parcialPendente = null;
    this.#ocupado = true;
    worker.postMessage({ tipo: "ouvir", ...pedido }, [pedido.audio.buffer]);
  }

  #aoTexto(data) {
    if (data.tipo === "texto" || data.tipo === "erro") this.#ocupado = false;
    if (data.tipo === "texto" && data.texto) {
      // Parcial de uma frase que já terminou chegaria depois do final e
      // "desfaria" a legenda: descartado.
      if (data.final || data.id === this.#frase) this.emit("result", { text: data.texto, final: data.final, ms: data.ms });
    }
    this.#proximo();
  }

  #desligarAudio() {
    clearInterval(this.#acompanhar);
    this.#seg?.encerrar();
    try {
      this.#no?.disconnect();
      this.#fonte?.disconnect();
    } catch {
      /* já desligados */
    }
    this.#clone?.stop();
    this.#ctx?.close().catch(() => {});
    this.#ctx = this.#no = this.#fonte = this.#clone = this.#seg = null;
  }

  stop() {
    this.#ativo = false;
    this.#desligarAudio();
    this.#fila = [];
    this.#parcialPendente = null;
    this.#ocupado = false;
    // O worker (e o modelo carregado) fica: religar a legenda é instantâneo.
  }
}
