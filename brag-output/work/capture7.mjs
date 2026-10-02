#!/usr/bin/env node
/** Limpeza: gravação e chamada padrão sem o menu do quadro aberto por cima. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "escuro");
const PORT = 3971, BASE = `http://localhost:${PORT}`;
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
const shot = async (p, n, ms = 700) => { await espera(ms); await p.screenshot({ path: path.join(OUT, `${n}.png`), timeout: 60000 }); console.log(`  ✓ ${n}`); };

async function ctxEscuro() {
  const ctx = await browser.newContext({ permissions: ["camera","microphone"], viewport: VW });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("vcall:intro","1");
      localStorage.setItem("vcall:theme", '"dark"');
      localStorage.setItem("vcall:paleta", '"tinta"');
    } catch {}
  });
  return ctx;
}
async function convidado(nome, id, sorteios = 0) {
  const ctx = await ctxEscuro();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/#${id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await p.fill("#nameInput", nome);
  for (let i = 0; i < sorteios; i++) { await p.click("#avatarShuffle"); await espera(240); }
  await p.click("#lobbyCam");
  await espera(600);
  await p.click("#joinBtn");
  await p.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(900);
  return p;
}
const dock = (p, id) => p.click(`#dock [data-id="${id}"]`, { timeout: 9000 });

try {
  // Anfitrião com sala nomeada, pelo diálogo da tela inicial.
  const ctx = await ctxEscuro();
  const a = await ctx.newPage();
  await a.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await espera(1200);
  await a.click("text=Criar nova call");
  await espera(800);
  await a.fill("dialog[open] .modal__body input.input:visible", "Reunião de equipe · Q3");
  await a.click("dialog[open] .privacy >> nth=1");
  await a.click("dialog[open] >> text=Criar e entrar");
  await a.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await a.fill("#nameInput", "Victor");
  await a.click("#avatarShuffle"); await espera(300);
  await a.click("#lobbyCam");
  await espera(500);
  await a.click("#joinBtn");
  await a.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(900);
  await dock(a, "layout");
  await espera(2600);
  const id = await a.evaluate(() => location.hash.slice(1));

  const pares = [];
  for (const [n, s] of [["Alice",1],["Bruno",5],["Carla",9],["Diego",13],["Elisa",17]]) pares.push(await convidado(n, id, s));
  await a.waitForFunction(() => [...window.vcall.mesh.peers.values()].filter(x => x.connectionState === "connected").length >= 5, null, { timeout: 40000 });
  await espera(3500);

  // Chamada limpa, nada aberto por cima.
  await a.mouse.move(960, 400);
  await shot(a, "27-chamada-tinta", 1500);

  // Gravação, com o aviso REC e nada mais.
  await dock(a, "record");
  await espera(2600);
  await a.mouse.move(960, 400);
  await shot(a, "22-gravando", 1200);

  for (const p of pares) await p.context().close().catch(() => {});
  await ctx.close();
  console.log("fim");
} catch (err) {
  console.error("FALHA:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
