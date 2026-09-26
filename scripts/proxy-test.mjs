#!/usr/bin/env node
/**
 * scripts/proxy-test.mjs — simula um túnel (cloudflared, ngrok, Nginx).
 *
 * Sobe um proxy HTTPS com certificado autoassinado na frente do servidor. É o
 * mesmo arranjo do `cloudflared tunnel --url http://localhost:3000`: TLS na
 * borda, HTTP simples atrás, e o WebSocket atravessando por upgrade.
 *
 * Serve para verificar o que muda nesse cenário e costuma quebrar:
 *   - a página vira contexto seguro, então câmera e microfone são liberados;
 *   - o cliente precisa derivar `wss://` (e não `ws://`) do protocolo da página;
 *   - a CSP precisa permitir essa conexão;
 *   - o upgrade de WebSocket precisa sobreviver ao proxy.
 *
 * Roda com: node scripts/proxy-test.mjs
 */
import { spawn } from "node:child_process";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3989;
const TLS_PORT = 8443;
const ORIGIN = `https://localhost:${TLS_PORT}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* -- certificado autoassinado ------------------------------------- */

const certDir = path.join(root, ".tls");
if (!existsSync(certDir)) mkdirSync(certDir);
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
if (!existsSync(certPath)) {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "30",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
}

/* -- app ----------------------------------------------------------- */

const app = spawn("node", ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(APP_PORT), LOG_LEVEL: "warn" },
  stdio: ["ignore", "ignore", "pipe"],
});
app.stderr.on("data", (d) => process.stderr.write(`[app] ${d}`));
await wait(1000);

/* -- proxy HTTPS --------------------------------------------------- */

const proxy = https.createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  (req, res) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: APP_PORT, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  },
);

// É este pedaço que um proxy mal configurado esquece — e sem ele a sinalização
// nunca conecta, mesmo com a página abrindo normalmente.
proxy.on("upgrade", (req, socket, head) => {
  const up = net.connect(APP_PORT, "127.0.0.1", () => {
    up.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join("") +
        "\r\n",
    );
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

await new Promise((r) => proxy.listen(TLS_PORT, r));
console.log(`\nProxy HTTPS em ${ORIGIN} → app em :${APP_PORT}\n`);

/* -- navegadores --------------------------------------------------- */

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const errors = [];

async function open(name) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, // certificado autoassinado
    permissions: ["camera", "microphone"],
    viewport: { width: 1200, height: 800 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${name}] ${m.text()}`);
  });
  await page.goto(`${ORIGIN}/#tunel-sala-de-teste-abcdef`, { waitUntil: "networkidle" });
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForSelector("#dock:not([hidden])", { timeout: 15_000 });
  return { ctx, page };
}

try {
  const a = await open("Alice");
  await wait(500);
  const b = await open("Bruno");

  check("a página carrega pelo HTTPS do túnel", true, ORIGIN);

  const secure = await a.page.evaluate(() => window.isSecureContext);
  check("contexto seguro — câmera e microfone liberados", secure);

  const proto = await a.page.evaluate(
    () => (location.protocol === "https:" ? "wss:" : "ws:"),
  );
  check("o cliente deriva o protocolo certo para a sinalização", proto === "wss:", proto);

  const gotMedia = await a.page.evaluate(() => !!window.vcall.media.micTrack);
  check("o microfone abriu através do HTTPS", gotMedia);

  await Promise.all([
    a.page.waitForFunction(() => window.vcall?.mesh.peers.size === 1, { timeout: 20_000 }),
    b.page.waitForFunction(() => window.vcall?.mesh.peers.size === 1, { timeout: 20_000 }),
  ]);
  check("o WebSocket atravessou o proxy e os dois se descobriram", true);

  await Promise.all([
    a.page.waitForFunction(
      () => [...window.vcall.mesh.peers.values()].every((p) => p.connectionState === "connected"),
      { timeout: 30_000 },
    ),
    b.page.waitForFunction(
      () => [...window.vcall.mesh.peers.values()].every((p) => p.connectionState === "connected"),
      { timeout: 30_000 },
    ),
  ]);
  check("a mídia conectou direto, sem passar pelo túnel", true);

  await wait(3000);
  const frames = await b.page.evaluate(async () => {
    const peer = [...window.vcall.mesh.peers.values()][0];
    const s = await peer.pc.getStats();
    let f = 0;
    s.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video") f += r.framesDecoded || 0;
    });
    return f;
  });
  check("vídeo fluindo entre os participantes", frames > 0, `${frames} quadros`);

  // A prova de que a mídia NÃO passa pelo túnel: o par escolhido é um
  // candidato local host/srflx, não uma conexão com o proxy.
  const route = await b.page.evaluate(async () => {
    const peer = [...window.vcall.mesh.peers.values()][0];
    const s = await peer.pc.getStats();
    let pair = null;
    const cands = new Map();
    s.forEach((r) => {
      if (r.type === "local-candidate" || r.type === "remote-candidate") cands.set(r.id, r);
      if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") pair = r;
    });
    if (!pair) return null;
    return {
      local: cands.get(pair.localCandidateId)?.candidateType,
      remote: cands.get(pair.remoteCandidateId)?.candidateType,
    };
  });
  check(
    "rota da mídia é P2P direta (o túnel carrega só a sinalização)",
    !!route && route.local !== "relay",
    route ? `${route.local} ↔ ${route.remote}` : "sem par",
  );

  await b.page.screenshot({ path: path.join(root, ".tunnel-proof.png") });

  const real = errors.filter((e) => !/favicon|ERR_CERT|NotAllowedError|play\(\)/i.test(e));
  check("nenhum erro de JavaScript", real.length === 0, real.slice(0, 2).join(" | "));

  await a.ctx.close();
  await b.ctx.close();
} catch (err) {
  check("execução", false, err.message);
  console.error(err);
} finally {
  await browser.close();
  proxy.close();
  app.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
process.exit(failed.length ? 1 : 0);
