/**
 * lib/invite.js — os links de convite.
 *
 * O WhatsApp (e quase todo aplicativo de mensagem) só transforma em link
 * clicável o que começa com http:// ou https://. Um `vcall://…` chega como
 * texto morto. Por isso o convite que vai para o WhatsApp é uma página
 * https do próprio Vcall — `/abrir#sala` — que chama o aplicativo e, se ele
 * não estiver instalado, oferece entrar pelo navegador. É o mesmo desenho do
 * Zoom e do Teams.
 *
 * Funções puras: testadas em Node por scripts/fixes-test.mjs.
 */

/** Ids de sala: o mesmo formato que o servidor e o app de mesa aceitam. */
export const ID_SALA = /^[A-Za-z0-9_-]{16,64}$/;

/** Id da sala a partir do fragmento (`#abc…`), ou null se não for válido. */
export function salaDoFragmento(hash) {
  const id = String(hash || "").replace(/^#/, "");
  return ID_SALA.test(id) ? id : null;
}

/**
 * Link de convite "inteligente": mesma origem e mesma sala, na página
 * /abrir. Aceita tanto o link local quanto o público (túnel).
 */
export function linkAbrir(linkDaSala) {
  try {
    const url = new URL(linkDaSala);
    if (!salaDoFragmento(url.hash)) return null;
    url.pathname = "/abrir";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Link direto da sala (sem a página /abrir), para entrar pelo navegador. */
export function linkDaSala(origem, sala) {
  if (!salaDoFragmento(sala)) return null;
  try {
    const url = new URL(origem);
    url.pathname = "/";
    url.search = "";
    url.hash = sala;
    return url.toString();
  } catch {
    return null;
  }
}

/** Endereço `vcall://` que o aplicativo de mesa entende (desktop/protocol.js). */
export function linkDoAplicativo(linkDaSalaHttp) {
  if (!linkDaSalaHttp) return null;
  return `vcall://join?u=${encodeURIComponent(linkDaSalaHttp)}`;
}

/** Mensagem pronta para o WhatsApp, com o link na própria linha. */
export function linkWhatsApp(link, { nomeSala = "" } = {}) {
  if (!link) return null;
  const titulo = nomeSala ? `Entra na chamada “${nomeSala}” no Vcall:` : "Entra na minha chamada no Vcall:";
  return `https://wa.me/?text=${encodeURIComponent(`${titulo}\n${link}`)}`;
}

/** Celular ou tablet: lá não existe o aplicativo de mesa. */
export function ehCelular(ua = "", toque = false) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (toque && /Macintosh/.test(ua));
}
