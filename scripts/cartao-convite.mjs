#!/usr/bin/env node
/**
 * scripts/cartao-convite.mjs — gera public/assets/convite.jpg, a imagem da
 * prévia do convite no WhatsApp, Telegram e afins (1200×630, o formato
 * "summary_large_image"). Desenhada em HTML com a logo e as cores da marca e
 * fotografada pelo Chromium do Playwright.
 *
 *   CHROMIUM_PATH=/caminho/do/chrome node scripts/cartao-convite.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = readFileSync(path.join(root, "public", "assets", "logo-mark.svg"), "utf8");
const fonte = path.join(root, "public", "fonts");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Marca; src: url("file://${fonte}/bricolage-latin.woff2"); font-weight: 200 800; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: Marca, system-ui, sans-serif;
    background: radial-gradient(circle at 12% 18%, rgb(253 77 135 / .38), transparent 46%),
      radial-gradient(circle at 92% 88%, rgb(254 156 95 / .34), transparent 48%), #110c3a;
    color: #fff; display: flex; align-items: center; padding: 0 96px; gap: 72px; }
  .marca { width: 330px; height: 330px; flex: none; filter: drop-shadow(0 36px 60px rgb(253 77 135 / .45)); }
  .marca svg { width: 100%; height: 100%; }
  h1 { font-size: 104px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  p { margin-top: 26px; font-size: 40px; line-height: 1.25; color: rgb(255 255 255 / .82); font-weight: 500; }
  .selo { display: inline-block; margin-top: 40px; padding: 14px 30px; border-radius: 999px; font-size: 30px; font-weight: 700;
    background: linear-gradient(135deg, #fd4d87, #fe9c5f); }
</style></head><body>
  <div class="marca">${logo}</div>
  <div><h1>Vcall</h1><p>Chamada de vídeo criptografada<br>ponta a ponta</p><span class="selo">Toque para entrar</span></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
// Por arquivo (e não setContent): só assim a página carrega a fonte local.
const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), "vcall-cartao-")), "cartao.html");
writeFileSync(tmp, html);
await page.goto(`file://${tmp}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
// JPEG: o WhatsApp despreza imagens grandes (passe de ~300 KB) na prévia.
const destino = path.join(root, "public", "assets", "convite.jpg");
await page.screenshot({ path: destino, type: "jpeg", quality: 88 });
await browser.close();
console.log(`✓ ${path.relative(root, destino)}`);
