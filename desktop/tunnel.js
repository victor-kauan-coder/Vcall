/**
 * desktop/tunnel.js — o túnel do Cloudflare, gerenciado pelo aplicativo.
 *
 * O problema que ele resolve: a sala roda na sua máquina, e a sua máquina não
 * tem endereço na internet. O túnel dá um endereço público temporário que
 * aponta de volta para o servidor local — é o que transforma "só funciona aqui"
 * em "mande o link para quem quiser".
 *
 * Três decisões:
 *
 * 1. O BINÁRIO NÃO VAI DENTRO DO EXECUTÁVEL. O cloudflared tem cerca de 30 MB;
 *    embutido, ele triplicaria o tamanho do arquivo que você manda para as
 *    pessoas — e a maioria das chamadas é na rede local, sem túnel nenhum. Ele
 *    é procurado na máquina e, se não houver, baixado da página oficial de
 *    versões do Cloudflare na primeira vez que alguém pedir um link público.
 *
 * 2. O DOWNLOAD É EXPLÍCITO. Nada é baixado ao abrir o app: só quando você
 *    clica em gerar o link. Um programa que busca coisas na internet sozinho,
 *    sem avisar, é exatamente o que não se quer num app de chamada.
 *
 * 3. O ENDEREÇO SAI DA SAÍDA DO PROCESSO. O cloudflared imprime o domínio
 *    sorteado no stderr; não há API para perguntar. A leitura é por expressão
 *    regular mesmo, e há um tempo limite para o caso de ele nunca imprimir.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import https from "node:https";

/** Onde o binário fica guardado depois de baixado. */
const HOME = path.join(os.homedir(), ".vcall");

/** Endereço oficial da última versão, por plataforma. */
const RELEASES = {
  win32: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe",
  },
  darwin: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
  },
  linux: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
  },
};

const exeName = () => (process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

/** Endereço público impresso pelo cloudflared. */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Tempo máximo esperando o endereço aparecer. */
const READY_TIMEOUT_MS = 45_000;
/**
 * Depois que o cloudflared entrega o endereço, quanto esperar o link
 * responder de verdade. O endereço sai antes de a Cloudflare registrar o
 * túnel, e até lá quem abre vê a página de erro dela (530, erro 1033).
 */
const VERIFY_TIMEOUT_MS = 45_000;

async function existe(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Procura o cloudflared, na ordem: ao lado do executável, na pasta do Vcall,
 * e no PATH do sistema. Quem já tem o programa instalado não baixa de novo.
 */
export async function findCloudflared() {
  const nomes = [
    path.join(path.dirname(process.execPath), exeName()),
    path.join(HOME, exeName()),
  ];
  for (const p of nomes) {
    if (await existe(p)) return p;
  }
  // No PATH: deixa o sistema resolver. Só confirma que responde.
  const ok = await new Promise((res) => {
    const p = spawn(exeName(), ["--version"], { stdio: "ignore", shell: false });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  }).catch(() => false);
  return ok ? exeName() : null;
}

/** Baixa o binário oficial, seguindo os redirecionamentos do GitHub. */
function baixar(url, destino, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "vcall" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        baixar(res.headers.location, destino, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`resposta ${res.statusCode} ao baixar o cloudflared`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let lidos = 0;
      const out = createWriteStream(destino);
      res.on("data", (c) => {
        lidos += c.length;
        if (total) onProgress?.(lidos / total);
      });
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve(destino)));
      out.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("tempo esgotado ao baixar")));
  });
}

/**
 * O cloudflared que veio dentro do executável.
 *
 * Ele é embutido comprimido na hora de montar o programa. Descomprimir e
 * gravar uma vez — na primeira vez que alguém pede um link público — é o que
 * elimina o download pela internet, que era a única coisa que este aplicativo
 * ainda ia buscar fora.
 *
 * Fora do executável (rodando o código direto), não há o que extrair: aí o
 * caminho antigo, de baixar, continua valendo.
 */
