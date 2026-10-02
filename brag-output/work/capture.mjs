#!/usr/bin/env node
/**
 * brag-output/work/capture.mjs — retratos de todas as telas do Vcall.
 *
 * Sobe o servidor, abre participantes reais no Chromium e grava um PNG de
 * cada superfície do produto em 1920x1080 (mais os retratos de celular).
 * Mesmo padrão do scripts/ui-test.mjs: mídia falsa, cliques de gente.
 *
 * As câmeras entram FECHADAS de propósito: a câmera falsa do Chromium é um
 * pacman verde, e o avatar do próprio Vcall é o que a interface mostra de
 * verdade quando alguém entra sem vídeo — e é bonito.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "shots");
mkdirSync(OUT, { recursive: true });

const PORT = 3977;
const BASE = `http://localhost:${PORT}`;
const VW = { width: 1920, height: 1080 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sala = (n) => `${n}-${randomBytes(15).toString("base64url")}`;

const server = spawn("node", ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "error" },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await espera(1400);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=1",
  ],
});

const ok = [];
const falhou = [];
async function shot(page, nome, pausa = 500) {
  await espera(pausa);
  try {
    await page.screenshot({ path: path.join(OUT, `${nome}.png`), timeout: 60000, animations: "allow" });
    ok.push(nome);
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    falhou.push(nome);
    console.log(`  ✗ ${nome} — ${e.message.split("\n")[0]}`);
  }
}

/** Contexto que já pula a intro (ela só vale na abertura do vídeo). */
async function ctxNovo(viewport = VW, extra = {}) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport, ...extra });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem("vcall:intro", "1"); } catch {}
  });
  return ctx;
}

/** Antessala pronta: nome escrito, avatar sorteado, câmera fechada. */
async function antessala(nome, id, { viewport = VW, sorteios = 0, ctxOpts = {} } = {}) {
  const ctx = await ctxNovo(viewport, ctxOpts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`  [js ${nome}] ${e.message}`));
  await page.goto(`${BASE}/#${id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await page.fill("#nameInput", nome);
  for (let i = 0; i < sorteios; i++) {
    await page.click("#avatarShuffle");
    await espera(260);
  }
  await page.click("#lobbyCam");
  await espera(600);
  return page;
}

async function entrar(page) {
  await page.click("#joinBtn");
  await page.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(1000);
  return page;
}

const participante = async (nome, id, opts) => entrar(await antessala(nome, id, opts));

const conectados = (p, n) =>
  p.waitForFunction(
    (n) => [...window.vcall.mesh.peers.values()].filter((x) => x.connectionState === "connected").length >= n,
    n,
    { timeout: 40000 },
  );

const dock = async (p, id) => {
  try { await p.click(`#dock [data-id="${id}"]`, { timeout: 8000 }); return true; }
  catch { console.log(`  · dock/${id} indisponível`); return false; }
};

