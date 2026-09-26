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
import { avatarEl } from "../ui/avatars.js";
import { FalaOffline, falaOfflineDisponivel } from "./fala-offline.js";
import { FalaWhisper, whisperDisponivel } from "./fala-whisper.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Quanto tempo uma frase encerrada continua na tela. */
const HOLD_MS = 5000;
/** Quantas falas simultâneas cabem sem virar parede de texto. */
const MAX_LINES = 3;
/** Caracteres de uma fala mostrados na tela (~duas linhas). */
const CAUDA = 150;

/** O fim de um texto longo, começando numa palavra inteira. */
export function cauda(texto, max = CAUDA) {
  const t = String(texto || "").trim();
  if (t.length <= max) return t;
  const corte = t.slice(-max);
  const espaco = corte.indexOf(" ");
  return `\u2026${espaco > 0 && espaco < 30 ? corte.slice(espaco + 1) : corte}`;
}
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

  /** Tamanho do modelo Whisper no app: "rapida", "equilibrada" ou "maxima". */
  nivel = "equilibrada";
  usarWhisper = true;

  constructor({ lang = "pt-BR", nivel = "equilibrada" } = {}) {
    super();
    this.lang = lang;
    this.nivel = nivel;
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

  /** O Chrome tem o reconhecimento deste idioma no próprio aparelho? */
  #local = null;
  #localLang = "";

  async #startWeb() {
    if (this.#rec) return;
    /*
     * Chrome recente: reconhecimento NO APARELHO (processLocally). Mais
     * rápido, funciona sem internet e o áudio não vai para o Google. Só é
     * usado quando o pacote do idioma já está instalado — baixar centenas de
     * MB sem a pessoa pedir não é decisão nossa. Sem isso, segue o normal.
     */
    if (this.#localLang !== this.lang) {
      this.#localLang = this.lang;
      this.#local = false;
      try {
        if (typeof SR.available === "function") {
          this.#local = (await SR.available({ langs: [this.lang], processLocally: true })) === "available";
        }
      } catch {
        this.#local = false;
      }
      if (this.#rec || !this.#wantsRunning || this.#paused) return;
    }
    const rec = new SR();
    rec.lang = this.lang;
    if (this.#local && "processLocally" in rec) rec.processLocally = true;
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

  /**
   * No app de mesa: Whisper primeiro (acerta frases inteiras, com
   * pontuação); se ele não abrir — modelo que não baixou, máquina sem
   * WebAssembly moderno —, o Vosk entra no lugar e a legenda não morre.
   */
  #startOffline() {
    this.#engine = "offline";
    this.#wantsRunning = true;
    this.enabled = true;
    const trilha = () => this.micTrack?.() || null;
    const ligar = (motor, reserva) => {
      this.#offline = motor;
      motor.on("result", ({ text, final, confirmado }) => this.emit("local", { text, final, confirmado: confirmado?.length || 0 }));
      motor.on("status", (st) => this.emit("status", st));
      motor.on("falando", (on) => this.emit("falando", on));
      motor.start().catch((err) => {
        if (this.#offline !== motor) return;
        if (reserva && this.#wantsRunning) {
          console.warn("[legendas] Whisper não abriu; usando o Vosk", err);
          this.emit("status", { fase: "reserva", motivo: err?.message || "" });
          ligar(reserva(), null);
          return;
        }
        this.emit("error", err?.message || "offline");
        this.stop();
      });
    };
    if (whisperDisponivel() && this.usarWhisper) {
      ligar(new FalaWhisper({ lang: this.lang, nivel: this.nivel, trilha }), () => new FalaOffline({ lang: this.lang, trilha }));
    } else {
      ligar(new FalaOffline({ lang: this.lang, trilha }), null);
    }
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
  show(peerId, { name, text, final = false, color = null, avatar = null, confirmado = 0 }) {
    if (!this.#root || !text) return;

    let line = this.#lines.get(peerId);
    if (!line) {
      const node = el("div.caption", { style: color ? { "--cor": color } : {} }, [
        el("span.caption__avatar", { "aria-hidden": "true" }, [avatar ? avatarEl(avatar, { title: name || "" }) : null].filter(Boolean)),
        el("div.caption__corpo", {}, [el("span.caption__who", { text: name || "" }), el("p.caption__text")]),
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

    /*
     * Só o FIM da fala fica na tela, em até duas linhas. Uma frase longa
     * crescia até virar um bloco de texto cobrindo o vídeo; legenda boa é a
     * que se lê de relance — como na TV, o texto antigo sai por cima.
     */
    const visivel = cauda(text, CAUDA);
    const alvo = line.node.querySelector(".caption__text");
    // Palavras já confirmadas (duas leituras concordaram) ficam firmes; o fim,
    // que ainda pode mudar, aparece mais claro.
    const prov = !final && confirmado > 0 && confirmado < text.length ? text.length - confirmado : 0;
    const corte = visivel.length - prov;
    if (prov && corte > 0) {
      alvo.replaceChildren(document.createTextNode(visivel.slice(0, corte)), el("span.caption__prov", { text: visivel.slice(corte) }));
    } else {
      alvo.textContent = visivel;
    }
    line.node.dataset.final = String(final);
    line.node.classList.remove("is-ouvindo");

    clearTimeout(line.timer);
    // Um palpite sem continuação some mais rápido: quase sempre é ruído.
    line.timer = setTimeout(() => {
      line.node.classList.add("is-saindo");
      setTimeout(() => {
        line.node.remove();
        if (this.#lines.get(peerId) === line) this.#lines.delete(peerId);
      }, 260);
    }, final ? HOLD_MS : HOLD_MS * 1.6);

    if (final) {
      const item = { at: Date.now(), name: name || "Participante", text, color };
      this.transcript.push(item);
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
      this.emit("linha", item);
    }
  }

  /** "Ouvindo…": a pessoa começou a falar e o texto ainda está a caminho. */
  ouvindo(peerId, { name, color = null, avatar = null }) {
    if (!this.#root || this.#lines.has(peerId)) return;
    this.show(peerId, { name, text: "\u2026", final: false, color, avatar });
    this.#lines.get(peerId)?.node.classList.add("is-ouvindo");
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

  /**
   * A transcrição como legenda .srt (abre em qualquer player junto da
   * gravação da reunião). Cada fala dura até a próxima começar, no máximo 6 s.
   */
  asSrt() {
    const t0 = this.transcript[0]?.at || Date.now();
    const tempo = (ms) => {
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      const r = ms % 1000;
      const p = (n, k = 2) => String(n).padStart(k, "0");
      return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
    };
    return this.transcript
      .map((t, i) => {
        const ini = t.at - t0;
        const prox = this.transcript[i + 1]?.at;
        const fim = Math.min(ini + 6000, prox ? prox - t0 : ini + 6000);
        return `${i + 1}\n${tempo(ini)} --> ${tempo(Math.max(fim, ini + 800))}\n${t.name}: ${t.text}\n`;
      })
      .join("\n");
  }
}
