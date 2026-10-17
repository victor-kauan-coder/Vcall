/**
 * src/ice.js — montagem da configuração de ICE entregue em GET /ice.
 *
 * Três modos, escolhidos automaticamente pelo que estiver no ambiente:
 *
 *   1. Cloudflare Realtime — CF_TURN_KEY_ID + CF_TURN_API_TOKEN.
 *      A chave longa fica aqui; o servidor a troca por credenciais curtas.
 *   2. Segredo compartilhado — TURN_URLS + TURN_SECRET.
 *      O padrão do coturn (`use-auth-secret`): usuário é um carimbo de tempo,
 *      senha é um HMAC-SHA1 desse carimbo com o segredo. Nada de senha fixa.
 *   3. Usuário e senha fixos — TURN_URLS + TURN_USER + TURN_PASS.
 *      Simples, mas o /ice é público: qualquer pessoa que abra a página fica
 *      com a senha e pode usar a sua banda. Bom para testar, ruim em produção.
 *
 * Em todos os casos o cliente recebe só o que precisa e por pouco tempo.
 */
import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { log } from "./logger.js";

const ice = config.ice;

/**
 * Modo em uso, decidido uma vez. A ordem é a de preferência: quem configurou
 * um coturn próprio quer usá-lo, mesmo que também tenha deixado uma chave de
 * provedor no ambiente.
 */
export const turnMode = ice.turnUrls.length && ice.turnSecret
  ? "secret"
  : ice.cfKeyId && ice.cfToken
    ? "cloudflare"
    : ice.apiUrl
      ? "api"
      : ice.turnUrls.length && ice.turnUser
        ? "static"
        : "none";

const base = {
  iceTransportPolicy: ice.transportPolicy,
  // Um basta: com max-bundle só um conjunto de candidatos é usado. Quatro
  // pré-alocavam quatro relays TURN por pessoa, três jogados fora.
  iceCandidatePoolSize: 1,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

/* ------------------------------------------------------------------ *
 * Modo 2 — segredo compartilhado (coturn `use-auth-secret`)
 * ------------------------------------------------------------------ */

/**
 * O formato é o da especificação REST do TURN, que o coturn implementa:
 *   username   = <expiração unix>[:<nome opcional>]
 *   credential = base64(HMAC-SHA1(username, segredo))
 * O servidor TURN recalcula o HMAC e aceita sem consultar banco nenhum.
 */
function secretCredentials() {
  const expires = Math.floor(Date.now() / 1000) + ice.ttl;
  const username = `${expires}:vcall`;
  const credential = createHmac("sha1", ice.turnSecret).update(username).digest("base64");
  return { username, credential };
}

/* ------------------------------------------------------------------ *
 * Modos 1 e 3 — credenciais buscadas num provedor por REST
 * ------------------------------------------------------------------ */

let remoteCache = { at: 0, servers: null };

/** Provedores devolvem ou um array de iceServers, ou um objeto que o contém. */
function normalizeServers(body) {
  const raw = Array.isArray(body) ? body : body?.iceServers || body?.ice_servers || body?.v?.iceServers;
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((s) => s && s.urls);
}

function remoteRequest() {
  if (turnMode === "cloudflare") {
    return {
      url: `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(
        ice.cfKeyId,
      )}/credentials/generate-ice-servers`,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${ice.cfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: ice.ttl }),
      },
      name: "Cloudflare",
    };
  }
  const headers = ice.apiToken ? { Authorization: `Bearer ${ice.apiToken}` } : {};
  return {
    url: ice.apiUrl,
    init: { method: ice.apiMethod, headers },
    name: "provedor de TURN",
  };
}

