/**
 * features/captions.js — legendas ao vivo e transcrição da reunião.
 *
 * Três decisões sustentam o arquivo:
 *
 * 1. QUEM FALA TRANSCREVE. O reconhecimento roda no microfone de quem está
 *    falando, não no áudio recebido. É a única forma que funciona numa malha
 *    ponto a ponto: o navegador só reconhece bem a trilha local, e transcrever
 *    N trilhas recebidas multiplicaria o custo por N em cada máquina. O texto
 *    pronto viaja como texto — alguns bytes, não áudio.
 *
 * 2. O NAVEGADOR FAZ O TRABALHO. `SpeechRecognition` existe no Chrome e no
 *    Edge. Onde não existe, o botão não aparece: é melhor do que oferecer um
 *    recurso que fica mudo. Quem não transcreve continua LENDO as legendas
 *    dos outros normalmente — receber é só texto.
 *
 * 3. PARCIAL E FINAL SÃO COISAS DIFERENTES. O reconhecedor entrega um palpite
 *    que muda a cada palavra e, no fim da frase, um resultado estável. O
 *    palpite aparece e se corrige na tela; só o final entra na transcrição
 *    que pode ser baixada.
 */
import { Emitter } from "../lib/emitter.js";
import { el, clear } from "../lib/dom.js";
import { formatClock } from "../lib/util.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Quanto tempo uma frase encerrada continua na tela. */
const HOLD_MS = 5000;
/** Quantas falas simultâneas cabem sem virar parede de texto. */
const MAX_LINES = 3;
/** Falas guardadas na transcrição. Acima disso, as mais antigas saem. */
const TRANSCRICAO_MAX = 5000;

export const captionsSupported = typeof SR === "function";

export class Captions extends Emitter {
  enabled = false;
  /** Transcrição da sessão: só frases finais, em ordem de chegada. */
  transcript = [];

  #rec = null;
  #root = null;
  /** peerId -> { node, timer } */
  #lines = new Map();
  #restart = 0;
  #wantsRunning = false;

  constructor({ lang = navigator.language || "pt-BR" } = {}) {
    super();
    this.lang = lang;
  }

  /** Monta a camada de legendas sobre o palco. */
  mount(container) {
    this.unmount();
    this.#root = el("div.captions", { "aria-live": "polite", "aria-atomic": "false" });
    container.append(this.#root);
    return this.#root;
  }

  unmount() {
    for (const l of this.#lines.values()) clearTimeout(l.timer);
    this.#lines.clear();
    this.#root?.remove();
    this.#root = null;
  }

  /* ---------------------------------------------------------------- *
   * Reconhecimento da própria voz
   * ---------------------------------------------------------------- */

  start() {
    if (!captionsSupported || this.#rec) return false;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      // O evento traz a lista inteira desde o início; só o que veio depois de
      // `resultIndex` é novidade.
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const text = String(r[0]?.transcript || "").trim();
        if (!text) continue;
        this.emit("local", { text, final: r.isFinal });
      }
    };

    rec.onerror = (e) => {
      // "no-speech" e "aborted" são rotina: alguém ficou calado, ou o próprio
      // app parou o reconhecimento. Só o resto merece ser contado para fora.
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.emit("error", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") this.stop();
    };

    /*
     * O Chrome encerra sozinho depois de alguns segundos de silêncio, mesmo em
     * modo contínuo. Sem religar, a legenda morre calada no meio da reunião.
     */
    rec.onend = () => {
      if (!this.#wantsRunning) return;
      clearTimeout(this.#restart);
      this.#restart = setTimeout(() => {
        try {
          rec.start();
        } catch {
          /* já rodando: nada a fazer */
        }
      }, 400);
    };

    this.#rec = rec;
    this.#wantsRunning = true;
    this.enabled = true;
    try {
      rec.start();
    } catch {
      /* uma segunda chamada a start() lança; o onend já religa */
    }
    this.emit("state", true);
    return true;
  }

  stop() {
    this.#wantsRunning = false;
    clearTimeout(this.#restart);
    if (this.#rec) {
      this.#rec.onend = null;
      try {
        this.#rec.stop();
      } catch {
        /* ignorado */
      }
      this.#rec = null;
    }
    this.enabled = false;
    this.emit("state", false);
    return false;
  }

  toggle() {
    return this.enabled ? this.stop() : this.start();
  }

  /* ---------------------------------------------------------------- *
   * Exibição
   * ---------------------------------------------------------------- */

  /**
   * Mostra (ou atualiza) a fala de alguém. Uma pessoa ocupa sempre a mesma
   * linha: o palpite se reescreve no lugar em vez de empilhar repetições.
   */
  show(peerId, { name, text, final = false, color = null }) {
    if (!this.#root || !text) return;

    let line = this.#lines.get(peerId);
    if (!line) {
      const node = el("div.caption", {}, [
        el("span.caption__who", { text: name || "", style: color ? { color } : {} }),
        el("span.caption__text"),
      ]);
      line = { node, timer: 0 };
      this.#lines.set(peerId, line);
      this.#root.append(node);
      // Mais de três falas ao mesmo tempo viram parede; a mais antiga sai.
      while (this.#root.childElementCount > MAX_LINES) {
        const first = this.#root.firstElementChild;
        for (const [id, l] of this.#lines) {
          if (l.node === first) {
            clearTimeout(l.timer);
            this.#lines.delete(id);
          }
        }
        first.remove();
      }
    }

    line.node.querySelector(".caption__text").textContent = text;
    line.node.dataset.final = String(final);

    clearTimeout(line.timer);
    // Um palpite sem continuação some mais rápido: quase sempre é ruído.
    line.timer = setTimeout(() => {
      line.node.remove();
      this.#lines.delete(peerId);
    }, final ? HOLD_MS : HOLD_MS * 1.6);

    if (final) {
      this.transcript.push({ at: Date.now(), name: name || "Participante", text });
      /*
       * Teto na transcrição. Numa reunião de horas, com várias pessoas
       * legendando, a lista cresceria sem limite nenhum dentro da aba. O
       * começo é o que se perde — que é também o que menos importa quando
       * alguém baixa a transcrição no fim.
       */
      if (this.transcript.length > TRANSCRICAO_MAX) {
        this.transcript.splice(0, this.transcript.length - TRANSCRICAO_MAX);
      }
      this.emit("transcript", this.transcript.length);
    }
  }

  clear() {
    for (const l of this.#lines.values()) clearTimeout(l.timer);
    this.#lines.clear();
    if (this.#root) clear(this.#root);
  }

  /** A transcrição como texto corrido, pronta para salvar ou colar. */
  asText() {
    return this.transcript.map((t) => `[${formatClock(t.at)}] ${t.name}: ${t.text}`).join("\n");
  }
}
