#!/usr/bin/env node
/**
 * scripts/nativo-test.mjs — o cliente nativo (cliente/, GPUI) numa sala de verdade.
 *
 * Sobe o servidor da sala, põe um participante no Chromium e abre o
 * vcall-nativo com o link da mesma sala. Confere, pelos dois lados:
 *
 *   - o navegador vê o cliente nativo entrar, com o nome dele;
 *   - o cliente nativo segue a sala ao vivo (o log dele mostra quem entra,
 *     o estado e quem sai);
 *   - fechar o cliente o tira da sala para o navegador.
 *
 * G2: o WebRTC conecta e o cliente recebe som, câmera e tela do navegador.
 * G3: o navegador recebe o som, a câmera e a tela do cliente — fontes
 * sintéticas (--teste) e uma janela de teste fora da tela
 * (scripts/fixtures/janela-teste.cjs), nunca a tela, a webcam ou o
 * microfone de quem roda. Compile antes:
 *   cd cliente && cargo build --release
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// VCALL_NATIVO_BIN: outro binário com a mesma sinalização (ex.: uma prova sem janela).
// CARGO_TARGET_DIR: a pasta de build curta do Windows (cliente/README.md).
const exe = process.platform === "win32" ? "vcall-nativo.exe" : "vcall-nativo";
const bin = process.env.VCALL_NATIVO_BIN || path.join(process.env.CARGO_TARGET_DIR || path.join(root, "cliente", "target"), "release", exe);
if (!existsSync(bin)) {
  console.error('sem o cliente nativo: rode "cargo build --release" em cliente/');
  process.exit(1);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const check = (nome, ok, detalhe = "") => {
  resultados.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

const PORTA = 3971;
const servidor = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORTA) }, stdio: "ignore" });
await espera(1500);
const sala = `nativo-${Date.now().toString(36)}-abcdefghij`;
const link = `http://127.0.0.1:${PORTA}/#${sala}`;
let browser;
let nativo;
let janela;
try {
  // PW_CANAL=chrome: o Chrome instalado, no lugar do Chromium do Playwright.
  browser = await chromium.launch({ channel: process.env.PW_CANAL || undefined, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"] });
  const web = await (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
  await web.goto(link, { waitUntil: "load" });
  await espera(1500);
  await web.fill("#nameInput", "Web");
  await web.click("#joinBtn");
  await web.waitForSelector("#dock:not([hidden])");

  // G3: a janela que o cliente transmite (só ela) e as fontes sintéticas.
  const extra = [];
  if (!process.env.VCALL_SO_PRESENCA && process.platform === "win32") {
    janela = spawn(createRequire(import.meta.url)("electron"), [path.join(root, "scripts", "fixtures", "janela-teste.cjs"), "1280", "720"], { stdio: ["pipe", "pipe", "ignore"] });
    const hwnd = await new Promise((r) => {
      let saida = "";
      janela.stdout.on("data", (d) => {
        const m = (saida += d).match(/hwnd (\d+)/);
        if (m) r(m[1]);
      });
      setTimeout(() => r(null), 15_000);
    });
    extra.push("--teste", ...(hwnd ? ["--ligar", process.env.NATIVO_LIGAR || "mic,cam,tela", "--tela-janela", hwnd] : ["--ligar", "mic,cam"]));
  }
  nativo = spawn(bin, [link, "--nome", "Cliente GPUI", ...extra], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, VCALL_NATIVO_LOG: "1", VCALL_NATIVO_ROTEIRO: "1", VCALL_NATIVO_FUNDO: "1" } });
  let log = "";
  nativo.stdout.on("data", (d) => (log += d));
  nativo.stderr.on("data", (d) => (log += d));
  nativo.on("exit", (codigo) => (log += `
saiu com ${codigo}
`));
  Object.defineProperty(globalThis, "__logNativo", { get: () => log, configurable: true });

  const viu = await web
    .waitForFunction(() => [...window.vcall.mesh.profiles.values()].some((p) => p?.name === "Cliente GPUI"), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check("o navegador vê o cliente nativo entrar, com o nome dele", viu);

  // O navegador liga e desliga o microfone e a mão: o cliente nativo acompanha.
  await web.evaluate(() => window.vcall.mesh.publishState?.());
  await espera(2500);
  check("o cliente nativo recebeu a sala (welcome, com o navegador dentro)", /welcome .*Web/.test(log), log.split("\n").find((l) => l.startsWith("welcome")) || "sem welcome no log");

  /* -- G2: WebRTC com o navegador, recebendo som, câmera e tela -- */
  if (!process.env.VCALL_SO_PRESENCA) {
    const noLog = (re, ms) => {
      const fim = Date.now() + ms;
      return new Promise((r) => {
        const t = setInterval(() => {
          if (re.test(log) || Date.now() > fim) clearInterval(t), r(re.test(log));
        }, 200);
      });
    };
    const conectou = await noLog(/conexao \S+ Connected/, 25_000);
    const doOutroLado = await web
      .waitForFunction(() => [...window.vcall.mesh.peers.values()].some((p) => p.connectionState === "connected"), null, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const papel = log.match(/^par \S+ (\S+)/m)?.[1] || "?";
    if (process.env.DEBUG_NATIVO) {
      await espera(3000);
      console.log("navegador:", JSON.stringify(await web.evaluate(async () => {
        const p = [...window.vcall.mesh.peers.values()][0];
        const linhas = [];
        for (const t of p.pc.getTransceivers()) {
          let bytes = 0;
          (await t.sender.getStats()).forEach((r) => r.type === "outbound-rtp" && (bytes += r.bytesSent));
          linhas.push({ mid: t.mid, dir: t.direction, atual: t.currentDirection, trilha: t.sender.track?.kind || null, bytes });
        }
        // A linha da tela na descrição do cliente (oferta ou resposta dele).
        const secoes = (p.pc.remoteDescription?.sdp || "").split(/\r?\nm=/);
        const tela = secoes.find((x) => /a=mid:2\r?\n/.test(x)) || "";
        const sdpTela = tela.split(/\r?\n/).filter((l) => /^(video|a=rtpmap|a=fmtp|a=send|a=recv|a=inactive|a=msid)/.test(l)).join(" | ");
        return { polite: p.polite, papeis: Object.keys(p.tx), linhas, sdpTela };
      })));
    }
    check("o WebRTC conecta com o navegador (dos dois lados, pelo protocolo do peer.js)", conectou && doOutroLado, `nativo ${papel}; nativo=${conectou} navegador=${doOutroLado}`);
    check("o cliente nativo recebe a câmera do navegador", await noLog(/quadro \S+ cam \d+x\d+/, 15_000), log.match(/quadro \S+ cam \S+/)?.[0] || "sem quadro de câmera");
    check("o cliente nativo recebe o som do navegador", await noLog(/som \S+ mic/, 10_000));
    // A tela: trilha sintética no lugar do getDisplayMedia (como no e2e.mjs).
    await web.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const g = c.getContext("2d");
      let i = 0;
      setInterval(() => {
        g.fillStyle = ++i % 2 ? "#fd4d87" : "#110c3a";
        g.fillRect(0, 0, 1280, 720);
      }, 40);
      const s = c.captureStream(30);
      window.vcall.screen.stream = s;
      window.vcall.screen.videoTrack = s.getVideoTracks()[0];
      window.vcall.screen.emit("change", window.vcall.screen.snapshot());
    });
    check("o cliente nativo recebe a tela do navegador", await noLog(/quadro \S+ screen 1280x720/, 15_000), log.match(/quadro \S+ screen \S+/)?.[0] || "sem quadro de tela");

    /* -- G3: o navegador recebe o que o cliente manda -- */
    if (janela) {
      // O que chega ao navegador em cada linha do par com o cliente (duas leituras, 2 s entre elas).
      const recebido = () =>
        web.evaluate(async () => {
          const p = [...window.vcall.mesh.peers.values()][0];
          const out = {};
          for (const [papel, t] of Object.entries(p?.tx || {})) {
            const st = await t.receiver.getStats();
            st.forEach((r) => {
              if (r.type !== "inbound-rtp") return;
              const codec = st.get(r.codecId)?.mimeType;
              out[papel] = { bytes: r.bytesReceived, quadros: r.framesDecoded, w: r.frameWidth, h: r.frameHeight, energia: r.totalAudioEnergy, codec };
            });
          }
          const estado = window.vcall.mesh.states.get([...window.vcall.mesh.peers.keys()][0]) || {};
          return { out, estado };
        });
      await espera(4000);
      const a = await recebido();
      await espera(2000);
      const b = await recebido();
      const d = (papel, k) => (b.out[papel]?.[k] ?? 0) - (a.out[papel]?.[k] ?? 0);
      check("o navegador vê o estado do cliente (microfone, câmera e tela ligados)", !!(b.estado.mic && b.estado.cam && b.estado.screen), JSON.stringify(b.estado));
      check("o navegador recebe o microfone do cliente (o tom de teste, com energia)", d("mic", "bytes") > 0 && d("mic", "energia") > 0, `+${d("mic", "bytes")} bytes, energia +${d("mic", "energia").toFixed(3)}`);
      const cam = b.out.cam || {};
      check("o navegador recebe a câmera do cliente (o padrão de teste)", d("cam", "quadros") > 20, `${cam.w}x${cam.h}, +${d("cam", "quadros")} quadros em 2 s, ${cam.codec}`);
      const tela = b.out.screen || {};
      const qps = d("screen", "quadros") / 2;
      check("o navegador recebe a tela do cliente, codificada na placa pelo vcall-midia (H.264)", qps > 20 && /h264/i.test(tela.codec || "") && tela.w >= 1000, `${tela.w}x${tela.h}, ${qps.toFixed(0)} qps, ${tela.codec}`);
    }

    /* -- G4: conversa, reações, mão e o anfitrião -- */
    // O que o navegador recebe do cliente (pelos eventos do mesh, como a interface usa).
    await web.evaluate(() => {
      window.__g4 = { chat: [], reacoes: [], fala: [] };
      window.vcall.mesh.on("speaking", (e) => window.__g4.fala.push(e));
      window.vcall.mesh.on("chat", (m) => window.__g4.chat.push(m.text));
      window.vcall.mesh.on("reaction", (m) => window.__g4.reacoes.push(m.kind));
    });
    const idNativo = await web.evaluate(() => [...window.vcall.mesh.profiles.entries()].find(([, p]) => p?.name === "Cliente GPUI")?.[0]);
    const roteiro = (linha) => nativo.stdin.write(`${linha}\n`);
    const doNavegador = (fn, ms = 8000, arg = null) =>
      web
        .waitForFunction(fn, arg, { timeout: ms })
        .then(() => true)
        .catch(() => false);

    roteiro("chat Olá do cliente nativo, com acentuação: ção, é, ü");
    check("o navegador recebe o chat do cliente (pelo canal de dados, com acentos)", await doNavegador(() => window.__g4.chat.includes("Olá do cliente nativo, com acentuação: ção, é, ü")));
    await web.evaluate(() => window.vcall.mesh.sendChat("Oi do navegador 👋"));
    check("o cliente recebe o chat do navegador", await noLog(/chat de Web: Oi do navegador 👋/, 8000));

    roteiro("reagir clap");
    check("o navegador recebe a reação do cliente", await doNavegador(() => window.__g4.reacoes.includes("clap")));
    await web.evaluate(() => window.vcall.mesh.sendReaction("heart"));
    check("o cliente recebe a reação do navegador", await noLog(/reacao \S+ heart/, 8000));

    const estadoDoNativo = () => web.evaluate((id) => JSON.stringify(window.vcall.mesh.states.get(id) || null), idNativo);
    roteiro("mao");
    const levantou = await doNavegador((id) => window.vcall.mesh.states.get(id)?.hand === true, 8000, idNativo);
    check("o navegador vê a mão levantada do cliente", levantou, await estadoDoNativo());

    // Voz: o tom de teste passa do limiar; o navegador vê o cliente falando.
    const falou = await doNavegador((id) => window.__g4.fala.some((e) => e.id === id && e.speaking && e.via === "p2p"), 8000, idNativo);
    check("o navegador vê o indicador de voz do cliente (falando, pelo canal de voz)", falou);
    // Uma operação de recurso (quadro, jogos...) do navegador chega ao cliente.
    await web.evaluate(() => window.vcall.mesh.broadcastBoard({ type: "teste-nativo", n: 1 }));
    check("o cliente recebe uma operação de recurso pelo canal do quadro", await noLog(/dados de \S+: "teste-nativo"/, 8000));

    // O navegador entrou primeiro: é o anfitrião. Silencia o cliente.
    await web.evaluate((id) => window.vcall.mesh.moderate("mute", id), idNativo);
    const silenciou = await noLog(/moderado mute/, 8000);
    const desligou = await doNavegador((id) => window.vcall.mesh.states.get(id)?.mic === false, 8000, idNativo);
    check("o anfitrião silencia o cliente, e o microfone dele desliga para a sala", silenciou && desligou, `moderado=${silenciou} estado=${await estadoDoNativo()}`);
  }

  await web.close();
  await espera(2500);
  check("o cliente nativo vê o navegador sair", /peer-leave/.test(log));

  // Fechar o cliente: o navegador (outro) deixa de vê-lo.
  const web2 = await (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
  await web2.goto(link, { waitUntil: "load" });
  await espera(1500);
  await web2.fill("#nameInput", "Web 2");
  await web2.click("#joinBtn");
  await web2.waitForSelector("#dock:not([hidden])");
  await web2.waitForFunction(() => [...window.vcall.mesh.profiles.values()].some((p) => p?.name === "Cliente GPUI"), null, { timeout: 15_000 }).catch(() => {});
  // Fechar com educação (a janela, ou a entrada da prova sem janela): o
  // cliente se despede e sai na hora. Matado, o servidor o seguraria 20 s.
  nativo.stdin.end();
  const saiu = await web2
    .waitForFunction(() => ![...window.vcall.mesh.profiles.values()].some((p) => p?.name === "Cliente GPUI"), null, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  check("fechar o cliente nativo o tira da sala na hora (ele se despede)", saiu);
} catch (err) {
  check("o roteiro chegou ao fim", false, String(err?.message || err).split("\n")[0]);
} finally {
  nativo?.kill();
  janela?.kill();
  await browser?.close().catch(() => {});
  servidor.kill();
}
if (process.env.DEBUG_NATIVO) console.log(`
--- log do cliente nativo ---
${globalThis.__logNativo || ""}`);
const falhas = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações do cliente nativo passaram.`);
process.exit(falhas ? 1 : 0);
