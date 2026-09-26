/**
 * core/screen.js — captura de tela.
 *
 * Este é o módulo que decide se o compartilhamento vai ficar nítido ou virar
 * um borrão. Pontos que resolvem os problemas mais comuns:
 *
 * - `min` e `exact` são proibidos nas restrições de getDisplayMedia; só
 *   `ideal` e `max` valem. E as restrições são aplicadas DEPOIS da escolha da
 *   superfície, como redução — nunca aumentam a resolução de uma janela.
 * - O Firefox ignora `frameRate` passado na captura, mas respeita o mesmo
 *   valor aplicado logo em seguida na trilha. Aplicamos sempre.
 * - `monitorTypeSurfaces: "exclude"` junto de `displaySurface: "monitor"`
 *   lança TypeError; o mesmo vale para `preferCurrentTab` com
 *   `selfBrowserSurface: "exclude"`. Por isso as opções são montadas em
 *   camadas, e uma falha por opção desconhecida cai num plano B mínimo.
 * - A trilha precisa escutar `ended`: é assim que o botão "Parar
 *   compartilhamento" do próprio navegador chega até o app.
 * - Trocar de janela no meio (surfaceSwitching) muda a resolução sem encerrar
 *   a trilha. Sem reavaliar, o encoder continua com o teto antigo e a imagem
 *   desmancha.
 */
import { Emitter } from "../lib/emitter.js";
import { constrainScreenTrack, screenProfileFor } from "./tuning.js";

/** Resoluções oferecidas ao usuário. */
export const SCREEN_QUALITY = {
  auto: { label: "Automática", width: 1920, height: 1080, frameRate: 30 },
  hd: { label: "1080p · nítida", width: 1920, height: 1080, frameRate: 30 },
  smooth: { label: "720p · fluida", width: 1280, height: 720, frameRate: 60 },
  light: { label: "720p · econômica", width: 1280, height: 720, frameRate: 15 },
};

export class ScreenShare extends Emitter {
  /** @type {MediaStream|null} */ stream = null;
  /** @type {MediaStreamTrack|null} */ videoTrack = null;
  /** @type {MediaStreamTrack|null} */ audioTrack = null;

  /** "text" para slides/código, "motion" para vídeo/animação. */
  mode = "text";
  quality = "auto";
  settings = null;

  get active() {
    return !!this.videoTrack && this.videoTrack.readyState === "live";
  }

  get profile() {
    return screenProfileFor(this.mode);
  }

  /**
   * Abre o seletor de tela do navegador. Precisa ser chamado diretamente de um
   * clique: depois de um `await` intermediário o navegador já perdeu a
   * "ativação transitória" e recusa a captura.
   */
  async start({ quality = this.quality, mode = this.mode, withAudio = false, surface = null } = {}) {
    if (this.active) return this.stream;

    this.quality = quality;
    this.mode = mode;
    this.surface = surface;
    this.wantedAudio = !!withAudio;
    const q = SCREEN_QUALITY[quality] || SCREEN_QUALITY.auto;

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(this.#options(q, withAudio, surface));
    } catch (err) {
      if (err?.name === "TypeError" || err?.name === "NotSupportedError") {
        // Alguma opção nova não foi aceita: tenta o conjunto mínimo e, se nem
        // assim, sem som. O Firefox (comum no Linux) não captura áudio de
        // tela e pode recusar o pedido inteiro só por causa dele.
        const planos = withAudio ? [{ video: true, audio: true }, { video: true }] : [{ video: true }];
        let ultimo = err;
        for (const plano of planos) {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia(plano);
            break;
          } catch (err2) {
            ultimo = err2;
            if (err2?.name !== "TypeError" && err2?.name !== "NotSupportedError") break;
          }
        }
        if (!stream) {
          this.emit("error", ultimo);
          throw ultimo;
        }
      } else {
        this.emit("error", err);
        throw err;
      }
    }