try {
  /* ================= 1. Abertura animada (a intro) ================= */
  console.log("\nIntro animada");
  {
    const ctx = await browser.newContext({ viewport: VW });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 10; i++) {
      await shot(page, `00-intro-${String(i).padStart(2, "0")}`, i === 0 ? 220 : 240);
    }
    await ctx.close();
  }

  /* ================= 2. Tela inicial ================= */
  console.log("\nTela inicial");
  {
    const ctx = await ctxNovo();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(page, "01-tela-inicial", 1600);

    await page.evaluate(() => localStorage.setItem("vcall.tema", '"light"'));
    await page.reload({ waitUntil: "networkidle" });
    await shot(page, "02-tela-inicial-claro", 1600);
    await page.evaluate(() => localStorage.setItem("vcall.tema", '"dark"'));
    await page.reload({ waitUntil: "networkidle" });
    await espera(1400);

    // Diálogo "Criar nova call" — o caminho de um clique.
    await page.click("text=Criar nova call");
    await shot(page, "03-criar-nova-call", 900);
    await page.fill("dialog[open] .modal__body input.input:visible", "Reunião do time");
    await page.click("dialog[open] .privacy >> nth=1"); // Pública
    await shot(page, "04-criar-publica", 700);
    await page.click("dialog[open] >> text=Criar e entrar");
    await page.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
    await page.fill("#nameInput", "Victor");
    await page.click("#lobbyCam");
    await shot(page, "05-antessala", 1300);
    await entrar(page);
    await shot(page, "06-aguardando", 1200);

    await page.click("#inviteBtn");
    await shot(page, "07-convidar", 1100);
    await page.keyboard.press("Escape");
    await espera(500);

    // Com a sala pública no ar, a tela inicial lista "Ao vivo agora".
    const ctx2 = await ctxNovo();
    const vitrine = await ctx2.newPage();
    await vitrine.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(vitrine, "08-tela-inicial-ao-vivo", 7000);
    await ctx2.close();
    await ctx.close();
  }

  /* ================= 3. A chamada ================= */
  console.log("\nChamada");
  {
    const id = sala("grade");
    const a = await participante("Alice", id, { sorteios: 1 });
    const b = await participante("Bruno", id, { sorteios: 3 });
    await conectados(a, 1);
    await shot(a, "09-chamada-2", 2200);

    const c = await participante("Carla", id, { sorteios: 5 });
    const d = await participante("Diego", id, { sorteios: 7 });
    await conectados(a, 3);
    await shot(a, "10-chamada-4", 2600);

    const e = await participante("Elisa", id, { sorteios: 9 });
    const f = await participante("Fábio", id, { sorteios: 11 });
    await conectados(a, 5);
    await shot(a, "11-chamada-6", 3200);

    /* --- conversa por texto --- */
    if (await dock(a, "chat")) {
      await espera(1100);
      await a.evaluate(() => {
        const i = document.querySelector(".panel textarea, .panel input[type=text], #chatInput");
        i?.focus();
      });
      await a.keyboard.type("entrei pelo link no celular, nem instalei nada 🙌", { delay: 16 });
      await shot(a, "12-chat-digitando", 600);
      await a.keyboard.press("Enter");
      await shot(a, "13-chat-enviado", 1200);
    }

    if (await dock(a, "people")) await shot(a, "14-pessoas", 1200);
    if (await dock(a, "stats")) await shot(a, "15-estatisticas", 1800);
    if (await dock(a, "settings")) {
      await shot(a, "16-configuracoes", 1200);
      await a.keyboard.press("Escape");
      await espera(600);
    }
    if (await dock(a, "react")) {
      await shot(a, "17-reacoes", 900);
      await a.keyboard.press("Escape");
      await espera(500);
    }
    if (await dock(a, "layout")) {
      await shot(a, "18-layout", 900);
      await a.keyboard.press("Escape");
      await espera(600);
    }

    /* --- quadro branco --- */
    if (await dock(a, "board")) {
      await shot(a, "19-quadro-vazio", 2000);
      const caixa = await a.evaluate(() => {
        const c = document.querySelector(".board canvas, canvas.board__canvas, #boardCanvas");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (caixa) {
        const { x, y, w, h } = caixa;
        const traco = async (pts) => {
          await a.mouse.move(x + pts[0][0] * w, y + pts[0][1] * h);
          await a.mouse.down();
          for (const [px, py] of pts.slice(1)) await a.mouse.move(x + px * w, y + py * h, { steps: 14 });
          await a.mouse.up();
          await espera(200);
        };
        // "V" da marca, uma seta e um sublinhado — rabisco de gente.
        await traco([[0.22, 0.26], [0.3, 0.6], [0.38, 0.26]]);
        await traco([[0.46, 0.44], [0.66, 0.44]]);
        await traco([[0.6, 0.37], [0.66, 0.44], [0.6, 0.51]]);
        await traco([[0.72, 0.26], [0.72, 0.6]]);
        await traco([[0.72, 0.26], [0.84, 0.3], [0.82, 0.42], [0.72, 0.43]]);
        await traco([[0.22, 0.72], [0.84, 0.72]]);
        await shot(a, "20-quadro-desenhado", 1200);
        await shot(b, "21-quadro-no-outro-lado", 800);
      }
      await dock(a, "board");
      await espera(1500);
    }

    /* --- legendas ao vivo --- */
    if (await dock(a, "captions")) await shot(a, "22-legendas", 3500);

    /* --- compartilhar tela --- */
    if (await dock(a, "screen")) {
      await shot(a, "23-tela-compartilhada", 3500);
      await shot(b, "24-tela-vista-pelo-outro", 900);
      await dock(a, "screen");
      await espera(1500);
    }

    /* --- gravação local --- */
    if (await dock(a, "record")) await shot(a, "25-gravando", 1800);

    /* --- tela de saída --- */
    if (await dock(a, "leave")) await shot(a, "26-saida", 3000);

    for (const p of [a, b, c, d, e, f]) await p.context().close().catch(() => {});
  }

  /* ================= 4. Celular ================= */
  console.log("\nCelular");
  {
    const MOB = { width: 430, height: 932 };
    const id = sala("celular");
    const m = await antessala("Carla", id, {
      viewport: MOB,
      sorteios: 4,
      ctxOpts: { deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    });
    await shot(m, "27-celular-antessala", 1200);
    await entrar(m);
    const pc = await participante("Bruno", id, { sorteios: 2 });
    await conectados(m, 1);
    await shot(m, "28-celular-chamada", 3000);
    await pc.context().close();
    await m.context().close();
  }

  console.log(`\n${ok.length} telas capturadas${falhou.length ? `, ${falhou.length} falharam: ${falhou.join(", ")}` : ""}`);
} catch (err) {
  console.error("\nFALHA:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
