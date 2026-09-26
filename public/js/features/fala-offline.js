/**
 * features/fala-offline.js — reconhecimento de fala na própria máquina.
 *
 * Usado pelas legendas no aplicativo de mesa, onde o reconhecimento do Chrome
 * não existe (veja desktop/fala.js). O Vosk roda em WebAssembly num worker; o
 * áudio vem do MESMO microfone da chamada — o dispositivo escolhido nas
 * Configurações, e mudo quando o microfone está mudo. Nenhum som sai do
 * computador: só o texto reconhecido vai para a sala.
 */
import { Emitter } from "../lib/emitter.js";

let carregandoVosk = null;

/** Carrega /vendor/vosk.js uma vez só (5 MB: só quando a legenda é ligada). */
function carregarVosk() {
  if (window.Vosk) return Promise.resolve(window.Vosk);
  carregandoVosk ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/vosk.js";
    s.async = true;
    s.onload = () => (window.Vosk ? resolve(window.Vosk) : reject(new Error("vosk.js não expôs o Vosk")));
    s.onerror = () => {
      carregandoVosk = null;
      reject(new Error("não consegui carregar o reconhecedor de fala"));
    };
    document.head.append(s);
  });
  return carregandoVosk;
}

/**
 * Abre o modelo. O `createModel` do vosk-browser só resolve no sucesso: se o
 * modelo falha, a promessa fica pendurada e a tela presa em "Preparando".
 * Aqui o erro do worker e um tempo limite também encerram a espera.
 */
function abrirModelo(Vosk, url, limiteMs = 120_000) {
  return new Promise((resolve, reject) => {
    const modelo = new Vosk.Model(url);
    // O `terminate()` do vosk-browser tenta liberar um modelo que nunca
    // carregou e lança dentro do worker. Encerrar o worker direto é o certo
    // quando a abertura falhou.
    modelo.terminate = () => modelo.worker?.terminate();
    const timer = setTimeout(() => {
      modelo.terminate?.();
      reject(new Error("o reconhecedor de fala demorou demais para abrir"));
    }, limiteMs);
    modelo.on("load", (m) => {
      clearTimeout(timer);
      if (m?.result) resolve(modelo);
      else reject(new Error("o modelo de fala não pôde ser aberto"));
    });
    modelo.on("error", (m) => {
      clearTimeout(timer);
      modelo.terminate?.();
      reject(new Error(`o modelo de fala não abriu${m?.error ? ` (${m.error})` : ""}. Ele será baixado de novo na próxima vez.`));
    });
  });
}

/** Modelos já carregados nesta aba, por idioma (carregar custa segundos). */
const modelos = new Map();

export const falaOfflineDisponivel = () => typeof window.vcallDesktop?.prepararFala === "function";

export class FalaOffline extends Emitter {
  #ctx = null;
  #fonte = null;
  #proc = null;
  #rec = null;
  #ativo = false;

  /** @param {{lang:string, trilha:() => MediaStreamTrack|null}} opts */
  constructor({ lang, trilha }) {
    super();
    this.lang = lang;
    this.trilha = trilha;
  }

  get ativo() {
    return this.#ativo;
  }

  async start() {
    if (this.#ativo) return;
    this.#ativo = true;
    try {
      let modelo = modelos.get(this.lang);
      if (!modelo) {
        this.emit("status", { fase: "baixando", p: 0 });
        const { url } = await window.vcallDesktop.prepararFala(this.lang, (p) =>
          this.emit("status", { fase: "baixando", p }),
        );
        if (!this.#ativo) return;
        this.emit("status", { fase: "carregando" });
        const Vosk = await carregarVosk();
        modelo = await abrirModelo(Vosk, url);
        modelos.set(this.lang, modelo);
      }
      if (!this.#ativo) return;
      await this.#ligarAudio(modelo);
      this.emit("status", { fase: "pronto" });
    } catch (err) {
      this.#ativo = false;
      this.#desligarAudio();
      // Modelo corrompido (download interrompido, disco cheio): apaga as duas
      // cópias — a do disco e a descompactada no IndexedDB — para a próxima
      // tentativa baixar de novo em vez de repetir o mesmo erro para sempre.
      if (/modelo|reconhecedor/.test(err?.message || "")) {
        modelos.delete(this.lang);
        try {
          indexedDB.deleteDatabase("/vosk");
        } catch {
          /* sem IndexedDB: nada guardado */
        }
        window.vcallDesktop?.descartarFala?.(this.lang).catch?.(() => {});
      }
      throw err;
    }
  }

  async #ligarAudio(modelo) {
    const trilha = this.trilha();
    if (!trilha) throw new Error("sem microfone para legendar");

    const ctx = new AudioContext();
    const rec = new modelo.KaldiRecognizer(ctx.sampleRate);
    rec.on("result", (m) => {
      const texto = String(m?.result?.text || "").trim();
      if (texto) this.emit("result", { text: texto, final: true });
    });
    rec.on("partialresult", (m) => {
      const texto = String(m?.result?.partial || "").trim();
      if (texto) this.emit("result", { text: texto, final: false });
    });

    // Uma trilha própria (clone): parar a legenda não pode parar o microfone
    // da chamada. O `enabled` acompanha o do original (mudo = silêncio).
    const clone = trilha.clone();
    const acompanhar = () => (clone.enabled = trilha.enabled);
    this.acompanhar = setInterval(acompanhar, 250);
    acompanhar();

    const fonte = ctx.createMediaStreamSource(new MediaStream([clone]));
    // ScriptProcessor é antigo, mas é o que o vosk-browser aceita direto. A
    // saída é silêncio; ligá-la ao destino só serve para o nó rodar.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      try {
        rec.acceptWaveform(e.inputBuffer);
      } catch {
        /* reconhecedor encerrado no meio de um bloco */
      }
    };
    fonte.connect(proc);
    proc.connect(ctx.destination);

    this.#ctx = ctx;
    this.#fonte = fonte;
    this.#proc = proc;
    this.#rec = rec;
    this.clone = clone;
  }

  #desligarAudio() {
    clearInterval(this.acompanhar);
    try {
      this.#proc?.disconnect();
      this.#fonte?.disconnect();
    } catch {
      /* já desligados */
    }
    try {
      this.#rec?.remove();
    } catch {
      /* já removido */
    }
    this.clone?.stop();
    this.#ctx?.close().catch(() => {});
    this.#ctx = this.#fonte = this.#proc = this.#rec = null;
    this.clone = null;
  }

  stop() {
    this.#ativo = false;
    this.#desligarAudio();
  }
}
