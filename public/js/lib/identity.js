/**
 * lib/identity.js — os três segredos que o cliente manda ao entrar na sala.
 *
 *   sessão     um por aba, só em memória. Ao reconectar depois de uma queda,
 *              o servidor reconhece a mesma aba e SUBSTITUI a conexão antiga
 *              em vez de somar uma nova. Era isso que deixava a pessoa
 *              duplicada na tela dos outros: o id novo entrava e o velho só
 *              saía quando o servidor percebia a queda, até ~50 s depois.
 *
 *   aparelho   um por navegador, guardado. Serve para que alguém removido pelo
 *              anfitrião não volte só recarregando a página.
 *
 *   anfitrião  um por sala, guardado. Quem cria a sala registra esta chave no
 *              servidor; ao voltar depois de uma queda, a apresenta de novo e
 *              recupera o papel de anfitrião — em vez de ele passar para outro.
 *
 * Nenhum deles identifica a pessoa fora do Vcall nem sai do servidor.
 */
import { prefs } from "./util.js";

/** 128 bits aleatórios em base64url (22 caracteres). */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Esta aba. Não vai para o armazenamento: duas abas nunca compartilham. */
const SESSAO = newToken();
export const sessionToken = () => SESSAO;

export function deviceToken() {
  let d = prefs.get("device", null);
  if (typeof d !== "string" || !TOKEN_RE.test(d)) {
    d = newToken();
    prefs.set("device", d);
  }
  return d;
}

/** Quantas chaves de anfitrião guardar (as salas mais recentes). */
const MAX_CHAVES = 40;

export function hostKeyFor(room) {
  const todas = prefs.get("hostkeys", {}) || {};
  let item = todas[room];
  if (!item || typeof item.k !== "string" || !TOKEN_RE.test(item.k)) {
    item = { k: newToken(), at: Date.now() };
  } else {
    item = { ...item, at: Date.now() };
  }
  todas[room] = item;
  // Poda: só as salas usadas mais recentemente ficam.
  const ordenadas = Object.entries(todas).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
  prefs.set("hostkeys", Object.fromEntries(ordenadas.slice(0, MAX_CHAVES)));
  return item.k;
}
