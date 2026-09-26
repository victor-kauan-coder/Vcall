#!/usr/bin/env node
/**
 * scripts/bench-fala.mjs — quanto as legendas acertam, e quanto custam.
 *
 * Mede o reconhecimento (public/js/features/whisper-nucleo.js, o mesmo
 * código do app) com VOZ HUMANA de verdade: frases do LapsBM (UFPA
 * FalaBrasil — 35 falantes brasileiros, gravadas sem ambiente controlado),
 * com a transcrição de referência. Para cada configuração:
 *
 *   - WER: palavras erradas / palavras ditas (menor é melhor);
 *   - tempo médio por frase e o pior caso;
 *   - memória do processo depois.
 *
 * Roda no CI (.github/workflows/bench-fala.yml), que tem acesso ao Hugging
 * Face. Localmente: HF_OFFLINE_DIR aponta modelos e áudios já baixados.
 *
 *   node scripts/bench-fala.mjs [--frases 40] [--configs base-q8-curto,...]
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import * as lib from "@huggingface/transformers";
import { adaptarEncoder } from "../desktop/whisper-curto.js";
import { abrirWhisper, limpar, tokensPara, wer } from "../public/js/features/whisper-nucleo.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = process.env.BENCH_CACHE || path.join(os.tmpdir(), "vcall-bench-fala");
const HF = "https://huggingface.co";
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const N_FRASES = Number(arg("frases", 40));
const THREADS = Number(arg("threads", 2));

/* ------------------------------------------------------------------ *
 * Downloads (com cache)
 * ------------------------------------------------------------------ */

async function baixar(url, destino) {
  if (existsSync(destino)) return readFileSync(destino);
  mkdirSync(path.dirname(destino), { recursive: true });
  for (let tentativa = 1; ; tentativa += 1) {
    const r = await fetch(url);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(destino, buf);
      return buf;
    }
    if (tentativa >= 3 || r.status === 404) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 2000 * tentativa));
  }
}

const ARQS = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json"];

async function prepararModelo(repo, encoder) {
  const dir = path.join(cache, "modelos", repo);
  for (const a of [...ARQS, "onnx/decoder_model_merged_quantized.onnx"]) await baixar(`${HF}/${repo}/resolve/main/${a}`, path.join(dir, a));
  const enc = path.join(dir, "onnx", encoder);
  await baixar(`${HF}/${repo}/resolve/main/onnx/${encoder}`, enc);
  // O modelo adaptado lê qualquer tamanho — inclusive os 30 s inteiros, com o
  // mesmo resultado numérico — então serve às configurações "longo" também.
  writeFileSync(enc, adaptarEncoder(readFileSync(enc)));
  return path.join(cache, "modelos");
}

