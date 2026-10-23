/**
 * desktop/turn.js — o "Servidor TURN" das configurações do app de mesa.
 *
 * No app instalado o servidor vem dentro do pacote e não há .env para editar.
 * A escolha fica em turn.json, na pasta do app, e vai para src/ice.js, que a
 * entrega no /ice para quem entra na chamada (inclusive pelo link público).
 *
 * Senha e segredo nunca voltam para a página: ela só fica sabendo que existem.
 * Salvar com o campo vazio mantém o que já estava guardado.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { definirTurnLocal, normalizarTurnLocal } from "../src/ice.js";

export function lerTurn(arquivo) {
  try {
    return normalizarTurnLocal(JSON.parse(readFileSync(arquivo, "utf8")));
  } catch {
    return null;
  }
}

/** O que a página pode ver: sem senha nem segredo. */
export function visaoDoTurn(c) {
  if (!c) return { tipo: "nenhum" };
  if (c.tipo === "api") {
    // A chave do provedor vem na própria URL (?apiKey=...): mostra só o endereço.
    const u = new URL(c.url);
    return { tipo: "api", host: u.host, temChave: !!u.search };
  }
  return { tipo: c.tipo, urls: c.urls, usuario: c.usuario || "", temSegredo: !!(c.segredo || c.senha) };
}

/**
 * Junta o pedido da página com o que já estava salvo (campos secretos vazios
 * mantêm o valor antigo), grava, aplica e devolve { ok, turn } ou { erro }.
 */
export function salvarTurn(arquivo, pedido) {
  const antigo = lerTurn(arquivo);
  let novo = null;
  if (pedido.tipo && pedido.tipo !== "nenhum") {
    const mesmo = antigo?.tipo === pedido.tipo ? antigo : {};
    novo = normalizarTurnLocal({
      tipo: pedido.tipo,
      url: pedido.url || mesmo.url,
      urls: pedido.urls || mesmo.urls,
      usuario: pedido.usuario || mesmo.usuario,
      senha: pedido.senha || mesmo.senha,
      segredo: pedido.segredo || mesmo.segredo,
    });
    if (!novo) return { erro: "Confira os dados: o endereço do servidor começa com turn: ou turns:, e o link do provedor com https://." };
  }
  try {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, JSON.stringify(novo || { tipo: "nenhum" }), { mode: 0o600 });
  } catch (err) {
    return { erro: "Não consegui salvar a configuração neste computador." };
  }
  definirTurnLocal(novo);
  return { ok: true, turn: visaoDoTurn(novo) };
}
