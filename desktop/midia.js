/**
 * desktop/midia.js — o motor de mídia nativo (midia/, em Rust) no app de mesa.
 *
 * Com "Motor nativo" em Configurações › Transmissão, a tela compartilhada não
 * é codificada pelo Chromium: o vcall-midia captura e codifica na placa de
 * vídeo, e a página põe os quadros prontos no WebRTC (public/js/core/midia.js).
 * Medido num notebook Intel + RTX 2050: 1080p a 56–57 qps contra 1440x806 a
 * 27–30 qps pelo Chromium, e com o processador ocupado 95 ms contra 172–193 ms
 * de vidro a vidro (midia/README.md).
 *
 * Aqui: achar o binário, traduzir a fonte do seletor no alvo do motor, subir o
 * processo e repassar os quadros por uma MessagePort, que a página entrega ao
 * worker do injetor (sem passar pela thread da interface). As decisões ficam
 * em funções puras, sem importar o Electron, para o scripts/fixes-test.mjs
 * testar em Node.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const EXE = "vcall-midia.exe";

/**
 * O binário: ao lado do Vcall.exe no app instalado (extraFiles, como o
 * livekit-server e o cloudflared) ou o compilado em midia/ no desenvolvimento.
 */
export function caminhoDoMotor({ empacotado = false, executavel = process.execPath, plataforma = process.platform, existe = existsSync } = {}) {
  if (plataforma !== "win32") return null;
  const c = empacotado ? path.join(path.dirname(executavel), EXE) : path.join(aqui, "..", "midia", "target", "release", EXE);
  return existe(c) ? c : null;
}

/**
 * O alvo do motor para a fonte que a captura usou (DesktopCapturerSource):
 *   "window:HWND:0"  → --janela HWND
 *   "screen:…"       → --ponto X,Y, o centro da tela em pixels físicos
 *
 * @param {{id: string, display_id?: string}|null} fonte
 * @param {Array<{id: number|string, bounds: {x: number, y: number, width: number, height: number}}>} telas  screen.getAllDisplays()
 * @param {(p: {x: number, y: number}) => {x: number, y: number}} paraFisico  screen.dipToScreenPoint
 * @returns {string[]|null}
 */
export function alvoDaFonte(fonte, telas = [], paraFisico = (p) => p) {
  const id = String(fonte?.id || "");
  const janela = /^window:(\d+):/.exec(id);
  if (janela) return ["--janela", janela[1]];
  if (!id.startsWith("screen:")) return null;
  const tela = telas.find((t) => String(t.id) === String(fonte.display_id)) || (telas.length === 1 ? telas[0] : null);
  if (!tela) return null;
  const b = tela.bounds;
  const p = paraFisico({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
  return ["--ponto", `${Math.round(p.x)},${Math.round(p.y)}`];
}

/** Linha de comando do motor; números de fora da página são limitados. */
export function argumentosDoMotor(alvo, { qps = 60, altura = 1080, kbps = 1000 } = {}) {
  const n = (v, min, max, padrao) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : padrao);
  return ["transmitir", "--sob-demanda", ...alvo, "--qps", String(n(qps, 1, 240, 60)), "--altura", String(n(altura, 144, 2160, 1080)), "--kbps", String(n(kbps, 300, 50_000, 1000))];
}

/** Comandos que a página pode mandar ao motor (o resto é ignorado). */
export const comandoValido = (c) => typeof c === "string" && /^(quadro|chave|kbps \d{3,5})$/.test(c);

/**
 * Os quadros da saída do `vcall-midia transmitir`: 16 bytes de cabeçalho (u32
 * tamanho, u8 flags com o bit 0 = quadro-chave, 3 zeros, u64 captura em µs) e
 * o H.264. O pipe entrega pedaços cortados em qualquer lugar.
 */
export class LeitorDeQuadros {
  #acum = Buffer.alloc(0);

  /** @returns {Array<{chave: boolean, tempo: number, dados: Uint8Array}>} */
  ler(pedaco) {
    this.#acum = this.#acum.length ? Buffer.concat([this.#acum, pedaco]) : pedaco;
    const quadros = [];
    while (this.#acum.length >= 16) {
      const n = this.#acum.readUInt32LE(0);
      if (this.#acum.length < 16 + n) break;
      // Cópia do tamanho exato: a MessagePort clonaria o buffer inteiro do pipe.
      quadros.push({ chave: (this.#acum[4] & 1) === 1, tempo: Number(this.#acum.readBigUInt64LE(8)), dados: new Uint8Array(this.#acum.subarray(16, 16 + n)) });
      this.#acum = this.#acum.subarray(16 + n);
    }
    return quadros;
  }
}

/**
 * Sobe o motor e o liga à `porta` (MessagePortMain do processo principal):
 * por ela saem os quadros, a linha de "pronto", as estatísticas de cada
 * segundo e o fim do processo; da página chegam os comandos.
 *
 * @returns {{filho: import("node:child_process").ChildProcess, pronto: Promise<object>, parar: () => void}}
 */
export function ligarMotor({ exe, args, porta, registrar = () => {}, gerar = spawn }) {
  const filho = gerar(exe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const leitor = new LeitorDeQuadros();
  let resolver;
  let rejeitar;
  const pronto = new Promise((res, rej) => ((resolver = res), (rejeitar = rej)));
  let ultimoErro = "";

  filho.stdout.on("data", (d) => {
    for (const q of leitor.ler(d)) porta.postMessage(q);
  });
  filho.stdin.on("error", () => {}); // o motor saiu: o "exit" avisa
  readline.createInterface({ input: filho.stderr }).on("line", (linha) => {
    let m;
    try {
      m = JSON.parse(linha);
    } catch {
      return;
    }
    if (m.pronto) {
      resolver(m);
      porta.postMessage({ info: m });
    } else if (m.erro) {
      ultimoErro = String(m.erro);
      rejeitar(new Error(ultimoErro));
    } else if (m.aviso) {
      registrar("motor-nativo-aviso", { aviso: String(m.aviso), recriado: m.recriado });
    } else if (m.latencia_ms) {
      porta.postMessage({ estatisticas: m });
    }
  });
  porta.on("message", ({ data }) => {
    if (comandoValido(data) && filho.stdin.writable) filho.stdin.write(`${data}\n`);
  });
  filho.on("error", (err) => rejeitar(err));
  filho.on("exit", (codigo) => {
    rejeitar(new Error(ultimoErro || `o motor saiu (${codigo})`));
    try {
      porta.postMessage({ fim: true, codigo, erro: ultimoErro || null });
      porta.close();
    } catch {
      /* a página já fechou a porta */
    }
  });
  porta.start();
  return {
    filho,
    pronto,
    parar: () => {
      if (filho.exitCode != null) return;
      try {
        filho.stdin.end("parar\n");
      } catch {
        /* já fechado */
      }
      // Sem resposta em 2 s, à força.
      setTimeout(() => filho.exitCode == null && filho.kill(), 2000).unref?.();
    },
  };
}
