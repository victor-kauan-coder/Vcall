#!/usr/bin/env node
/**
 * scripts/midia-app-test.mjs — a tela pelo motor nativo no app de mesa de verdade.
 *
 * Sobe o Vcall de desenvolvimento isolado (scripts/fixtures/app-isolado.mjs:
 * não mexe no Vcall instalado), entra numa sala com um participante no
 * Chromium, abre uma janela de teste fora da tela (scripts/midia-bench/
 * fonte.html, 1920x1080 animada) e a compartilha pelo seletor do app com
 * "Motor nativo" escolhido. Confere:
 *
 *   - a tela sai pelo motor (injetor no sender, H.264);
 *   - quem recebe decodifica a janela inteira (1920x1080) a mais de 40 qps;
 *   - o motor caindo no meio, a tela volta ao Chromium sem o ladrilho sumir
 *     e quem recebe continua recebendo quadros;
 *   - parar a transmissão desliga o motor.
 *
 * Só no Windows (o motor ainda é só Windows). Compile antes:
 *   cd midia && cargo build --release
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") {
  console.log("midia-app-test: só no Windows");
  process.exit(0);
}
if (!existsSync(path.join(root, "midia", "target", "release", "vcall-midia.exe"))) {
  console.error('sem midia/target/release/vcall-midia.exe: rode "cargo build --release" em midia/');
  process.exit(1);
}

const resultados = [];
const check = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const motores = () => {
  try {
    return execFileSync("tasklist", ["/FI", "IMAGENAME eq vcall-midia.exe", "/NH"], { encoding: "utf8" }).includes("vcall-midia.exe");
  } catch {
    return false;
  }
};

const app = await electron.launch({
  args: ["--use-fake-device-for-media-stream", "scripts/fixtures/app-isolado.mjs"],
  cwd: root,
  env: { ...process.env, VCALL_USERDATA: mkdtempSync(path.join(os.tmpdir(), "vcall-midia-app-")), VCALL_SEM_OCLUSAO: "1" },
});
const win = await app.firstWindow();
const erros = [];
const avisos = [];
win.on("pageerror", (e) => erros.push(e.message));
win.on("console", (m) => /motor|screen|midia/i.test(m.text()) && avisos.push(`${m.type()}: ${m.text()}`));
let browser;

/** A tela que chega a quem assiste: quadros decodificados, tamanho e codec. */
const recebido = (page) =>
  page.evaluate(async () => {
    const p = [...window.vcall.mesh.peers.values()][0];
    const st = await p?.tx.screen?.receiver.getStats();
    let r = null;
    const codecs = {};
    st?.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video") r = s;
      if (s.type === "codec") codecs[s.id] = s.mimeType;
    });
    return r ? { quadros: r.framesDecoded || 0, w: r.frameWidth, h: r.frameHeight, codec: codecs[r.codecId], t: performance.now() } : null;
  });
const qps = (a, b) => (a && b ? Math.round(((b.quadros - a.quadros) / (b.t - a.t)) * 10000) / 10 : 0);

