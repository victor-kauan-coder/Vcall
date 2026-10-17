#!/usr/bin/env node
/**
 * scripts/rele-test.mjs — o relé com três navegadores reais (core/rele.js).
 *
 *   1. Ana e Bruno perdem a conexão direta: Carla repassa voz e vídeo nos dois
 *      sentidos, e os dois continuam se ouvindo e se vendo.
 *   2. A conexão direta volta: cada um volta a receber direto e Carla para.
 *   3. Ana fica com subida fraca: manda a câmera só para Carla, que repassa
 *      para Bruno. A voz de Ana continua indo direto.
 *
 * A queda é simulada (Ana e Bruno deixam de se anunciar como conectados);
 * o repasse, as linhas extras e a mídia são de verdade.
 *
 * Roda com: node scripts/rele-test.mjs
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3994;
const URL_BASE = `http://localhost:${PORT}`;
const ROOM = "rele-sala-para-teste-abcdef";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("node", ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "production", LOG_LEVEL: "error" },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
await wait(900);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const erros = [];

async function abrir(nome) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erros.push(`[${nome}] ${e.message}`));
  await page.goto(`${URL_BASE}/#${ROOM}`, { waitUntil: "networkidle" });
  await page.fill("#nameInput", nome);
  await page.click("#joinBtn");
  await page.waitForSelector("#dock:not([hidden])", { timeout: 10_000 });
  return page;
}

/** Quadros e pacotes que chegam a `page` pelas linhas de repasse do par `ajudante`. */
const repassado = (page, ajudante) =>
  page.evaluate(async (h) => {
    const peer = window.vcall.mesh.peers.get(h);
    const proprias = new Set(Object.values(peer.tx).map((t) => String(t.mid)));
    let quadros = 0;
    let pacotesAudio = 0;
    (await peer.pc.getStats()).forEach((r) => {
      if (r.type !== "inbound-rtp" || r.mid == null || proprias.has(String(r.mid))) return;
      if (r.kind === "video") quadros += r.framesDecoded || 0;
      else pacotesAudio += r.packetsReceived || 0;
    });
    return { quadros, pacotesAudio };
  }, ajudante);

const fonte = (page, de, papel) => page.evaluate(([d, p]) => window.vcall.mesh.fonteDe(d, p), [de, papel]);

