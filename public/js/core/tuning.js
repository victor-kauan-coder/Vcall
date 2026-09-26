/**
 * core/tuning.js — ajuste fino do encoder.
 *
 * É aqui que se decide se o compartilhamento de tela vai ficar legível ou
 * virar um borrão. Três alavancas importam, e a ordem importa:
 *
 *   1. contentHint  — diz ao encoder o que é a imagem. Para tela com texto,
 *                     "text" liga as ferramentas de conteúdo sintético e já
 *                     implica degradationPreference "maintain-resolution".
 *   2. degradationPreference — o que sacrificar quando a banda aperta.
 *                     Para texto: mantenha a resolução, derrube quadros.
 *                     Para vídeo em movimento: o inverso.
 *   3. maxBitrate / priority — quanto de banda esta trilha pode reivindicar.
 *                     Numa chamada com câmera + tela, a tela precisa ganhar,
 *                     senão o alocador reparte igual e a tela some.
 *
 * Duas armadilhas conhecidas estão tratadas aqui:
 *   - `degradationPreference` fica no topo de RTCRtpSendParameters, não dentro
 *     de encodings[0]. Colocado no lugar errado, é silenciosamente ignorado.
 *   - setCodecPreferences exige capacidades de RTCRtpReceiver (não Sender)
 *     desde o Chrome 124, e a lista precisa continuar contendo rtx/red, senão
 *     a retransmissão morre e o vídeo congela na primeira perda de pacote.
 */

/* ------------------------------------------------------------------ *
 * Perfis
 * ------------------------------------------------------------------ */

export const PROFILES = {
  /** Câmera: rosto em movimento, resolução é negociável. */
  camera: {
    contentHint: "motion",
    degradationPreference: "balanced",
    maxBitrate: 1_200_000,
    maxFramerate: 30,
    priority: "low",
    networkPriority: "low",
  },
  /** Tela com texto/código/slides: legibilidade acima de fluidez. */
  screenText: {
    contentHint: "text",
    degradationPreference: "maintain-resolution",
    maxBitrate: 3_500_000,
    maxFramerate: 30,
    priority: "high",
    networkPriority: "high",
  },
  /** Tela com vídeo/animação: fluidez acima de nitidez. */
  screenMotion: {
    contentHint: "motion",
    degradationPreference: "maintain-framerate",
    maxBitrate: 6_000_000,
    maxFramerate: 30,
    priority: "high",
    networkPriority: "high",
  },
  /** Voz. */
  mic: {
    maxBitrate: 40_000,
    priority: "high",
    networkPriority: "high",
  },
  /** Áudio capturado da tela (música, vídeo): estéreo, sem processamento. */
  screenAudio: {
    maxBitrate: 128_000,
    priority: "medium",
    networkPriority: "medium",
  },
};

/* ------------------------------------------------------------------ *
 * Codecs
 * ------------------------------------------------------------------ */

const codecCache = new Map();

/**
 * Lista de codecs de vídeo disponíveis para *receber*. É essa lista que o
 * setCodecPreferences aceita a partir do Chrome 124.
 */
function videoCapabilities() {
  if (!codecCache.has("video")) {
    let caps = null;
    try {
      caps = RTCRtpReceiver.getCapabilities?.("video") || null;
    } catch {
      caps = null;
    }
    codecCache.set("video", caps);
  }
  return codecCache.get("video");
}

