/**
 * desktop/tailscale.js — o link da sala pela sua rede Tailscale.
 *
 * O túnel do Cloudflare põe a sala na internet aberta. Quem já usa Tailscale
 * tem algo melhor à mão: uma rede privada entre os próprios computadores, com
 * endereço HTTPS de verdade (`maquina.sua-rede.ts.net`), que só quem está na
 * rede consegue abrir. Este módulo publica o servidor local nesse endereço.
 *
 * Quatro decisões:
 *
 * 1. NADA É INSTALADO NEM BAIXADO. O Tailscale é um programa da pessoa, com a
 *    conta dela. O Vcall só procura o `tailscale` que já existe e conversa com
 *    ele pela linha de comando, como a própria pessoa faria no terminal.
 *
 * 2. `tailscale serve` EM PRIMEIRO PLANO, NUNCA `--bg`. Em primeiro plano a
 *    publicação pertence ao processo: quando ele morre (o Vcall fechou,
 *    travou, o computador desligou), o Tailscale desfaz tudo sozinho. Com
 *    `--bg` um Vcall que caísse deixaria a máquina publicando uma porta que
 *    amanhã pode ser de outro programa.
 *
 * 3. NÃO PISA NO QUE JÁ EXISTE. Se a pessoa já publica algo na 443, o Vcall
 *    usa a 8443 ou a 10000 em vez de substituir a configuração dela.
 *
 * 4. A CONFERÊNCIA NÃO DEPENDE DO DNS DESTA MÁQUINA. O link é testado
 *    conectando direto no IP do Tailscale, com o nome no SNI e no Host — o
 *    mesmo cuidado do túnel. A primeira conexão também é a que faz o
 *    Tailscale emitir o certificado, que pode levar alguns segundos.
 */
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pedirNoIp } from "./tunnel.js";

export { ehIpTailscale } from "../src/rede.js";

/** Portas em que o Tailscale publica HTTPS, em ordem de preferência. */
export const PORTAS_HTTPS = [443, 8443, 10000];

/** Página em que a pessoa liga o HTTPS da rede (o próprio Tailscale imprime). */
const URL_HABILITAR_RE = /https:\/\/login\.tailscale\.com\/\S+/;

/** Quanto esperar a pessoa habilitar o HTTPS na página do Tailscale. */
const PRAZO_HABILITAR_MS = 10 * 60_000;
/** Quanto esperar o `tailscale serve` responder quando nada depende da pessoa. */
const PRAZO_SERVE_MS = 25_000;
/** Quanto esperar o link responder (inclui emitir o certificado). */
const PRAZO_VERIFICAR_MS = 60_000;

/** Onde o Tailscale costuma ficar, por sistema, além do PATH. */
export function candidatos(plataforma = process.platform, env = process.env) {
  if (plataforma === "win32") {
    const pf = [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files"].filter(Boolean);
    return pf.map((p) => path.win32.join(p, "Tailscale", "tailscale.exe"));
  }
  if (plataforma === "darwin") {
    return [
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/opt/homebrew/bin/tailscale",
      "/usr/local/bin/tailscale",
    ];
  }
  return ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale", "/snap/bin/tailscale"];
}

async function ehArquivo(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * O `tailscale` desta máquina, ou null. `VCALL_TAILSCALE` vence tudo (testes,
 * instalações fora do lugar); depois os lugares conhecidos; depois o PATH.
 */
export async function acharTailscale({ env = process.env, plataforma = process.platform, existe = ehArquivo } = {}) {
  if (env.VCALL_TAILSCALE) return (await existe(env.VCALL_TAILSCALE)) ? env.VCALL_TAILSCALE : null;
  for (const p of candidatos(plataforma, env)) if (await existe(p)) return p;
  const nome = plataforma === "win32" ? "tailscale.exe" : "tailscale";
  const sep = plataforma === "win32" ? ";" : ":";
  for (const dir of String(env.PATH || env.Path || "").split(sep).filter(Boolean)) {
    const p = (plataforma === "win32" ? path.win32 : path.posix).join(dir, nome);
    if (await existe(p)) return p;
  }
  return null;
}

/** Roda o CLI e devolve o que ele disse. Nunca lança. */
export function rodar(cli, args, { timeout = 8000 } = {}) {
  return new Promise((ok) => {
    execFile(cli, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      ok({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""), erro: err });
    });
  });
}