/** Frases do LapsBM: .wav + .txt com o mesmo nome. */
async function prepararFrases() {
  // Sem rede: uma pasta local com pares .wav/.txt.
  if (process.env.BENCH_FRASES_DIR) {
    const { readdirSync } = await import("node:fs");
    const dir = process.env.BENCH_FRASES_DIR;
    return readdirSync(dir)
      .filter((a) => a.endsWith(".wav") && existsSync(path.join(dir, a.replace(/\.wav$/, ".txt"))))
      .sort()
      .slice(0, N_FRASES)
      .map((a) => ({
        id: a,
        falante: "local",
        audio: lerWav16k(readFileSync(path.join(dir, a))),
        texto: readFileSync(path.join(dir, a.replace(/\.wav$/, ".txt")), "utf8").trim(),
      }));
  }
  // A API lista uma pasta por vez: primeiro os falantes, depois os arquivos.
  const listar = async (pasta) => {
    const r = await fetch(`${HF}/api/datasets/falabrasil/lapsbm/tree/main/${pasta}`);
    if (!r.ok) throw new Error(`LapsBM (${pasta}): ${r.status}`);
    return r.json();
  };
  const falantes = (await listar("data/test")).filter((x) => x.type === "directory").map((x) => x.path);
  const lista = [];
  for (const f of falantes.slice(0, Math.max(6, Math.ceil(N_FRASES / 4)))) {
    for (const x of await listar(f)) lista.push(x.path);
  }
  const wavs = lista.filter((p) => /\.wav$/i.test(p)).sort();
  const txts = new Set(lista.filter((p) => /\.txt$/i.test(p)));
  const pares = wavs.map((w) => [w, w.replace(/\.wav$/i, ".txt")]).filter(([, t]) => txts.has(t));
  if (!pares.length) {
    console.log("Estrutura do LapsBM:", lista.slice(0, 40));
    throw new Error("LapsBM: nenhum par .wav/.txt");
  }
  // Espalha pelos falantes (pastas) em vez de pegar só os primeiros.
  const porFalante = new Map();
  for (const p of pares) {
    const f = path.dirname(p[0]);
    if (!porFalante.has(f)) porFalante.set(f, []);
    porFalante.get(f).push(p);
  }
  const escolhidos = [];
  for (let i = 0; escolhidos.length < N_FRASES; i += 1) {
    let algum = false;
    for (const l of porFalante.values()) {
      if (l[i] && escolhidos.length < N_FRASES) {
        escolhidos.push(l[i]);
        algum = true;
      }
    }
    if (!algum) break;
  }
  const frases = [];
  for (const [w, t] of escolhidos) {
    const wav = await baixar(`${HF}/datasets/falabrasil/lapsbm/resolve/main/${w}`, path.join(cache, "lapsbm", w));
    const txt = (await baixar(`${HF}/datasets/falabrasil/lapsbm/resolve/main/${t}`, path.join(cache, "lapsbm", t))).toString("utf8").trim();
    frases.push({ id: w, falante: path.dirname(w), audio: lerWav16k(wav), texto: txt });
  }
  return frases;
}

