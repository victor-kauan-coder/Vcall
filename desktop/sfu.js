/**
 * desktop/sfu.js — o LiveKit (Apache-2.0) rodando no PC de quem transmite.
 *
 * Por que aqui e não num servidor: o usuário não quer datacenter. A subida de
 * casa (medida: ~71 Mbps) aguenta ~16 pessoas em 720p60 se a tela for
 * codificada uma vez só; o que travava a malha era o processador, que
 * codificava uma cópia por pessoa.
 *
 * Quatro decisões:
 *
 * 1. O BINÁRIO VAI JUNTO DO APP. O build (scripts/livekit.mjs) baixa o
 *    release oficial, confere o SHA256 fixado abaixo e o põe ao lado do
 *    executável; o app instalado não baixa nada. Rodando do código-fonte, o
 *    mesmo download acontece na primeira vez, na pasta do Vcall.
 * 2. CHAVE NOVA A CADA VEZ QUE LIGA. Chave e segredo são aleatórios, ficam
 *    neste processo e no arquivo de configuração da pasta do Vcall. As fichas
 *    de entrada valem 6 h.
 * 3. A SINALIZAÇÃO DO LIVEKIT SÓ ESCUTA EM 127.0.0.1. Quem está fora chega
 *    pelo /sfu/ do servidor da sala (src/sfu.js), pelo túnel ou Tailscale. A
 *    mídia vai por UDP direto, com o IP público descoberto por STUN, e o ICE
 *    fura o NAT como a malha já faz.
 * 4. SEM PAUSAR O VÍDEO. Com `allow_pause: false` a imagem só cai de camada
 *    quando falta banda; na fase 0, as pausas e as trocas de camada viravam
 *    travadas de até 3 s.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { baixar, HOME } from "./tunnel.js";

export const VERSAO = "1.13.11";
/** Arquivo e SHA256 de cada plataforma, copiados do checksums.txt do release. */
export const PACOTES = {
  win32: {
    x64: ["livekit_1.13.11_windows_amd64.zip", "5d071ea43339f0140d24a66f0b2ff8a7bf6c4d0dceb19b30abca835670213667"],
    arm64: ["livekit_1.13.11_windows_arm64.zip", "47ebfaa1ef6de546bf17a6699d4d9be59693bd5c3ffbec14d0749bd396ea3875"],
  },
  linux: {
    x64: ["livekit_1.13.11_linux_amd64.tar.gz", "1e9ee90ca301e1842b2887fc77cb122759756a9c8aeb4334ee91de3325ec43fb"],
    arm64: ["livekit_1.13.11_linux_arm64.tar.gz", "2af6ce091d6b3c79d1677f8ff1bbb91a8007f40b2325c059b52d38383c0830b6"],
  },
};
const exe = () => (process.platform === "win32" ? "livekit-server.exe" : "livekit-server");
const tar = () => (process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar");
/** Fichas de entrada valem uma noite de transmissão. */
const FICHA_S = 6 * 3600;

export async function sha256(arquivo) {
  const h = createHash("sha256");
  for await (const pedaco of createReadStream(arquivo)) h.update(pedaco);
  return h.digest("hex");
}

/** Recusa o pacote se o SHA256 não bater com o fixado. */
export async function conferirPacote(arquivo, esperado) {
  const visto = await sha256(arquivo);
  if (visto !== esperado) throw new Error(`pacote do LiveKit com SHA256 inesperado (${visto.slice(0, 12)}…)`);
}

/** O binário pronto na pasta do Vcall; baixa, confere e extrai na primeira vez. */
export async function garantirBinario({ pasta = path.join(HOME, "sfu", VERSAO), onProgress } = {}) {
  const destino = path.join(pasta, exe());
  if (await stat(destino).then((s) => s.isFile(), () => false)) return destino;
  const pacote = PACOTES[process.platform]?.[process.arch];
  if (!pacote) throw new Error(`sem LiveKit pronto para ${process.platform}/${process.arch}`);
  const [nome, sha] = pacote;
  await mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, nome);
  try {
    await baixar(`https://github.com/livekit/livekit/releases/download/v${VERSAO}/${nome}`, arquivo, onProgress);
    await conferirPacote(arquivo, sha);
    // O tar do Windows 10+ (bsdtar, em System32) também abre .zip. Pelo
    // caminho completo: um tar do Git no PATH não abre .zip.
    const parcial = path.join(pasta, "extraindo");
    await rm(parcial, { recursive: true, force: true });
    await mkdir(parcial);
    await new Promise((res, rej) => execFile(tar(), ["-xf", arquivo, "-C", parcial], (e) => (e ? rej(e) : res())));
    await rename(path.join(parcial, exe()), destino);
    await rm(parcial, { recursive: true, force: true });
    return destino;
  } finally {
    await rm(arquivo, { force: true });
  }
}

