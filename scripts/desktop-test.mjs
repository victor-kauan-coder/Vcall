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
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultados = [];
const check = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// O microfone do app é um .wav com uma frase falada: a legenda é testada
// com fala de verdade, do microfone até o texto.
const app = await electron.launch({
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${path.join(root, "scripts", "fixtures", "fala-teste.wav")}`,
    "desktop/main.js",
  ],
  cwd: root,
});
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

    // Trocar para a tela inteira SEM parar: quem assiste não perde o ladrilho.
    await web.evaluate(() => {
      window.__saiu = 0;
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.removedNodes) if (n.dataset?.kind === "screen") window.__saiu++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await win.click('.tile[data-tile="self:screen"] [aria-label="Trocar o que estou mostrando"]', { force: true });
    await win.waitForSelector(".share__fontes", { timeout: 5000 });
    await espera(1500);
    await win.click('.share__pilula[data-tipo="screen"]');
    await espera(200);
    await win.click(".share__acoes .btn--primary");
    await espera(3500);
    const depois = await win.evaluate(() => ({
      ativo: window.vcall.screen.active,
      tipo: window.vcall.screen.videoTrack?.getSettings?.().displaySurface,
    }));
    const saiu = await web.evaluate(() => window.__saiu);
    check("troca de janela para tela inteira sem parar a transmissão", depois.ativo && depois.tipo === "monitor" && saiu === 0, JSON.stringify({ ...depois, saiu }));
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

  /* -- legendas com Whisper: microfone de verdade (um .wav com fala) -- */
  // O modelo "rápido" (tiny). No CI ele é baixado do Hugging Face como seria
  // para qualquer pessoa; sem rede, VCALL_WHISPER_LOCAL aponta uma cópia.
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  if (process.env.VCALL_WHISPER_LOCAL) {
    const destino = path.join(userData, "fala", "whisper", "Xenova", "whisper-tiny");
    mkdirSync(destino, { recursive: true });
    cpSync(process.env.VCALL_WHISPER_LOCAL, destino, { recursive: true });
  }
  await win.evaluate(() => {
    localStorage.setItem("vcall:captions:nivel", JSON.stringify("rapida"));
    window.vcall.captions.nivel = "rapida";
  });
  const isolada = await win.evaluate(() => self.crossOriginIsolated);
  check("app isolado (COOP/COEP): o Whisper pode usar vários núcleos", isolada === true);
  if (!(await win.evaluate(() => window.vcall.media.micEnabled))) await win.keyboard.press("m");
  await win.click('[aria-label="Legendar minha fala"]');
  const inicio = Date.now();
  let fala = null;
  while (Date.now() - inicio < 150_000 && !fala) {
    await espera(1000);
    fala = await win.evaluate(() => window.vcall.captions.transcript.find((t) => /\w{3}/.test(t.text))?.text || null);
  }
  const avisos = await win.evaluate(() => [...document.querySelectorAll(".toast span")].map((x) => x.textContent).join(" | "));
  check(
    "legenda no app: o Whisper reconhece a fala do microfone (sem sair do computador)",
    !!fala && /dia|todos|reuni|come/i.test(fala),
    fala ? `"${fala}" em ${Math.round((Date.now() - inicio) / 1000)} s` : avisos.slice(0, 120),
  );
  const naTela = await win.evaluate(() => !!document.querySelector(".caption .caption__text")?.textContent);
  const naAba = await win.evaluate(() => window.vcall.captions.transcript.length);
  check("a legenda aparece na tela e entra na transcrição", naTela || naAba > 0, `${naAba} fala(s)`);
  const chegou = fala
    ? await web
        .waitForFunction((t) => window.vcall.captions.transcript.some((x) => x.text === t), fala, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  check("o outro participante recebe a legenda como texto", chegou);
  await win.click('[aria-label="Parar de legendar minha fala"]').catch(() => {});

  /* -- visualizador de imagem: o X não pode ficar sob os botões da janela -- */
  const geo = await win.evaluate(async () => {
    const png = await new Promise((r) => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      c.toBlob(r, "image/png");
    });
    const { abrirVisualizador } = await import("/js/ui/lightbox.js");
    abrirVisualizador({ url: URL.createObjectURL(png), blob: png, name: "foto.png", mime: "image/png" });
    await new Promise((r) => setTimeout(r, 400));
    const x = document.querySelector('.lightbox [aria-label="Fechar"]').getBoundingClientRect();
    const area = navigator.windowControlsOverlay?.getTitlebarAreaRect?.();
    const alto = area?.height || 40;
    const drag = getComputedStyle(document.querySelector(".lightbox__barra")).getPropertyValue("-webkit-app-region");
    return { top: x.top, right: x.right, alto, limite: area ? area.x + area.width : innerWidth, drag };
  });
  check(
    "visualizador: o X fica abaixo dos botões da janela e fora da faixa de arrastar",
    geo.top >= geo.alto && geo.right <= geo.limite && geo.drag.trim() !== "drag",
    JSON.stringify(geo),
  );
  await win.click('.lightbox [aria-label="Fechar"]');
  await espera(300);
  check("visualizador: o X fecha", !(await win.evaluate(() => !!document.querySelector(".lightbox"))));

  /* -- modo jogo: sobreposição transparente com quem está na chamada -- */
  // Começa desligado (a preferência sobrevive entre execuções do teste).
  await win.evaluate(() => window.vcall.setModoJogo(false, { avisar: false }));
  await espera(500);
  const antes = app.windows().length;
  await win.evaluate(() => localStorage.setItem("vcall:modo-jogo:canto", JSON.stringify("tr")));
  await win.evaluate(() => window.vcall.setModoJogo(true, { avisar: false }));
  const atalhos = await win.evaluate(() => window.vcallDesktop.modoJogo(true, "tr"));
  let sobre = null;
  for (let i = 0; i < 20 && !sobre; i++) {
    await espera(250);
    sobre = app.windows().find((w) => w.url().endsWith("/sobreposicao.html")) || null;
  }
  check("modo jogo abre a sobreposição por cima dos jogos", !!sobre, `${antes} → ${app.windows().length} janelas`);
  check("modo jogo registra os atalhos globais (ou avisa que não deu)", atalhos && typeof atalhos.mic === "boolean", JSON.stringify(atalhos));
  if (sobre) {
    const nomes = await sobre
      .waitForFunction(() => document.querySelectorAll(".p").length >= 2, null, { timeout: 5000 })
      .then(() => sobre.evaluate(() => [...document.querySelectorAll(".p .nome")].map((n) => n.textContent)))
      .catch(() => []);
    check("a sobreposição lista quem está na chamada", nomes.length >= 2, nomes.join(", "));
    const canto = await sobre.evaluate(() => document.body.dataset.canto);
    check("a sobreposição fica no canto escolhido", canto === "tr", canto);
  }
  await win.evaluate(() => window.vcall.setModoJogo?.(false, { avisar: false }));
  await espera(600);
  check("desligar o modo jogo fecha a sobreposição", !app.windows().some((w) => w.url().endsWith("/sobreposicao.html")));

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
