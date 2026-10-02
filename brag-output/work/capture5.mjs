#!/usr/bin/env node
/**
 * Quinta passada: as funcionalidades que faltavam no vídeo curto —
 * legendas com texto, arquivos no chat, anotação sobre a tela compartilhada,
 * mini-janela (picture-in-picture), mão levantada, reação e tema claro.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "shots");
const PORT = 3973, BASE = `http://localhost:${PORT}`;
const VW = { width: 1920, height: 1080 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("node", ["server.js"], {
  cwd: root, env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "error" }, stdio: ["ignore","ignore","pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await espera(1400);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1",
  ],
});

const feitos = [], falhos = [];
const shot = async (p, nome, pausa = 600) => {
  await espera(pausa);
  try {
    await p.screenshot({ path: path.join(OUT, `${nome}.png`), timeout: 60000 });
    feitos.push(nome); console.log(`  ✓ ${nome}`);
  } catch (e) { falhos.push(nome); console.log(`  ✗ ${nome} — ${e.message.split("\n")[0]}`); }
};

async function participante(nome, id, sorteios = 0) {
  const ctx = await browser.newContext({ permissions: ["camera","microphone"], viewport: VW });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("vcall:intro","1"); } catch {} });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error(`  [js ${nome}] ${e.message}`));
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
const dock = async (p, id) => {
  try { await p.click(`#dock [data-id="${id}"]`, { timeout: 9000 }); return true; }
  catch { console.log(`  · dock/${id} indisponível`); return false; }
};

try {
  const id = `extras-${randomBytes(15).toString("base64url")}`;
  const a = await participante("Alice", id, 1);
  await dock(a, "layout"); // grade igualitária
  await espera(2600);

  const b = await participante("Bruno", id, 5);
  const c = await participante("Carla", id, 9);
  const d = await participante("Diego", id, 13);
  await a.waitForFunction(() => [...window.vcall.mesh.peers.values()].filter(x => x.connectionState === "connected").length >= 3, null, { timeout: 40000 });
  await espera(3000);

  /* ---------- legendas, com texto de verdade na tela ---------- */
  console.log("\nLegendas");
  await dock(a, "captions");
  await espera(2500);
  // A interface de legenda é a real; o texto entra pela mesma porta que o
  // reconhecedor usa, porque mídia falsa não fala.
  await a.evaluate(() => {
    const ids = [...window.vcall.mesh.peers.keys()];
    const falas = [
      "então a ideia é a chamada ir direto de uma máquina pra outra",
      "isso, sem servidor no meio segurando o vídeo",
      "e quem eu convidar não precisa instalar nada, né?",
    ];
    ids.slice(0, 3).forEach((pid, i) => {
      const perfil = window.vcall.mesh.peers.get(pid)?.profile || {};
      window.vcall.captions.show(pid, { name: perfil.name || "Participante", text: falas[i], final: true });
    });
  });
  await shot(a, "31-legendas", 1200);
  await dock(a, "captions");
  await espera(1200);

  /* ---------- chat com arquivo ---------- */
  console.log("\nChat e arquivos");
  await dock(a, "chat");
  await espera(1200);
  await a.evaluate(() => {
    const i = document.querySelector(".panel textarea.composer__input");
    i?.focus();
  });
  await a.keyboard.type("entrei pelo link no celular, nem instalei nada 🙌", { delay: 14 });
  await a.keyboard.press("Enter");
  await espera(900);
  const picker = await a.$(".panel input[type=file]");
  if (picker) {
    await picker.setInputFiles(path.join(root, "public/assets/logo-wordmark.png"));
    await espera(2600);
  }
  await shot(a, "30-chat-arquivo", 1400);
  await dock(a, "chat");
  await espera(900);

  /* ---------- pessoas ---------- */
  console.log("\nPessoas");
  if (await dock(a, "people")) await shot(a, "40-pessoas", 1400);
  await dock(a, "people");
  await espera(800);

  /* ---------- mão levantada ---------- */
  console.log("\nMão levantada");
  if (await dock(a, "hand")) {
    await espera(1800);
    await shot(a, "35-mao-levantada");
    await shot(b, "35b-mao-vista-pelo-outro", 700);
    await dock(a, "hand");
    await espera(900);
  }

  /* ---------- reação ---------- */
  console.log("\nReação");
  if (await dock(a, "react")) {
    await espera(900);
    await shot(a, "36-reacoes-menu");
    try {
      await a.click('.popover--reactions button >> nth=1', { timeout: 5000 });
      await espera(500);
      await shot(a, "36b-reacao-voando", 250);
    } catch (e) { console.log(`  · reação: ${e.message.split("\n")[0]}`); }
    await a.keyboard.press("Escape");
    await espera(700);
  }

  /* ---------- compartilhar tela + anotar por cima ---------- */
  console.log("\nTela e anotação");
  if (await dock(a, "screen")) {
    await espera(1600);
    await shot(a, "23-compartilhar-escolha");
    try {
      await a.click("text=Escolher o que mostrar", { timeout: 8000 });
      await espera(5000);
      await shot(a, "41-compartilhando");
      // Agora o quadro em modo "Anotar", por cima da tela em exibição.
      await dock(a, "board");
      await espera(900);
      await a.click("text=Anotar", { timeout: 6000 });
      await espera(2500);
      const cv = await a.evaluate(() => {
        const el = document.querySelector("canvas.board__surface");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (cv) {
        const { x, y, w, h } = cv;
        const traco = async (pts) => {
          await a.mouse.move(x + pts[0][0]*w, y + pts[0][1]*h);
          await a.mouse.down();
          for (const [px, py] of pts.slice(1)) await a.mouse.move(x + px*w, y + py*h, { steps: 14 });
          await a.mouse.up();
          await espera(200);
        };
        await traco([[0.30,0.34],[0.62,0.34],[0.62,0.56],[0.30,0.56],[0.30,0.34]]);
        await traco([[0.64,0.62],[0.58,0.57]]);
        await traco([[0.64,0.62],[0.72,0.70]]);
        await espera(1200);
        await shot(a, "32-anotar-sobre-a-tela");
      }
      await dock(a, "board");
      await espera(1200);
    } catch (e) { console.log(`  · tela: ${e.message.split("\n")[0]}`); }
    await dock(a, "screen");
    await espera(1800);
  }

  /* ---------- mini-janela (picture-in-picture) ---------- */
  console.log("\nPicture-in-picture");
  const suporta = await a.evaluate(() => "documentPictureInPicture" in window);
  console.log(`  · documentPictureInPicture no navegador: ${suporta}`);
  if (suporta) {
    const espiaPagina = a.context().waitForEvent("page", { timeout: 12000 }).catch(() => null);
    await dock(a, "mini");
    const pip = await espiaPagina;
    await espera(2500);
    await shot(a, "34-pip-pagina-principal");
    if (pip) {
      try {
        await pip.setViewportSize({ width: 420, height: 300 }).catch(() => {});
        await espera(1200);
        await pip.screenshot({ path: path.join(OUT, "33-pip-janela.png"), timeout: 30000 });
        feitos.push("33-pip-janela"); console.log("  ✓ 33-pip-janela");
      } catch (e) { console.log(`  ✗ 33-pip-janela — ${e.message.split("\n")[0]}`); }
    } else {
      console.log("  · a janela da mini-chamada não apareceu como página");
    }
    await dock(a, "mini");
    await espera(1200);
  }

  /* ---------- gravação ---------- */
  console.log("\nGravação");
  if (await dock(a, "record")) await shot(a, "38-gravando", 2400);

  /* ---------- tema claro na chamada ---------- */
  console.log("\nTema claro");
  try {
    await a.click("#themeBtn2", { timeout: 6000 });
    await espera(1800);
    await shot(a, "37-tema-claro-chamada");
  } catch (e) { console.log(`  · tema: ${e.message.split("\n")[0]}`); }

  for (const p of [a,b,c,d]) await p.context().close().catch(() => {});
  console.log(`\n${feitos.length} capturadas${falhos.length ? `, ${falhos.length} falharam` : ""}`);
} catch (err) {
  console.error("\nFALHA:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