/** WAV PCM 16 bits -> Float32 mono a 16 kHz (interpolação linear). */
function lerWav16k(buf) {
  let pos = 12;
  let fmt = null;
  let dados = null;
  while (pos < buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const tam = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { canais: buf.readUInt16LE(pos + 10), taxa: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === "data") dados = buf.subarray(pos + 8, pos + 8 + tam);
    pos += 8 + tam + (tam % 2);
  }
  if (!fmt || !dados || fmt.bits !== 16) throw new Error("WAV não suportado");
  const n = dados.length / 2 / fmt.canais;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i += 1) mono[i] = dados.readInt16LE(i * 2 * fmt.canais) / 32768;
  if (fmt.taxa === 16_000) return mono;
  const razao = fmt.taxa / 16_000;
  const out = new Float32Array(Math.floor(n / razao));
  for (let i = 0; i < out.length; i += 1) {
    const x = i * razao;
    const k = Math.floor(x);
    out[i] = mono[k] + (mono[Math.min(k + 1, n - 1)] - mono[k]) * (x - k);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Medição
 * ------------------------------------------------------------------ */

const CONFIGS = {
  "tiny-q8-longo": { repo: "Xenova/whisper-tiny", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: false },
  "tiny-q8-curto": { repo: "Xenova/whisper-tiny", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: true },
  "base-q8-longo": { repo: "Xenova/whisper-base", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: false },
  "base-q8-curto": { repo: "Xenova/whisper-base", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: true },
  "base-fp32-curto": { repo: "Xenova/whisper-base", enc: "encoder_model.onnx", dtype: "fp32", curto: true },
  "base-q8-curto-contexto": { repo: "Xenova/whisper-base", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: true, contexto: true },
  "small-q8-curto": { repo: "Xenova/whisper-small", enc: "encoder_model_quantized.onnx", dtype: "q8", curto: true },
  "small-fp32-curto": { repo: "Xenova/whisper-small", enc: "encoder_model.onnx", dtype: "fp32", curto: true },
};

async function medir(nome, cfg, frases) {
  const base = await prepararModelo(cfg.repo, cfg.enc);
  lib.env.allowRemoteModels = false;
  lib.env.localModelPath = `${base}/`;
  const t0 = performance.now();
  const w = await abrirWhisper(lib, {
    repo: cfg.repo,
    idioma: "pt",
    curto: cfg.curto,
    opcoes: {
      dtype: { encoder_model: cfg.dtype, decoder_model_merged: "q8" },
      device: "cpu",
      session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 },
    },
    lerJson: async (a) => JSON.parse(readFileSync(path.join(base, cfg.repo, a), "utf8")),
  });
  const abrirMs = performance.now() - t0;
  await w.transcrever(new Float32Array(16_000), { maxTokens: 4 });

  let erros = 0;
  let palavras = 0;
  const tempos = [];
  const exemplos = [];
  let contexto = "";
  let falanteAnterior = "";
  for (const f of frases) {
    if (f.falante !== falanteAnterior) contexto = "";
    falanteAnterior = f.falante;
    const t = performance.now();
    const bruto = await w.transcrever(f.audio, { maxTokens: tokensPara(f.audio.length), contexto: cfg.contexto ? contexto : "" });
    tempos.push(performance.now() - t);
    const hip = limpar(bruto);
    const e = wer(f.texto, hip);
    erros += e.erros;
    palavras += e.palavras;
    if (exemplos.length < 4) exemplos.push({ ref: f.texto, hip });
    contexto = `${contexto} ${hip}`.slice(-200);
  }
  await w.modelo.dispose?.();
  const ord = [...tempos].sort((a, b) => a - b);
  const audioS = frases.reduce((s, f) => s + f.audio.length / 16_000, 0);
  return {
    config: nome,
    wer: +((erros / palavras) * 100).toFixed(1),
    msPorFrase: Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length),
    p95ms: Math.round(ord[Math.floor(ord.length * 0.95)]),
    // Fator de tempo real: segundos de processamento por segundo de fala.
    rtf: +(tempos.reduce((a, b) => a + b, 0) / 1000 / audioS).toFixed(3),
    abrirMs: Math.round(abrirMs),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
    exemplos,
  };
}

const escolhidas = (arg("configs", "") || Object.keys(CONFIGS).join(",")).split(",");
console.log(`Preparando ${N_FRASES} frases do LapsBM…`);
const frases = await prepararFrases();
const audioS = frases.reduce((s, f) => s + f.audio.length / 16_000, 0);
console.log(`${frases.length} frases, ${audioS.toFixed(0)} s de fala, ${new Set(frases.map((f) => f.falante)).size} falantes; ${THREADS} threads.\n`);

const resultados = [];
for (const nome of escolhidas) {
  try {
    const r = await medir(nome, CONFIGS[nome], frases);
    resultados.push(r);
    console.log(`${nome.padEnd(24)} WER ${String(r.wer).padStart(5)}%  ${String(r.msPorFrase).padStart(6)} ms/frase  p95 ${r.p95ms} ms  RTF ${r.rtf}  RSS ${r.rssMB} MB`);
    for (const ex of r.exemplos) console.log(`    ref: ${ex.ref}\n    hip: ${ex.hip}`);
  } catch (err) {
    console.log(`${nome}: FALHOU — ${err?.message || err}`);
  }
}

const tabela = [
  "| Configuração | WER | ms/frase | p95 | RTF | RSS |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...resultados.map((r) => `| ${r.config} | ${r.wer}% | ${r.msPorFrase} | ${r.p95ms} | ${r.rtf} | ${r.rssMB} MB |`),
].join("\n");
console.log(`\n${tabela}`);
writeFileSync(path.join(root, "bench-fala.json"), JSON.stringify({ frases: frases.length, audioS, threads: THREADS, resultados }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Legendas: precisão e custo (LapsBM, ${frases.length} frases, ${THREADS} threads)\n\n${tabela}\n`, { flag: "a" });
}
