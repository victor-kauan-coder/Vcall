// Electron do banco de medida (scripts/midia-bench.mjs). Abre a janela de
// teste (fonte.html) e a que transmite e recebe (recebe.html). No modo
// nativo sobe o vcall-midia e repassa os quadros por uma MessagePort.
// Mesmas chaves do Chromium e mesma prioridade que o app de mesa usa ao
// transmitir (desktop/main.js), para a comparação ser justa.
const { app, BrowserWindow, ipcMain, MessageChannelMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const MODO = process.env.BENCH_MODO || "chromium";
const QPS = Number(process.env.BENCH_QPS || 60);
const KBPS = Number(process.env.BENCH_KBPS || 14000);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("force-fieldtrials", "WebRTC-FlexFEC-03/Enabled/WebRTC-FlexFEC-03-Advertised/Enabled/");
// A janela de teste continua desenhando mesmo coberta.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (process.env.BENCH_GPU === "1") app.commandLine.appendSwitch("disable-gpu-sandbox");

global.bench = { pronto: false, hwnd: null, pid: null, midia: [], saiu: null };
let filho = null;

app.whenReady().then(async () => {
  const sf = screen.getPrimaryDisplay().scaleFactor;
  const fora = process.env.BENCH_FORA === "1";
  const fonte = new BrowserWindow({
    x: fora ? -Math.round(1920 / sf) - 200 : 0,
    y: 0,
    width: Math.round(1920 / sf),
    height: Math.round(1080 / sf),
    useContentSize: true,
    frame: false,
    resizable: false,
    enableLargerThanScreen: true,
    webPreferences: { backgroundThrottling: false },
  });
  await fonte.loadFile(path.join(__dirname, "fonte.html"));
  const hwnd = fonte.getNativeWindowHandle().readBigUInt64LE().toString();
  global.bench.hwnd = hwnd;

  const area = screen.getPrimaryDisplay().workArea;
  const recebe = new BrowserWindow({
    x: area.x + area.width - 500,
    y: area.y + 20,
    width: 480,
    height: 320,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });

  if (MODO === "nativo") {
    filho = spawn(process.env.BENCH_BIN, ["transmitir", "--sob-demanda", "--janela", hwnd, "--qps", String(QPS), "--kbps", "1000"], { stdio: ["pipe", "pipe", "pipe"] });
    global.bench.pid = filho.pid;
    filho.on("exit", (c) => (global.bench.saiu = c));
    readline.createInterface({ input: filho.stderr }).on("line", (l) => {
      try {
        global.bench.midia.push(JSON.parse(l));
      } catch {
        global.bench.midia.push({ texto: l });
      }
    });
    const { port1, port2 } = new MessageChannelMain();
    ipcMain.once("pronto-para-porta", (e) => e.sender.postMessage("porta", null, [port2]));
    ipcMain.on("midia", (_e, comando) => filho.stdin.write(comando + "\n"));
    // Quadros: 16 bytes de cabeçalho (tamanho, flags, captura em µs) + H.264.
    let acum = Buffer.alloc(0);
    filho.stdout.on("data", (d) => {
      acum = acum.length ? Buffer.concat([acum, d]) : d;
      while (acum.length >= 16) {
        const n = acum.readUInt32LE(0);
        if (acum.length < 16 + n) break;
        // Cópia do tamanho exato: o clone da MessagePort copia o buffer inteiro.
        const dados = new Uint8Array(acum.subarray(16, 16 + n));
        port1.postMessage({ chave: acum[4] === 1, tempo: Number(acum.readBigUInt64LE(8)), dados });
        acum = acum.subarray(16 + n);
      }
    });
    port1.start();
  }

  await recebe.loadFile(path.join(__dirname, "recebe.html"), { query: { modo: MODO, hwnd, qps: String(QPS), kbps: String(KBPS) } });
  const { PRIORITY_HIGH, PRIORITY_ABOVE_NORMAL } = os.constants.priority;
  for (const m of app.getAppMetrics()) {
    try {
      os.setPriority(m.pid, m.type === "Browser" || m.type === "GPU" ? PRIORITY_HIGH : PRIORITY_ABOVE_NORMAL);
    } catch {
      /* já saiu */
    }
  }
  global.bench.pronto = true;
});

app.on("will-quit", () => filho?.kill());