/** O que veio no instalador, ao lado do executável (electron-builder.yml). */
async function binarioDoPacote() {
  const p = path.join(path.dirname(process.execPath), exe());
  return (await stat(p).then((s) => s.isFile(), () => false)) ? p : null;
}

/** A configuração do LiveKit. Função pura, para o teste conferir as escolhas. */
export function montarConfig({ porta, portaUdp, chave, segredo }) {
  return `port: ${porta}
bind_addresses: ["127.0.0.1"]
rtc:
  udp_port: ${portaUdp}
  tcp_port: 0
  use_external_ip: true
  # A janela do próprio app (quem transmite) está na mesma máquina e não
  # alcança o IP público dela (roteador de casa não faz hairpin): o IP local
  # também vai como candidato.
  advertise_internal_ip: true
  # Roteador de casa costuma não deixar a máquina pingar o próprio IP público.
  skip_external_ip_validation: true
  congestion_control:
    enabled: true
    allow_pause: false
    use_send_side_bwe: true
keys:
  ${chave}: ${segredo}
logging:
  level: warn
`;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
/**
 * Ficha de entrada (JWT HS256, o formato do LiveKit). Quem não publica só
 * assiste: nem tela, nem dados.
 */
export function assinarFicha({ chave, segredo, id, nome, sala, publica, agora = Date.now() }) {
  const s = Math.floor(agora / 1000);
  const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: chave,
    sub: id,
    name: nome,
    nbf: s - 10,
    exp: s + FICHA_S,
    video: { room: sala, roomJoin: true, canSubscribe: true, canPublish: !!publica, canPublishData: false },
  })}`;
  return `${corpo}.${createHmac("sha256", segredo).update(corpo).digest("base64url")}`;
}

/** O nome da sala no LiveKit: o id da sala é o segredo dela e não sai daqui. */
export const salaNoSfu = (id) => createHash("sha256").update(`vcall-sfu:${id}`).digest("hex").slice(0, 32);

function portaLivre(tipo) {
  return new Promise((res, rej) => {
    if (tipo === "udp") {
      const s = dgram.createSocket("udp4");
      s.on("error", rej);
      s.bind(0, () => { const p = s.address().port; s.close(() => res(p)); });
    } else {
      const s = net.createServer();
      s.on("error", rej);
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
    }
  });
}

const responde = (porta) =>
  new Promise((res) => {
    const r = http.get({ host: "127.0.0.1", port: porta, path: "/", timeout: 1000 }, (x) => (x.resume(), res(x.statusCode === 200)));
    r.on("error", () => res(false));
    r.on("timeout", () => (r.destroy(), res(false)));
  });

/**
 * O SFU vivo. Emite "log" (linhas do LiveKit) e "caiu" ({codigo}).
 * `ligar()` pode ser chamado várias vezes: liga uma vez só.
 */
export class Sfu extends EventEmitter {
  porta = null;
  #proc = null;
  #ligando = null;
  #chave = null;
  #segredo = null;

  constructor({ pasta = path.join(HOME, "sfu"), binario = null } = {}) {
    super();
    this.pasta = pasta;
    this.binario = binario;
  }

  ligar() {
    this.#ligando ||= this.#iniciar().catch((e) => {
      this.#ligando = null;
      throw e;
    });
    return this.#ligando;
  }

  async #iniciar() {
    const bin = this.binario || (await binarioDoPacote()) || (await garantirBinario({ pasta: path.join(this.pasta, VERSAO) }));
    const porta = await portaLivre("tcp");
    const portaUdp = await portaLivre("udp");
    this.#chave = `vcall${randomBytes(6).toString("hex")}`;
    this.#segredo = randomBytes(32).toString("hex");
    const conf = path.join(this.pasta, "livekit.yaml");
    await mkdir(this.pasta, { recursive: true });
    await writeFile(conf, montarConfig({ porta, portaUdp, chave: this.#chave, segredo: this.#segredo }), { mode: 0o600 });
    const proc = spawn(bin, ["--config", conf], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.#proc = proc;
    for (const s of [proc.stdout, proc.stderr]) s.on("data", (d) => this.emit("log", String(d)));
    proc.on("exit", (codigo) => {
      if (this.#proc !== proc) return;
      this.#proc = null;
      this.porta = null;
      this.#ligando = null;
      this.emit("caiu", { codigo });
    });
    for (let i = 0; i < 50; i++) {
      if (proc.exitCode != null) throw new Error(`o LiveKit saiu ao ligar (código ${proc.exitCode})`);
      if (await responde(porta)) {
        this.porta = porta;
        return porta;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.parar();
    throw new Error("o LiveKit não respondeu em 10 s");
  }

  ficha(id, nome, sala, publica) {
    if (!this.#chave) throw new Error("SFU desligado");
    return assinarFicha({ chave: this.#chave, segredo: this.#segredo, id, nome, sala: salaNoSfu(sala), publica });
  }

  parar() {
    const p = this.#proc;
    this.#proc = null;
    this.porta = null;
    this.#ligando = null;
    p?.kill();
  }
}