async function remoteServers() {
  // As credenciais valem horas; pedir uma por participante seria desperdício.
  // Reusamos enquanto restar pelo menos metade da validade.
  const halfLife = (ice.ttl * 1000) / 2;
  if (remoteCache.servers && Date.now() - remoteCache.at < halfLife) return remoteCache.servers;

  const { url, init, name } = remoteRequest();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      log.warn(`${name} recusou a geração de credenciais`, { status: res.status });
      return remoteCache.servers; // pode ser null; o STUN ainda vai junto
    }
    const servers = normalizeServers(await res.json());
    if (servers?.length) remoteCache = { at: Date.now(), servers };
    return servers;
  } catch (err) {
    log.warn(`falha ao falar com o ${name}`, { err: String(err?.name || err) });
    return remoteCache.servers;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Modo do app de mesa — Configurações › Servidor TURN
 *
 * No app instalado não há .env para editar (o servidor vem dentro do pacote).
 * A pessoa escolhe o TURN nas configurações; desktop/main.js guarda em disco
 * e entrega aqui. Vale por cima do ambiente, e pode mudar com o app aberto.
 * ------------------------------------------------------------------ */

let local = null;
let localCache = { chave: "", at: 0, servers: null };

const urlTurn = (u) => typeof u === "string" && u.length <= 256 && /^(turns?|stuns?):[^\s]+$/i.test(u.trim());

/**
 * Confere o que veio das configurações. Devolve a configuração limpa, ou null
 * (desligado ou inválido — nesse caso vale o que estiver no ambiente).
 *
 *   { tipo: "api", url }                      link de provedor (Metered, Xirsys…)
 *   { tipo: "segredo", urls, segredo }        coturn próprio com use-auth-secret
 *   { tipo: "fixo", urls, usuario, senha }    usuário e senha fixos
 */
export function normalizarTurnLocal(c) {
  if (!c || typeof c !== "object") return null;
  const texto = (v, max = 512) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const lista = (v) =>
    (Array.isArray(v) ? v : String(v || "").split(/[,\s]+/))
      .map((u) => String(u).trim())
      .filter(urlTurn)
      .slice(0, 8);
  if (c.tipo === "api") {
    const url = texto(c.url, 1024);
    try {
      if (new URL(url).protocol !== "https:") return null;
    } catch {
      return null;
    }
    return { tipo: "api", url };
  }
  if (c.tipo === "segredo") {
    const urls = lista(c.urls);
    const segredo = texto(c.segredo);
    return urls.length && segredo ? { tipo: "segredo", urls, segredo } : null;
  }
  if (c.tipo === "fixo") {
    const urls = lista(c.urls);
    const usuario = texto(c.usuario, 256);
    const senha = texto(c.senha, 256);
    return urls.length && usuario && senha ? { tipo: "fixo", urls, usuario, senha } : null;
  }
  return null;
}

export function definirTurnLocal(c) {
  local = normalizarTurnLocal(c);
  localCache = { chave: "", at: 0, servers: null };
  return local;
}

async function serversLocais() {
  if (local.tipo === "fixo") return [{ urls: local.urls, username: local.usuario, credential: local.senha }];
  if (local.tipo === "segredo") {
    const username = `${Math.floor(Date.now() / 1000) + ice.ttl}:vcall`;
    return [{ urls: local.urls, username, credential: createHmac("sha1", local.segredo).update(username).digest("base64") }];
  }
  // Link de provedor: mesma regra do modo REST — reusa por metade da validade.
  if (localCache.chave === local.url && localCache.servers && Date.now() - localCache.at < (ice.ttl * 1000) / 2) {
    return localCache.servers;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(local.url, { signal: controller.signal });
    if (!res.ok) {
      log.warn("o provedor de TURN das configurações recusou o pedido", { status: res.status });
      return localCache.servers;
    }
    const servers = normalizeServers(await res.json());
    if (servers?.length) localCache = { chave: local.url, at: Date.now(), servers };
    return servers;
  } catch (err) {
    log.warn("falha ao falar com o provedor de TURN das configurações", { err: String(err?.name || err) });
    return localCache.servers;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Configuração completa para o RTCPeerConnection do cliente.
 * Nunca lança: se o TURN falhar, a chamada ainda tenta pelo STUN.
 */
export async function iceConfiguration() {
  const iceServers = ice.stun.length ? [{ urls: ice.stun }] : [];

  if (local) {
    const servers = await serversLocais();
    if (servers) iceServers.push(...servers);
  } else if (turnMode === "cloudflare" || turnMode === "api") {
    const servers = await remoteServers();
    if (servers) iceServers.push(...servers);
  } else if (turnMode === "secret") {
    iceServers.push({ urls: ice.turnUrls, ...secretCredentials() });
  } else if (turnMode === "static") {
    iceServers.push({
      urls: ice.turnUrls,
      username: ice.turnUser,
      credential: ice.turnPass,
    });
  }

  const hasTurn = iceServers.some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith("turn")),
  );

  return { ...base, iceServers, hasTurn, turnMode: local ? `app:${local.tipo}` : turnMode };
}

/** Uma linha no arranque dizendo o que está configurado. */
export function describeTurn() {
  switch (turnMode) {
    case "cloudflare":
      return "Cloudflare Realtime (credenciais temporárias)";
    case "api":
      return `provedor por REST (${new URL(ice.apiUrl).host})`;
    case "secret":
      return `segredo compartilhado, ${ice.turnUrls.length} endereço(s), validade de ${Math.round(ice.ttl / 3600)}h`;
    case "static":
      return `usuário e senha fixos, ${ice.turnUrls.length} endereço(s) — troque por TURN_SECRET em produção`;
    default:
      return "ausente (só STUN)";
  }
}