    const video = stream.getVideoTracks()[0];
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      const err = new Error("a captura não trouxe vídeo");
      this.emit("error", err);
      throw err;
    }

    this.stream = stream;
    this.videoTrack = video;
    this.audioTrack = stream.getAudioTracks()[0] || null;

    // Dica de conteúdo: define como o encoder negocia nitidez contra fluidez.
    if ("contentHint" in video) video.contentHint = this.mode === "motion" ? "motion" : "text";

    this.settings = await constrainScreenTrack(video, {
      frameRate: q.frameRate,
      maxWidth: q.width,
      maxHeight: q.height,
    });

    if (this.audioTrack) {
      // Áudio de tela é mídia, não voz: o processamento de voz o destruiria.
      try {
        await this.audioTrack.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        });
      } catch {
        /* alguns navegadores não permitem: segue assim mesmo */
      }
      this.audioTrack.addEventListener("ended", () => {
        this.audioTrack = null;
        this.emit("change", this.snapshot());
      });
    }

    // O botão "Parar compartilhamento" do navegador só chega por aqui.
    video.addEventListener("ended", () => this.stop("browser"));

    // Troca de janela no meio: a resolução muda sem encerrar a trilha.
    video.addEventListener?.("configurationchange", () => this.#onSurfaceChange());
    this.#watchSurface();

    this.emit("start", this.snapshot());
    this.emit("change", this.snapshot());
    return stream;
  }

  /** Alterna entre priorizar nitidez (texto) e fluidez (vídeo). */
  setMode(mode) {
    if (mode === this.mode) return this.mode;
    this.mode = mode === "motion" ? "motion" : "text";
    if (this.videoTrack && "contentHint" in this.videoTrack) {
      this.videoTrack.contentHint = this.mode === "motion" ? "motion" : "text";
    }
    this.emit("mode", this.mode);
    this.emit("change", this.snapshot());
    return this.mode;
  }

  async setQuality(quality) {
    this.quality = quality;
    const q = SCREEN_QUALITY[quality] || SCREEN_QUALITY.auto;
    if (!this.videoTrack) return null;
    this.settings = await constrainScreenTrack(this.videoTrack, {
      frameRate: q.frameRate,
      maxWidth: q.width,
      maxHeight: q.height,
    });
    this.emit("change", this.snapshot());
    return this.settings;
  }

  stop(reason = "user") {
    if (!this.stream) return;
    clearInterval(this.#surfaceTimer);
    for (const t of this.stream.getTracks()) {
      try {
        t.stop();
      } catch {
        /* já parada */
      }
    }
    this.stream = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.settings = null;
    this.emit("stop", { reason });
    this.emit("change", this.snapshot());
  }

  snapshot() {
    return {
      active: this.active,
      video: this.videoTrack,
      audio: this.audioTrack,
      stream: this.stream,
      mode: this.mode,
      profile: this.profile,
      settings: this.settings,
      hasAudio: !!this.audioTrack,
    };
  }

  /* ---------------------------------------------------------------- */

  #surfaceTimer = 0;

  #options(q, withAudio, surface = null) {
    /** @type {DisplayMediaStreamOptions} */
    const opts = {
      video: {
        // Nada de `min`/`exact` aqui: getDisplayMedia os rejeita.
        width: { ideal: q.width, max: q.width },
        height: { ideal: q.height, max: q.height },
        frameRate: { ideal: q.frameRate, max: q.frameRate },
      },
      audio: withAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            sampleRate: 48000,
            // Chrome recente: não captura o som tocado pela própria página
            // (as vozes da chamada). Ignorado onde não existe.
            restrictOwnAudio: true,
            suppressLocalAudioPlayback: false,
          }
        : false,
    };

    // Opções de nível superior (Chrome). Ignoradas em silêncio em outros
    // navegadores; combinações inválidas são evitadas de propósito.
    /*
     * `displaySurface` é uma PREFERÊNCIA, não uma escolha: ela diz ao navegador
     * em qual aba do seletor abrir — tela inteira, janela ou aba. Quem escolhe
     * continua sendo a pessoa, na janela do navegador, e isso não tem como ser
     * contornado por página nenhuma. O que ganhamos é o seletor já abrir no
     * lugar certo, em vez de a pessoa ter que procurar.
     */
    if (surface === "monitor" || surface === "window" || surface === "browser") {
      opts.video.displaySurface = surface;
    }

    opts.selfBrowserSurface = "exclude"; // evita o efeito "sala de espelhos"
    opts.surfaceSwitching = "include"; // deixa trocar de janela sem reiniciar
    opts.systemAudio = withAudio ? "include" : "exclude";
    opts.monitorTypeSurfaces = "include";
    return opts;
  }

  /**
   * `configurationchange` ainda não está em todo lugar; uma sondagem leve
   * cobre o resto. Só emite quando a resolução realmente mudou.
   */
  #watchSurface() {
    clearInterval(this.#surfaceTimer);
    this.#surfaceTimer = setInterval(() => this.#onSurfaceChange(), 3000);
  }

  #onSurfaceChange() {
    if (!this.videoTrack) return;
    const s = this.videoTrack.getSettings?.();
    if (!s) return;
    const prev = this.settings || {};
    if (s.width === prev.width && s.height === prev.height && s.frameRate === prev.frameRate) return;
    this.settings = s;
    this.emit("surface", s);
    this.emit("change", this.snapshot());
  }
}

export function describeScreenError(err) {
  switch (err?.name) {
    case "NotAllowedError":
      return "Compartilhamento cancelado.";
    case "NotFoundError":
      return "Nenhuma tela disponível para compartilhar.";
    case "NotReadableError":
      return "O sistema não deixou capturar essa tela. No macOS, libere a gravação de tela para o navegador.";
    case "InvalidStateError":
      return "Clique no botão de compartilhar novamente — a permissão expirou.";
    case "AbortError":
      return "A captura foi interrompida.";
    default:
      return "Não foi possível compartilhar a tela.";
  }
}
