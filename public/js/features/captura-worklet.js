/**
 * features/captura-worklet.js — entrega o áudio do microfone em blocos.
 *
 * Roda na thread de áudio. Junta os blocos de 128 amostras que o navegador
 * entrega em pedaços de ~100 ms e os passa adiante; quem decide o que é fala
 * é o worker do reconhecedor (features/whisper-worker.js).
 */
class Captura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(sampleRate / 10);
    this.n = 0;
    // O destino pode ser um MessagePort entregue pela página: o áudio vai
    // direto ao worker do reconhecedor, sem passar pela thread da página.
    this.destino = this.port;
    this.port.onmessage = ({ data }) => {
      if (data?.porta) this.destino = data.porta;
    };
  }

  process(inputs) {
    const canal = inputs[0]?.[0];
    if (canal) {
      let i = 0;
      while (i < canal.length) {
        const cabe = Math.min(canal.length - i, this.buf.length - this.n);
        this.buf.set(canal.subarray(i, i + cabe), this.n);
        this.n += cabe;
        i += cabe;
        if (this.n === this.buf.length) {
          const bloco = this.buf.slice(0);
          this.destino.postMessage(bloco, [bloco.buffer]);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("vcall-captura", Captura);