async function extrairEmbutido(onProgress) {
  let sea;
  try {
    sea = await import("node:sea");
    if (!sea.isSea?.()) return null;
  } catch {
    return null;
  }

  let comprimido;
  try {
    comprimido = sea.getRawAsset("cloudflared.gz");
  } catch {
    return null; // montado sem o binário embutido
  }
  if (!comprimido) return null;

  onProgress?.(0.1);
  const bruto = zlib.gunzipSync(Buffer.from(comprimido));
  const destino = path.join(HOME, exeName());
  const parcial = `${destino}.parcial`;

  await mkdir(HOME, { recursive: true });
  await writeFile(parcial, bruto);
  const { rename } = await import("node:fs/promises");
  await rename(parcial, destino);
  if (process.platform !== "win32") await chmod(destino, 0o755);
  onProgress?.(1);
  return destino;
}

export async function ensureCloudflared(onProgress) {
  const achado = await findCloudflared();
  if (achado) return achado;

  // Antes de sair pela internet: ele já veio junto?
  const embutido = await extrairEmbutido(onProgress).catch(() => null);
  if (embutido) return embutido;

  const url = RELEASES[process.platform]?.[process.arch];
  if (!url) throw new Error(`sem cloudflared pronto para ${process.platform}/${process.arch}`);
  if (url.endsWith(".tgz")) {
    // O pacote do macOS vem compactado e exigiria descompactar aqui dentro.
    // Instalar pelo Homebrew é um comando e não deixa o app mexendo em tar.
    throw new Error("no macOS, instale com: brew install cloudflared");
  }

  await mkdir(HOME, { recursive: true });
  const destino = path.join(HOME, exeName());
  const parcial = `${destino}.parcial`;
  try {
    await baixar(url, parcial, onProgress);
    // Só vira o arquivo final depois de completo: um download interrompido
    // deixaria um binário quebrado que falharia para sempre.
    const { rename } = await import("node:fs/promises");
    await rename(parcial, destino);
    if (process.platform !== "win32") await chmod(destino, 0o755);
    return destino;
  } catch (err) {
    await unlink(parcial).catch(() => {});
    throw err;
  }
}

/**
 * Um túnel vivo. Emite:
 *   "status"  {state, url?, error?}  — "baixando" | "abrindo" | "pronto" | "parado" | "erro"
 *   "log"     linha bruta do cloudflared (útil para diagnóstico)
 */
/**
 * O link público chega até este servidor? Pergunta pelo próprio túnel.
 * Devolve true, ou o que viu por último (para o registro).
 *
 * NÃO usa o DNS do sistema. O cloudflared mostra o endereço antes de o nome
 * existir no DNS da Cloudflare; uma consulta nesse intervalo recebe "não
 * existe", e o Windows guarda essa resposta por vários minutos — o link
 * funcionava para todo mundo e continuava "quebrado" NESTE computador. Aqui o
 * nome é resolvido por DNS sobre HTTPS e a conexão vai direto ao IP; o link
 * só é mostrado quando o nome já existe, e o navegador da pessoa nunca guarda
 * o "não existe".
 */
export async function responde(url, { prazo = VERIFY_TIMEOUT_MS, passo = 1500 } = {}) {
  const fim = Date.now() + prazo;
  const host = new URL(url).hostname;
  let visto = "nada";
  while (Date.now() < fim) {
    try {
      const ip = await resolverDoH(host);
      if (!ip) {
        visto = "o nome ainda não está no DNS";
      } else {
        const status = await pedirNoIp(`${url}/healthz`, ip);
        if (status >= 200 && status < 300) return true;
        visto = `HTTP ${status}`;
      }
    } catch (err) {
      visto = String(err?.code || err?.message || err);
    }
    await new Promise((ok) => setTimeout(ok, passo));
  }
  return visto;
}

/** IPv4 de um nome, pelo DNS sobre HTTPS da Cloudflare (sem cache do sistema). */
async function resolverDoH(host) {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(5000),
  });
  const j = await r.json();
  return (j.Answer || []).find((x) => x.type === 1)?.data || null;
}

