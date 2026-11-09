/**
 * core/midia.js — a tela pelo motor nativo do app de mesa (desktop/midia.js).
 *
 * Com "Motor nativo" em Configurações › Transmissão, quem captura e codifica a
 * tela é o vcall-midia, na placa de vídeo, e não o Chromium. A captura do
 * Chromium continua, em poucos quadros, só para a prévia, para saber quando a
 * pessoa para pelo botão do sistema e como reserva.
 *
 * O que os pares recebem é uma trilha falsa (160x90, parada) cujo quadro uma
 * RTCRtpScriptTransform troca pelo do motor (core/injetor-worker.js). Malha,
 * relé, FlexFEC e controle de banda seguem os do Chromium, e quem recebe não
 * muda nada. A tela é codificada uma vez para todo mundo, em vez de uma cópia
 * por pessoa.
 *
 * O Chromium só passa os quadros por uma transform posta ANTES da negociação.
 * Então, com o modo ligado, todo sender de tela ganha o injetor quando nasce
 * (peer.js chama instalarInjetor), no modo "passar"; ao levar a trilha falsa
 * vai para "injetar" (prepararSender). Um sender sem injetor (par criado antes
 * de ligar o modo) leva a captura do Chromium (`reserva`), nunca a trilha falsa.
 *
 * Fora daqui: stats.js não adapta o sender que injeta (o motor segue a banda
 * por conta própria, abaixo); sfu.js não publica (o LiveKit cifra numa
 * transform própria, e só cabe uma por sender). Se o motor cair, screen.js
 * volta ao caminho do Chromium sem parar a transmissão.
 */
import { Emitter } from "../lib/emitter.js";
import { modoDoCodificador } from "./tuning.js";

let existe = false;
/** O motor existe nesta máquina (app de mesa no Windows, binário presente)? */
export async function motorDisponivel() {
  const m = globalThis.window?.vcallDesktop?.midia;
  if (!m || typeof RTCRtpScriptTransform !== "function" || typeof MediaStreamTrackGenerator !== "function") return false;
  existe = !!(await m.disponivel().catch(() => false));
  return existe;
}
// Pergunta já ao carregar: o primeiro par nasce antes de alguém abrir as configurações.
if (globalThis.window?.vcallDesktop?.midia) motorDisponivel();

/** Os senders de tela nascem com o injetor? (modo nativo e motor presente) */
export const injetorPossivel = () => existe && modoDoCodificador() === "nativo";

/**
 * A banda do motor: a menor entre os pares que assistem — a estimativa da
 * conexão (availableOutgoingBitrate) e o teto do sender (o orçamento da malha
 * divide a subida entre os pares) — até `teto`. Um codificador só para todos:
 * quem tem a pior conexão dita a banda. `null`: ainda não há estimativa.
 *
 * @param {Array<{ativo: boolean, estimativa?: number|null, maxBitrate?: number}>} leituras
 */
export function bandaAlvo(leituras, teto) {
  let alvo = teto;
  let estimou = false;
  for (const l of leituras) {
    if (!l.ativo) continue;
    if (l.estimativa) {
      alvo = Math.min(alvo, l.estimativa);
      estimou = true;
    }
    if (l.maxBitrate) alvo = Math.min(alvo, l.maxBitrate);
  }
  return estimou ? Math.max(300_000, Math.round(alvo)) : null;
}

/**
 * Muda a banda do motor? O MFT da Intel solta um IDR a cada mudança: só com
 * mais de 15% de diferença.
 */
export const mudarBanda = (antes, depois) => !antes || Math.abs(depois - antes) / antes > 0.15;

/* ------------------------------------------------------------------ *
 * O injetor: um worker só, uma transform por sender de tela
 * ------------------------------------------------------------------ */

let worker = null;
/** O motor ligado agora (um por vez). */
let atual = null;
const ids = new WeakMap();
let proximoId = 1;

