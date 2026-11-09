#!/usr/bin/env node
/**
 * scripts/midia-bench.mjs — a tela pelo Chromium contra a tela pelo motor nativo.
 *
 * Abre uma janela de teste 1920x1080 (scripts/midia-bench/fonte.html: cena
 * animada + horário num código de barras) e a transmite numa conexão WebRTC
 * em laço dentro do Electron do Vcall, por três caminhos:
 *
 *   chromium      captura e codificador do Chromium (o app de mesa de hoje)
 *   chromium-gpu  o mesmo com --disable-gpu-sandbox (Configurações › Placa de vídeo)
 *   nativo        vcall-midia (WGC + placa) com os quadros injetados no WebRTC
 *
 * Mede quem recebe: qps decodificado, resolução, latência de vidro a vidro
 * (horário lido do quadro decodificado), intervalo entre quadros, banda e o
 * processador gasto (Electron + vcall-midia). `--carga N` ocupa N threads,
 * como um jogo pesado.
 *
 *   node scripts/midia-bench.mjs
 *   node scripts/midia-bench.mjs --cenarios nativo --carga 0,12 --segundos 15
 *   --qps 60 --kbps 14000 --aquecer 6 --fora (janela de teste fora da tela)
 *   --saida resultado.json   --bin caminho/vcall-midia.exe
 *
 * Só Windows por enquanto (o motor nativo ainda não tem Linux). Compile antes:
 *   cd midia && cargo build --release
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import electron from "electron";
import { _electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const CENARIOS = arg("cenarios", "chromium,chromium-gpu,nativo").split(",");
const CARGAS = arg("carga", "0").split(",").map(Number);
const SEGUNDOS = Number(arg("segundos", 15));
const AQUECER = Number(arg("aquecer", 6));
const QPS = Number(arg("qps", 60));
const KBPS = Number(arg("kbps", 14000));
const FORA = process.argv.includes("--fora");
const BIN = path.resolve(arg("bin", path.join(root, "midia", "target", "release", "vcall-midia.exe")));
const SAIDA = path.resolve(arg("saida", path.join(os.tmpdir(), "midia-bench.json")));

if (process.platform !== "win32") {
  console.log("midia-bench: só Windows por enquanto");
  process.exit(0);
}
if (CENARIOS.includes("nativo") && !existsSync(BIN)) {
  console.error(`sem ${BIN}: rode "cargo build --release" em midia/`);
  process.exit(1);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v, q) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return Math.round(s[Math.round((s.length - 1) * q)] * 10) / 10;
};
const um = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

/** Tempo de processador (ms) somado dos processos. */
function cpuMs(pids) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { $_.TotalProcessorTime.Ticks }`], { encoding: "utf8" });
  return r.stdout.split(/\s+/).filter(Boolean).map(Number).reduce((a, b) => a + b, 0) / 10_000;
}

async function esperarAte(f, ms, oque) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await f().catch(() => false)) return;
    await espera(200);
  }
  throw new Error(`tempo esgotado esperando ${oque}`);
}

async function medir(cenario, carga) {
  const ocupados = Array.from({ length: carga }, () => new Worker("for(;;){}", { eval: true }));
  const env = {
    ...process.env,
    BENCH_MODO: cenario === "nativo" ? "nativo" : "chromium",
    BENCH_GPU: cenario === "chromium-gpu" ? "1" : "0",
    BENCH_BIN: BIN,
    BENCH_QPS: String(QPS),
    BENCH_KBPS: String(KBPS),
    BENCH_FORA: FORA ? "1" : "0",
  };
  const app = await _electron.launch({ executablePath: electron, args: [path.join(root, "scripts", "midia-bench", "main.cjs")], env });
  try {
    await esperarAte(() => app.evaluate(() => global.bench.pronto), 30_000, "o Electron");
    let recebe = null;
    await esperarAte(async () => {
      for (const w of app.windows()) if ((await w.title()) === "vcall-midia recebe") recebe = w;
      return recebe;
    }, 10_000, "a janela que recebe");
    await recebe.waitForFunction(() => window.pronto || window.medida?.erro, null, { timeout: 30_000 });
    const erro = await recebe.evaluate(() => window.medida.erro);
    if (erro) throw new Error(erro);

    await espera(AQUECER * 1000);
    const pids = await app.evaluate(({ app }) => [...app.getAppMetrics().map((m) => m.pid), global.bench.pid].filter(Boolean));
    const n0 = await app.evaluate(() => global.bench.midia.length);
    const motor = await app.evaluate(() => global.bench.pid);
    const a = await recebe.evaluate(() => window.amostra());
    const c0 = cpuMs(pids);
    const m0 = motor ? cpuMs([motor]) : 0;
    const t0 = Date.now();
    await espera(SEGUNDOS * 1000);
    const b = await recebe.evaluate(() => window.amostra());
    const c1 = cpuMs(pids);
    const m1 = motor ? cpuMs([motor]) : 0;
    const t1 = Date.now();
    const midia = await app.evaluate((_e, n) => global.bench.midia.slice(n), n0);
    const pronto = await app.evaluate(() => global.bench.midia.find((m) => m.pronto) || null);

    const dt = (b.t - a.t) / 1000;
    const nativo = cenario === "nativo";
    const segundosMidia = midia.filter((m) => m.latencia_ms);
    return {
      cenario,
      carga,
      qps: um((b.entrada.quadros - a.entrada.quadros) / dt),
      resolucao: `${b.entrada.w}x${b.entrada.h}`,
      kbps: Math.round(((b.entrada.bytes - a.entrada.bytes) * 8) / dt / 1000),
      latencia_p50: pct(b.latencias, 0.5),
      latencia_p95: pct(b.latencias, 0.95),
      intervalo_p95: pct(b.intervalos, 0.95),
      congelado_s: um(b.entrada.congelado - a.entrada.congelado),
      jitter_buffer_ms: um(((b.entrada.jb - a.entrada.jb) / Math.max(1, b.entrada.jbN - a.entrada.jbN)) * 1000),
      pacer_ms: um(((b.saida.pacer - a.saida.pacer) / Math.max(1, b.saida.pacotes - a.saida.pacotes)) * 1000),
      decodificar_ms: um(((b.entrada.decod - a.entrada.decod) / Math.max(1, b.entrada.quadros - a.entrada.quadros)) * 1000),
      cpu_pct: um(((c1 - c0) / ((t1 - t0) * os.cpus().length)) * 100),
      nucleos: Math.round(((c1 - c0) / (t1 - t0)) * 100) / 100,
      cpu_motor_pct: motor ? um(((m1 - m0) / ((t1 - t0) * os.cpus().length)) * 100) : null,
      codificador: nativo ? pronto?.codificador : b.saida.codificador,
      codificar_ms: nativo ? pct(segundosMidia.map((m) => m.codificar_ms.p50), 0.5) : um(((b.saida.tempo - a.saida.tempo) / Math.max(1, b.saida.quadros - a.saida.quadros)) * 1000),
      limite: nativo ? "—" : b.saida.limite,
      cor: b.cores[0] || null,
      injecao: b.injecao,
      pronto: nativo ? pronto : undefined,
      motor: nativo ? await app.evaluate(() => global.bench.midia.filter((m) => !m.pronto).slice(-40)) : undefined,
      kbps_pedidos: nativo ? await recebe.evaluate(() => window.medida.kbpsPedidos) : undefined,
    };
  } finally {
    // Um Electron que não fecha não pode prender o banco inteiro.
    const fechou = await Promise.race([app.close().then(() => true, () => true), espera(5000).then(() => false)]);
    if (!fechou) app.process().kill();
    for (const w of ocupados) await w.terminate();
  }
}

const resultados = [];
for (const carga of CARGAS) {
  for (const cenario of CENARIOS) {
    process.stdout.write(`${cenario}, carga ${carga}... `);
    try {
      const r = await medir(cenario, carga);
      resultados.push(r);
      console.log(`${r.qps} qps, ${r.resolucao}, vidro a vidro ${r.latencia_p50}/${r.latencia_p95} ms, CPU ${r.cpu_pct}%`);
    } catch (e) {
      resultados.push({ cenario, carga, erro: String(e.message || e) });
      console.log(`falhou: ${e.message || e}`);
    }
  }
}
console.table(resultados.map(({ cor, injecao, pronto, ...r }) => r));
writeFileSync(SAIDA, JSON.stringify(resultados, null, 2));
console.log(`resultado completo: ${SAIDA}`);
