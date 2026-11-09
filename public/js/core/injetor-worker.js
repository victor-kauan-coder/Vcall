/**
 * core/injetor-worker.js — os quadros do motor nativo no WebRTC do Chromium.
 *
 * Cada sender da tela (um por pessoa na malha) tem uma RTCRtpScriptTransform
 * aqui, posta quando o sender nasce: o Chromium só passa os quadros por uma
 * transform posta ANTES da negociação (medido no Electron 44; posta depois,
 * os quadros saem por fora dela). Por isso ela começa no modo "passar" — os
 * quadros da captura do Chromium seguem intactos — e vai para "injetar" quando
 * o sender passa a levar a trilha falsa do motor (core/midia.js).
 *
 * Injetar: o sender codifica uma trilha falsa (160x90, parada); a transform
 * troca cada quadro dela pelo H.264 que o motor codificou. O empacotador H.264
 * do Chromium relê as NAL, então o quadro sai como se fosse dele.
 *
 * Ritmo (o modelo "puxar" de midia/README.md):
 *   - cada quadro nativo vai para a fila dos senders que injetam e pede à
 *     página um quadro falso com o horário da captura ({falso}): o RTP sai no
 *     ritmo real da tela;
 *   - cada quadro falso consumido pede o próximo ao motor ("quadro"); o motor
 *     só codifica quando pedido (e sem passar do qps), então cada quadro sai
 *     uma vez, em ordem, e a cadeia de referência do H.264 não quebra.
 *
 * Quadro-chave:
 *   - sender que começa a injetar (alguém entrou, voltou a assistir) espera um
 *     IDR e pede um: delta sem o anterior estraga a imagem de quem recebe;
 *   - quadro falso marcado "key" = quem recebe pediu (PLI/FIR): pede um IDR;
 *   - fila acima de 2 (o Chromium descartou quadros falsos, ou o par está
 *     pausado porque não assiste): pula para o IDR mais novo da fila ou pede
 *     um e larga os deltas até ele.
 */
let porta = null;
/** id da transform -> { modo, fila, esperandoChave } */
const senders = new Map();
let pedidoEm = 0;
/** Contadores para o diagnóstico (core/midia.js guarda em `diag`). */
const diag = { quadros: 0, transforms: 0, passados: 0, trocados: 0, vazios: 0 };

const pedir = () => {
  pedidoEm = performance.now();
  porta?.postMessage("quadro");
};
const pedirChave = () => porta?.postMessage("chave");
const estado = (id) => {
  let s = senders.get(id);
  if (!s) senders.set(id, (s = { modo: "passar", fila: [], esperandoChave: true }));
  return s;
};

onmessage = ({ data }) => {
  if (data.porta) {
    // Motor novo (outra fonte, outra qualidade): filas zeradas, IDR para todos.
    porta?.close();
    porta = data.porta;
    porta.onmessage = ({ data: m }) => chegou(m);
    porta.start();
    for (const s of senders.values()) {
      s.fila = [];
      s.esperandoChave = true;
    }
    pedir();
    pedirChave();
  } else if (data.modo) {
    const s = estado(data.id);
    if (s.modo === data.modo) return;
    s.modo = data.modo;
    s.fila = [];
    s.esperandoChave = true;
    if (s.modo === "injetar") pedirChave();
  } else if (data.comando) {
    porta?.postMessage(data.comando);
  } else if (data.parar) {
    porta?.close();
    porta = null;
  }
};

function chegou(m) {
  if (m.fim || m.info || m.estatisticas) {
    postMessage(m);
    return;
  }
  diag.quadros++;
  for (const s of senders.values()) {
    if (s.modo !== "injetar") continue;
    s.fila.push(m);
    // Par pausado (não assiste) não consome: guarda só os últimos.
    if (s.fila.length > 30) s.fila.shift();
  }
  postMessage({ falso: m.tempo });
}

// Se o Chromium descartar quadros falsos, ninguém pede o próximo.
setInterval(() => {
  if (porta && performance.now() - pedidoEm > 50) pedir();
}, 16);
setInterval(() => postMessage({ diag: { ...diag, senders: senders.size } }), 1000);

onrtctransform = ({ transformer }) => {
  const id = transformer.options?.id;
  const s = estado(id);
  diag.transforms++;
  transformer.readable
    .pipeThrough(
      new TransformStream({
        transform(frame, ctl) {
          if (s.modo !== "injetar") {
            diag.passados++;
            ctl.enqueue(frame);
            return;
          }
          if (frame.type === "key" && !s.esperandoChave) pedirChave();
          if (s.fila.length > 2) {
            const k = s.fila.findLastIndex((q) => q.chave);
            if (k > 0) s.fila.splice(0, k);
            else if (k < 0 && !s.esperandoChave) {
              s.esperandoChave = true;
              pedirChave();
            }
          }
          const q = s.fila.shift();
          pedir();
          if (!q || (s.esperandoChave && !q.chave)) {
            diag.vazios++;
            return;
          }
          diag.trocados++;
          s.esperandoChave = false;
          // Uma cópia por sender: o mesmo buffer não vai em dois quadros.
          frame.data = q.dados.slice().buffer;
          ctl.enqueue(frame);
        },
      }),
    )
    .pipeTo(transformer.writable)
    .catch(() => senders.delete(id));
};