function injetor() {
  if (!worker) {
    worker = new Worker(new URL("./injetor-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => atual?.doWorker(data);
  }
  return worker;
}

/**
 * peer.js, quando o sender da tela nasce: no addTransceiver de quem oferta, e
 * logo depois do setRemoteDescription de quem responde, sem nenhuma espera no
 * meio. O Chromium decide passar por fora da transform numa tarefa logo depois
 * de criar o sender, e uma transform posta depois da negociação nunca vale.
 */
export function instalarInjetor(sender) {
  if (!sender || ids.has(sender) || !injetorPossivel()) return;
  try {
    const id = proximoId++;
    sender.transform = new RTCRtpScriptTransform(injetor(), { id });
    ids.set(sender, id);
  } catch (err) {
    console.warn("[midia] sem injetor neste sender", err);
  }
}

/**
 * peer.js, ao trocar a trilha da tela. Devolve a trilha que o sender deve
 * levar: a falsa do motor só vai a quem tem injetor (os outros levam a
 * reserva); o injetor passa a trocar os quadros ANTES de a falsa entrar e
 * volta a deixar passar quando outra trilha entra (`depois`).
 */
export function prepararSender(sender, track) {
  const motor = track?.vcallNativo || null;
  const id = ids.get(sender);
  if (motor && id == null) return { track: motor.reserva, depois: () => {} };
  if (motor) {
    worker?.postMessage({ modo: "injetar", id });
    motor.ligar(sender);
    return { track, depois: () => {} };
  }
  return { track, depois: () => id != null && worker?.postMessage({ modo: "passar", id }) };
}

export class MotorNativo extends Emitter {
  /** @type {MediaStreamTrack|null} a trilha falsa que os pares mandam */
  track = null;
  /** A captura do Chromium, para os senders sem injetor. */
  reserva = null;
  /** Linha de "pronto" do motor: codificador, placa, tamanhos. */
  info = null;
  id = 0;
  /** Contadores do injetor (core/injetor-worker.js), a cada segundo. */
  diag = null;
  #escrever = null;
  #falsa = null;
  /** Senders que levam a trilha falsa (para a banda). */
  #senders = new Set();
  #timer = 0;
  #kbps = 0;
  #parado = false;

  /** Liga o motor para a fonte que a captura acabou de usar. */
  static async iniciar({ qps = 60, altura = 1080, teto = 14_000_000, reserva = null } = {}) {
    const m = new MotorNativo();
    m.reserva = reserva;
    try {
      await m.#iniciar({ qps, altura, teto });
    } catch (err) {
      m.parar();
      throw err;
    }
    return m;
  }

  async #iniciar({ qps, altura, teto }) {
    // A porta chega por postMessage logo antes de o pedido responder.
    let ouvir;
    const porta = new Promise((resolve, reject) => {
      const prazo = setTimeout(() => reject(new Error("o motor nativo não entregou os quadros")), 15_000);
      ouvir = (e) => {
        if (e.source !== window || !e.data?.vcallMidiaPorta || !e.ports?.[0]) return;
        clearTimeout(prazo);
        resolve(e.ports[0]);
      };
      window.addEventListener("message", ouvir);
    });
    try {
      const r = await window.vcallDesktop.midia.iniciar({ qps, altura, kbps: 1000 });
      if (!r?.ok) throw new Error(r?.erro || "o motor nativo não ligou");
      this.id = r.id;
      this.info = r.info;
      const p = await porta;
      if (this.#parado) {
        p.close();
        return;
      }
      const gen = new MediaStreamTrackGenerator({ kind: "video" });
      this.#escrever = gen.writable.getWriter();
      this.#falsa = new OffscreenCanvas(160, 90);
      const g = this.#falsa.getContext("2d");
      g.fillStyle = "#202020";
      g.fillRect(0, 0, 160, 90);
      gen.vcallNativo = this;
      this.track = gen;
      atual?.parar();
      atual = this;
      injetor().postMessage({ porta: p }, [p]);
      this.#timer = setInterval(() => this.#banda(teto).catch(() => {}), 1000);
    } finally {
      window.removeEventListener("message", ouvir);
    }
  }

  /** Mensagens do worker do injetor. */
  doWorker(data) {
    if (data.falso != null) {
      // O horário da captura (µs) vira o do quadro falso: o RTP sai no ritmo da tela.
      this.#escrever?.write(new VideoFrame(this.#falsa, { timestamp: data.falso })).catch(() => {});
    } else if (data.fim) {
      this.#falhou(data.erro || `o motor nativo saiu (código ${data.codigo})`);
    } else if (data.estatisticas) {
      this.emit("estatisticas", data.estatisticas);
    } else if (data.diag) {
      this.diag = data.diag;
    }
  }

  /** Este sender passou a levar a trilha falsa (prepararSender). */
  ligar(sender) {
    if (!this.#parado) this.#senders.add(sender);
  }

  async #banda(teto) {
    const leituras = [];
    for (const sender of [...this.#senders]) {
      if (sender.track !== this.track || sender.transport?.state === "closed") {
        this.#senders.delete(sender);
        continue;
      }
      let estimativa = null;
      (await sender.getStats()).forEach((r) => {
        if (r.type === "candidate-pair" && r.nominated && r.availableOutgoingBitrate) estimativa = r.availableOutgoingBitrate;
      });
      const enc = sender.getParameters().encodings?.[0] || {};
      leituras.push({ ativo: enc.active !== false, estimativa, maxBitrate: enc.maxBitrate });
    }
    const alvo = bandaAlvo(leituras, teto);
    if (!alvo || this.#parado) return;
    const kbps = Math.round(alvo / 1000);
    if (!mudarBanda(this.#kbps, kbps)) return;
    this.#kbps = kbps;
    worker?.postMessage({ comando: `kbps ${kbps}` });
  }

  #falhou(motivo) {
    if (this.#parado) return;
    this.parar();
    this.emit("falhou", motivo);
  }

  parar() {
    if (this.#parado) return;
    this.#parado = true;
    clearInterval(this.#timer);
    this.#senders.clear();
    if (atual === this) {
      atual = null;
      worker?.postMessage({ parar: true });
    }
    try {
      this.track?.stop();
    } catch {
      /* já parada */
    }
    if (this.id) window.vcallDesktop?.midia?.parar(this.id).catch(() => {});
  }
}
