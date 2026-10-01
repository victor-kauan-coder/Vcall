/**
 * core/media.js — microfone e câmera locais.
 *
 * Um único lugar sabe abrir, trocar e fechar dispositivos. O resto do app só
 * pergunta "qual é a trilha de microfone agora?" e escuta quando ela muda.
 */
import { Emitter } from "../lib/emitter.js";
import { prefs, env } from "../lib/util.js";
import { processarVoz, VOZ_PADRAO } from "./voz.js";

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
};

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: "user",
};

export class LocalMedia extends Emitter {
  /** @type {MediaStreamTrack|null} */ micTrack = null;
  /** @type {MediaStreamTrack|null} */ camTrack = null;
  /** @type {MediaStream} */ stream = new MediaStream();

  devices = { audioinput: [], videoinput: [], audiooutput: [] };
  selected = {
    audioinput: prefs.get("device:mic", null),
    videoinput: prefs.get("device:cam", null),
    audiooutput: prefs.get("device:spk", null),
  };

  /** Processamento de áudio ligado/desligado (supressão de ruído etc.). */
  processing = prefs.get("audio:processing", true);
  /** Processador de voz: supressão de ruído por IA e sensibilidade de entrada. */
  voz = { ...VOZ_PADRAO, ...prefs.get("audio:voz", {}) };
  /** O processador da trilha de microfone atual (null = trilha bruta). */
  #proc = null;

  constructor() {
    super();
    navigator.mediaDevices?.addEventListener?.("devicechange", () => this.enumerate());
  }

  get micEnabled() {
    return !!this.micTrack?.enabled;
  }
  get camEnabled() {
    return !!this.camTrack && this.camTrack.readyState === "live";
  }

  /* ---------------------------------------------------------------- *
   * Permissões e dispositivos
   * ---------------------------------------------------------------- */

