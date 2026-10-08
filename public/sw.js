/*
 * public/sw.js — a nossa tela no lugar da página de erro da Cloudflare.
 *
 * Quando o Vcall de quem convidou fecha, o túnel rápido some e quem abre ou
 * recarrega o link recebe a página da própria Cloudflare (530, erro 1033;
 * 502; 524). Este service worker troca essa página por public/erro.html, na
 * paleta da pessoa, que explica o que houve e tenta de novo sozinha.
 *
 * Faz o mínimo de propósito:
 *  - só NAVEGAÇÃO é interceptada; o resto vai direto para a rede;
 *  - guarda apenas os arquivos da tela de erro, sempre rede primeiro (com o
 *    servidor no ar, nada muda e nada fica velho);
 *  - é registrado só em https (convidados pelo túnel), nunca no computador de
 *    quem criou a sala.
 */
const CACHE = "vcall-erro-v1";
const ARQUIVOS = [
  "/erro.html",
  "/js/erro.js",
  "/js/ui/tela-erro.js",
  "/js/ui/ilustracao.js",
  "/js/lib/dom.js",
  "/js/boot-tema.js",
  "/css/tokens.css",
  "/css/paletas.css",
  "/css/base.css",
  "/css/app.css",
  "/css/motion.css",
  "/css/call.css",
  "/assets/illustrations/desconectado.svg",
  "/assets/logo-mark.svg",
  "/assets/favicon-64.png",
  "/vendor/icons.svg",
  "/fonts/bricolage-latin.woff2",
  "/fonts/bricolage-latin-ext.woff2",
];

/** Códigos com que a Cloudflare responde quando o outro lado do túnel sumiu. */
const foraDoAr = (s) => s === 502 || s === 503 || s === 504 || s === 530 || (s >= 520 && s <= 527);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Arquivos da tela de erro: rede primeiro (e o cache acompanha); com o
  // servidor fora do ar, a cópia guardada.
  if (ARQUIVOS.includes(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copia));
            return r;
          }
          return foraDoAr(r.status) ? caches.match(url.pathname).then((g) => g || r) : r;
        })
        .catch(() => caches.match(url.pathname).then((g) => g || Response.error())),
    );
    return;
  }

  if (req.mode !== "navigate") return;
  e.respondWith(
    fetch(req)
      .then((r) => (foraDoAr(r.status) ? paraErro(req.url, r.status) : r))
      .catch(() => paraErro(req.url, 0)),
  );
});

function paraErro(volta, status) {
  const destino = new URL("/erro.html", self.location.origin);
  const tipo = !status ? (self.navigator.onLine === false ? "internet" : "tunel") : status === 504 || status === 524 ? "demora" : "tunel";
  destino.searchParams.set("tipo", tipo);
  if (status) destino.searchParams.set("codigo", String(status));
  destino.searchParams.set("url", volta);
  return Response.redirect(destino.href, 302);
}
