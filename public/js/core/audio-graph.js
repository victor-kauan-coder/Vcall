/**
 * core/audio-graph.js — um único contexto de áudio para a página inteira.
 *
 * Existe por causa de um problema concreto: no Chrome, criar mais de um
 * `MediaStreamAudioSourceNode` a partir do MESMO MediaStream — sobretudo em
 * contextos diferentes — faz um dos dois receber silêncio. O app tinha três
 * contextos (saída de áudio, detecção de fala e os avisos sonoros), e a
 * detecção de fala pegava o stream do participante antes da saída. Resultado:
 * a conexão funcionava, o outro lado ouvia, e quem recebia não ouvia nada.
 *
 * A regra passa a ser: **um contexto, uma origem por stream**. Quem precisar
 * do áudio pede `sourceFor(stream)` e liga o que quiser na saída dessa mesma
 * origem — o ganho que vai para os alto-falantes, o analisador que detecta
 * quem está falando, o que for.
 */

let ctx = null;
let unavailable = false;

/** stream.id -> { node, refs } */
const sources = new Map();

export function audioContext() {
  if (unavailable) return null;
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      unavailable = true;
      return null;
    }
    try {
      ctx = new Ctx();
    } catch {
      unavailable = true;
      return null;
    }
  }
  return ctx;
}

export function contextState() {
  return ctx ? ctx.state : unavailable ? "unavailable" : "none";
}

/**
 * O navegador começa com o contexto suspenso e só o libera depois de um gesto
 * do usuário. Chame isto de dentro de um clique.
 */
export async function resumeAudio() {
  const c = audioContext();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  return c.state === "running";
}

/**
 * A origem compartilhada de um stream. Chamadas repetidas devolvem o MESMO
 * nó, com contagem de referências — é exatamente isso que evita o silêncio.
 */
export function sourceFor(stream) {
  const c = audioContext();
  if (!c || !stream || !stream.getAudioTracks().length) return null;

  const key = stream.id;
  const hit = sources.get(key);
  if (hit) {
    hit.refs += 1;
    return hit.node;
  }

  let node;
  try {
    node = c.createMediaStreamSource(stream);
  } catch {
    return null;
  }
  sources.set(key, { node, refs: 1 });
  return node;
}

/** Libera uma referência. A origem só é descartada quando ninguém mais a usa. */
export function releaseSource(stream) {
  if (!stream) return;
  const entry = sources.get(stream.id);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  try {
    entry.node.disconnect();
  } catch {
    /* já desconectado */
  }
  sources.delete(stream.id);
}

export function closeAudio() {
  for (const { node } of sources.values()) {
    try {
      node.disconnect();
    } catch {
      /* idem */
    }
  }
  sources.clear();
  ctx?.close().catch(() => {});
  ctx = null;
}

/** Diagnóstico. */
export function graphDebug() {
  return {
    state: contextState(),
    sampleRate: ctx?.sampleRate ?? null,
    sources: sources.size,
  };
}