  /**
   * Abre microfone (e câmera, se pedido). Degrada com elegância: sem câmera a
   * chamada continua só com voz; sem nada, o participante ainda entra e vê e
   * ouve os outros. Nenhum desses casos deve virar uma tela de erro.
   */
  async start({ audio = true, video = true } = {}) {
    const result = { audio: false, video: false, errors: [] };

    if (audio) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: this.#audioConstraints() });
        await this.#usarMic(s.getAudioTracks()[0] || null);
        result.audio = true;
      } catch (err) {
        result.errors.push({ kind: "audio", err });
      }
    }

    if (video) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.#videoConstraints() });
        this.#swap("cam", s.getVideoTracks()[0] || null);
        result.video = true;
      } catch (err) {
        result.errors.push({ kind: "video", err });
      }
    }

    await this.enumerate();
    return result;
  }

  /** A lista de dispositivos só traz rótulos depois de uma permissão concedida. */
  async enumerate() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      this.devices = { audioinput: [], videoinput: [], audiooutput: [] };
      for (const d of list) {
        if (this.devices[d.kind]) this.devices[d.kind].push(d);
      }
      this.emit("devices", this.devices);
    } catch {
      /* sem permissão ainda */
    }
    return this.devices;
  }

  /* ---------------------------------------------------------------- *
   * Controles
   * ---------------------------------------------------------------- */

  /** Mudo real: a trilha continua existindo, mas para de transmitir amostras. */
  setMic(on) {
    if (!this.micTrack) return false;
    this.micTrack.enabled = on;
    this.emit("change", this.snapshot());
    return on;
  }

  toggleMic() {
    return this.setMic(!this.micEnabled);
  }

  /**
   * Desligar a câmera libera o dispositivo de verdade (a luz apaga) em vez de
   * só parar de enviar quadros. É o comportamento que as pessoas esperam.
   */
  async setCam(on) {
    if (on === this.camEnabled) return this.camEnabled;
    if (!on) {
      this.#swap("cam", null);
      return false;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: this.#videoConstraints() });
      this.#swap("cam", s.getVideoTracks()[0] || null);
      return true;
    } catch (err) {
      this.emit("error", { kind: "video", err });
      return false;
    }
  }

  toggleCam() {
    return this.setCam(!this.camEnabled);
  }

  /** Troca de dispositivo sem derrubar a chamada — só um replaceTrack adiante. */
  async selectDevice(kind, deviceId) {
    this.selected[kind] = deviceId;
    prefs.set(
      { audioinput: "device:mic", videoinput: "device:cam", audiooutput: "device:spk" }[kind],
      deviceId,
    );

    if (kind === "audiooutput") {
      this.emit("sink", deviceId);
      return true;
    }
    if (kind === "audioinput" && this.micTrack) {
      const wasEnabled = this.micTrack.enabled;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: this.#audioConstraints() });
        await this.#usarMic(s.getAudioTracks()[0] || null, wasEnabled);
        return true;
      } catch (err) {
        this.emit("error", { kind: "audio", err });
        return false;
      }
    }
    if (kind === "videoinput" && this.camEnabled) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.#videoConstraints() });
        this.#swap("cam", s.getVideoTracks()[0] || null);
        return true;
      } catch (err) {
        this.emit("error", { kind: "video", err });
        return false;
      }
    }
    return true;
  }

  /**
   * Liga/desliga cancelamento de eco, supressão de ruído e ganho automático.
   * Vale desligar quando alguém está tocando um instrumento ou compartilhando
   * som: o processamento foi feito para voz e destrói música.
   */
  async setProcessing(on) {
    this.processing = on;
    prefs.set("audio:processing", on);
    await this.#reaplicarMic();
    this.emit("change", this.snapshot());
    return on;
  }

  /**
   * Supressão de ruído por IA e sensibilidade de entrada ("auto", "off" ou um
   * limiar em dB). Ajustes finos vão direto ao processador, sem cortar o som;
   * ligar ou desligar o processador inteiro reabre o microfone.
   */
  async setVoz(opcoes) {
    const antes = this.voz;
    this.voz = { ...this.voz, ...opcoes };
    prefs.set("audio:voz", this.voz);
    if (!this.micTrack) return this.voz;
    const precisa = this.voz.ruido || this.voz.limiar !== "off";
    if (this.#proc && precisa) {
      this.#proc.definir({ ruido: this.voz.ruido, limiar: this.voz.limiar });
      if (antes.ruido !== this.voz.ruido) await this.#reaplicarMic({ reabrir: false });
    } else if (!!this.#proc !== precisa) {
      await this.#reaplicarMic({ reabrir: true });
    }
    return this.voz;
  }

  /** Reaplica as restrições do microfone; reabre se o navegador não aceitar. */
  async #reaplicarMic({ reabrir = false } = {}) {
    if (!this.micTrack) return;
    const bruta = this.#proc?.bruta || this.micTrack;
    if (!reabrir) {
      try {
        await bruta.applyConstraints(this.#audioConstraints());
        return;
      } catch {
        /* alguns navegadores só aplicam na abertura */
      }
    }
    const wasEnabled = this.micTrack.enabled;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: this.#audioConstraints() });
      await this.#usarMic(s.getAudioTracks()[0] || null, wasEnabled);
    } catch {
      /* mantém a trilha atual */
    }
  }

  /**
   * Coloca uma trilha de microfone recém-aberta em uso, passando-a pelo
   * processador de voz quando ele está ligado.
   */
  async #usarMic(bruta, enabled = true) {
    if (!bruta) {
      this.#swap("mic", null);
      return;
    }
    let final = bruta;
    let proc = null;
    if (this.voz.ruido || this.voz.limiar !== "off") {
      proc = await processarVoz(bruta, this.voz);
      if (proc) {
        final = proc.track;
        proc.bruta = bruta;
        proc.aoNivel((n) => this.emit("voz-nivel", n));
        // Microfone desconectado: a trilha processada não "acaba" sozinha.
        bruta.addEventListener(
          "ended",
          () => {
            if (this.micTrack !== final) return;
            this.#swap("mic", null);
          },
          { once: true },
        );
      }
    }
    final.enabled = enabled;
    this.#swap("mic", final, proc);
  }

  /** O processador de voz está ativo na trilha atual? */
  get vozAtiva() {
    return !!this.#proc;
  }

  snapshot() {
    return {
      mic: this.micTrack,
      cam: this.camTrack,
      micEnabled: this.micEnabled,
      camEnabled: this.camEnabled,
    };
  }

  stop() {
    this.#swap("mic", null);
    this.#swap("cam", null);
  }

  /* ---------------------------------------------------------------- */

  #audioConstraints() {
    let base = this.processing
      ? AUDIO_CONSTRAINTS
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    // Com a supressão por IA ligada, a do navegador sai: as duas juntas
    // "comem" o começo e o fim das palavras.
    if (this.processing && this.voz.ruido) base = { ...base, noiseSuppression: false };
    const id = this.selected.audioinput;
    return id ? { ...base, deviceId: { ideal: id } } : base;
  }

  #videoConstraints() {
    const id = this.selected.videoinput;
    const base = { ...VIDEO_CONSTRAINTS };
    // Em celular, `facingMode` e `deviceId` juntos brigam; o id ganha.
    if (id) {
      delete base.facingMode;
      return { ...base, deviceId: { ideal: id } };
    }
    return env.isTouch ? base : (delete base.facingMode, base);
  }

  #swap(which, track, proc = null) {
    const key = which === "mic" ? "micTrack" : "camTrack";
    const old = this[key];
    if (old) {
      old.stop();
      this.stream.removeTrack(old);
    }
    if (which === "mic") {
      // O processador anterior (contexto de áudio e trilha bruta) sai junto.
      if (this.#proc && this.#proc !== proc) this.#proc.parar();
      this.#proc = proc;
    }
    this[key] = track;
    if (track) {
      this.stream.addTrack(track);
      track.addEventListener(
        "ended",
        () => {
          if (this[key] === track) {
            this[key] = null;
            this.stream.removeTrack(track);
            this.emit("change", this.snapshot());
          }
        },
        { once: true },
      );
    }
    this.emit("change", this.snapshot());
  }
}

/** Mensagens de erro de permissão em português, por tipo. */
export function describeMediaError(err, kind = "audio") {
  const dev = kind === "audio" ? "o microfone" : "a câmera";
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return `Permissão para ${dev} foi negada. Libere nas configurações do site e tente de novo.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `Nenhum dispositivo compatível encontrado para ${dev}.`;
    case "NotReadableError":
      return `Outro programa está usando ${dev}. Feche-o e tente de novo.`;
    case "AbortError":
      return `Não foi possível iniciar ${dev}.`;
    default:
      return `Não foi possível acessar ${dev}.`;
  }
}
