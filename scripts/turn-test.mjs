#!/usr/bin/env node
/**
 * scripts/turn-test.mjs — chamada passando só pelo TURN, com um coturn de verdade.
 *
 * Sobe um coturn local (segredo compartilhado, como no TURN.md), sobe o Vcall
 * com TURN_URLS + TURN_SECRET e ICE_TRANSPORT_POLICY=relay — nenhum caminho
 * direto é permitido — e confere que dois navegadores se conectam pelo relay,
 * que voz e vídeo chegam, e que o "Testar" das configurações acha o servidor.
 *
 * Precisa do coturn instalado (`turnserver`); sem ele, avisa e sai sem falhar.
 *
 * Roda com: node scripts/turn-test.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3993;
const TURN_PORT = 34780;
const SEGREDO = "segredo-do-teste-turn";
const ROOM = "turn-sala-para-teste-abcdef";

if (spawnSync("turnserver", ["--version"], { stdio: "ignore" }).error) {
  console.log("coturn (turnserver) não instalado: teste do TURN pulado.");
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const turn = spawn(
  "turnserver",
  [
    "-n", "-v", "--no-cli", "--no-tls", "--no-dtls", "--log-file=stdout",
    "--listening-ip=127.0.0.1", "--relay-ip=127.0.0.1", `--listening-port=${TURN_PORT}`,
    "--min-port=49200", "--max-port=49300",
    "--use-auth-secret", `--static-auth-secret=${SEGREDO}`, "--realm=vcall.teste",
    // Só no teste: tudo roda em 127.0.0.1. Em produção o TURN.md manda negar isso.
    "--allow-loopback-peers", "--fingerprint",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logTurn = "";
turn.stdout.on("data", (d) => (logTurn += d));
turn.stderr.on("data", (d) => (logTurn += d));

const server = spawn("node", ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "production",
    LOG_LEVEL: "error",
    TURN_URLS: `turn:127.0.0.1:${TURN_PORT}?transport=udp,turn:127.0.0.1:${TURN_PORT}?transport=tcp`,
    TURN_SECRET: SEGREDO,
    ICE_TRANSPORT_POLICY: "relay",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await wait(1200);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

async function abrir(nome) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/#${ROOM}`, { waitUntil: "networkidle" });
  await page.fill("#nameInput", nome);
  await page.click("#joinBtn");
  await page.waitForSelector("#dock:not([hidden])", { timeout: 10_000 });
  return page;
}

try {
  const ice = await (await fetch(`http://localhost:${PORT}/ice`)).json();
  check("o /ice entrega o TURN com credencial temporária", ice.hasTurn && ice.iceTransportPolicy === "relay", ice.turnMode);

  const ana = await abrir("Ana");
  const teste = await ana.evaluate(() => window.vcall.testarTurn());
  check('o "Testar" das configurações acha o servidor', teste.ok, JSON.stringify(teste));

  const bruno = await abrir("Bruno");
  const conectados = (p) =>
    p.waitForFunction(() => {
      const ps = [...window.vcall.mesh.peers.values()];
      return ps.length === 1 && ps[0].connectionState === "connected";
    }, null, { timeout: 30_000 });
  await Promise.all([conectados(ana), conectados(bruno)]);
  check("os dois se conectam só pelo relay", true);
  await wait(4000);

  const rota = (p) =>
    p.evaluate(async () => {
      const peer = [...window.vcall.mesh.peers.values()][0];
      const stats = await peer.pc.getStats();
      let tipo = null;
      let quadros = 0;
      let audio = 0;
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated) tipo = stats.get(r.localCandidateId)?.candidateType;
        if (r.type === "inbound-rtp" && r.kind === "video") quadros += r.framesDecoded || 0;
        if (r.type === "inbound-rtp" && r.kind === "audio") audio += r.packetsReceived || 0;
      });
      return { tipo, quadros, audio };
    });
  const [ra, rb] = await Promise.all([rota(ana), rota(bruno)]);
  check("o caminho escolhido é o do TURN", ra.tipo === "relay" && rb.tipo === "relay", `${ra.tipo} / ${rb.tipo}`);
  check("vídeo chega pelo TURN nos dois sentidos", ra.quadros > 0 && rb.quadros > 0, `${ra.quadros} / ${rb.quadros} quadros`);
  check("voz chega pelo TURN nos dois sentidos", ra.audio > 0 && rb.audio > 0, `${ra.audio} / ${rb.audio} pacotes`);
  check("o coturn autenticou e alocou", /ALLOCATE processed, success|allocation/i.test(logTurn), (logTurn.match(/.*(ALLOCATE|allocation).*/i) || [""])[0].trim().slice(0, 90));
} catch (err) {
  check("execução sem exceção", false, err.message);
} finally {
  await browser.close();
  server.kill();
  turn.kill();
}

const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
