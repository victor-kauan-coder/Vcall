/**
 * src/convite.js — o link curto do convite (/c/CODIGO) e a prévia dele no
 * WhatsApp, Telegram, iMessage e afins.
 *
 * O convite antigo é /abrir#<id da sala>. O que vem depois do # nunca chega
 * ao servidor, então a prévia era a mesma para toda chamada, com a imagem num
 * caminho relativo (que o WhatsApp ignora): a mensagem mostrava só o link
 * comprido. Agora o convite é /c/<código de 6 letras da sala>: o servidor
 * sabe qual é a chamada e responde a página do convite com
 *   - o nome da chamada e quem chamou no título e na descrição;
 *   - a imagem grande da marca (1200×630) em endereço absoluto;
 *   - o id da sala numa <meta>, de onde a página segue igual ao /abrir.
 *
 * O código é o mesmo que já abre a sala por "Entrar com código"
 * (/api/code/...): o link curto não expõe nada que já não estivesse exposto.
 */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const ROTA_CURTA = /^\/c\/([A-Za-z0-9]{4,12})\/?$/;

/** https://host de onde a pessoa chegou (túnel, Tailscale ou local), ou null. */
export function origemPublica(req) {
  const h = req.headers || {};
  const proto = String(h["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() || (req.socket?.encrypted ? "https" : "http");
  const host = String(h["x-forwarded-host"] || h.host || "").split(",")[0].trim();
  if (!/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host)) return null;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/** As tags da prévia. `sala`: { id, name, host } ou null (chamada encerrada). */
export function previa({ sala, origem, codigo }) {
  const img = origem ? `${origem}/assets/convite.jpg` : "/assets/convite.jpg";
  const quem = sala?.host?.profile?.name ? String(sala.host.profile.name).slice(0, 40) : "";
  const nome = sala?.name ? String(sala.name).slice(0, 60) : "";
  const titulo = !sala ? "Chamada encerrada · Vcall" : nome ? `${nome} · Vcall` : "Entrar na chamada · Vcall";
  const descricao = !sala
    ? "Este convite não está mais ativo. Peça um link novo para quem te chamou."
    : `${quem ? `${quem} te chamou` : "Você foi chamado"} para uma chamada de vídeo criptografada ponta a ponta. Toque para entrar.`;
  const tags = [
    `<title>${esc(titulo)}</title>`,
    `<meta name="description" content="${esc(descricao)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Vcall" />`,
    `<meta property="og:title" content="${esc(titulo)}" />`,
    `<meta property="og:description" content="${esc(descricao)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Vcall" />`,
    origem ? `<meta property="og:url" content="${esc(`${origem}/c/${codigo}`)}" />` : "",
    `<meta name="twitter:card" content="summary_large_image" />`,
    sala ? `<meta name="vcall-sala" content="${esc(sala.id)}" />` : `<meta name="vcall-convite" content="encerrado" />`,
  ];
  return tags.filter(Boolean).join("\n    ");
}

/** A página do convite (abrir.html) com a prévia desta chamada no lugar da genérica. */
export function paginaDoConvite(html, opcoes) {
  const ini = html.indexOf("<!-- prévia:início -->");
  const fim = html.indexOf("<!-- prévia:fim -->");
  if (ini < 0 || fim < 0) return html;
  return html.slice(0, ini) + previa(opcoes) + html.slice(fim + "<!-- prévia:fim -->".length);
}
