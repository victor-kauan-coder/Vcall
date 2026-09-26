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
 *    Edge. No aplicativo de mesa ele NÃO funciona (falha com "network"), e lá
 *    entra o reconhecedor offline (features/fala-offline.js). Onde nenhum dos
 *    dois existe, o botão avisa em vez de ficar mudo. Quem não transcreve
 *    continua LENDO as legendas dos outros normalmente — receber é só texto.
 *
 * 3. PARCIAL E FINAL SÃO COISAS DIFERENTES. O reconhecedor entrega um palpite
 *    que muda a cada palavra e, no fim da frase, um resultado estável. O
 *    palpite aparece e se corrige na tela; só o final entra na transcrição
 *    que pode ser baixada.
 */
import { Emitter } from "../lib/emitter.js";
import { el, clear } from "../lib/dom.js";
import { formatClock } from "../lib/util.js";
import { FalaOffline, falaOfflineDisponivel } from "./fala-offline.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Quanto tempo uma frase encerrada continua na tela. */
const HOLD_MS = 5000;
/** Quantas falas simultâneas cabem sem virar parede de texto. */
const MAX_LINES = 3;
/** Falas guardadas na transcrição. Acima disso, as mais antigas saem. */
const TRANSCRICAO_MAX = 5000;

/** Dá para legendar a própria fala aqui? (Chrome/Edge, ou o app de mesa.) */
export const captionsSupported = typeof SR === "function" || falaOfflineDisponivel();

/**
 * Idioma inicial das legendas. O Vcall é em português: antes o padrão era o
 * idioma do sistema, e num Windows em inglês a fala em português era
 * transcrita como se fosse inglês — um amontoado de palavras sem sentido.
 */
export function idiomaPadrao(salvo) {
  const validos = ["pt-BR", "pt-PT", "en-US", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP"];
  return validos.includes(salvo) ? salvo : "pt-BR";
}

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
  #paused = false;
  /** "web" (Chrome/Edge) ou "offline" (aplicativo de mesa). */
  #engine = null;
  #offline = null;
  /** Palpite em andamento que ainda não virou frase final. */
  #pendente = "";
  /** Quem fornece a trilha do microfone da chamada (motor offline). */
  micTrack = null;

  constructor({ lang = "pt-BR" } = {}) {
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

  /**
   * Liga a legenda da própria fala.
   *
   * Dois motores, escolhidos sozinhos:
   *   - no navegador, o reconhecimento do Chrome/Edge (Web Speech);
   *   - no aplicativo de mesa, o reconhecedor offline (features/fala-offline.js),
   *     porque lá o do Chrome falha na hora com "network".
   */
  start() {
    if (this.enabled) return true;
    if (falaOfflineDisponivel()) return this.#startOffline();
    if (!SR) return false;
    this.#wantsRunning = true;
    this.enabled = true;
    this.#engine = "web";
    if (!this.#paused) this.#startWeb();
    this.emit("state", true);
    return true;
  }

  #startWeb() {
    if (this.#rec) return;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      /*
       * O evento traz a lista inteira desde o início; só o que veio depois de
       * `resultIndex` é novidade. Frases finais saem uma a uma; o palpite em
       * andamento pode vir QUEBRADO em vários pedaços, e antes cada pedaço
       * substituía o anterior na tela (a legenda piscava mostrando só o fim
       * da frase). Agora os pedaços em andamento são juntados num só.
       */
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const text = String(r[0]?.transcript || "").trim();
        if (!text) continue;
        if (r.isFinal) {
          this.#pendente = "";
          this.emit("local", { text, final: true });
        } else {
          parcial = parcial ? `${parcial} ${text}` : text;
        }
      }
      if (parcial) {
        this.#pendente = parcial;
        this.emit("local", { text: parcial, final: false });
      }
    };

    rec.onerror = (e) => {
      // "no-speech" e "aborted" são rotina: alguém ficou calado, ou o próprio
      // app parou o reconhecimento. Só o resto merece ser contado para fora.
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.emit("error", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network") this.stop();
    };

    /*
     * O Chrome encerra sozinho depois de alguns segundos de silêncio, mesmo em
     * modo contínuo. Sem religar, a legenda morre calada no meio da reunião.
     * E o palpite que estava na tela quando ele encerrou nunca vira "final":
     * antes essa frase sumia da transcrição. Agora ela é confirmada aqui.
     */
    rec.onend = () => {
      this.#confirmarPendente();
      this.#rec = null;
      if (!this.#wantsRunning || this.#paused) return;
      clearTimeout(this.#restart);
      this.#restart = setTimeout(() => this.#startWeb(), 250);
    };

    this.#rec = rec;
    try {
      rec.start();
    } catch {
      /* uma segunda chamada a start() lança; o onend já religa */
    }
  }

  #stopWeb() {
    clearTimeout(this.#restart);
    if (!this.#rec) return;
    const rec = this.#rec;
    this.#rec = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      /* ignorado */
    }
    this.#confirmarPendente();
  }

  #confirmarPendente() {
    if (!this.#pendente) return;
    const text = this.#pendente;
    this.#pendente = "";
    this.emit("local", { text, final: true });
  }

  #startOffline() {
    this.#engine = "offline";
    this.#wantsRunning = true;
    this.enabled = true;
    this.#offline = new FalaOffline({ lang: this.lang, trilha: () => this.micTrack?.() || null });
    this.#offline.on("result", ({ text, final }) => this.emit("local", { text, final }));
    this.#offline.on("status", (st) => this.emit("status", st));
    this.#offline.start().catch((err) => {
      this.emit("error", err?.message || "offline");
      this.stop();
    });
    this.emit("state", true);
    return true;
  }

  /**
   * Microfone mudo = legenda em pausa. Antes a legenda continuava ouvindo e
   * mandando para a sala o que a pessoa dizia com o microfone DESLIGADO —
   * vazamento de privacidade. O motor offline já recebe silêncio da trilha
   * muda; o do Chrome ouve o microfone por conta própria, então é parado.
   */
  setPaused(paused) {
    this.#paused = !!paused;
    if (this.#engine !== "web" || !this.#wantsRunning) return;
    if (this.#paused) this.#stopWeb();
    else this.#startWeb();
  }

  stop() {
    this.#wantsRunning = false;
    this.#stopWeb();
    this.#offline?.stop();
    this.#offline = null;
    this.#engine = null;
    if (!this.enabled) return false;
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
