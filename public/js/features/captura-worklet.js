/**
 * features/captura-worklet.js — entrega o áudio do microfone em blocos.
 *
 * Roda na thread de áudio. Junta os blocos de 128 amostras que o navegador
 * entrega em pedaços de ~100 ms e os passa adiante; quem decide o que é fala
 * é a página (features/fala-whisper.js).
 */
class Captura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(sampleRate / 10);
    this.n = 0;
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
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("vcall-captura", Captura);
