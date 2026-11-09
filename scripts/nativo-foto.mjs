#!/usr/bin/env node
/**
 * scripts/nativo-foto.mjs — o app web e o cliente nativo, na mesma cena, lado a lado.
 *
 *   node scripts/nativo-foto.mjs --cena chamada --tema escuro [--saida pasta]
 *
 * Cenas: saguao, sozinha, chamada (3 pessoas), chat (painel aberto), tela
 * (alguém transmitindo). Temas: claro, escuro.
 *
 * Nada aparece para quem usa o computador: o navegador roda sem janela e mudo,
 * e a janela do cliente abre fora da tela, sem foco e sem som
 * (VCALL_NATIVO_FOTO). O vcall-midia fotografa só a janela do cliente.
 *
 * Saída: web.png, nativo.png e lado-a-lado.png (web à esquerda) na pasta.
 * Compile antes: cliente (cargo build --release) e midia/.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, padrao) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const CENA = arg("cena", "chamada");
const TEMA = arg("tema", "escuro");
const SAIDA = path.resolve(arg("saida", path.join(root, "cliente", "fotos", `${CENA}-${TEMA}`)));
mkdirSync(SAIDA, { recursive: true });
const W = 1360,
  H = 860;

const exe = process.platform === "win32" ? ".exe" : "";
const bin = process.env.VCALL_NATIVO_BIN || path.join(process.env.CARGO_TARGET_DIR || path.join(root, "cliente", "target"), "release", `vcall-nativo${exe}`);
const motor = path.join(root, "midia", "target", "release", `vcall-midia${exe}`);
for (const b of [bin, motor]) if (!existsSync(b)) throw new Error(`falta ${b}`);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const PORTA = 3990 + Math.floor(Math.random() * 9);
const servidor = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORTA) }, stdio: "ignore" });
await espera(1500);
const link = `http://127.0.0.1:${PORTA}/#foto-${Date.now().toString(36)}-abcdefghij`;
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"] });
const colorScheme = TEMA === "claro" ? "light" : "dark";
const pagina = async (w = 800, h = 600) => (await browser.newContext({ viewport: { width: w, height: h }, colorScheme, permissions: ["camera", "microphone"] })).newPage();
const entrar = async (p, nome) => {
  await p.goto(link, { waitUntil: "load" });
  await espera(1500);
  await p.fill("#nameInput", nome);
  await p.click("#joinBtn");
  await p.waitForSelector("#dock:not([hidden])");
};
const telaFalsa = (p) =>
  p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const g = c.getContext("2d");
    let i = 0;
    setInterval(() => {
      i++;
      g.fillStyle = "#1d2b53";
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = "#ffcc00";
      g.beginPath();
      g.arc(640 + 400 * Math.cos(i / 15), 360 + 200 * Math.sin(i / 15), 60, 0, 7);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "64px sans-serif";
      g.fillText("Tela do Bruno", 60, 120);
    }, 33);
    const s = c.captureStream(30);
    window.vcall.screen.stream = s;
    window.vcall.screen.videoTrack = s.getVideoTracks()[0];
    window.vcall.screen.emit("change", window.vcall.screen.snapshot());
  });

let nativo;
try {
  // Os outros da sala (não fotografados).
  const outros = [];
  if (["chamada", "chat", "tela"].includes(CENA)) {
    for (const nome of ["Bruno Lima", "Carla Dias"]) {
      const p = await pagina();
      await entrar(p, nome);
      outros.push(p);
    }
    if (CENA === "tela") await telaFalsa(outros[0]);
    await espera(2000);
  }

  /* -- o app web -- */
  const web = await pagina(W, H);
  if (CENA === "saguao") {
    await web.goto(link, { waitUntil: "load" });
    await espera(2500);
  } else {
    await entrar(web, "Ana Souza");
    await espera(4000);
    if (CENA === "chat") {
      for (const p of outros) await p.evaluate((n) => window.vcall.mesh.sendChat(`Oi, aqui é ${n}`), await p.evaluate(() => window.vcall.mesh.self?.name || ""));
      await web.click('[aria-label="Conversa"]');
      await espera(1500);
    }
  }
  await web.screenshot({ path: path.join(SAIDA, "web.png") });
  await web.context().close();
  await espera(1500);

  /* -- o cliente nativo, na mesma cena -- */
  const args = [link, "--teste"];
  if (CENA !== "saguao") args.push("--nome", "Ana Souza", "--ligar", "cam");
  nativo = spawn(bin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, VCALL_NATIVO_FOTO: "1", VCALL_NATIVO_LOG: "1", VCALL_NATIVO_ROTEIRO: "1", VCALL_TEMA: TEMA },
  });
  let log = "";
  nativo.stdout.on("data", (d) => (log += d));
  nativo.stderr.on("data", (d) => (log += d));
  const fim = Date.now() + 15_000;
  while (!/hwnd (\d+)/.test(log) && Date.now() < fim) await espera(200);
  const hwnd = log.match(/hwnd (\d+)/)?.[1];
  if (!hwnd) throw new Error(`o cliente não abriu a janela:\n${log.slice(-800)}`);
  await espera(CENA === "saguao" ? 2500 : 6000);
  if (CENA === "chat") {
    for (const p of outros) await p.evaluate(() => window.vcall.mesh.sendChat("Oi, de novo"));
    nativo.stdin.write("painel conversa\n");
    await espera(1500);
  }
  const h264 = path.join(SAIDA, "nativo.h264");
  const r = spawnSync(motor, ["medir", "--janela", hwnd, "--segundos", "0.6", "--saida", h264], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`o motor não fotografou: ${r.stderr.slice(0, 300)}`);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.2", "-i", h264, "-frames:v", "1", path.join(SAIDA, "nativo.png")]);
  spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", path.join(SAIDA, "web.png"),
    "-i", path.join(SAIDA, "nativo.png"),
    "-filter_complex", `[0]scale=-2:${H}[a];[1]scale=-2:${H}[b];[a][b]hstack`,
    path.join(SAIDA, "lado-a-lado.png"),
  ]);
  console.log(`fotos em ${SAIDA}`);
} finally {
  nativo?.stdin.end();
  await espera(800);
  nativo?.kill();
  await browser.close().catch(() => {});
  servidor.kill();
}
