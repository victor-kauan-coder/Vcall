/**
 * desktop/rede.js — as chamadas de todos os computadores com Vcall na sua
 * rede Tailscale.
 *
 * Cada Vcall só conhece as próprias salas. Quem sabe quais computadores
 * existem na rede é o Tailscale (`tailscale status --json`, que só o app de
 * mesa consegue rodar); daí este módulo pergunta a cada computador ligado se
 * ele tem um Vcall publicado (`/api/rooms` nas portas em que o Tailscale
 * publica HTTPS) e junta as respostas.
 *
 * Decisões:
 *
 * 1. EM PARALELO E COM PRAZO CURTO. Cada computador é perguntado nas três
 *    portas ao mesmo tempo, com 2,5 s de prazo. Uma rede com 30 aparelhos
 *    (celulares, servidores, a impressora) responde no tempo do mais lento.
 * 2. QUEM NÃO É VCALL FICA DE FORA POR UM TEMPO. Um celular ou um servidor
 *    sem Vcall não é perguntado de novo por 30 s — curto o bastante para um
 *    computador que acabou de ligar o Vcall aparecer logo.
 * 3. A LISTA VELHA SERVE ENQUANTO A NOVA CHEGA. O painel pergunta a cada
 *    poucos segundos; a varredura roda no máximo uma vez a cada 8 s e, se já
 *    há uma resposta, ela volta na hora.
 * 4. O QUE VEM DOS OUTROS É DADO DE FORA. Cada sala recebida é refeita só
 *    com os campos que o painel usa, com tipo e tamanho conferidos.
 */
import https from "node:https";
import { PORTAS_HTTPS, acharTailscale, lerEstado, rodar, urlDe } from "./tailscale.js";

const FRESCA_MS = 8000;
const NAO_VCALL_MS = 30_000;
const PRAZO_MS = 2500;
const ID_SALA = /^[A-Za-z0-9_-]{16,64}$/;

/** Os computadores ligados da tailnet, de `tailscale status --json`. */
export function paresOnline(st) {
  const out = [];
  for (const p of Object.values(st?.Peer || {})) {
    const nome = String(p?.DNSName || "").replace(/\.$/, "");
    const ipv4 = (p?.TailscaleIPs || []).map(String).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    if (!p?.Online || !nome || !ipv4) continue;
    out.push({ nome, curto: String(p.HostName || nome.split(".")[0]).slice(0, 63), ipv4, os: String(p.OS || "").slice(0, 20) });
  }
  return out;
}

/** A resposta é de um Vcall? (`servidor` desde a 3.10; antes, pelo formato.) */
export function pareceVcall(j) {
  if (!j || typeof j !== "object" || !Array.isArray(j.rooms)) return false;
  return j.servidor === "vcall" || (!!j.stats && typeof j.stats === "object" && "publicRooms" in j.stats);
}

const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const inteiro = (v, max) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0);

/** Só o que o painel mostra, com tipo e tamanho conferidos. */
export function limparSala(s) {
  if (!s || typeof s !== "object" || !ID_SALA.test(String(s.id || ""))) return null;
  const av = s.host?.avatar;
  return {
    id: s.id,
    code: texto(s.code, 12),
    name: texto(s.name, 48) || "Sala sem nome",
    visibility: s.visibility === "rede" ? "rede" : "public",
    size: inteiro(s.size, 64),
    max: inteiro(s.max, 64) || 16,
    full: s.full === true,
    locked: s.locked === true,
    sharing: s.sharing === true,
    createdAt: inteiro(s.createdAt, Number.MAX_SAFE_INTEGER),
    host: s.host
      ? {
          name: texto(s.host.name, 40),
          avatar: av && typeof av === "object" ? { style: texto(av.style, 40), seed: texto(av.seed, 64) } : null,
        }
      : null,
  };
}

