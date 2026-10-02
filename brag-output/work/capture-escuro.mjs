#!/usr/bin/env node
/**
 * capture-escuro.mjs — todas as telas do Vcall, em tema escuro.
 *
 * Sobe o servidor e dirige participantes reais no Chromium, como o
 * scripts/ui-test.mjs. Diferenças em relação às passadas anteriores:
 *   - tema ESCURO em todo mundo (vcall:theme = "dark");
 *   - as salas têm nome de uso real — reunião, estudo, aula — e são públicas,
 *     para a tela inicial listar "Ao vivo agora" com esses nomes;
 *   - layout em "grade igualitária", para todo mundo do mesmo tamanho;
 *   - uma volta inteira pelas paletas de cor.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = path.join(here, "escuro");
mkdirSync(OUT, { recursive: true });

const PORT = 3972, BASE = `http://localhost:${PORT}`;
const VW = { width: 1920, height: 1080 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const novaSala = (n) => `${n}-${randomBytes(15).toString("base64url")}`;

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
const shot = async (p, nome, pausa = 700) => {
  await espera(pausa);
  try {
    await p.screenshot({ path: path.join(OUT, `${nome}.png`), timeout: 60000 });
    feitos.push(nome); console.log(`  ✓ ${nome}`);
  } catch (e) { falhos.push(nome); console.log(`  ✗ ${nome} — ${e.message.split("\n")[0]}`); }
};

/** Contexto escuro, com a intro já vista e a paleta pedida. */
async function ctxEscuro({ viewport = VW, paleta = "tinta", extra = {} } = {}) {
  const ctx = await browser.newContext({ permissions: ["camera","microphone"], viewport, ...extra });
  await ctx.addInitScript(([pal]) => {
    try {
      sessionStorage.setItem("vcall:intro", "1");
      localStorage.setItem("vcall:theme", '"dark"');
      localStorage.setItem("vcall:paleta", JSON.stringify(pal));
    } catch {}
  }, [paleta]);
  return ctx;
}

/** Cria uma sala PÚBLICA com nome, pelo diálogo da tela inicial. */
async function anfitriao(nomePessoa, nomeSala, { paleta = "tinta" } = {}) {
  const ctx = await ctxEscuro({ paleta });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error(`  [js ${nomePessoa}] ${e.message}`));
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await espera(1200);
  await p.click("text=Criar nova call");
  await espera(800);
  await p.fill("dialog[open] .modal__body input.input:visible", nomeSala);
  await p.click("dialog[open] .privacy >> nth=1"); // Pública
  await espera(400);
  return { page: p, nomeSala };
}

/** Conclui o diálogo e entra: nome, avatar, câmera fechada. */
async function entrarComoAnfitriao(p, nomePessoa, sorteios = 0) {
  await p.click("dialog[open] >> text=Criar e entrar");
  await p.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await p.fill("#nameInput", nomePessoa);
  for (let i = 0; i < sorteios; i++) { await p.click("#avatarShuffle"); await espera(240); }
  await p.click("#lobbyCam");
  await espera(600);
  await p.click("#joinBtn");
  await p.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(1000);
  return p;
}

async function convidado(nome, id, { sorteios = 0, paleta = "tinta", viewport = VW, extra = {} } = {}) {
  const ctx = await ctxEscuro({ viewport, paleta, extra });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error(`  [js ${nome}] ${e.message}`));
  await p.goto(`${BASE}/#${id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  await p.fill("#nameInput", nome);
  for (let i = 0; i < sorteios; i++) { await p.click("#avatarShuffle"); await espera(240); }
  await p.click("#lobbyCam");
  await espera(600);
  await p.click("#joinBtn");
  await p.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
  await espera(1000);
  return p;
}

const salaDe = (p) => p.evaluate(() => location.hash.slice(1));
const dock = async (p, id) => {
  try { await p.click(`#dock [data-id="${id}"]`, { timeout: 9000 }); return true; }
  catch { console.log(`  · dock/${id} indisponível`); return false; }
};
const esperaPares = (p, n) =>
  p.waitForFunction((n) => [...window.vcall.mesh.peers.values()].filter(x => x.connectionState === "connected").length >= n, n, { timeout: 40000 });