export function supportsCodec(mime) {
  const caps = videoCapabilities();
  if (!caps) return false;
  return caps.codecs.some((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
}

/**
 * Reordena os codecs do transceiver colocando os preferidos na frente.
 * Os demais continuam na lista — inclusive rtx e red, cuja remoção é uma
 * causa clássica de "congela e volta" em rede com perda.
 */
export function preferCodecs(transceiver, mimes) {
  if (typeof transceiver?.setCodecPreferences !== "function") return null;
  const caps = videoCapabilities();
  if (!caps) return null;

  const wanted = [];
  for (const mime of mimes) {
    for (const c of caps.codecs) {
      if (c.mimeType.toLowerCase() !== mime.toLowerCase()) continue;
      // VP9: o perfil 0 (8 bits, 4:2:0) é o rápido e universal. O perfil 2
      // (10 bits) costuma aparecer na lista e custa caro sem ganho aqui.
      if (/vp9/i.test(mime) && c.sdpFmtpLine && !/profile-id=0/.test(c.sdpFmtpLine)) continue;
      wanted.push(c);
    }
  }
  if (!wanted.length) return null;

  const rest = caps.codecs.filter((c) => !wanted.includes(c));
  try {
    transceiver.setCodecPreferences([...wanted, ...rest]);
    return wanted[0].mimeType;
  } catch (err) {
    console.warn("[tuning] setCodecPreferences recusado", err);
    return null;
  }
}

/**
 * Ordem de preferência para conteúdo de tela.
 * VP9 vence por larga margem em texto — o mesmo quadro custa cerca de metade
 * da banda de VP8/H264 a 1080p. AV1 é melhor ainda por bit, mas o encoder é
 * caro demais numa malha, onde codificamos uma vez para cada par.
 */
export function screenCodecPreference(peerCount) {
  const list = [];
  if (peerCount <= 1 && supportsCodec("video/AV1")) list.push("video/AV1");
  if (supportsCodec("video/VP9")) list.push("video/VP9");
  list.push("video/VP8");
  return list;
}

/* ------------------------------------------------------------------ *
 * Parâmetros do sender
 * ------------------------------------------------------------------ */

/**
 * Aplica um perfil a um sender. Ler-modificar-escrever é obrigatório: montar
 * um objeto de parâmetros do zero faz o setParameters rejeitar.
 */
export async function applyProfile(sender, profile, overrides = {}) {
  if (!sender) return false;
  const opts = { ...profile, ...overrides };

  // contentHint vive na trilha, não no sender — e não sobrevive a um
  // replaceTrack, então é reaplicado aqui a cada chamada.
  if (opts.contentHint && sender.track && "contentHint" in sender.track) {
    sender.track.contentHint = opts.contentHint;
  }

  let params;
  try {
    params = sender.getParameters();
  } catch {
    return false;
  }
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

  if (opts.degradationPreference) params.degradationPreference = opts.degradationPreference;

  const enc = params.encodings[0];
  if (opts.maxBitrate != null) enc.maxBitrate = Math.round(opts.maxBitrate);
  if (opts.maxFramerate != null) enc.maxFramerate = opts.maxFramerate;
  if (opts.scaleResolutionDownBy != null) {
    enc.scaleResolutionDownBy = Math.max(1, opts.scaleResolutionDownBy);
  }
  if (opts.priority) enc.priority = opts.priority;
  if (opts.networkPriority) enc.networkPriority = opts.networkPriority;
  enc.active = opts.active !== false;

  try {
    await sender.setParameters(params);
    return true;
  } catch (err) {
    // Navegadores divergem sobre o que aceitam aqui; falhar não pode derrubar
    // a chamada — só significa que a trilha vai com os padrões do navegador.
    console.debug("[tuning] setParameters recusado", err?.name || err);
    return false;
  }
}

/**
 * Corrige o que o navegador ignora nas restrições iniciais do getDisplayMedia.
 * O Firefox descarta `frameRate` passado na captura, mas respeita o mesmo
 * valor aplicado depois na trilha.
 */
export async function constrainScreenTrack(track, { frameRate = 30, maxWidth = 1920, maxHeight = 1080 } = {}) {
  if (!track) return null;
  try {
    await track.applyConstraints({
      frameRate: { ideal: frameRate, max: frameRate },
      width: { max: maxWidth },
      height: { max: maxHeight },
    });
  } catch {
    /* restrição recusada: seguimos com o que a captura deu */
  }
  return track.getSettings?.() || null;
}

/**
 * Escolhe entre o perfil de texto e o de movimento a partir do que a captura
 * realmente entregou e do que o usuário declarou estar mostrando.
 */
export function screenProfileFor(mode) {
  return mode === "motion" ? PROFILES.screenMotion : PROFILES.screenText;
}

/* ------------------------------------------------------------------ *
 * Orçamento de banda da malha
 * ------------------------------------------------------------------ */

/**
 * Cada RTCPeerConnection estima a banda isoladamente e não sabe das outras.
 * Numa malha, todas tentam ocupar o mesmo enlace de subida. Sem um teto
 * central, quatro pares pedem quatro vezes a banda disponível e o resultado
 * é congestionamento — exatamente o "travando" que se vê na prática.
 */
export function meshBudget(peerCount, { uplink = 8_000_000 } = {}) {
  const n = Math.max(1, peerCount);
  const share = uplink / n;
  return {
    screen: Math.round(Math.min(PROFILES.screenMotion.maxBitrate, Math.max(600_000, share * 0.7))),
    camera: Math.round(Math.min(PROFILES.camera.maxBitrate, Math.max(150_000, share * 0.25))),
  };
}

/**
 * Teto de codificação sugerido pela CPU: numa malha codificamos N vezes.
 * Máquinas modestas com muitos pares precisam abrir mão de quadros antes de
 * abrir mão de resolução (texto ilegível é pior que texto que anda devagar).
 */
export function cpuCeiling(peerCount, cores) {
  const load = peerCount / Math.max(2, cores);
  if (load > 1.2) return { maxFramerate: 10, scaleResolutionDownBy: 1.5 };
  if (load > 0.8) return { maxFramerate: 15, scaleResolutionDownBy: 1.25 };
  if (load > 0.5) return { maxFramerate: 24, scaleResolutionDownBy: 1 };
  return { maxFramerate: 30, scaleResolutionDownBy: 1 };
}
