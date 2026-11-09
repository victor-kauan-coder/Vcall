/**
 * scripts/fixtures/janela-teste.cjs — uma janela de teste para o motor capturar.
 *
 *   electron scripts/fixtures/janela-teste.cjs [largura] [altura]
 *
 * Abre fora da tela, sem moldura, a cena do banco de medidas
 * (scripts/midia-bench/fonte.html) e escreve "hwnd <número>" na saída. Os
 * testes transmitem SÓ esta janela (`--janela`), nunca a tela de quem roda.
 * Quem abriu a janela a mata no fim (no Electron do Windows o stdin do
 * processo principal dá "end" na hora: não serve de sinal para fechar).
 */
const path = require("node:path");
const { app, BrowserWindow, screen } = require("electron");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const [largura = 1280, altura = 720] = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);

app.whenReady().then(async () => {
  const sf = screen.getPrimaryDisplay().scaleFactor;
  const w = new BrowserWindow({
    x: -Math.round(largura / sf) - 200,
    y: 0,
    width: Math.round(largura / sf),
    height: Math.round(altura / sf),
    useContentSize: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: { backgroundThrottling: false },
  });
  await w.loadFile(path.join(__dirname, "..", "midia-bench", "fonte.html"));
  process.stdout.write(`hwnd ${w.getNativeWindowHandle().readBigUInt64LE()}\n`);
});
