#!/usr/bin/env node
/** Quarta passada: o MESMO desenho nas duas telas, com o quadro aberto dos dois lados. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "shots");
const PORT = 3974, BASE = `http://localhost:${PORT}`;
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
const abrirQuadro = async (p) => {
  await p.click('#dock [data-id="board"]');
  await espera(900);
  await p.click("text=Canvas colaborativo");
  await espera(2200);
};

try {
  const id = `quadro-${randomBytes(15).toString("base64url")}`;
  const a = await participante("Alice", id, 1);
  const b = await participante("Bruno", id, 5);
  const c = await participante("Carla", id, 9);
  await a.waitForFunction(() => [...window.vcall.mesh.peers.values()].filter(x => x.connectionState === "connected").length >= 2, null, { timeout: 40000 });
  await espera(2500);

  // Os dois abrem o canvas: é o mesmo quadro, não uma cópia.
  await abrirQuadro(a);
  await abrirQuadro(b);
  await espera(1500);

  const caixa = await a.evaluate(() => {
    const el = document.querySelector("canvas.board__surface");
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const { x, y, w, h } = caixa;
  const traco = async (pts) => {
    await a.mouse.move(x + pts[0][0]*w, y + pts[0][1]*h);
    await a.mouse.down();
    for (const [px, py] of pts.slice(1)) await a.mouse.move(x + px*w, y + py*h, { steps: 16 });
    await a.mouse.up();
    await espera(220);
  };
  await traco([[0.17,0.30],[0.23,0.56],[0.29,0.30]]);
  await traco([[0.38,0.34],[0.52,0.34],[0.52,0.52],[0.38,0.52],[0.38,0.34]]);
  await traco([[0.56,0.43],[0.70,0.43]]);
  await traco([[0.66,0.38],[0.70,0.43],[0.66,0.48]]);
  await traco([[0.74,0.34],[0.88,0.34],[0.88,0.52],[0.74,0.52],[0.74,0.34]]);
  await traco([[0.17,0.68],[0.88,0.68]]);
  await traco([[0.17,0.72],[0.60,0.72]]);
  await espera(2000);

  await shot(a, "20-quadro-desenhado");
  await shot(b, "21-quadro-no-outro-lado", 900);

  for (const p of [a,b,c]) await p.context().close().catch(() => {});
  console.log("fim");
} catch (err) {
  console.error("FALHA:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
