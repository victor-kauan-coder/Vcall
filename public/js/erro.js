/**
 * js/erro.js — monta public/erro.html.
 *
 * Parâmetros: ?tipo=tunel|internet|demora|servidor &codigo=530 &url=<sala>.
 * O jeito de saber se a sala voltou depende de onde a página está:
 *  - no app Android, a página é do próprio APK e pergunta à ponte;
 *  - no app de mesa, ela é do servidor local e pergunta ao processo principal;
 *  - no navegador, quem a trouxe foi o service worker, na MESMA origem da
 *    sala, e um fetch comum responde.
 */
import { montarTelaDeErro, tipoDoCodigo } from "./ui/tela-erro.js";

const p = new URLSearchParams(location.search);
const codigo = p.get("codigo") || "";
const tipo = p.get("tipo") || tipoDoCodigo(codigo, navigator.onLine);
const alvo = seguro(p.get("url"));
const mesmaOrigem = !!alvo && new URL(alvo).origin === location.origin;
const android = window.VcallAndroid;
const desktop = window.vcallDesktop;

// No APK a página não enxerga a paleta escolhida na sala; o app lembra dela.
try {
  const t = JSON.parse(android?.tema?.() || "null");
  if (t?.paleta) document.documentElement.setAttribute("data-paleta", t.paleta);
  if (t?.tema === "dark" || t?.tema === "light") document.documentElement.setAttribute("data-theme", t.tema);
} catch {}

/** Só volta para endereço http(s); qualquer outra coisa vira o início. */
function seguro(url) {
  try {
    const u = new URL(url || "", location.href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * A sala voltou? Na mesma origem (quem trouxe foi o service worker), um fetch
 * comum responde; noutra origem, pergunta a quem pode: o APK ou o app de mesa.
 * Sem nenhum dos dois, não há como saber: o botão só tenta abrir.
 */
function escolherSonda() {
  if (!alvo) return null;
  if (mesmaOrigem) {
    return () => fetch(alvo, { cache: "no-store", credentials: "same-origin" }).then((r) => r.status < 500);
  }
  if (android?.sondar) {
    return () =>
      new Promise((ok) => {
        window.aoSondar = (status) => ok(status > 0 && status < 500);
        android.sondar(alvo);
      });
  }
  if (desktop?.sondar) return () => desktop.sondar(alvo).then((status) => status > 0 && status < 500);
  return null;
}

function entrar() {
  if (!mesmaOrigem && android?.entrar) android.entrar(alvo);
  else location.replace(alvo);
}

function inicio() {
  if (android) android.voltarAoInicio();
  else if (desktop || !alvo) location.href = "/"; // o início do próprio app
  else location.href = new URL("/", alvo).href;
}

document.body.append(
  montarTelaDeErro({
    tipo,
    codigo,
    sondar: escolherSonda(),
    aoTentar: entrar,
    aoVoltar: inicio,
  }),
);