const desenhar = async (p, tracos) => {
  const cv = await p.evaluate(() => {
    const el = document.querySelector("canvas.board__surface");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!cv) return false;
  const { x, y, w, h } = cv;
  for (const pts of tracos) {
    await p.mouse.move(x + pts[0][0]*w, y + pts[0][1]*h);
    await p.mouse.down();
    for (const [px, py] of pts.slice(1)) await p.mouse.move(x + px*w, y + py*h, { steps: 15 });
    await p.mouse.up();
    await espera(200);
  }
  return true;
};
const abrirQuadro = async (p) => {
  await dock(p, "board");
  await espera(900);
  await p.click("text=Canvas colaborativo", { timeout: 8000 });
  await espera(2200);
};

try {
  /* ============ 1 · intro animada (já é escura) ============ */
  console.log("\nIntro");
  {
    const ctx = await browser.newContext({ viewport: VW });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("vcall:theme", '"dark"'); } catch {}
    });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 10; i++) await shot(p, `00-intro-${String(i).padStart(2,"0")}`, i === 0 ? 220 : 240);
    await ctx.close();
  }

  /* ============ 2 · entrada, em escuro, com nome de reunião ============ */
  console.log("\nEntrada (escuro)");
  const { page: host } = await anfitriao("Victor", "Reunião de equipe · Q3");
  await shot(host, "02-criar-nova-call");
  await entrarComoAnfitriao(host, "Victor", 2);
  await shot(host, "04-aguardando");
  await host.click("#inviteBtn");
  await shot(host, "05-convidar", 1100);
  await host.keyboard.press("Escape");
  await espera(600);
  await dock(host, "layout"); // grade igualitária
  await espera(2600);
  const salaReuniao = await salaDe(host);

  // a antessala, vista por quem foi convidado
  {
    const ctx = await ctxEscuro();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/#${salaReuniao}`, { waitUntil: "networkidle" });
    await p.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
    await p.fill("#nameInput", "Alice");
    await p.click("#avatarShuffle"); await espera(300);
    await p.click("#lobbyCam");
    await shot(p, "03-antessala", 1400);
    await ctx.close();
  }

  /* ============ 3 · os usos: salas públicas com nome ============ */
  console.log("\nAo vivo agora: trabalho, estudo, aula");
  const estudo = await anfitriao("Marina", "Grupo de estudos · Cálculo II");
  await entrarComoAnfitriao(estudo.page, "Marina", 4);
  const aula = await anfitriao("Rafael", "Aula de violão · iniciantes");
  await entrarComoAnfitriao(aula.page, "Rafael", 7);
  const salaEstudo = await salaDe(estudo.page);
  {
    const ctx = await ctxEscuro();
    const v = await ctx.newPage();
    await v.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(v, "01-tela-inicial", 1600);
    await shot(v, "06-ao-vivo-usos", 7000);
    await ctx.close();
  }

  /* ============ 4 · a sala de reunião enche ============ */
  console.log("\nA sala enche");
  const b = await convidado("Alice", salaReuniao, { sorteios: 1 });
  await esperaPares(host, 1);
  await shot(host, "07-chamada-2", 2600);
  const c = await convidado("Bruno", salaReuniao, { sorteios: 5 });
  const d = await convidado("Carla", salaReuniao, { sorteios: 9 });
  await esperaPares(host, 3);
  await shot(host, "08-chamada-4", 3000);
  const e = await convidado("Diego", salaReuniao, { sorteios: 13 });
  const f = await convidado("Elisa", salaReuniao, { sorteios: 17 });
  await esperaPares(host, 5);
  await shot(host, "09-chamada-6", 3600);

  /* ============ 5 · chat com arquivo ============ */
  console.log("\nChat e arquivos");
  if (await dock(host, "chat")) {
    await espera(1200);
    await host.evaluate(() => document.querySelector(".panel textarea.composer__input")?.focus());
    await host.keyboard.type("mandei o roteiro da apresentação aqui 👇", { delay: 14 });
    await host.keyboard.press("Enter");
    await espera(900);
    const picker = await host.$(".panel input[type=file]");
    if (picker) { await picker.setInputFiles(path.join(root, "public/assets/logo-wordmark.png")); await espera(2800); }
    await shot(host, "10-chat-arquivo", 1400);
    await dock(host, "chat");
    await espera(900);
  }

  /* ============ 6 · pessoas e estatísticas ============ */
  console.log("\nPessoas e rede");
  if (await dock(host, "people")) await shot(host, "11-pessoas", 1400);
  if (await dock(host, "stats")) await shot(host, "12-estatisticas", 2000);
  await dock(host, "stats");
  await espera(900);

  /* ============ 7 · legendas ao vivo ============ */
  console.log("\nLegendas");
  if (await dock(host, "captions")) {
    await espera(2600);
    await host.evaluate(() => {
      const ids = [...window.vcall.mesh.peers.keys()];
      const falas = [
        "então a chamada vai direto de uma máquina pra outra",
        "isso, não tem servidor no meio segurando o vídeo",
        "e quem eu convidar não instala nada, só abre o link",
      ];
      ids.slice(0, 3).forEach((pid, i) => {
        const perfil = window.vcall.mesh.peers.get(pid)?.profile || {};
        window.vcall.captions.show(pid, { name: perfil.name || "Participante", text: falas[i], final: true });
      });
    });
    await shot(host, "13-legendas", 1300);
    await dock(host, "captions");
    await espera(1200);
  }

  /* ============ 8 · mão levantada e reação ============ */
  console.log("\nMão e reação");
  if (await dock(host, "hand")) {
    await shot(host, "14-mao-levantada", 1900);
    await dock(host, "hand");
    await espera(900);
  }
  if (await dock(host, "react")) {
    await shot(host, "15-reacoes-menu", 1000);
    try {
      await host.click(".popover--reactions button >> nth=1", { timeout: 5000 });
      await shot(host, "16-reacao-voando", 350);
    } catch { console.log("  · reação não disparou"); }
    await host.keyboard.press("Escape");
    await espera(800);
  }

  /* ============ 9 · compartilhar tela e anotar ============ */
  console.log("\nTela e anotação");
  if (await dock(host, "screen")) {
    await shot(host, "17-compartilhar-escolha", 1700);
    try {
      await host.click("text=Escolher o que mostrar", { timeout: 8000 });
      await espera(5200);
      await shot(host, "18-compartilhando");
      await dock(host, "board");
      await espera(900);
      await host.click("text=Anotar", { timeout: 6000 });
      await espera(2500);
      if (await desenhar(host, [
        [[0.30,0.33],[0.63,0.33],[0.63,0.56],[0.30,0.56],[0.30,0.33]],
        [[0.66,0.64],[0.60,0.58]],
        [[0.66,0.64],[0.74,0.72]],
      ])) await shot(host, "19-anotar-sobre-a-tela", 1300);
      await dock(host, "board");
      await espera(1300);
    } catch (err) { console.log(`  · tela: ${err.message.split("\n")[0]}`); }
    await dock(host, "screen");
    await espera(1900);
  }

  /* ============ 10 · mini-janela (picture-in-picture) ============ */
  console.log("\nPicture-in-picture");
  {
    const espia = host.context().waitForEvent("page", { timeout: 12000 }).catch(() => null);
    await dock(host, "mini");
    const pip = await espia;
    await shot(host, "20-pip-pagina-principal", 2600);
    if (pip) {
      try {
        await pip.setViewportSize({ width: 440, height: 316 }).catch(() => {});
        await espera(1400);
        await pip.screenshot({ path: path.join(OUT, "21-pip-janela.png"), timeout: 30000 });
        feitos.push("21-pip-janela"); console.log("  ✓ 21-pip-janela");
      } catch (err) { console.log(`  ✗ 21-pip-janela — ${err.message.split("\n")[0]}`); }
    }
    await dock(host, "mini");
    await espera(1300);
  }

  /* ============ 11 · gravação local ============ */
  console.log("\nGravação");
  if (await dock(host, "record")) await shot(host, "22-gravando", 2400);

  /* ============ 12 · as paletas de cor ============ */
  console.log("\nPaletas");
  if (await dock(host, "settings")) {
    await espera(1300);
    await host.evaluate(() => {
      document.querySelector(".paletaGrade")?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await shot(host, "23-paletas", 1100);
    // Uma volta pelas cores, aplicadas de verdade.
    const cores = [["oceano","24-paleta-oceano"],["brasa","25-paleta-brasa"],["ametista","26-paleta-ametista"]];
    for (const [id, nome] of cores) {
      try {
        await host.click(`.paletaOpcao[data-paleta-amostra="${id}"]`, { timeout: 6000 });
        await espera(1600);
        await shot(host, nome, 400);
      } catch (err) { console.log(`  · paleta ${id}: ${err.message.split("\n")[0]}`); }
    }
    // volta para a padrão e fecha
    await host.click('.paletaOpcao[data-paleta-amostra="tinta"]').catch(() => {});
    await espera(1200);
    await host.keyboard.press("Escape");
    await espera(900);
    await shot(host, "27-chamada-tinta", 1200);
  }

  for (const p of [b,c,d,e,f]) await p.context().close().catch(() => {});

  /* ============ 13 · o quadro, dos dois lados (sala de estudo) ============ */
  console.log("\nQuadro branco · grupo de estudos");
  {
    const m = estudo.page;
    await dock(m, "layout");
    await espera(2400);
    const g = await convidado("Pedro", salaEstudo, { sorteios: 3 });
    const h = await convidado("Júlia", salaEstudo, { sorteios: 11 });
    await esperaPares(m, 2);
    await espera(2500);
    await abrirQuadro(m);
    await abrirQuadro(g);
    await espera(1500);
    await shot(m, "28-quadro-vazio");
    // um esboço de aula: um gráfico com eixos e uma curva
    if (await desenhar(m, [
      [[0.20,0.22],[0.20,0.66],[0.78,0.66]],
      [[0.22,0.62],[0.34,0.50],[0.46,0.56],[0.58,0.34],[0.72,0.28]],
      [[0.26,0.74],[0.72,0.74]],
      [[0.26,0.79],[0.56,0.79]],
      [[0.60,0.40],[0.66,0.34]],
      [[0.66,0.34],[0.62,0.44]],
    ])) {
      await shot(m, "29-quadro-desenhado", 1400);
      await shot(g, "30-quadro-no-outro-lado", 1000);
    }
    await g.context().close().catch(() => {});
    await h.context().close().catch(() => {});
  }

  /* ============ 14 · celular ============ */
  console.log("\nCelular");
  {
    const MOB = { width: 430, height: 932 };
    const idc = novaSala("celular");
    const ctx = await ctxEscuro({ viewport: MOB, extra: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    const m = await ctx.newPage();
    await m.goto(`${BASE}/#${idc}`, { waitUntil: "networkidle" });
    await m.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
    await m.fill("#nameInput", "Carla");
    for (let i = 0; i < 4; i++) { await m.click("#avatarShuffle"); await espera(240); }
    await m.click("#lobbyCam");
    await shot(m, "31-celular-antessala", 1300);
    await m.click("#joinBtn");
    await m.waitForSelector("#dock:not([hidden])", { timeout: 25000 });
    const pc = await convidado("Bruno", idc, { sorteios: 2 });
    await esperaPares(m, 1);
    await shot(m, "32-celular-chamada", 3200);
    await pc.context().close().catch(() => {});
    await ctx.close();
  }

  /* ============ 15 · a saída ============ */
  console.log("\nSaída");
  if (await dock(host, "leave")) await shot(host, "33-saida", 3000);

  await host.context().close().catch(() => {});
  await estudo.page.context().close().catch(() => {});
  await aula.page.context().close().catch(() => {});

  console.log(`\n${feitos.length} capturadas${falhos.length ? `, ${falhos.length} falharam: ${falhos.join(", ")}` : ""}`);
} catch (err) {
  console.error("\nFALHA:", err.message, "\n", err.stack?.split("\n").slice(1,4).join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