/** GET num endereço https, conectando no IP dado (o nome segue no SNI e no Host). */
function pedirNoIp(url, ip) {
  return new Promise((ok, falha) => {
    const req = https.get(
      url,
      {
        timeout: 5000,
        lookup: (_host, opcoes, cb) => (opcoes?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
      },
      (res) => {
        res.resume();
        ok(res.statusCode || 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("sem resposta")));
    req.on("error", falha);
  });
}

export class Tunnel extends EventEmitter {
  proc = null;
  url = null;
  state = "parado";

  constructor(port) {
    super();
    this.port = port;
  }

  #set(state, extra = {}) {
    this.state = state;
    this.emit("status", { state, url: this.url, ...extra });
  }

  async start() {
    if (this.proc) return this.url;

    let bin;
    try {
      this.#set("baixando");
      bin = await ensureCloudflared((p) => this.emit("status", { state: "baixando", progresso: p }));
    } catch (err) {
      this.#set("erro", { error: err.message });
      throw err;
    }

    this.#set("abrindo");
    return new Promise((resolve, reject) => {
      const proc = spawn(
        bin,
        [
          "tunnel",
          "--no-autoupdate",
          "--url",
          `http://127.0.0.1:${this.port}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      this.proc = proc;

      let resolvido = false;
      const prazo = setTimeout(() => {
        if (resolvido) return;
        resolvido = true;
        this.stop();
        const err = new Error("o Cloudflare não respondeu a tempo");
        this.#set("erro", { error: err.message });
        reject(err);
      }, READY_TIMEOUT_MS);

      const ler = (buf) => {
        const texto = String(buf);
        this.emit("log", texto);
        const m = URL_RE.exec(texto);
        if (!m || resolvido) return;
        resolvido = true;
        clearTimeout(prazo);
        this.url = m[0];
        // "Pronto" só quando o link abre de fora: era o "criei a sala e o
        // link não funciona" — o endereço existia, o túnel ainda não.
        this.#set("verificando");
        responde(this.url).then((ok) => {
          if (this.proc !== proc) return reject(new Error("o túnel foi fechado"));
          if (ok !== true) {
            this.stop();
            const err = new Error(`o link do Cloudflare não respondeu (${ok})`);
            this.#set("erro", { error: err.message });
            return reject(err);
          }
          this.#set("pronto");
          resolve(this.url);
        });
      };

      proc.stdout.on("data", ler);
      proc.stderr.on("data", ler);

      proc.on("error", (err) => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(prazo);
        this.proc = null;
        this.#set("erro", { error: err.message });
        reject(err);
      });

      proc.on("exit", (code) => {
        clearTimeout(prazo);
        this.proc = null;
        this.url = null;
        if (!resolvido) {
          resolvido = true;
          const err = new Error(`o cloudflared encerrou (código ${code})`);
          this.#set("erro", { error: err.message });
          reject(err);
          return;
        }
        this.#set("parado");
      });
    });
  }

  /**
   * Derruba o túnel.
   *
   * Mata a ÁRVORE de processos, não só o pai. O cloudflared cria processos
   * filhos, e no Windows `kill()` no pai deixa os filhos órfãos — o túnel
   * continuaria de pé, com o endereço público aceitando quem tivesse o link,
   * depois de a pessoa achar que fechou tudo. Isso é falha de segurança, não
   * desperdício de memória.
   */
  stop() {
    this.url = null;
    const p = this.proc;
    this.proc = null;
    if (!p) {
      this.#set("parado");
      return;
    }

    if (process.platform === "win32" && p.pid) {
      try {
        // /T pega a árvore inteira, /F não pede licença.
        spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        /* cai para o kill comum abaixo */
      }
    }

    try {
      p.kill("SIGTERM");
      // Se ignorar o pedido educado, insiste. Um túnel que não morre é pior
      // do que um processo encerrado à força.
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* já morreu */
        }
      }, 1500).unref?.();
    } catch {
      /* já morreu */
    }
    this.#set("parado");
  }
}
