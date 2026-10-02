#!/usr/bin/env node
/** Terceira passada: as grades de 2, 4 e 6 pessoas em "grade igualitária". */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "shots");
const PORT = 3975, BASE = `http://localhost:${PORT}`;
const VW = { width: 1920, height: 1080 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("node", ["server.js"], {
  cwd: root, env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "error" }, stdio: ["ignore","ignore","pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await espera(1400);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"],
});

const shot = async (p, nome, pausa = 600) => {
  await espera(pausa);
  await p.screenshot({ path: path.join(OUT, `${nome}.png`), timeout: 60000 });
  console.log(`  ✓ ${nome}`);
};

async function participante(nome, id, sorteios = 0) {
  const ctx = await browser.newContext({ permissions: ["camera","microphone"], viewport: VW });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("vcall:intro","1"); } catch {} });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/#${id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await p.fill("#nameInput", nome);
  for (let i = 0; i < sorteios; i++) { await p.click("#avatarShuffle"); await espera(240); }
  await p.click("#lobbyCam");
  await espera(500);
  await p.click("#joinBtn");
  await p.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(900);
  return p;
}
const esperaPares = (p, n) =>
  p.waitForFunction((n) => [...window.vcall.mesh.peers.values()].filter(x => x.connectionState === "connected").length >= n, n, { timeout: 40000 });

try {
  const id = `grade-${randomBytes(15).toString("base64url")}`;
  const a = await participante("Alice", id, 1);
  // Grade igualitária: todo mundo do mesmo tamanho, sem destaque automático.
  await a.click('#dock [data-id="layout"]');
  await espera(2600); // deixa o aviso sumir

  const b = await participante("Bruno", id, 3);
  await esperaPares(a, 1);
  await shot(a, "09-chamada-2", 3000);

  const c = await participante("Carla", id, 6);
  const d = await participante("Diego", id, 9);
  await esperaPares(a, 3);
  await shot(a, "10-chamada-4", 3200);

  const e = await participante("Elisa", id, 12);
  const f = await participante("Fábio", id, 15);
  await esperaPares(a, 5);
  await shot(a, "11-chamada-6", 4000);

  for (const p of [a,b,c,d,e,f]) await p.context().close().catch(() => {});
  console.log("fim");
} catch (err) {
  console.error("FALHA:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
