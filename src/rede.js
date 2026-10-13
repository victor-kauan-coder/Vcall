/**
 * src/rede.js — endereços que o servidor precisa reconhecer.
 *
 * A mesma regra existe no navegador (public/js/core/stats.js, para mostrar a
 * rota "Tailscale" no painel); o fixes-test confere que as duas concordam.
 */

/**
 * O endereço é da rede Tailscale? O Tailscale dá a cada máquina um IPv4 em
 * 100.64.0.0/10 (a faixa de CGNAT, que ele reserva para si) e um IPv6 em
 * fd7a:115c:a1e0::/48.
 */
export function ehIpTailscale(ip) {
  const s = String(ip || "")
    .trim()
    .replace(/^::ffff:/i, "")
    .replace(/^\[|\]$/g, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(s);
  if (m) return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
  return /^fd7a:115c:a1e0:/i.test(s);
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/**
 * Quem pediu é "da rede"? Vale para salas marcadas "Na minha rede" e para a
 * lista das chamadas dos outros computadores da tailnet.
 *
 *   - a própria máquina (a janela do app, ou quem roda o servidor);
 *   - quem chegou pelo `tailscale serve` desta máquina (127.0.0.1 com o
 *     X-Forwarded-For de um endereço da tailnet), quando `trustTailscale`.
 *
 * Quem chega pelo túnel do Cloudflare (CF-Connecting-IP), por um proxy
 * declarado (TRUST_PROXY) sem endereço da tailnet, ou direto de outro
 * computador NÃO é: para essas pessoas, a sala "Na minha rede" não existe.
 */
export function ehDaRede(req, { trustTailscale = false, trustProxy = false } = {}) {
  const direto = req?.socket?.remoteAddress || "";
  if (!LOOPBACK.test(direto)) return false;
  const h = req.headers || {};
  if (h["cf-connecting-ip"] || h["cf-ray"]) return false;
  const fwd = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].trim() : "";
  if (fwd) return trustTailscale && ehIpTailscale(fwd);
  return !trustProxy;
}