/**
 * Lê o `tailscale status --json` e diz se dá para publicar, e por que não.
 * Função pura: é o que os testes exercitam com respostas reais do CLI.
 */
export function lerEstado(st) {
  const nome = String(st?.Self?.DNSName || "").replace(/\.$/, "");
  const ips = (st?.Self?.TailscaleIPs || st?.TailscaleIPs || []).map(String);
  const base = {
    nome,
    ips,
    ipv4: ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null,
    tailnet: st?.CurrentTailnet?.Name || null,
    https: !!nome && (st?.CertDomains || []).includes(nome),
    versao: st?.Version || null,
  };
  switch (st?.BackendState) {
    case "Running":
      if (!nome || st?.CurrentTailnet?.MagicDNSEnabled === false) return { ...base, pronto: false, motivo: "sem-dns" };
      return { ...base, pronto: true, motivo: null };
    case "NeedsLogin":
      return { ...base, pronto: false, motivo: "deslogado" };
    case "NeedsMachineAuth":
      return { ...base, pronto: false, motivo: "aprovacao" };
    case "Stopped":
      return { ...base, pronto: false, motivo: "parado" };
    default:
      return { ...base, pronto: false, motivo: "iniciando" };
  }
}

/** O que dizer para a pessoa, em português, para cada motivo. */
export const MENSAGENS = {
  "nao-instalado": "O Tailscale não está instalado neste computador. Instale em tailscale.com/download e entre na sua conta.",
  "sem-daemon": "O Tailscale está instalado, mas não está aberto. Abra o Tailscale e tente de novo.",
  deslogado: "Entre na sua conta do Tailscale (ícone do Tailscale › Log in) e tente de novo.",
  aprovacao: "Este computador está esperando o administrador da sua rede Tailscale aprovar a entrada.",
  parado: "O Tailscale está desligado. Ligue no ícone do Tailscale e tente de novo.",
  iniciando: "O Tailscale ainda está conectando. Espere alguns segundos e tente de novo.",
  "sem-dns": "Ligue o MagicDNS no painel do Tailscale (DNS › MagicDNS): é ele que dá o nome ao link.",
  operador:
    "No Linux, o Tailscale só deixa o administrador publicar. Rode uma vez no terminal: sudo tailscale set --operator=$USER — e tente de novo.",
};

/** Traduz a saída de um CLI que falhou numa mensagem com o que fazer. */
export function interpretarFalha(texto, plataforma = process.platform) {
  const t = String(texto || "");
  if (/ENOENT|not found|não encontrado/i.test(t) && !/tailscaled/i.test(t)) return MENSAGENS["nao-instalado"];
  if (/failed to connect to local tailscaled|is Tailscale running|tailscaled.*not running|connect: (no such file|connection refused)/i.test(t)) {
    return MENSAGENS["sem-daemon"];
  }
  if (/Logged out|NeedsLogin/i.test(t)) return MENSAGENS.deslogado;
  if (/flag provided but not defined|unknown subcommand|invalid argument|usage: tailscale serve/i.test(t)) {
    return "Este Tailscale é antigo demais para publicar o link. Atualize para a versão 1.52 ou mais nova.";
  }
  if (/serve config denied|Access denied|permission denied/i.test(t)) {
    return plataforma === "linux"
      ? MENSAGENS.operador
      : "O Tailscale recusou a publicação neste usuário. Abra o Tailscale com a sua conta e tente de novo.";
  }
  const linha = t.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return linha ? `O Tailscale respondeu: ${linha.slice(0, 200)}` : "O Tailscale não respondeu.";
}

/**
 * Primeira porta HTTPS livre na configuração de `tailscale serve status --json`.
 * Conta a configuração permanente e as de primeiro plano (outros processos).
 */
