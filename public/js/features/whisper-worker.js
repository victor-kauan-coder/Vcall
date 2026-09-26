/**
 * features/whisper-worker.js — a transcrição inteira, fora da tela.
 *
 * O áudio do microfone chega aqui direto do AudioWorklet (por um
 * MessageChannel, sem passar pela thread da página) e tudo o mais acontece
 * neste worker: detectar quando a pessoa fala, cortar as frases, decidir
 * quando vale a pena rodar o Whisper e entregar o texto. A página só desenha.
 *
 * O que torna isto leve, rápido e preciso (medido em scripts/bench-fala —
 * veja a wiki, "Legendas"):
 *
 * 1. DETECTOR DE VOZ DE VERDADE (Silero VAD v5). Antes o corte era por
 *    volume: clique de teclado e ventilador "eram fala", as frases grudavam
 *    umas nas outras e a legenda chegava até 8 s atrasada. O Silero é uma
 *    rede minúscula (2 MB, ~0,3 ms por quadro de 32 ms) treinada para isso.
 *
 * 2. O WHISPER SÓ RODA QUANDO COMPENSA. Cada chamada custa o mesmo que 30 s de
 *    áudio (o encoder sempre enxerga uma janela de 30 s), então o que pesa é
 *    o NÚMERO de chamadas. Parciais só com a fala em andamento, espaçadas
 *    pelo próprio custo medido (máquina lenta = menos parciais, sem fila); e
 *    o texto é limitado ao que cabe na duração do trecho.
 *
 * 3. PALAVRAS CONFIRMADAS NÃO MUDAM (LocalAgreement-2, do Whisper-Streaming,
 *    Macháček et al., 2023). Uma palavra só é "confirmada" quando duas
 *    leituras seguidas concordam nela. A legenda mostra as confirmadas
 *    firmes e o resto mais claro — sem aquele texto que pisca e se reescreve.
 *
 * 4. CONTEXTO. A frase anterior entra como "prompt" do Whisper: nomes e
 *    termos que já apareceram tendem a ser escritos igual, e a pontuação
 *    segue o fluxo da conversa.
 *
 * Mensagens:
 *   → { tipo: "abrir", base, modelo, idioma, vad }
 *   → { tipo: "audio", porta }        porta do AudioWorklet (Float32, 16 kHz)
 *   → { tipo: "pausa", on }           microfone mudo: nada é processado
 *   → { tipo: "reiniciar" }           nova sessão de legenda
 *   → { tipo: "ouvir", id, audio }    transcreve um trecho avulso (testes)
 *   ← { tipo: "pronto" } | { tipo: "erro", mensagem }
 *   ← { tipo: "falando", on }
 *   ← { tipo: "parcial", confirmado, provisorio }
 *   ← { tipo: "final", texto, ms }
 *   ← { tipo: "texto", id, texto, ms }        resposta de "ouvir"
 */
import * as lib from "/vendor/whisper/transformers.js";
import { abrirWhisper, Acordo, limpar, tokensPara } from "./whisper-nucleo.js";

const { env, InferenceSession, OrtTensor } = lib;

const TAXA = 16_000;
/** Experimentos de ajuste (scripts de medição): ?exp=semcontexto,threads4 … */
const EXP = new Set((new URL(self.location.href).searchParams.get("exp") || "").split(",").filter(Boolean));
const QUADRO = 512; // 32 ms: o que o Silero v5 lê por vez
const CONTEXTO = 64; // o Silero v5 quer as últimas 64 amostras do quadro anterior

/* ------------------------------------------------------------------ *
 * Modelos
 * ------------------------------------------------------------------ */

let whisper = null;
let vad = null;
/**
 * O encoder aceita trechos curtos (desktop/whisper-curto.js adapta o modelo
 * ao baixar)? Então ele lê só o tamanho do áudio, em vez de uma janela fixa
 * de 30 s — a mesma ideia do `audio_ctx` do whisper.cpp. Uma frase de 3 s
 * custa ~1/10 do que custava.
 */
let curto = false;

