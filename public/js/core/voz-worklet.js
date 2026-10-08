/**
 * core/voz-worklet.js — o processador de voz, na thread de áudio.
 *
 * Duas etapas por quadro de 10 ms (480 amostras a 48 kHz):
 *
 * 1. SUPRESSÃO DE RUÍDO POR IA (RNNoise). Uma rede neural pequena, treinada
 *    para separar voz de ruído: teclado mecânico, ventilador, cachorro, ar-
 *    condicionado. É o mesmo tipo de coisa que o Krisp faz no Discord, só
 *    que rodando aqui, sem mandar áudio para servidor nenhum. De brinde, ela
 *    diz a probabilidade de o quadro ter voz.
 *
 * 2. SENSIBILIDADE DE ENTRADA (o "portão"). Entre uma frase e outra, o
 *    microfone fica fechado: nem o ruído que sobrou nem a respiração vão para
 *    a sala. No automático, quem decide é a probabilidade de voz da rede; no
 *    manual, um limiar de volume em dB, como no Discord.
 *
 *    O portão olha 30 ms À FRENTE do que está tocando: o áudio sai com um
 *    pequeno atraso e o portão já abriu quando a primeira sílaba passa. Sem
 *    isso, todo começo de frase saía cortado ("om dia").
 */
import createRNNWasmModuleSync from "/vendor/rnnoise-sync.js";

const QUADRO = 480;
const ADIANTE = 3; // quadros de antecipação do portão (30 ms)
const SEGURA = 30; // quadros que o portão fica aberto depois da voz (300 ms)

class Voz extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    const o = opcoes?.processorOptions || {};
    this.ruido = o.ruido !== false;
    /** "auto" | "off" | número em dBFS */
    this.limiar = o.limiar ?? "auto";

    this.mod = null;
    try {
      this.mod = createRNNWasmModuleSync();
      this.estado = this.mod._rnnoise_create();
      this.ptr = this.mod._malloc(QUADRO * 4);
    } catch {
      this.mod = null; // sem RNNoise: o portão por volume continua valendo
    }

    this.entrada = new Float32Array(QUADRO);
    this.nEntrada = 0;
    /** Quadros processados esperando a decisão do portão. */
    this.fila = [];
    /** Saída pronta, amostra a amostra. */
    this.saida = new Float32Array(QUADRO * 8);
    this.lerEm = 0;
    this.escreverEm = 0;
    this.prontas = 0;
    this.ganho = 1;
    this.segura = 0;
    this.contaAviso = 0;

    this.port.onmessage = ({ data }) => {
      if ("ruido" in data) this.ruido = !!data.ruido;
      if ("limiar" in data) this.limiar = data.limiar;
    };
  }

  #quadro() {
    const q = new Float32Array(QUADRO);
    let voz = null;
    if (this.ruido && this.mod) {
      const heap = this.mod.HEAPF32;
      const base = this.ptr >> 2;
      // O RNNoise trabalha na escala de 16 bits.
      for (let i = 0; i < QUADRO; i += 1) heap[base + i] = this.entrada[i] * 32768;
      voz = this.mod._rnnoise_process_frame(this.estado, this.ptr, this.ptr);
      for (let i = 0; i < QUADRO; i += 1) q[i] = heap[base + i] / 32768;
    } else {
      q.set(this.entrada);
    }
    let soma = 0;
    for (let i = 0; i < QUADRO; i += 1) soma += q[i] * q[i];
    const db = 10 * Math.log10(soma / QUADRO + 1e-12);

    let aberto;
    if (this.limiar === "off") aberto = true;
    // A probabilidade da rede cai em microfone de fone Bluetooth (banda
    // estreita) e em voz baixa: só ela fechava o portão em cima de gente
    // falando. Som forte depois da supressão de ruído é voz; passa sempre.
    // ponytail: -45 dBFS chutado com microfone de notebook; ajuste se cortar.
    else if (this.limiar === "auto") aberto = voz === null ? true : (voz > 0.5 && db > -65) || db > -45;
    else aberto = db > Number(this.limiar);

    this.fila.push({ q, aberto, db });
    if (this.fila.length <= ADIANTE) return;

    // Abre se qualquer quadro da janela à frente tiver voz.
    if (this.fila.some((f) => f.aberto)) this.segura = SEGURA;
    else if (this.segura > 0) this.segura -= 1;
    const alvo = this.segura > 0 ? 1 : 0;

    const { q: sai } = this.fila.shift();
    // Abre rápido (5 ms), fecha devagar (40 ms): sem estalo nas bordas.
    const passo = alvo > this.ganho ? 1 / 240 : 1 / 1920;
    for (let i = 0; i < QUADRO; i += 1) {
      if (this.ganho < alvo) this.ganho = Math.min(alvo, this.ganho + passo);
      else if (this.ganho > alvo) this.ganho = Math.max(alvo, this.ganho - passo);
      this.saida[this.escreverEm] = sai[i] * this.ganho;
      this.escreverEm = (this.escreverEm + 1) % this.saida.length;
    }
    this.prontas = Math.min(this.saida.length, this.prontas + QUADRO);

    // Nível e estado do portão para o medidor das Configurações (10×/s).
    if (++this.contaAviso >= 10) {
      this.contaAviso = 0;
      this.port.postMessage({ db, aberto: alvo === 1 });
    }
  }

  process(inputs, outputs) {
    const entrada = inputs[0]?.[0];
    const saida = outputs[0]?.[0];
    if (entrada) {
      for (let i = 0; i < entrada.length; i += 1) {
        this.entrada[this.nEntrada++] = entrada[i];
        if (this.nEntrada === QUADRO) {
          this.nEntrada = 0;
          this.#quadro();
        }
      }
    }
    if (saida) {
      if (this.prontas >= saida.length) {
        for (let i = 0; i < saida.length; i += 1) {
          saida[i] = this.saida[this.lerEm];
          this.lerEm = (this.lerEm + 1) % this.saida.length;
        }
        this.prontas -= saida.length;
      } else {
        saida.fill(0);
      }
    }
    return true;
  }
}

registerProcessor("vcall-voz", Voz);