export function escolherPorta(cfg, nome) {
  const ocupadas = new Set();
  const olhar = (c) => {
    if (!c || typeof c !== "object") return;
    for (const p of Object.keys(c.TCP || {})) ocupadas.add(Number(p));
    for (const hp of Object.keys(c.Web || {})) {
      const m = /:(\d+)$/.exec(hp);
      if (m && (!nome || hp.startsWith(`${nome}:`))) ocupadas.add(Number(m[1]));
    }
  };
  olhar(cfg);
  for (const fg of Object.values(cfg?.Foreground || {})) olhar(fg);
  return PORTAS_HTTPS.find((p) => !ocupadas.has(p)) ?? null;
}

export function urlDe(nome, porta) {
  return porta === 443 ? `https://${nome}` : `https://${nome}:${porta}`;
}

/**
 * O link da sala pelo Tailscale. Emite "status" {state, url?, habilitar?, error?}:
 *   "conferindo" → "habilitar" (só se o HTTPS da rede estiver desligado)
 *   → "verificando" → "pronto"; ou "erro"; e "parado" ao desligar.
 */
export class LinkTailscale extends EventEmitter {
  proc = null;
  url = null;
  state = "parado";
  habilitar = null;
  erro = null;
  #cancelado = false;

  /**
   * @param {number} portaLocal porta do servidor do Vcall em 127.0.0.1
   * @param {object} [opcoes] tudo o que toca o sistema, trocável nos testes
   * @param {() => Promise<string|null>} [opcoes.achar] onde está o CLI
   * @param {typeof rodar} [opcoes.rodar] comando curto (status)
   * @param {typeof spawn} [opcoes.gerar] processo longo (`tailscale serve`)
   * @param {(url: string, ip: string) => Promise<number>} [opcoes.pedir] teste do link
   */
  constructor(portaLocal, { achar = acharTailscale, rodar: rodarCli = rodar, gerar = spawn, pedir = pedirNoIp, prazoVerificar = PRAZO_VERIFICAR_MS } = {}) {
    super();
    this.portaLocal = portaLocal;
    this.achar = achar;
    this.rodar = rodarCli;
    this.gerar = gerar;
    this.pedir = pedir;
    this.prazoVerificar = prazoVerificar;
  }