try {
  await win.waitForLoadState("domcontentloaded");
  await espera(2000);
  const base = new URL(win.url()).origin;
  const sala = `nativo-${Date.now().toString(36)}-abcdefghij`;
  await win.evaluate((r) => {
    localStorage.setItem("vcall:codificador", "nativo");
    location.hash = r;
    location.reload();
  }, sala);
  await espera(2500);
  await win.fill("#nameInput", "App");
  await win.click("#joinBtn");
  await win.waitForSelector("#dock:not([hidden])", { timeout: 15_000 });
  const disponivel = await win.evaluate(() => window.vcallDesktop.midia.disponivel());
  check("o app acha o motor nativo", disponivel);

  browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const web = await (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
  await web.goto(`${base}/#${sala}`, { waitUntil: "load" });
  await espera(1500);
  await web.fill("#nameInput", "Web");
  await web.click("#joinBtn");
  await web.waitForSelector("#dock:not([hidden])");
  await win.waitForFunction(() => [...window.vcall.mesh.peers.values()].some((p) => p.connectionState === "connected"), null, { timeout: 25_000 });
  check("o app conecta com um navegador", true);

  // A janela de teste, fora da tela.
  await app.evaluate(async ({ BrowserWindow, screen }, arquivo) => {
    const sf = screen.getPrimaryDisplay().scaleFactor;
    const w = new BrowserWindow({
      x: -Math.round(1920 / sf) - 200,
      y: 0,
      width: Math.round(1920 / sf),
      height: Math.round(1080 / sf),
      useContentSize: true,
      frame: false,
      enableLargerThanScreen: true,
      webPreferences: { backgroundThrottling: false },
    });
    await w.loadFile(arquivo);
    globalThis.__fonteTeste = w;
  }, path.join(root, "scripts", "midia-bench", "fonte.html"));

  /* -- compartilhar a janela de teste pelo seletor do app -- */
  await win.click('[aria-label="Compartilhar tela"]');
  await win.waitForSelector(".share__fontes", { timeout: 5000 });
  await espera(2500);
  await win.click('.share__pilula[data-tipo="window"]');
  const fonte = win.locator('.share__fonte[aria-label="vcall-midia fonte"]');
  await fonte.waitFor({ timeout: 8000 });
  await fonte.click();
  await win.click(".share__acoes .btn--primary");
  await win.waitForFunction(() => window.vcall.screen.active, null, { timeout: 15_000 });
  // O motor liga depois da captura (o MFT leva ~1 s para abrir).
  await win.waitForFunction(() => window.vcall.screen.nativo, null, { timeout: 20_000 }).catch(() => {});
  const saindo = await win.evaluate(() => {
    const p = [...window.vcall.mesh.peers.values()][0];
    return { nativo: window.vcall.screen.nativo, codec: window.vcall.screen.profile.codec, injetor: !!p?.tx.screen.sender.transform };
  });
  check("a tela sai pelo motor nativo, com o injetor no sender", saindo.nativo && saindo.injetor && saindo.codec === "video/H264", JSON.stringify(saindo));

  await web.waitForSelector(".tile__assistir", { timeout: 15_000 });
  await web.click(".tile__assistir");
  await web.evaluate(() => {
    window.__saiu = 0;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.removedNodes) if (n.dataset?.kind === "screen") window.__saiu++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await espera(6000);
  const a = await recebido(web);
  await espera(5000);
  const b = await recebido(web);
  const diag = await win.evaluate(() => [...window.vcall.mesh.peers.values()][0]?.tx.screen.sender.track?.vcallNativo?.diag || null);
  console.log(`    injetor: ${JSON.stringify(diag)}`);
  if (process.env.DEBUG_LINHAS) {
    const linhas = await win.evaluate(async () => {
      const p = [...window.vcall.mesh.peers.values()][0];
      const out = [];
      for (const t of p.pc.getTransceivers()) {
        let enc = null;
        (await t.sender.getStats()).forEach((r) => {
          if (r.type === "outbound-rtp") enc = `${r.frameWidth}x${r.frameHeight} q=${r.framesEncoded}`;
        });
        out.push({ mid: t.mid, dir: t.currentDirection, kind: t.sender.track?.kind, falsa: !!t.sender.track?.vcallNativo, transform: !!t.sender.transform, tela: t === p.tx.screen, enc });
      }
      return { polite: p.polite, linhas: out };
    });
    console.log(`    linhas: ${JSON.stringify(linhas)}`);
  }
  check(
    "quem recebe decodifica a janela inteira a mais de 40 qps, em H.264",
    // A janela sem moldura sai com 1920–1944 de largura, conforme a escala da tela.
    b?.w >= 1900 && b?.h >= 1060 && qps(a, b) > 40 && /h264/i.test(b?.codec || ""),
    `${b?.w}x${b?.h} ${qps(a, b)} qps ${b?.codec}`,
  );

  /* -- o motor cai: volta ao Chromium sem parar -- */
  try {
    execFileSync("taskkill", ["/F", "/IM", "vcall-midia.exe"], { stdio: "ignore" });
  } catch {
    /* já tinha saído */
  }
  await espera(4000);
  const depois = await win.evaluate(() => ({ ativo: window.vcall.screen.active, nativo: window.vcall.screen.nativo }));
  const c = await recebido(web);
  await espera(4000);
  const d = await recebido(web);
  const saiu = await web.evaluate(() => window.__saiu);
  check(
    "o motor caindo, a tela volta ao Chromium sem o ladrilho sumir",
    depois.ativo && !depois.nativo && saiu === 0 && qps(c, d) > 5,
    `${JSON.stringify(depois)} saiu=${saiu} ${qps(c, d)} qps ${d?.w}x${d?.h} ${d?.codec}`,
  );

  /* -- compartilhar de novo e parar: o motor desliga -- */
  await win.evaluate(() => window.vcall.screen.stop("user"));
  await espera(1500);
  await win.click('[aria-label="Compartilhar tela"]');
  await win.waitForSelector(".share__fontes", { timeout: 5000 });
  await espera(2000);
  await win.click('.share__pilula[data-tipo="window"]');
  await win.locator('.share__fonte[aria-label="vcall-midia fonte"]').click();
  await win.click(".share__acoes .btn--primary");
  await win.waitForFunction(() => window.vcall.screen.nativo, null, { timeout: 15_000 }).catch(() => {});
  const ligouDeNovo = motores();
  await win.evaluate(() => window.vcall.screen.stop("user"));
  await espera(3000);
  check("compartilhar de novo liga o motor, e parar o desliga", ligouDeNovo && !motores(), `ligou=${ligouDeNovo} sobrou=${motores()}`);
  check("nenhum erro de página", erros.length === 0, erros.slice(0, 3).join(" | "));
} catch (err) {
  check("o roteiro chegou ao fim", false, String(err?.message || err).split("\n")[0]);
} finally {
  await browser?.close().catch(() => {});
  await Promise.race([app.close().catch(() => {}), espera(5000)]);
  try {
    execFileSync("taskkill", ["/F", "/IM", "vcall-midia.exe"], { stdio: "ignore" });
  } catch {
    /* nenhum sobrou */
  }
}

if (avisos.length) console.log(["", "avisos da página:", ...avisos.slice(0, 10).map((a) => `  ${a}`)].join("\n"));
const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações do motor nativo no app passaram.`);
process.exit(falhas ? 1 : 0);