async function abrir({ base, modelo: repo, idioma, vad: urlVad, curto: encoderCurto, dtype, folgaS }) {
  curto = !!encoderCurto && !EXP.has("longo");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = base;
  env.useBrowserCache = false;
  env.backends.onnx.wasm.wasmPaths = "/vendor/whisper/";
  // Várias threads só com isolamento de origem (SharedArrayBuffer). Metade
  // dos núcleos, no máximo 4: o resto fica para o jogo, o vídeo e a chamada.
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
    : 1;
  for (const e of EXP) if (/^threads\d$/.test(e)) env.backends.onnx.wasm.numThreads = Number(e.slice(7));

  /*
   * Sem "spinning": por padrão as threads do ONNX Runtime ficam girando em
   * espera ativa entre uma inferência e outra. Para um reconhecedor que roda
   * em rajadas curtas, dormir é o certo.
   */
  const semGiro = { extra: { session: { intra_op: { allow_spinning: "0" }, inter_op: { allow_spinning: "0" } } } };
  const opcoes = {
    dtype: dtype || { encoder_model: "q8", decoder_model_merged: "q8" },
    device: "wasm",
    session_options: semGiro,
  };
  try {
    whisper = await abrirWhisper(lib, {
      repo,
      idioma,
      curto,
      folgaS: Number(folgaS) > 0 ? Number(folgaS) : 1,
      opcoes,
      lerJson: async (arquivo) => {
        const r = await fetch(`${base}${repo}/${arquivo}`);
        if (!r.ok) throw new Error(`${arquivo}: ${r.status}`);
        return r.json();
      },
    });
  } catch (err) {
    throw new Error(`o modelo de fala não abriu (${err?.message || err})`);
  }

  if (urlVad) {
    try {
      vad = new Silero(await InferenceSession.create(urlVad, { executionProviders: ["wasm"], ...semGiro }));
    } catch (err) {
      console.warn("[whisper] Silero indisponível; usando o volume", err);
      vad = null;
    }
  }
  // Aquece: a primeira inferência compila o grafo e custa o dobro.
  await whisper.transcrever(new Float32Array(TAXA), { maxTokens: 4 }).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * Detector de voz
 * ------------------------------------------------------------------ */

class Silero {
  constructor(sessao) {
    this.sessao = sessao;
    this.sr = new OrtTensor("int64", BigInt64Array.from([16000n]), []);
    this.reiniciar();
  }
  reiniciar() {
    this.estado = new OrtTensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    this.contexto = new Float32Array(CONTEXTO);
  }
  /** Probabilidade de haver voz no quadro (0–1). */
  async prob(quadro) {
    const entrada = new Float32Array(CONTEXTO + QUADRO);
    entrada.set(this.contexto);
    entrada.set(quadro, CONTEXTO);
    const r = await this.sessao.run({ input: new OrtTensor("float32", entrada, [1, entrada.length]), state: this.estado, sr: this.sr });
    this.estado = r.stateN;
    this.contexto = quadro.slice(QUADRO - CONTEXTO);
    return r.output.data[0];
  }
}

/** Sem Silero: volume acima do ruído de fundo (o método antigo). */
let ruido = 0.004;
function probPorVolume(q) {
  let s = 0;
  for (let i = 0; i < q.length; i += 1) s += q[i] * q[i];
  const rms = Math.sqrt(s / q.length);
  const voz = rms > Math.max(0.008, ruido * 3.2);
  if (!voz) ruido = ruido * 0.97 + Math.min(rms, 0.05) * 0.03;
  return voz ? 0.9 : 0.1;
}

/** Texto das últimas frases, usado como contexto da próxima. */
let historico = "";
/** Contexto só com evidência de que ajuda: veja a medição (scripts/bench-fala.mjs). */
const usarContexto = EXP.has("contexto");
const transcrever = (audio, o) => whisper.transcrever(audio, o);

/* ------------------------------------------------------------------ *
 * O ciclo: áudio → voz → frase → texto
 * ------------------------------------------------------------------ */

const LIGA = 0.5; // prob. de voz para começar uma frase
const DESLIGA = 0.35; // abaixo disto é pausa
const PAUSA_Q = 15; // 15 × 32 ms ≈ 480 ms de pausa encerra a frase
const ANTES_Q = 8; // ≈ 256 ms de áudio antes da voz entram na frase
const MIN_VOZ_Q = 6; // frase com menos de ≈ 190 ms de voz é ruído
const MAX_S = 12; // frase mais longa que isso é cortada numa pausa curta
const PRIMEIRO_PARCIAL_S = 0.9;

let pausado = false;
let resto = new Float32Array(0);
let fila = []; // blocos de áudio esperando o detector
let rodando = false;

let falando = false;
let frase = []; // quadros da frase atual
let antes = []; // quadros recentes, para o começo da frase
let vozQ = 0; // quadros com voz na frase
let pausaQ = 0;
let ultimoParcial = 0; // em quadros
let custoMs = 600; // quanto a última transcrição demorou (média móvel)
const acordo = new Acordo();
let finais = []; // frases encerradas esperando o Whisper

function juntar(quadros) {
  const out = new Float32Array(quadros.length * QUADRO);
  quadros.forEach((q, i) => out.set(q, i * QUADRO));
  return out;
}

function encerrarFrase() {
  if (falando) self.postMessage({ tipo: "falando", on: false });
  if (falando && vozQ >= MIN_VOZ_Q) finais.push(juntar(frase));
  falando = false;
  frase = [];
  vozQ = 0;
  pausaQ = 0;
  ultimoParcial = 0;
}

async function quadro(q) {
  const p = vad ? await vad.prob(q) : probPorVolume(q);
  if (!falando) {
    antes.push(q);
    if (antes.length > ANTES_Q) antes.shift();
    if (p >= LIGA) {
      falando = true;
      frase = [...antes];
      antes = [];
      vozQ = 1;
      pausaQ = 0;
      acordo.reiniciar();
      self.postMessage({ tipo: "falando", on: true });
    }
    return;
  }
  frase.push(q);
  if (p >= LIGA) vozQ += 1;
  pausaQ = p < DESLIGA ? pausaQ + 1 : 0;
  const dur = (frase.length * QUADRO) / TAXA;
  // Fim da frase: uma pausa, ou (frase longa) qualquer respiro.
  if (pausaQ >= PAUSA_Q || (dur > MAX_S * 0.7 && pausaQ >= 3) || dur >= MAX_S) encerrarFrase();
}

/** Decide se roda o Whisper agora, e para quê. Um por vez. */
async function talvezTranscrever() {
  if (finais.length) {
    const audio = finais.shift();
    const t0 = performance.now();
    const bruto = await transcrever(audio, { maxTokens: tokensPara(audio.length), contexto: usarContexto ? historico : "" });
    const ms = performance.now() - t0;
    custoMs = custoMs * 0.6 + ms * 0.4;
    const texto = limpar(bruto, historico);
    if (texto) {
      historico = `${historico} ${texto}`.slice(-220);
      self.postMessage({ tipo: "final", texto, ms: Math.round(ms) });
    } else {
      self.postMessage({ tipo: "final", texto: "", ms: Math.round(ms) });
    }
    return true;
  }
  if (!falando) return false;
  const dur = (frase.length * QUADRO) / TAXA;
  // Espaçamento pelo custo real: numa máquina lenta os parciais rareiam em
  // vez de formar fila (e de atrasar a frase final, que é a que importa).
  const intervaloQ = Math.max(0.7, Math.min(4, (custoMs * 1.5) / 1000)) * (TAXA / QUADRO);
  if (dur < PRIMEIRO_PARCIAL_S || frase.length - ultimoParcial < intervaloQ) return false;
  ultimoParcial = frase.length;
  const t0 = performance.now();
  const bruto = await transcrever(juntar(frase), { maxTokens: Math.ceil(dur * 9) + 8, contexto: historico });
  custoMs = custoMs * 0.6 + (performance.now() - t0) * 0.4;
  const texto = limpar(bruto, historico);
  // A frase pode ter terminado enquanto o parcial rodava: aí ele não vale mais.
  if (texto && falando) self.postMessage({ tipo: "parcial", ...acordo.ler(texto) });
  return true;
}

/** Um único laço consome o áudio e roda o Whisper, sem reentrância. */
async function bombear() {
  if (rodando) return;
  rodando = true;
  try {
    for (;;) {
      if (fila.length) {
        // Processa todo o áudio acumulado antes de decidir (o detector é
        // barato; atrasar a decisão é o que custaria latência).
        const blocos = fila;
        fila = [];
        for (const b of blocos) {
          let dados = b;
          if (resto.length) {
            dados = new Float32Array(resto.length + b.length);
            dados.set(resto);
            dados.set(b, resto.length);
          }
          let i = 0;
          for (; i + QUADRO <= dados.length; i += QUADRO) await quadro(dados.slice(i, i + QUADRO));
          resto = dados.slice(i);
        }
        continue;
      }
      if (!(await talvezTranscrever())) break;
    }
  } catch (err) {
    self.postMessage({ tipo: "erro", mensagem: String(err?.message || err) });
  } finally {
    rodando = false;
  }
}

function aoAudio({ data }) {
  if (pausado || !whisper) return;
  fila.push(data);
  bombear();
}

/* ------------------------------------------------------------------ */

let cadeia = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.tipo === "audio") {
    data.porta.onmessage = aoAudio;
    return;
  }
  if (data.tipo === "pausa") {
    pausado = !!data.on;
    if (pausado) {
      fila = [];
      encerrarFrase();
      bombear();
    }
    return;
  }
  if (data.tipo === "reiniciar") {
    fila = [];
    resto = new Float32Array(0);
    antes = [];
    finais = [];
    falando = false;
    frase = [];
    historico = "";
    vad?.reiniciar();
    return;
  }
  cadeia = cadeia.then(async () => {
    try {
      if (data.tipo === "abrir") {
        await abrir(data);
        self.postMessage({ tipo: "pronto", vad: !!vad, curto, threads: env.backends.onnx.wasm.numThreads });
      } else if (data.tipo === "ouvir" && whisper) {
        const t0 = performance.now();
        const texto = limpar(await transcrever(data.audio, { maxTokens: 160 }));
        self.postMessage({ tipo: "texto", id: data.id, texto, ms: Math.round(performance.now() - t0) });
      }
    } catch (err) {
      self.postMessage({ tipo: "erro", id: data?.id, mensagem: String(err?.message || err) });
    }
  });
};