/** GET de JSON num endereço https, conectando no IP dado (o nome vai no SNI). */
export function pedirJson(url, ip, { prazo = PRAZO_MS } = {}) {
  return new Promise((ok, falha) => {
    const req = https.get(
      url,
      {
        timeout: prazo,
        headers: { accept: "application/json" },
        lookup: (_h, opcoes, cb) => (opcoes?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
      },
      (res) => {
        let corpo = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          corpo += c;
          if (corpo.length > 256 * 1024) req.destroy(new Error("resposta grande demais"));
        });
        res.on("end", () => {
          try {
            ok({ status: res.statusCode || 0, json: JSON.parse(corpo) });
          } catch {
            ok({ status: res.statusCode || 0, json: null });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("sem resposta")));
    req.on("error", falha);
  });
}

export class RedeVcall {
  #cache = null;
  #quando = 0;
  #emCurso = null;
  /** nome -> porta em que o Vcall respondeu da última vez */
  #portas = new Map();
  /** nome -> até quando não perguntar de novo */
  #naoVcall = new Map();

  /**
   * @param {object} [o] o que toca o sistema, trocável nos testes
   * @param {() => object} [o.eu] {url, salas} deste computador
   */
  constructor({ achar = acharTailscale, rodar: rodarCli = rodar, pedir = pedirJson, eu = () => ({ url: null, salas: [] }), agora = Date.now } = {}) {
    this.achar = achar;
    this.rodar = rodarCli;
    this.pedir = pedir;
    this.eu = eu;
    this.agora = agora;
  }

  /** A lista mais recente; se a que existe for velha, outra é buscada. */
  async listar() {
    const velha = this.agora() - this.#quando > FRESCA_MS;
    if (velha && !this.#emCurso) {
      this.#emCurso = this.#varrer()
        .then((d) => {
          this.#cache = d;
          this.#quando = this.agora();
          return d;
        })
        .finally(() => {
          this.#emCurso = null;
        });
    }
    if (this.#cache) return this.#cache;
    return this.#emCurso;
  }

  async #varrer() {
    const cli = await this.achar();
    if (!cli) return { disponivel: false, motivo: "nao-instalado", computadores: [] };
    const r = await this.rodar(cli, ["status", "--json"]);
    let st;
    try {
      st = JSON.parse(r.stdout);
    } catch {
      return { disponivel: false, motivo: "sem-daemon", computadores: [] };
    }
    const e = lerEstado(st);
    if (!e.pronto) return { disponivel: false, motivo: e.motivo, computadores: [] };

    const outros = (await Promise.all(paresOnline(st).map((p) => this.#sondar(p)))).filter(Boolean);
    outros.sort((a, b) => b.salas.length - a.salas.length || a.curto.localeCompare(b.curto));
    const eu = this.eu() || {};
    return {
      disponivel: true,
      tailnet: e.tailnet,
      computadores: [
        { eu: true, nome: e.nome, curto: e.nome.split(".")[0], url: eu.url || null, salas: eu.salas || [] },
        ...outros,
      ],
      atualizado: this.agora(),
    };
  }

  /** Pergunta a um computador, nas três portas ao mesmo tempo, se ele tem Vcall. */
  async #sondar(p) {
    if ((this.#naoVcall.get(p.nome) || 0) > this.agora()) return null;
    const conhecida = this.#portas.get(p.nome);
    const portas = conhecida ? [conhecida, ...PORTAS_HTTPS.filter((x) => x !== conhecida)] : PORTAS_HTTPS;
    const tentativas = portas.map(async (porta) => {
      const { status, json } = await this.pedir(`${urlDe(p.nome, porta)}/api/rooms`, p.ipv4);
      if (status !== 200 || !pareceVcall(json)) throw new Error("não é Vcall");
      return { porta, json };
    });
    try {
      const { porta, json } = await Promise.any(tentativas);
      this.#portas.set(p.nome, porta);
      this.#naoVcall.delete(p.nome);
      return {
        eu: false,
        nome: p.nome,
        curto: p.curto,
        os: p.os,
        url: urlDe(p.nome, porta),
        versao: typeof json.versao === "string" ? json.versao.slice(0, 20) : null,
        salas: json.rooms.slice(0, 50).map(limparSala).filter(Boolean),
      };
    } catch {
      this.#portas.delete(p.nome);
      this.#naoVcall.set(p.nome, this.agora() + NAO_VCALL_MS);
      return null;
    }
  }
}
