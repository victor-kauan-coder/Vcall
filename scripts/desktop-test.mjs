#!/usr/bin/env node
/**
 * scripts/desktop-test.mjs — o aplicativo de mesa (Electron) de verdade.
 *
 * Abre o Vcall como app, entra numa sala com um participante no Chromium e
 * confere o que só existe no app:
 *
 *   - o seletor próprio lista telas E janelas (antes: só a tela inteira);
 *   - compartilhar uma JANELA específica chega ao outro lado;
 *   - compartilhar a tela inteira funciona no Linux (antes: travava por causa
 *     de `audio: undefined`) e mostra o aviso no lugar do efeito espelho;
 *   - a legenda offline carrega o reconhecedor (WebAssembly, sem eval) e
 *     busca o modelo pelo esquema interno.
 *
 * No Linux precisa de uma tela (Xvfb) e de um gerenciador de janelas para as
 * janelas aparecerem na lista:
 *
 *   xvfb-run -a sh -c 'openbox & node scripts/desktop-test.mjs'
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "playwright";
import { montarTar } from "../desktop/fala.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultados = [];
const check = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ args: ["--no-sandbox", "desktop/main.js"], cwd: root });
const win = await app.firstWindow();
const erros = [];
win.on("pageerror", (e) => erros.push(process.env.DEBUG_STACK ? e.stack : e.message));
let browser;

try {
  await win.waitForLoadState("domcontentloaded");
  await espera(2000);
  const base = new URL(win.url()).origin;
  const sala = `desktop-${Date.now().toString(36)}-abcdefghij`;
  await win.evaluate((r) => {
    location.hash = r;
    location.reload();
  }, sala);
  await espera(2500);
  await win.fill("#nameInput", "Desktop");
  await win.click("#joinBtn");
  await win.waitForSelector("#dock:not([hidden])", { timeout: 15_000 });

  // O outro participante: um Chromium com janela (para aparecer na lista).
  browser = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const web = await ctx.newPage();
  await web.goto(`${base}/#${sala}`, { waitUntil: "load" });
  await espera(1500);
  await web.fill("#nameInput", "Web");
  await web.click("#joinBtn");
  await web.waitForSelector("#dock:not([hidden])");
  await win.waitForFunction(() => [...window.vcall.mesh.peers.values()].some((p) => p.connectionState === "connected"), null, { timeout: 25_000 });
  check("o app de mesa conecta com um navegador", true);

  /* -- seletor de telas e janelas -- */
  await win.click('[aria-label="Compartilhar tela"]');
  await win.waitForSelector(".share__fontes", { timeout: 5000 });
  await espera(2500);
  const abas = await win.evaluate(() => [...document.querySelectorAll(".share__pilula[data-tipo]")].map((b) => b.dataset.tipo));
  await win.click('.share__pilula[data-tipo="window"]');
  await espera(300);
  const janelas = await win.evaluate(() => [...document.querySelectorAll(".share__fonte")].map((b) => b.getAttribute("aria-label")));
  await win.click('.share__pilula[data-tipo="screen"]');
  await espera(300);
  const telas = await win.evaluate(() => [...document.querySelectorAll(".share__fonte")].map((b) => b.getAttribute("aria-label")));
  check("o seletor tem as abas Janelas e Telas inteiras", abas.includes("window") && abas.includes("screen"));
  check("lista as telas", telas.length >= 1, telas.join(", "));
  check("lista as janelas abertas (e não a do próprio Vcall)", janelas.length >= 1 && !janelas.includes("Vcall"), janelas.join(", ") || "nenhuma");

  /* -- compartilhar uma janela -- */
  await win.click('.share__pilula[data-tipo="window"]');
  await espera(200);
  const temJanela = (await win.locator(".share__fonte").count()) > 0;
  if (temJanela) {
    await win.locator(".share__fonte").first().click();
    await win.click(".share__acoes .btn--primary");
    await espera(3500);
    const s = await win.evaluate(() => window.vcall.screen.videoTrack?.getSettings?.() || null);
    check("compartilha UMA janela (não a tela inteira)", s?.displaySurface === "window", s ? `${s.width}×${s.height} ${s.displaySurface}` : "sem captura");
    const chegou = await web
      .waitForFunction(() => [...document.querySelectorAll(".tile")].some((t) => t.dataset.kind === "screen"), null, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("a janela compartilhada aparece para o outro participante", chegou);
    await win.evaluate(() => window.vcall.screen.stop("user"));
    await espera(1500);
  } else {
    await win.click(".share__acoes .btn--ghost");
    check("compartilha UMA janela (não a tela inteira)", false, "nenhuma janela listada — rode com um gerenciador de janelas (openbox)");
  }

  /* -- compartilhar a tela inteira -- */
  await win.click('[aria-label="Compartilhar tela"]');
  await espera(2000);
  await win.click('.share__pilula[data-tipo="screen"]');
  await espera(200);
  await win.click(".share__acoes .btn--primary");
  await espera(3500);
  const ativa = await win.evaluate(() => window.vcall.screen.active);
  check("compartilhar a tela inteira funciona (antes travava no Linux)", ativa);
  const aviso = await win.evaluate(() => !!document.querySelector(".tile__present"));
  check("tela inteira: aviso no lugar da prévia (sem efeito espelho)", aviso);
  const conectado = await win.evaluate(() => [...window.vcall.mesh.peers.values()].every((p) => p.connectionState === "connected"));
  check("compartilhar não derruba a chamada", conectado);
  await win.evaluate(() => window.vcall.screen.stop("user"));

  /* -- legenda offline: o caminho inteiro, com um modelo falso -- */
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  const tar = montarTar([
    { nome: "vosk-model-falso/", dados: Buffer.alloc(0), pasta: true },
    { nome: "vosk-model-falso/am/final.mdl", dados: Buffer.alloc(1_500_000, 7), pasta: false },
  ]);
  mkdirSync(path.join(userData, "fala"), { recursive: true });
  // Sem compressão: o app considera "não baixado" um arquivo abaixo de 1 MB.
  writeFileSync(path.join(userData, "fala", "pt-BR.tar.gz"), gzipSync(tar, { level: 0 }));
  const logs = [];
  win.on("console", (m) => logs.push(m.text()));
  await win.click('[aria-label="Legendar minha fala"]');
  let aviso2 = "";
  for (let i = 0; i < 20 && !/interrompidas|ligadas/.test(aviso2); i++) {
    await espera(500);
    aviso2 = await win.evaluate(() => [...document.querySelectorAll(".toast span")].map((x) => x.textContent).join(" | "));
  }
  const voskCarregou = await win.evaluate(() => typeof window.Vosk === "object");
  const extraiu = logs.some((l) => /vosk-model-falso\/am\/final\.mdl ->/.test(l));
  check("legenda no app: o reconhecedor offline carrega (sem eval, dentro da CSP)", voskCarregou);
  check("legenda no app: o modelo chega pelo esquema interno e é descompactado", extraiu);
  const msg = aviso2.split(" | ").find((t) => /interrompidas/.test(t)) || aviso2;
  check("modelo inválido gera aviso claro, sem travar em 'Preparando'", /modelo de fala não abriu/.test(msg), msg.slice(0, 90));

  check("nenhum erro de JavaScript no app", erros.length === 0, erros.slice(0, 2).join(" | "));
} catch (err) {
  check("execução sem exceção", false, err?.message || String(err));
} finally {
  await browser?.close().catch(() => {});
  await app.close().catch(() => {});
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações do app de mesa passaram.`);
process.exit(falhas ? 1 : 0);