try {
  console.log("\nTrês participantes na mesma sala…");
  const ana = await abrir("Ana");
  await wait(500);
  const bruno = await abrir("Bruno");
  await wait(500);
  const carla = await abrir("Carla");
  const todos = [ana, bruno, carla];
  await Promise.all(
    todos.map((p) =>
      p.waitForFunction(
        () => window.vcall?.mesh.peers.size === 2 && [...window.vcall.mesh.peers.values()].every((x) => x.connectionState === "connected"),
        { timeout: 30_000 },
      ),
    ),
  );
  const [A, B, C] = await Promise.all(todos.map((p) => p.evaluate(() => window.vcall.mesh.selfId)));
  check("três conexões diretas de pé", true);

  // Carla é o computador forte; Bruno, o modesto (a máquina de teste é uma só).
  await carla.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 8 }));
  await ana.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 4 }));
  await bruno.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 2 }));
  await wait(3000);
  check("sem queda, ninguém repassa nada", (await carla.evaluate(() => [...window.vcall.mesh.peers.values()].every((p) => !p.repassando.length))));

  /* -- 1. resgate --------------------------------------------------- */
  await ana.evaluate((b) => (window.vcall.mesh.rele.forcar = { cpu: 4, quebrar: [b] }), B);
  await bruno.evaluate((a) => (window.vcall.mesh.rele.forcar = { cpu: 2, quebrar: [a] }), A);
  await bruno.waitForFunction(([a]) => window.vcall.mesh.fonteDe(a, "mic") && window.vcall.mesh.fonteDe(a, "cam"), [A], { timeout: 20_000 }).catch(() => {});
  const repassa = await carla.evaluate(([a, b]) => ({ paraBruno: window.vcall.mesh.peers.get(b).repassando, paraAna: window.vcall.mesh.peers.get(a).repassando }), [A, B]);
  check("Carla repassa Ana -> Bruno (voz, câmera, tela)", repassa.paraBruno.includes(`${A}:mic`) && repassa.paraBruno.includes(`${A}:cam`), repassa.paraBruno.join(", "));
  check("Carla repassa Bruno -> Ana", repassa.paraAna.includes(`${B}:mic`) && repassa.paraAna.includes(`${B}:cam`), repassa.paraAna.join(", "));
  check("Bruno ouve Ana pela Carla", (await fonte(bruno, A, "mic")) === C);
  check("Ana ouve Bruno pela Carla", (await fonte(ana, B, "mic")) === C);
  await wait(3000);
  const r1 = await repassado(bruno, C);
  await wait(2000);
  const r2 = await repassado(bruno, C);
  check("a câmera de Ana chega decodificada em Bruno pelo repasse", r2.quadros > r1.quadros, `${r1.quadros} -> ${r2.quadros} quadros`);
  check("a voz de Ana chega em Bruno pelo repasse", r2.pacotesAudio > r1.pacotesAudio, `${r1.pacotesAudio} -> ${r2.pacotesAudio} pacotes`);
  const tile = await bruno.evaluate((a) => {
    const v = document.querySelector(`.tile[data-tile="${a}:cam"] video`);
    return v ? { w: v.videoWidth, tocando: !v.paused } : null;
  }, A);
  check("o ladrilho de Ana em Bruno mostra o vídeo repassado", !!tile && tile.w > 0, JSON.stringify(tile));
  const saida = await bruno.evaluate((a) => window.vcall.audio?.diagnostico?.(a) ?? null, A).catch(() => null);
  if (saida) check("a voz repassada toca na saída de áudio", !saida.paused, JSON.stringify(saida));

  /* -- 2. a conexão direta volta ------------------------------------ */
  await ana.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 4 }));
  await bruno.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 2 }));
  await bruno.waitForFunction(([a]) => !window.vcall.mesh.fonteDe(a, "mic") && !window.vcall.mesh.fonteDe(a, "cam"), [A], { timeout: 15_000 }).catch(() => {});
  check("com a conexão direta de volta, Bruno ouve Ana direto", (await fonte(bruno, A, "mic")) === null && (await fonte(bruno, A, "cam")) === null);
  await carla.waitForFunction(() => [...window.vcall.mesh.peers.values()].every((p) => !p.repassando.length), null, { timeout: 10_000 }).catch(() => {});
  check("Carla para de repassar", await carla.evaluate(() => [...window.vcall.mesh.peers.values()].every((p) => !p.repassando.length)));

  /* -- 3. subida fraca ---------------------------------------------- */
  await ana.evaluate(() => (window.vcall.mesh.rele.forcar = { cpu: 4, fraco: true }));
  await bruno.waitForFunction(([a]) => !!window.vcall.mesh.fonteDe(a, "cam"), [A], { timeout: 20_000 }).catch(() => {});
  check("Bruno vê a câmera de Ana pela Carla", (await fonte(bruno, A, "cam")) === C);
  check("a voz de Ana continua direta (sem atraso a mais)", (await fonte(bruno, A, "mic")) === null);
  await ana.waitForFunction((b) => window.vcall.mesh.peers.get(b).viaRele.includes("cam"), B, { timeout: 10_000 }).catch(() => {});
  const envio = await ana.evaluate(([b, c]) => {
    const ativo = (id) => window.vcall.mesh.peers.get(id).tx.cam.sender.getParameters().encodings[0].active;
    return { paraBruno: ativo(b), paraCarla: ativo(c) };
  }, [B, C]);
  check("Ana manda a câmera uma vez só: para Carla sim, para Bruno não", envio.paraCarla === true && envio.paraBruno === false, JSON.stringify(envio));
  await wait(2500);
  const q1 = await repassado(bruno, C);
  await wait(2000);
  const q2 = await repassado(bruno, C);
  check("os quadros de Ana continuam chegando em Bruno", q2.quadros > q1.quadros, `${q1.quadros} -> ${q2.quadros}`);

  /* -- 3b. troca de rede (Wi-Fi -> 4G) ------------------------------ */
  await bruno.evaluate(() => dispatchEvent(new Event("online")));
  await wait(5000);
  const troca = await bruno.evaluate(() => ({
    trocas: window.vcall.mesh.rele.trocasDeRede || 0,
    conectados: [...window.vcall.mesh.peers.values()].every((p) => p.connectionState === "connected"),
  }));
  check("troca de rede: Bruno refaz o ICE de todas as conexões sem cair", troca.trocas === 1 && troca.conectados, JSON.stringify(troca));
  const t1 = await repassado(bruno, C);
  await wait(2000);
  const t2 = await repassado(bruno, C);
  check("e o vídeo segue chegando depois da troca", t2.quadros > t1.quadros, `${t1.quadros} -> ${t2.quadros}`);

  /* -- 4. o ajudante sai: volta tudo para o direto ------------------- */
  await carla.close();
  await bruno.waitForFunction(([a]) => window.vcall.mesh.peers.size === 1 && !window.vcall.mesh.fonteDe(a, "cam"), [A], { timeout: 15_000 }).catch(() => {});
  check("Carla saiu: Bruno volta a ver Ana direto", (await fonte(bruno, A, "cam")) === null);
  await ana.waitForFunction((b) => window.vcall.mesh.peers.get(b).tx.cam.sender.getParameters().encodings[0].active === true, B, { timeout: 10_000 }).catch(() => {});
  check("e Ana volta a mandar a câmera direto para Bruno", await ana.evaluate((b) => window.vcall.mesh.peers.get(b).tx.cam.sender.getParameters().encodings[0].active === true, B));

  check("nenhum erro de JavaScript", erros.length === 0, erros.slice(0, 3).join(" | "));
} catch (err) {
  check("execução sem exceção", false, err.message);
} finally {
  await browser.close();
  server.kill();
}

const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
