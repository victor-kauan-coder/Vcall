#!/usr/bin/env node
/**
 * scripts/ui-test.mjs — as correções da 3.1 em navegadores de verdade.
 *
 * Sobe o servidor, abre participantes no Chromium com câmera, microfone e
 * tela falsos, e confere na interface — clicando como uma pessoa — cada
 * problema que foi relatado e corrigido. Complementa o e2e.mjs (conexão e
 * mídia) e o fixes-test.mjs (servidor, sem navegador).
 *
 *   node scripts/ui-test.mjs
 *   CHROMIUM_PATH=/caminho/do/chrome node scripts/ui-test.mjs
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "vcall-ui-"));

const resultados = [];
const check = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const novaSala = (n) => `ui-${n}-${randomBytes(9).toString("base64url")}`;

const server = spawn("node", ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "error" },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await espera(900);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const errosJs = [];

async function participante(nome, sala, { antes = null, viewport = { width: 1280, height: 820 } } = {}) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport });
  if (antes) await ctx.addInitScript(antes);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errosJs.push(`[${nome}] ${e.message}`));
  await page.goto(`${BASE}/#${sala}`, { waitUntil: "networkidle" });
  await page.fill("#nameInput", nome);
  await page.click("#joinBtn");
  return page;
}
const noDock = (p) => p.waitForSelector("#dock:not([hidden])", { timeout: 15_000 });
const conectados = (p, n) =>
  p.waitForFunction(
    (n) => [...window.vcall.mesh.peers.values()].filter((x) => x.connectionState === "connected").length === n,
    n,
    { timeout: 25_000 },
  );

try {
  /* ================================================================ *
   * 1. Perfil, pessoas e diálogos
   * ================================================================ */
  console.log("\nPerfil, lista de pessoas e diálogos");
  {
    const sala = novaSala("perfil");
    const a = await participante("Alice", sala);
    await noDock(a);
    const b = await participante("Bruno", sala);
    await noDock(b);
    await conectados(a, 1);

    await a.click('[aria-label="Pessoas"]');
    await espera(300);
    const linhas = await a.locator(".person").count();
    check("a aba Pessoas mostra todo mundo ao abrir (antes abria vazia)", linhas === 2, `${linhas} pessoas`);

    await a.locator(".person__main").first().click();
    await espera(400);
    const aberto = await a.evaluate(() => document.querySelector("#settingsModal").open);
    check("clicar no próprio nome abre o perfil", aberto);

    await a.click(".profileEdit__avatar");
    await espera(300);
    const aindaAberto = await a.evaluate(() => document.querySelector("#settingsModal").open);
    const grade = await a.locator(".profileEdit__grid .avatarPicker__option").count();
    check("clicar no avatar abre a grade e o perfil NÃO some", aindaAberto && grade >= 5, `${grade} opções`);

    await a.locator(".profileEdit__grid .avatarPicker__option").nth(3).click();
    const avatarA = await a.evaluate(() => window.vcall.mesh.self.avatar);
    await b.waitForFunction(
      (esperado) => [...window.vcall.mesh.profiles.values()].some((p) => p.avatar?.style === esperado.style && p.avatar?.seed === esperado.seed),
      avatarA,
      { timeout: 5000 },
    );
    check("a troca de avatar chega aos outros na hora", true, avatarA.style);

    const foco = await a.evaluate(() => document.activeElement?.getAttribute("role"));
    check("o foco continua no avatar escolhido depois da troca", foco === "radio", foco || "sem foco");
    await a.keyboard.press("p"); // atalho de Pessoas: com o diálogo aberto, não pode agir
    await espera(150);
    const painelAberto = await a.evaluate(() => !document.querySelector(".panel").hidden);
    check("com o diálogo aberto, as teclas não vazam para a chamada", painelAberto);
    await a.evaluate(() => {
      window.__k = [];
      const d = document.querySelector("#settingsModal");
      d.addEventListener("cancel", (e) => window.__k.push(`cancel prevented=${e.defaultPrevented}`));
      document.addEventListener("keydown", (e) => window.__k.push(`key ${e.key} ${e.target.tagName} prevented=${e.defaultPrevented}`), true);
    });
    await a.keyboard.press("Escape");
    const fechou = await a
      .waitForFunction(() => !document.querySelector("#settingsModal").open, null, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!fechou) console.log("    eventos:", await a.evaluate(() => JSON.stringify(window.__k)));
    check("Esc fecha o diálogo (antes o atalho engolia a tecla)", fechou);

    await a.context().close();
    await b.context().close();
  }

  /* ================================================================ *
   * 2. Canvas, transmissão e avisos
   * ================================================================ */
  console.log("\nCanvas, transmissão de tela e avisos");
  {
    const sala = novaSala("tela");
    const contaAvisos = () => {
      window.__avisos = [];
      const ligar = () =>
        new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("toast")) window.__avisos.push(n.textContent);
        }).observe(document.body, { childList: true, subtree: true });
      if (document.body) ligar();
      else document.addEventListener("DOMContentLoaded", ligar);
    };
    const a = await participante("Alice", sala, { antes: contaAvisos });
    await noDock(a);
    const b = await participante("Bruno", sala, { antes: contaAvisos });
    await noDock(b);
    await conectados(a, 1);
    await conectados(b, 1);
    await espera(1500);

    // Bruno desenha 30 traços com o canvas da Alice fechado.
    await b.click('[aria-label="Quadro branco"]');
    await b.locator(".popover .dock__item, .popover button").first().click();
    await espera(500);
    const cv = await b.locator("#spotlight canvas").first().boundingBox();
    for (let i = 0; i < 30; i++) {
      await b.mouse.move(cv.x + 100 + i * 8, cv.y + 120);
      await b.mouse.down();
      await b.mouse.move(cv.x + 140 + i * 8, cv.y + 200, { steps: 4 });
      await b.mouse.up();
    }
    await espera(1200);
    const desenhando = await a.evaluate(() => window.__avisos.filter((t) => /desenhando no canvas/.test(t)).length);
    check("'Fulano está desenhando' aparece UMA vez, não a cada traço", desenhando === 1, `${desenhando} aviso(s) para 30 traços`);
    await b.keyboard.press("Escape");

    const somFalso = await a.evaluate(() => window.__avisos.filter((t) => /som da tela/.test(t)).length);
    check("sem aviso falso de 'compartilhando o som da tela'", somFalso === 0);

    // Duas transmissões seguidas na mesma chamada.
    const tela = async (n) => {
      await a.evaluate(() => window.vcall.screen.start({ withAudio: false }));
      const ok = await b
        .waitForFunction(() => [...document.querySelectorAll(".tile")].some((t) => t.dataset.kind === "screen"), null, { timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      await a.evaluate(() => window.vcall.screen.stop("user"));
      await b
        .waitForFunction(() => ![...document.querySelectorAll(".tile")].some((t) => t.dataset.kind === "screen"), null, { timeout: 8000 })
        .catch(() => {});
      return ok;
    };
    const primeira = await tela(1);
    const segunda = await tela(2);
    check("a tela aparece do outro lado na 1ª transmissão", primeira);
    check("e também na 2ª (antes o ladrilho não nascia mais)", segunda);

    const conectadoAinda = await a.evaluate(() => [...window.vcall.mesh.peers.values()].every((p) => p.connectionState === "connected"));
    check("transmitir não derruba a chamada", conectadoAinda);

    await a.context().close();
    await b.context().close();
  }

  /* ================================================================ *
   * 3. Arquivos na conversa
   * ================================================================ */
  console.log("\nArquivos na conversa");
  {
    const sala = novaSala("arq");
    const capturar = () => {
      const orig = URL.createObjectURL.bind(URL);
      window.__blobs = [];
      URL.createObjectURL = (b) => {
        window.__blobs.push(b);
        return orig(b);
      };
    };
    const a = await participante("Alice", sala);
    await noDock(a);
    const b = await participante("Bruno", sala, { antes: capturar });
    await noDock(b);
    await conectados(a, 1);
    await espera(1000);
    await a.click('[aria-label="Conversa"]');

    for (const tamanho of [300_000, 3_000_000, 12_000_000]) {
      const nome = `anexo-${tamanho}.bin`;
      const dados = randomBytes(tamanho);
      const arquivo = path.join(tmp, nome);
      writeFileSync(arquivo, dados);
      const hash = createHash("sha256").update(dados).digest("hex");
      await a.setInputFiles(".composer input[type=file]", arquivo);
      const chegou = await b
        .waitForFunction((t) => window.__blobs.some((x) => x.size === t), tamanho, { timeout: 90_000 })
        .then(() => true)
        .catch(() => false);
      let igual = false;
      if (chegou) {
        const h = await b.evaluate(async (t) => {
          const blob = window.__blobs.find((x) => x.size === t);
          const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
          return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
        }, tamanho);
        igual = h === hash;
      }
      check(`arquivo de ${(tamanho / 1e6).toFixed(1)} MB chega inteiro e idêntico`, chegou && igual, chegou ? (igual ? "sha256 igual" : "conteúdo diferente") : "não chegou");
    }
    // Um .html malicioso: aparece como texto, nunca é interpretado.
    const html = path.join(tmp, "armadilha.html");
    writeFileSync(html, '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>ola');
    await a.setInputFiles(".composer input[type=file]", html);
    await b.waitForFunction(() => document.querySelector('[data-file][title*="armadilha"]'), null, { timeout: 15_000 });
    await b.click('[aria-label="Conversa"]').catch(() => {});
    await espera(400);
    await b.locator('[data-file][title*="armadilha"]').click();
    await b.waitForSelector(".lightbox__texto", { timeout: 5000 });
    await b.waitForFunction(() => !/carregando/.test(document.querySelector(".lightbox__texto").textContent), null, { timeout: 5000 });
    const texto = await b.evaluate(() => document.querySelector(".lightbox__texto").textContent);
    const xss = await b.evaluate(() => window.__xss === 1);
    check("arquivo de texto recebido abre no visualizador (antes: 'não consegui ler')", texto.includes("ola"), texto.slice(0, 40));
    check("um .html recebido aparece como texto e NÃO executa script", !xss);

    await a.context().close();
    await b.context().close();
  }

  /* ================================================================ *
   * 4. Moderação e sala de espera
   * ================================================================ */
  console.log("\nModeração e sala de espera");
  {
    const sala = novaSala("mod");
    const a = await participante("Alice", sala);
    await noDock(a);
    const b = await participante("Bruno", sala);
    await noDock(b);
    await conectados(a, 1);

    await a.click('[aria-label="Pessoas"]');
    await espera(300);
    const temFaixa = await a.locator(".people__host").count();
    const bSemFaixa = await b.evaluate(() => (document.querySelector('[aria-label="Pessoas"]').click(), 0));
    await espera(300);
    const faixaNoBruno = await b.locator(".people__host").count();
    check("só o anfitrião vê os controles de moderação", temFaixa === 1 && faixaNoBruno === 0 && bSemFaixa === 0);

    await a.click('.person__acao[aria-label^="Silenciar"]');
    await espera(900);
    check("anfitrião silencia o microfone de outra pessoa", !(await b.evaluate(() => window.vcall.media.micEnabled)));

    await a.click(".people__acao >> text=Trancar sala");
    await espera(400);
    const c = await participante("Carla", sala);
    await c.waitForSelector(".waitRoom", { timeout: 8000 });
    await a.waitForSelector(".knock", { timeout: 8000 });
    check("sala trancada: quem chega espera e o anfitrião recebe o pedido", true);
    await a.click(".knock .btn--primary");
    await noDock(c);
    await c.waitForFunction(() => !document.querySelector(".waitRoom") && window.vcall.mesh.peers.size === 2, null, { timeout: 15_000 });
    check("'Deixar entrar' coloca a pessoa na chamada", true);

    await a.click('.person__acao[aria-label^="Remover"] >> nth=0');
    await a.click("dialog[open] .btn--danger");
    const removida = await Promise.race([
      b.waitForSelector(".leave__title", { timeout: 8000 }).then(() => "Bruno"),
      c.waitForSelector(".leave__title", { timeout: 8000 }).then(() => "Carla"),
    ]).catch(() => null);
    check("remover tira a pessoa da chamada com aviso claro", !!removida, removida || "");

    await a.context().close();
    await b.context().close();
    await c.context().close();
  }

  /* ================================================================ *
   * 5. Balão da chamada a dois
   * ================================================================ */
  console.log("\nTransições");
  {
    const sala = novaSala("duo");
    const a = await participante("Alice", sala);
    await noDock(a);
    const b = await participante("Bruno", sala);
    await noDock(b);
    await conectados(a, 1);
    await espera(800);
    const duo = await a.evaluate(() => document.querySelector("#stage").classList.contains("stage--duo") && !!document.querySelector(".floatSelf .tile"));
    check("chamada a dois: o próprio vídeo vira um balão flutuante", duo);
    // Espera o ladrilho terminar de deslizar para dentro do balão: durante a
    // animação ele ainda está visualmente em outro lugar.
    await a.waitForFunction(() => document.getAnimations().every((x) => x.playState !== "running" || x.effect?.getTiming?.().iterations === Infinity), null, { timeout: 5000 }).catch(() => {});
    await espera(300);
    const f = await a.locator(".floatSelf").boundingBox();
    await a.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await a.mouse.down();
    for (let i = 1; i <= 10; i++) await a.mouse.move(f.x + f.width / 2 - i * 80, f.y + f.height / 2 - i * 45, { steps: 2 });
    await a.mouse.up();
    await espera(900);
    const canto = await a.evaluate(() => document.querySelector(".floatSelf").dataset.corner);
    check("arrastar o balão leva ele ao canto mais próximo", canto === "tl", canto);
    await b.context().close();
    await a.waitForFunction(() => !document.querySelector("#stage").classList.contains("stage--duo"), null, { timeout: 10_000 });
    check("quando a outra pessoa sai, o balão volta para o palco", true);
    await a.context().close();
  }

  /* ================================================================ *
   * 5b. Foco na voz e volume por pessoa
   * ================================================================ */
  console.log("\nFoco na voz");
  {
    const sala = novaSala("foco");
    const a = await participante("Alice", sala);
    await noDock(a);
    const b = await participante("Bruno", sala);
    await noDock(b);
    const c = await participante("Carla", sala);
    await noDock(c);
    await conectados(a, 2);
    for (const p of [a, b, c]) await p.keyboard.press("m");
    await espera(1500);
    await a.keyboard.press("g");
    await espera(500);
    const [id1, id2] = await a.evaluate(() => [...window.vcall.mesh.peers.keys()]);
    await a.evaluate((id) => window.vcall.stage.get(id, "cam").setSpeaking(true), id1);
    await espera(500);
    const op = await a.evaluate(
      ([x, y]) => ({
        foco: document.querySelector("#stage").classList.contains("stage--foco"),
        fala: +getComputedStyle(document.querySelector(`.tile[data-tile="${x}:cam"]`)).opacity,
        quieto: +getComputedStyle(document.querySelector(`.tile[data-tile="${y}:cam"]`)).opacity,
        eu: +getComputedStyle(document.querySelector('.tile[data-tile="self:cam"]')).opacity,
      }),
      [id1, id2],
    );
    check("G liga o foco na voz: quem fala acende, quem está quieto fica apagado", op.foco && op.fala > 0.95 && op.quieto < 0.6, JSON.stringify(op));
    check("o próprio ladrilho não fica 'falando' com o microfone mudo", op.eu < 0.6);
    const lembra = await a.evaluate(() => JSON.parse(localStorage.getItem("vcall:foco-voz")));
    check("a preferência do foco fica guardada", lembra === true);

    const vol = await a.evaluate((id) => {
      const t = window.vcall.stage.get(id, "cam");
      const ler = () => {
        const v = document.querySelector(`.tile[data-tile="${id}:cam"] .vol`);
        return { acesas: v.style.getPropertyValue("--acesas") || getComputedStyle(v).getPropertyValue("--acesas"), boost: v.classList.contains("is-boost"), pct: v.querySelector(".vol__pct").textContent };
      };
      t.setVolume(1.5);
      const alto = ler();
      t.setVolume(0);
      const mudo = ler();
      return { alto, mudo, barras: document.querySelectorAll(`.tile[data-tile="${id}:cam"] .vol__rampa i`).length };
    }, id2);
    check("volume: rampa de barras própria acende conforme o nível", vol.barras === 10 && +vol.alto.acesas === 10 && vol.alto.boost && vol.alto.pct === "150%", JSON.stringify(vol));
    check("volume: no zero a rampa apaga e mostra 'mudo'", +vol.mudo.acesas === 0 && vol.mudo.pct === "mudo");
    await a.keyboard.press("g");
    await espera(300);
    check("G de novo desliga o foco", !(await a.evaluate(() => document.querySelector("#stage").classList.contains("stage--foco"))));
    for (const p of [a, b, c]) await p.context().close();
  }

  /* ================================================================ *
   * 5c. Tela parada, troca de fonte e economia de banda
   * ================================================================ */
  console.log("\nTransmissão estável");
  {
    const sala = novaSala("estavel");
    // Captura "estilo Linux": um quadro quando começa e nada mais enquanto a
    // tela não muda. Era isso que fazia a tela "cair e voltar" do outro lado.
    const telaParada = () => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement("canvas");
        c.width = window.__largura || 1280;
        c.height = 720;
        const g = c.getContext("2d");
        g.fillStyle = window.__cor || "#3355ff";
        g.fillRect(0, 0, c.width, c.height);
        const s = c.captureStream(0);
        const t = s.getVideoTracks()[0];
        setTimeout(() => t.requestFrame(), 300);
        return s;
      };
    };
    const contar = () => {
      window.__tela = { entrou: 0, saiu: 0 };
      const ligar = () =>
        new MutationObserver((ms) => {
          for (const m of ms) {
            for (const n of m.addedNodes) if (n.dataset?.kind === "screen") window.__tela.entrou++;
            for (const n of m.removedNodes) if (n.dataset?.kind === "screen") window.__tela.saiu++;
          }
        }).observe(document.body, { childList: true, subtree: true });
      if (document.body) ligar();
      else document.addEventListener("DOMContentLoaded", ligar);
    };
    const a = await participante("Linux", sala, { antes: telaParada });
    await noDock(a);
    const b = await participante("Eu", sala, { antes: contar });
    await noDock(b);
    await conectados(b, 1);
    await a.evaluate(() => window.vcall.screen.start({ withAudio: false }));
    await espera(12_000);
    const r = await b.evaluate(() => {
      const v = document.querySelector('.tile[data-kind="screen"] video');
      return { ...window.__tela, largura: v?.videoWidth || 0 };
    });
    check("tela parada por 12 s continua no ar (antes sumia e voltava)", r.entrou === 1 && r.saiu === 0, JSON.stringify(r));
    check("a imagem da tela parada chega (quadros repetidos mantêm o fluxo)", r.largura === 1280, `${r.largura}px`);

    await a.evaluate(() => {
      window.__largura = 960;
      window.__cor = "#ff5533";
      return window.vcall.screen.switchSource({ withAudio: false });
    });
    const trocou = await b
      .waitForFunction(() => document.querySelector('.tile[data-kind="screen"] video')?.videoWidth === 960, null, { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    const r2 = await b.evaluate(() => window.__tela);
    check("trocar o que é mostrado não interrompe a transmissão", trocou && r2.saiu === 0 && (await a.evaluate(() => window.vcall.screen.active)), JSON.stringify(r2));

    // Economia: a janela do Eu fica escondida — o Linux para de mandar câmera.
    await b.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const pausou = await a
      .waitForFunction(() => [...window.vcall.mesh.peers.values()].every((p) => p.camPausada), null, { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    const parametro = await a.evaluate(() => [...window.vcall.mesh.peers.values()][0].tx.cam.sender.getParameters().encodings[0].active);
    check("janela escondida: os outros param de mandar câmera (economia de banda)", pausou && parametro === false);
    await b.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const voltou = await a
      .waitForFunction(() => [...window.vcall.mesh.peers.values()].every((p) => !p.camPausada), null, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check("voltou a olhar: a câmera volta na hora", voltou);
    await a.context().close();
    await b.context().close();
  }

  /* ================================================================ *
   * 5d. Readmitir quem foi removido
   * ================================================================ */
  console.log("\nReadmitir");
  {
    const sala = novaSala("readmitir");
    const a = await participante("Anfitriã", sala);
    await noDock(a);
    const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
    const b = await ctxB.newPage();
    b.on("pageerror", (e) => errosJs.push(`[Bia] ${e.message}`));
    await b.goto(`${BASE}/#${sala}`, { waitUntil: "networkidle" });
    await b.fill("#nameInput", "Bia");
    await b.click("#joinBtn");
    await noDock(b);
    await conectados(a, 1);
    await a.click('[aria-label="Pessoas"]');
    await a.click('[aria-label="Remover da sala: Bia"]');
    await a.click(".modal .btn--danger");
    await b.waitForSelector(".leave", { timeout: 10_000 });
    const lista = await a
      .waitForSelector('.people__removidos [aria-label="Deixar Bia voltar"]', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check("o anfitrião vê quem removeu, na lista de Pessoas", lista);
    // Antes de liberar, a volta é recusada.
    const tentar = async () => {
      await b.click(".leave .btn--primary");
      await b.waitForSelector("#joinBtn", { timeout: 10_000 });
      await espera(600);
      await b.click("#joinBtn");
    };
    await tentar();
    await b.waitForSelector(".leave", { timeout: 10_000 });
    const barrada = await b.evaluate(() => /removido/i.test(document.querySelector(".leave__title")?.textContent || ""));
    check("sem liberação, quem foi removido não volta", barrada);
    await a.click('[aria-label="Deixar Bia voltar"]');
    await espera(800);
    await tentar();
    const entrou = await b
      .waitForSelector("#dock:not([hidden])", { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check("'Deixar voltar' + 'Tentar entrar de novo': a pessoa volta para a sala", entrou);
    await a.context().close();
    await ctxB.close();
  }

  /* ================================================================ *
   * 6. Legendas (Web Speech simulado)
   * ================================================================ */
  console.log("\nLegendas da própria fala");
  {
    // Um reconhecedor falso, controlado pelo teste, no lugar do do Chrome.
    const falso = () => {
      class FakeSR {
        constructor() {
          window.__sr = this;
          window.__srStarts = (window.__srStarts || 0) + 1;
        }
        start() {
          this.rodando = true;
        }
        stop() {
          this.rodando = false;
          this.onend?.();
        }
      }
      window.SpeechRecognition = FakeSR;
      window.webkitSpeechRecognition = FakeSR;
      window.__falar = (partes) => {
        const results = partes.map(([t, fin]) => Object.assign([{ transcript: t }], { isFinal: fin }));
        window.__sr.onresult({ resultIndex: 0, results });
      };
    };
    const sala = novaSala("leg");
    const a = await participante("Alice", sala, { antes: falso });
    await noDock(a);
    check("idioma padrão das legendas é pt-BR", (await a.evaluate(() => window.vcall.captions.lang)) === "pt-BR");
    await a.click('[aria-label="Legendar minha fala"]');
    await espera(200);
    await a.evaluate(() => window.__falar([["bom dia", false], ["a todos", false]]));
    const parcial = await a.evaluate(() => document.querySelector(".caption__text")?.textContent);
    check("pedaços do palpite são juntados (antes a legenda piscava só o fim)", parcial === "bom dia a todos", parcial);
    await a.evaluate(() => window.__sr.onend());
    await espera(100);
    const transcrito = await a.evaluate(() => window.vcall.captions.transcript.map((t) => t.text));
    check("frase em andamento não se perde quando o reconhecedor reinicia", transcrito.includes("bom dia a todos"), JSON.stringify(transcrito));
    await a.evaluate(() => document.querySelector('[aria-label="Mais opções"]')?.click());
    await espera(300);
    await a.getByText("Transcrição ao vivo").click();
    await espera(400);
    const naAba = await a.evaluate(() => [...document.querySelectorAll(".transcricao__texto")].map((x) => x.textContent));
    check("a aba Transcrição mostra o que foi dito, ao vivo", naAba.some((t) => t.includes("bom dia a todos")), JSON.stringify(naAba));
    await a.fill(".transcricao__busca", "dia");
    await espera(200);
    const marcado = await a.evaluate(() => document.querySelector(".transcricao__texto mark")?.textContent);
    check("a busca na transcrição destaca o termo", marcado === "dia", marcado || "");
    await a.fill(".transcricao__busca", "");
    await espera(400);
    const inicios = await a.evaluate(() => window.__srStarts);
    await a.click('[aria-label="Microfone ligado"]');
    await espera(300);
    const pausado = await a.evaluate(() => window.__sr?.rodando === false || window.__srStarts === undefined);
    check("microfone mudo pausa a legenda (nada vaza no mudo)", pausado, `inícios: ${inicios}`);
    await a.context().close();
  }

  /* ================================================================ *
   * 7. Convite pelo WhatsApp
   * ================================================================ */
  console.log("\nConvite pelo WhatsApp");
  {
    const sala = novaSala("convite");
    const p = await browser.newPage();
    await p.goto(`${BASE}/abrir#${sala}`, { waitUntil: "domcontentloaded" });
    await espera(400);
    const hrefs = await p.evaluate(() => ({ app: document.querySelector("#abrirApp").href, nav: document.querySelector("#noNavegador").href }));
    check(
      "/abrir leva ao aplicativo (vcall://) e oferece o navegador",
      hrefs.app.startsWith("vcall://join?u=") && hrefs.nav.endsWith(`/#${sala}`),
    );
    const cel = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" });
    const pc = await cel.newPage();
    await pc.goto(`${BASE}/abrir#${sala}`);
    await pc.waitForURL(`**/#${sala}`, { timeout: 5000 }).catch(() => {});
    check("no celular, /abrir vai direto para a sala no navegador", pc.url().endsWith(`/#${sala}`));
    await cel.close();

    const a = await participante("Alice", sala);
    await noDock(a);
    await a.click("#inviteBtn");
    const convite = await a.inputValue("#appLink");
    check("o convite do WhatsApp é o link /abrir", convite.includes(`/abrir#${sala}`), convite);
    await p.close();
    await a.context().close();
  }

  check("nenhum erro de JavaScript nas páginas", errosJs.length === 0, errosJs.slice(0, 3).join(" | "));
} catch (err) {
  check("execução sem exceção", false, err?.message || String(err));
} finally {
  await browser.close().catch(() => {});
  server.kill();
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
