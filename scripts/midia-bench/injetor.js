// Worker da RTCRtpScriptTransform: troca o quadro da trilha falsa (160x90,
// parada) pelo quadro H.264 do vcall-midia, na ordem.
//
// A página escreve um quadro falso para cada quadro nativo que chega (com o
// horário da captura) e este worker pede o próximo ao motor ({pedir}) a cada
// quadro que consome; o motor (--sob-demanda) só codifica quando pedido. Cada
// quadro codificado sai uma vez, em ordem: a cadeia de referência do H.264 não
// quebra.
//
// - Quadro falso marcado "key" depois do primeiro: quem recebe pediu (PLI/FIR).
//   Pede um IDR ao motor; ele sai no próximo quadro.
// - Fila acima de 2 (o Chromium descartou quadros falsos e ficou atraso): pede
//   um IDR e, quando ele estiver na fila, larga o que veio antes dele.
const fila = [];
let primeiro = true;
let pediuChave = false;
let injetados = 0;
let vazios = 0;
let largados = 0;

onmessage = (e) => {
  if (e.data.quadro) fila.push(e.data.quadro);
};

onrtctransform = ({ transformer }) => {
  transformer.readable
    .pipeThrough(
      new TransformStream({
        transform(frame, ctl) {
          if (frame.type === "key" && !primeiro) postMessage({ chave: true });
          primeiro = false;
          if (fila.length > 2) {
            const k = fila.findLastIndex((q) => q.chave);
            if (k > 0) {
              largados += k;
              fila.splice(0, k);
            } else if (!pediuChave) {
              pediuChave = true;
              postMessage({ chave: true });
            }
          }
          const q = fila.shift();
          postMessage({ pedir: true });
          if (!q) {
            vazios++;
            return;
          }
          if (q.chave) pediuChave = false;
          frame.data = q.dados;
          injetados++;
          ctl.enqueue(frame);
        },
      }),
    )
    .pipeTo(transformer.writable);
};

setInterval(() => postMessage({ injetados, vazios, largados, fila: fila.length }), 1000);