  #set(state, extra = {}) {
    this.state = state;
    if (state !== "habilitar") this.habilitar = null;
    this.erro = state === "erro" ? extra.error || null : null;
    this.emit("status", { state, url: this.url, habilitar: this.habilitar, ...extra });
  }

  /** Só olha: o Tailscale está aqui e pronto? (para o Convidar mostrar a opção certa) */
  static async conferir({ achar = acharTailscale, rodar: rodarCli = rodar } = {}) {
    const cli = await achar();
    if (!cli) return { instalado: false, pronto: false, motivo: "nao-instalado", mensagem: MENSAGENS["nao-instalado"] };
    const r = await rodarCli(cli, ["status", "--json"]);
    let st = null;
    try {
      st = JSON.parse(r.stdout);
    } catch {
      /* o CLI respondeu texto: é erro */
    }
    if (!st) return { instalado: true, pronto: false, motivo: "sem-daemon", mensagem: interpretarFalha(r.stderr || r.stdout) };
    const e = lerEstado(st);
    return { instalado: true, ...e, mensagem: e.pronto ? null : MENSAGENS[e.motivo] };
  }

  async start() {
    if (this.proc && this.url) return this.url;
    this.#cancelado = false;
    this.#set("conferindo");
    try {
      const cli = await this.achar();
      if (!cli) throw new Error(MENSAGENS["nao-instalado"]);
      const r = await this.rodar(cli, ["status", "--json"]);
      let st;
      try {
        st = JSON.parse(r.stdout);
      } catch {
        throw new Error(interpretarFalha(r.stderr || r.stdout || r.erro?.message));
      }
      const e = lerEstado(st);
      if (!e.pronto) throw new Error(MENSAGENS[e.motivo]);
      if (!e.ipv4) throw new Error("O Tailscale ainda não deu um endereço a este computador. Espere alguns segundos e tente de novo.");

      const cfg = await this.rodar(cli, ["serve", "status", "--json"]);
      let atual = {};
      try {
        atual = JSON.parse(cfg.stdout || "{}");
      } catch {
        /* versão antiga sem --json: segue com a 443 */
      }
      const porta = escolherPorta(atual, e.nome);
      if (!porta) throw new Error("Outros programas já estão ocupando o Tailscale deste computador (portas 443, 8443 e 10000). Feche-os e tente de novo.");

      await this.#servir(cli, porta);
      this.url = urlDe(e.nome, porta);
      this.#set("verificando");
      const ok = await this.#verificar(e.ipv4);
      if (ok !== true) throw new Error("O link pelo Tailscale não respondeu. Tente de novo em instantes.");
      this.#set("pronto");
      return this.url;
    } catch (err) {
      // Quem desistiu (fechou o link enquanto esperava) não vê "erro".
      if (this.#cancelado) throw new Error("cancelado");
      this.stop({ silencioso: true });
      this.#set("erro", { error: err.message });
      throw err;
    }
  }

  /**
   * Sobe o `tailscale serve` em primeiro plano e espera ele confirmar.
   * Se o HTTPS da rede estiver desligado, o CLI imprime a página para ligar
   * e fica esperando: mostramos o link e esperamos junto.
   */
  #servir(cli, porta) {
    return new Promise((ok, falha) => {
      const proc = this.gerar(cli, ["serve", `--https=${porta}`, `http://127.0.0.1:${this.portaLocal}`], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.proc = proc;
      let saida = "";
      let pronto = false;
      let prazo = setTimeout(() => desistir("o Tailscale não respondeu a tempo"), PRAZO_SERVE_MS);
      const desistir = (motivo) => {
        if (pronto) return;
        pronto = true;
        clearTimeout(prazo);
        try {
          proc.kill();
        } catch {
          /* já saiu */
        }
        falha(new Error(motivo));
      };
      const ler = (buf) => {
        saida += buf.toString();
        if (saida.length > 64_000) saida = saida.slice(-32_000);
        const pagina = URL_HABILITAR_RE.exec(saida)?.[0];
        if (pagina && !pronto && this.state !== "habilitar") {
          this.habilitar = pagina;
          this.#set("habilitar", { habilitar: pagina });
          clearTimeout(prazo);
          prazo = setTimeout(() => desistir("o HTTPS do Tailscale não foi ligado a tempo"), PRAZO_HABILITAR_MS);
        }
        if (!pronto && /Available within your tailnet|Press Ctrl\+C to exit|started and running/i.test(saida)) {
          pronto = true;
          clearTimeout(prazo);
          ok();
        }
      };
      proc.stdout.on("data", ler);
      proc.stderr.on("data", ler);
      proc.on("error", (err) => desistir(interpretarFalha(err.message)));
      proc.on("exit", (code) => {
        if (this.proc === proc) this.proc = null;
        if (!pronto) return desistir(interpretarFalha(saida || `saiu com código ${code}`));
        // Caiu depois de pronto (Tailscale fechado, conta trocada): o link morreu.
        if (this.state === "pronto" || this.state === "verificando") {
          this.url = null;
          this.#set("parado", { motivo: "o Tailscale encerrou a publicação" });
        }
      });
    });
  }

  async #verificar(ip) {
    const fim = Date.now() + this.prazoVerificar;
    let visto = "nada";
    while (Date.now() < fim) {
      if (!this.proc) return "o Tailscale encerrou a publicação";
      try {
        const status = await this.pedir(`${this.url}/healthz`, ip);
        if (status >= 200 && status < 300) return true;
        visto = `HTTP ${status}`;
      } catch (err) {
        visto = String(err?.code || err?.message || err);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return visto;
  }

  stop({ silencioso = false } = {}) {
    if (!silencioso) this.#cancelado = true;
    const proc = this.proc;
    this.proc = null;
    this.url = null;
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* já saiu */
      }
    }
    if (!silencioso) this.#set("parado");
  }
}
