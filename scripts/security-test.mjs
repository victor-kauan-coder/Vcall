#!/usr/bin/env node
/**
 * scripts/security-test.mjs — as defesas do servidor de sinalização.
 *
 * Três coisas que só falham em produção, em silêncio, e que ninguém repara
 * olhando o código:
 *
 *   1. a origem do WebSocket — a política de mesma origem do navegador NÃO
 *      vale aqui, então sem esta checagem qualquer site entra nas salas;
 *   2. uma rajada legítima (legendas, traço longo) não pode derrubar ninguém;
 *   3. um abuso sustentado ainda precisa derrubar.
 *
 *   node scripts/security-test.mjs
 */
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createHttpServer } from "../src/http.js";
import { attachSignaling } from "../src/signaling.js";
import { config } from "../src/config.js";

const PORT = 3097;
const server = createHttpServer({});
attachSignaling(server);
await new Promise((r) => server.listen(PORT, r));
const URL_ = `ws://localhost:${PORT}`;

const tenta = (opts) =>
  new Promise((res) => {
    const ws = new WebSocket(URL_, opts);
    ws.on("open", () => (ws.close(), res(true)));
    ws.on("error", () => res(false));
  });

/* -- 1. origem -- */
assert.equal(
  await tenta({ headers: { origin: `http://localhost:${PORT}`, host: `localhost:${PORT}` } }),
  true,
  "a própria página tem de conectar",
);
assert.equal(
  await tenta({ headers: { origin: "https://site-malicioso.example" } }),
  false,
  "outro site NÃO pode abrir um socket nesta sala",
);
assert.equal(await tenta({}), true, "cliente sem Origin (aplicativo desktop) continua entrando");

/* -- 2 e 3. limite de taxa -- */
const ws = new WebSocket(URL_);
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ t: "join", room: "A".repeat(22), profile: { name: "T" }, state: {} }));
await new Promise((r) => setTimeout(r, 200));

const rajada = config.limits.rateBurst * 2;
for (let i = 0; i < rajada; i++) ws.send(JSON.stringify({ t: "ping", n: i }));
await new Promise((r) => setTimeout(r, 500));
assert.equal(ws.readyState, WebSocket.OPEN, `rajada de ${rajada} mensagens não pode derrubar a conexão`);

const abuso = config.limits.rateBurst * 12;
for (let i = 0; i < abuso; i++) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping", n: i }));
await new Promise((r) => setTimeout(r, 700));
assert.notEqual(ws.readyState, WebSocket.OPEN, `abuso de ${abuso} mensagens tem de encerrar a conexão`);

/* -- cabeçalhos -- */
const res = await fetch(`http://localhost:${PORT}/`);
const csp = res.headers.get("content-security-policy") || "";
assert.ok(csp.includes("connect-src 'self'"), "connect-src tem de ser só a própria origem");
assert.ok(!/connect-src[^;]*\bwss?:/.test(csp), "curinga ws:/wss: reabriria a exfiltração por WebSocket");
assert.equal(res.headers.get("x-frame-options"), "DENY");
assert.equal(res.headers.get("strict-transport-security"), null, "sem HSTS em http puro");

server.close();
console.log("✓ segurança: origem do WebSocket, limite de taxa e cabeçalhos");
process.exit(0);
