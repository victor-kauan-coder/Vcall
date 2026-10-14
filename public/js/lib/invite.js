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
/**
 * O convite curto: https://host/c/CODIGO. Com ele o WhatsApp mostra o cartão
 * da chamada (imagem, nome, "toque para entrar") em vez do link comprido.
 * Sem código, ou num endereço que só abre neste computador, fica o /abrir.
 */
export function linkCurto(linkDaSala, codigo) {
  try {
    const url = new URL(linkDaSala);
    if (!/^[A-Z0-9]{4,12}$/i.test(String(codigo || ""))) return linkAbrir(linkDaSala);
    return `${url.origin}/c/${String(codigo).toUpperCase()}`;
  } catch {
    return null;
  }
}

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

/** Pacote do aplicativo Android (android/app/build.gradle, applicationId). */
export const PACOTE_ANDROID = "com.vcall.app";

/**
 * Endereço `intent://` do Chrome no Android: abre o aplicativo Vcall direto
 * na sala; sem o aplicativo instalado, o próprio navegador segue para
 * `linkDaSalaHttp` (S.browser_fallback_url). O app só aceita HTTPS (ou o
 * servidor no próprio aparelho), então link http de rede local fica no
 * navegador.
 */
export function linkIntentAndroid(linkDaSalaHttp) {
  if (!linkDaSalaHttp) return null;
  let url;
  try {
    url = new URL(linkDaSalaHttp);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  const u = encodeURIComponent(linkDaSalaHttp);
  return `intent://join?u=${u}#Intent;scheme=vcall;package=${PACOTE_ANDROID};S.browser_fallback_url=${u};end`;
}

/** Android (celular ou tablet), onde existe o aplicativo Vcall. */
export function ehAndroid(ua = "") {
  return /Android/i.test(ua);
}

/**
 * Abre o WhatsApp com SÓ o link na mensagem. Mensagem que é só um link vira
 * só o cartão (imagem, título, "Toque para entrar" e o domínio), sem o
 * endereço escrito, como um Reels do Instagram. Com texto junto, o WhatsApp
 * mostra o endereço inteiro. O nome da chamada já vai no cartão.
 */
export function linkWhatsApp(link) {
  if (!link) return null;
  return `https://wa.me/?text=${encodeURIComponent(link)}`;
}

/** Celular ou tablet: lá não existe o aplicativo de mesa. */
export function ehCelular(ua = "", toque = false) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (toque && /Macintosh/.test(ua));
}
