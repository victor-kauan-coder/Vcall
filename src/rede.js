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
