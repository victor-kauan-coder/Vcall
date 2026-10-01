/**
 * core/voz.js — o microfone passa pelo processador de voz antes de sair.
 *
 *   microfone ─► AudioWorklet "vcall-voz" (RNNoise + portão) ─► trilha enviada
 *
 * Um AudioContext próprio, a 48 kHz (a taxa do RNNoise), usado só aqui: o
 * microfone bruto não é lido por mais ninguém — a detecção de fala, a
 * gravação e as legendas leem a trilha JÁ processada. Assim ninguém disputa
 * o mesmo stream entre contextos (veja core/audio-graph.js).
 *
 * Se qualquer peça faltar (navegador sem AudioWorklet, erro ao abrir), a
 * trilha bruta segue como antes: o processador é uma melhoria, nunca um
 * ponto de falha da chamada.
 */

/** Opções salvas: supressão por IA e sensibilidade ("auto", "off" ou dB). */
export const VOZ_PADRAO = { ruido: true, limiar: "auto" };

export function vozDisponivel() {
  return typeof AudioWorkletNode === "function" && typeof AudioContext === "function";
}

/**
 * @param {MediaStreamTrack} bruta
 * @param {{ruido:boolean, limiar:"auto"|"off"|number}} opcoes
 * @returns {Promise<{track: MediaStreamTrack, definir: (o: object) => void, aoNivel: (fn: Function) => void, parar: () => void}|null>}
 */
export async function processarVoz(bruta, opcoes = VOZ_PADRAO) {
  if (!bruta || !vozDisponivel()) return null;
  if (!opcoes.ruido && opcoes.limiar === "off") return null; // nada a fazer
  let ctx;
  try {
    ctx = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("/js/core/voz-worklet.js");
    const fonte = ctx.createMediaStreamSource(new MediaStream([bruta]));
    const no = new AudioWorkletNode(ctx, "vcall-voz", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { ruido: opcoes.ruido, limiar: opcoes.limiar },
    });
    const destino = ctx.createMediaStreamDestination();
    fonte.connect(no).connect(destino);
    // Um contexto criado fora de um clique pode nascer suspenso.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const track = destino.stream.getAudioTracks()[0];
    let aoNivel = null;
    no.port.onmessage = ({ data }) => aoNivel?.(data);
    return {
      track,
      definir: (o) => no.port.postMessage(o),
      aoNivel: (fn) => (aoNivel = fn),
      parar: () => {
        try {
          fonte.disconnect();
          no.disconnect();
        } catch {
          /* já desligados */
        }
        track.stop();
        bruta.stop();
        ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    console.warn("[voz] processador indisponível; microfone segue sem ele", err);
    ctx?.close().catch(() => {});
    return null;
  }
}
