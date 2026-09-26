#!/usr/bin/env node
/**
 * scripts/fixes-test.mjs — as correções da versão 3.1, sem navegador.
 *
 * Cada bloco prova um problema real que existiu (e o descreve), com um
 * servidor de verdade e clientes WebSocket de verdade. Roda em segundos, em
 * qualquer sistema, e é o primeiro a rodar no CI.
 *
 *   node scripts/fixes-test.mjs
 */
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { WebSocket } from "ws";

import { createHttpServer } from "../src/http.js";
import { attachSignaling } from "../src/signaling.js";
import { parseClientMessage } from "../src/protocol.js";
import { descreverFontes, montarResposta, sessaoWayland, audioDoSistemaSuportado } from "../desktop/captura.js";
import { lerZip, montarTar, zipParaTarGz, nomeDoModelo, responderModelo } from "../desktop/fala.js";
import { destinoDoLink } from "../desktop/protocol.js";
import { linkAbrir, linkDaSala, linkDoAplicativo, linkWhatsApp, salaDoFragmento, ehCelular } from "../public/js/lib/invite.js";
import { createBoardNotice } from "../public/js/features/board-notice.js";

let passou = 0;
const ok = (nome) => {
  passou += 1;
  console.log(`✓ ${nome}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== *
 * Servidor de verdade
 * ================================================================== */

const PORT = 3098;
const server = createHttpServer({});
attachSignaling(server);
await new Promise((r) => server.listen(PORT, r));

/** Cliente de teste: junta as mensagens recebidas e espera por uma delas. */
function cliente() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const msgs = [];
  const fila = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    msgs.push(m);
    for (const f of [...fila]) {
      if (f.pred(m)) {
        fila.splice(fila.indexOf(f), 1);
        f.resolve(m);
      }
    }
  });
  const c = {
    ws,
    msgs,
    fechado: new Promise((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason) }))),
    aberto: new Promise((r, rej) => {
      ws.on("open", r);
      ws.on("error", rej);
    }),
    send: (m) => ws.send(JSON.stringify(m)),
    esperar(pred, ms = 3000) {
      const achado = msgs.find(pred);
      if (achado) return Promise.resolve(achado);
      return new Promise((resolve, reject) => {
        fila.push({ pred, resolve });
        setTimeout(() => reject(new Error("mensagem não chegou")), ms);
      });
    },
    async entrar(room, extra = {}) {
      await c.aberto;
      c.send({ t: "join", room, profile: { name: extra.nome || "T" }, state: {}, ...extra });
      return c.esperar((m) => m.t === "welcome" || m.t === "error" || m.t === "waiting");
    },
  };
  return c;
}
const sala = (n) => `sala-teste-${n}-${Math.random().toString(36).slice(2, 12)}`;
const TOK = (n) => `token-${n}-abcdefghijklmnop`;

/* -- senha da sala: antes NUNCA era conferida (room.hasPass não existia) -- */
{
  const id = sala("senha");
  const dono = cliente();
  const w = await dono.entrar(id, { meta: { name: "Secreta", visibility: "private", pass: "1234" }, pass: "1234" });
  assert.equal(w.t, "welcome", "quem cria com senha entra");

  const intruso = cliente();
  const r = await intruso.entrar(id, { pass: "errada" });
  assert.equal(r.t, "error");
  assert.equal(r.error, "bad-password", "senha errada precisa ser recusada");
  const sem = cliente();
  assert.equal((await sem.entrar(id)).error, "bad-password", "sem senha também é recusado");
  const certo = cliente();
  assert.equal((await certo.entrar(id, { pass: "1234" })).t, "welcome", "com a senha certa entra");
  ok("segurança: a senha da sala é conferida (antes qualquer um entrava)");
  for (const c of [dono, intruso, sem, certo]) c.ws.close();
}

/* -- reconexão: sem participante duplicado -- */
{
  const id = sala("dup");
  const a = cliente();
  await a.entrar(id, { nome: "Ana", session: TOK("a") });
  const b1 = cliente();
  const w1 = await b1.entrar(id, { nome: "Beto", session: TOK("b") });
  await a.esperar((m) => m.t === "peer-join" && m.peer.id === w1.you.id);

  // A conexão do Beto "cai" sem avisar: nada de FIN nem leave — o socket só
  // para de responder (Wi-Fi que troca, notebook que dorme). O servidor
  // continua achando que ele está lá. Ele volta com a mesma sessão.
  b1.ws._socket.pause();
  b1.ws._socket.removeAllListeners("data");
  const b2 = cliente();
  const w2 = await b2.entrar(id, { nome: "Beto", session: TOK("b") });
  const saida = await a.esperar((m) => m.t === "peer-leave" && m.id === w1.you.id, 1500);
  const entrada = await a.esperar((m) => m.t === "peer-join" && m.peer.id === w2.you.id);
  assert.ok(saida, "o id antigo sai na hora, sem esperar o batimento");
  assert.equal(entrada.replaces, w1.you.id, "a entrada diz quem ela substitui");
  assert.equal(w2.peers.length, 1, "quem volta vê só a Ana, e não um fantasma de si mesmo");
  assert.ok(
    a.msgs.indexOf(saida) < a.msgs.indexOf(entrada),
    "a saída do antigo chega ANTES da entrada do novo — nunca os dois na tela",
  );
  // Outra aba (outra sessão) do mesmo Beto não derruba a primeira.
  const b3 = cliente();
  await b3.entrar(id, { nome: "Beto 2", session: TOK("c") });
  await espera(200);
  assert.equal(b2.ws.readyState, WebSocket.OPEN, "sessões diferentes convivem");
  ok("sincronização: quem cai e volta substitui a conexão antiga (sem duplicata)");
  for (const c of [a, b2, b3]) c.ws.close();
}

/* -- moderação: só o anfitrião, conferido no servidor -- */
{
  const id = sala("mod");
  const host = cliente();
  const wh = await host.entrar(id, { nome: "Host", hostKey: TOK("host"), device: TOK("dh") });
  assert.equal(wh.you.host, true, "quem cria é o anfitrião");
  const g = cliente();
  const wg = await g.entrar(id, { nome: "Guest", device: TOK("dg") });
  assert.equal(wg.you.host, false);

  // Convidado tenta moderar: recusado.
  g.send({ t: "moderate", action: "kick", target: wh.you.id });
  const recusa = await g.esperar((m) => m.t === "error" && m.error === "not-host");
  assert.ok(recusa, "convidado não pode remover ninguém");
  assert.equal(host.ws.readyState, WebSocket.OPEN);

  host.send({ t: "moderate", action: "mute", target: wg.you.id });
  assert.equal((await g.esperar((m) => m.t === "moderated")).action, "mute", "silenciar chega ao alvo");

  host.send({ t: "moderate", action: "lower-hand", target: wg.you.id });
  await g.esperar((m) => m.t === "moderated" && m.action === "lower-hand");

  host.send({ t: "moderate", action: "kick", target: wg.you.id });
  await g.esperar((m) => m.t === "moderated" && m.action === "kick");
  const fim = await g.fechado;
  assert.equal(fim.code, 1008);
  assert.equal(fim.reason, "kicked", "o motivo diz ao cliente para não reconectar");

  // Mesmo aparelho, conexão nova: barrado.
  const volta = cliente();
  assert.equal((await volta.entrar(id, { nome: "Guest", device: TOK("dg") })).error, "kicked", "removido não volta pelo mesmo aparelho");
  ok("moderação: silenciar, baixar a mão e remover só pelo anfitrião; removido não volta");

  // O anfitrião cai e volta com a chave: recupera o papel.
  const outro = cliente();
  const wo = await outro.entrar(id, { nome: "Outro" });
  host.ws.terminate();
  await outro.esperar((m) => m.t === "peer-leave" && m.id === wh.you.id, 60_000).catch(() => null);
  const host2 = cliente();
  const wh2 = await host2.entrar(id, { nome: "Host", hostKey: TOK("host") });
  assert.equal(wh2.you.host, true, "a chave de anfitrião devolve o papel");
  await outro.esperar((m) => m.t === "host" && m.id === wh2.you.id);
  const chave = cliente();
  const falsa = await chave.entrar(id, { nome: "Esperto", hostKey: TOK("chute") });
  assert.equal(falsa.you.host, false, "chave errada não promove ninguém");
  ok("moderação: o anfitrião recupera o papel ao voltar; chave falsa não promove");
  void wo;
  for (const c of [host2, outro, chave, volta]) c.ws.close();
}

/* -- sala de espera -- */
{
  const id = sala("espera");
  const host = cliente();
  await host.entrar(id, { nome: "Host", hostKey: TOK("h2") });
  host.send({ t: "moderate", action: "lock" });
  await host.esperar((m) => m.t === "room" && m.closed === true);

  const bia = cliente();
  assert.equal((await bia.entrar(id, { nome: "Bia" })).t, "waiting", "sala trancada põe na espera");
  const batida = await host.esperar((m) => m.t === "knock" && m.name === "Bia");
  bia.send({ t: "chat", text: "posso?" });
  await espera(150);
  assert.ok(!host.msgs.some((m) => m.t === "chat"), "quem espera não fala na sala");

  host.send({ t: "moderate", action: "admit", target: batida.id });
  const w = await bia.esperar((m) => m.t === "welcome");
  assert.equal(w.peers.length, 1, "admitida, entra e vê o anfitrião");

  const caio = cliente();
  await caio.entrar(id, { nome: "Caio" });
  const b2 = await host.esperar((m) => m.t === "knock" && m.name === "Caio");
  host.send({ t: "moderate", action: "deny", target: b2.id });
  assert.equal((await caio.fechado).reason, "room-locked", "recusado sai com motivo definitivo");

  const davi = cliente();
  await davi.entrar(id, { nome: "Davi" });
  await host.esperar((m) => m.t === "knock" && m.name === "Davi");
  host.send({ t: "moderate", action: "unlock" });
  assert.ok(await davi.esperar((m) => m.t === "welcome"), "destrancar deixa entrar quem esperava");
  ok("sala de espera: bate, espera, é admitido ou recusado; destrancar libera");
  for (const c of [host, bia, davi]) c.ws.close();
}

/* -- protocolo -- */
{
  const p = parseClientMessage(JSON.stringify({ t: "moderate", action: "explodir", target: "x" }));
  assert.equal(p.ok, false, "ação desconhecida é recusada");
  const k = parseClientMessage(JSON.stringify({ t: "moderate", action: "kick" }));
  assert.equal(k.ok, false, "remover sem alvo é recusado");
  const j = parseClientMessage(JSON.stringify({ t: "join", room: "A".repeat(22), hostKey: "curta", session: "<script>" }));
  assert.equal(j.msg.hostKey, "", "chave fora do formato vira vazia");
  assert.equal(j.msg.session, "", "sessão fora do formato vira vazia");
  ok("protocolo: moderação e segredos validados na entrada");
}

server.close();

/* ================================================================== *
 * Compartilhar tela no app de mesa (desktop/captura.js)
 * ================================================================== */
{
  const fontes = [
    { id: "screen:1:0", name: "Entire screen" },
    { id: "window:42:0", name: "Planilha — LibreOffice" },
    { id: "window:7:1", name: "Vcall" },
    { id: "window:9:0", name: "" },
  ];
  const lista = descreverFontes(fontes, { propria: "window:7:1" });
  assert.deepEqual(
    lista.map((f) => f.id),
    ["screen:1:0", "window:42:0"],
    "a própria janela e as sem título ficam de fora",
  );
  assert.equal(lista[0].nome, "Tela 1");

  const pedido = { audioRequested: true, videoRequested: true };
  // O bug do Linux: `audio: undefined` presente no objeto.
  const linux = montarResposta({ fontes, escolha: null, pedido, plataforma: "linux" });
  assert.ok(!("audio" in linux), "no Linux a chave audio NÃO pode existir (o Electron recusa undefined)");
  const janela = montarResposta({ fontes, escolha: { id: "window:42:0", audio: false }, pedido, plataforma: "win32" });
  assert.equal(janela.video.id, "window:42:0", "a janela escolhida é a que vai");
  assert.ok(!("audio" in janela), "som só quando pedido");
  const comSom = montarResposta({ fontes, escolha: { id: "screen:1:0", audio: true }, pedido, plataforma: "win32" });
  assert.equal(comSom.audio, "loopback");
  const semPedido = montarResposta({ fontes, escolha: { id: "screen:1:0", audio: true }, pedido: { audioRequested: false }, plataforma: "win32" });
  assert.ok(!("audio" in semPedido), "sem áudio pedido pela página, sem áudio");
  assert.deepEqual(montarResposta({ fontes, escolha: { id: "window:999:0" }, pedido }), {}, "janela fechada: recusa");
  assert.equal(sessaoWayland({ XDG_SESSION_TYPE: "wayland" }), true);
  assert.equal(sessaoWayland({ XDG_SESSION_TYPE: "x11" }), false);
  assert.equal(audioDoSistemaSuportado("linux"), false);
  ok("desktop: escolha de tela/janela, Linux sem audio:undefined, som só quando pedido");
}

/* ================================================================== *
 * Legendas offline (desktop/fala.js)
 * ================================================================== */
{
  // Monta um .zip pequeno à mão (método 0) e confere a conversão.
  const zip = zipSimples([
    ["vosk-model/am/final.mdl", Buffer.from("x".repeat(1000))],
    ["vosk-model/conf/model.conf", Buffer.from("--sample-frequency=16000\n")],
  ]);
  const entradas = lerZip(zip);
  assert.equal(entradas.length, 2);
  const tar = gunzipSync(zipParaTarGz(zip));
  const nomes = lerNomesTar(tar);
  assert.deepEqual(
    nomes,
    ["vosk-model/", "vosk-model/am/", "vosk-model/am/final.mdl", "vosk-model/conf/", "vosk-model/conf/model.conf"],
    "pastas que o .zip não lista entram no .tar antes do conteúdo",
  );
  assert.throws(() => lerZip(zipSimples([["../fora.txt", Buffer.from("x")]])), /suspeito/, "caminho que escapa da pasta é recusado");
  assert.throws(() => montarTar([{ nome: `${"a".repeat(200)}/b`, dados: Buffer.alloc(1), pasta: false }]), /longo/);
  assert.equal(nomeDoModelo("pt-BR"), "pt-BR.tar.gz");
  assert.equal(nomeDoModelo("xx-YY"), "pt-BR.tar.gz", "idioma desconhecido cai no português");
  const r = await responderModelo("/tmp", "vcall-fala://modelo/..%2F..%2Fetc%2Fpasswd");
  assert.equal(r.status, 404, "nada de caminho arbitrário pelo esquema interno");
  ok("legendas: .zip→.tar.gz correto, caminhos maliciosos recusados");
}

/* ================================================================== *
 * Convite pelo WhatsApp (public/js/lib/invite.js)
 * ================================================================== */
{
  const sala = "abcdefghijklmnopqrstuv";
  const publico = `https://exemplo.trycloudflare.com/#${sala}`;
  const convite = linkAbrir(publico);
  assert.equal(convite, `https://exemplo.trycloudflare.com/abrir#${sala}`);
  assert.equal(linkAbrir("https://x.com/#curto"), null, "sem sala válida, sem convite");
  assert.equal(salaDoFragmento(`#${sala}`), sala);
  const direto = linkDaSala("https://exemplo.trycloudflare.com", sala);
  const app = linkDoAplicativo(direto);
  const destino = destinoDoLink(app);
  assert.deepEqual(destino, { tipo: "remoto", url: direto }, "o link vcall:// gerado é aceito pelo app de mesa");
  const wa = linkWhatsApp(convite, { nomeSala: "Reunião" });
  assert.ok(wa.startsWith("https://wa.me/?text="));
  assert.ok(decodeURIComponent(wa).includes(convite), "a mensagem leva o link clicável");
  assert.equal(ehCelular("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), true);
  assert.equal(ehCelular("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  ok("convite: link https clicável no WhatsApp que o app de mesa aceita");
}

/* ================================================================== *
 * Aviso do canvas (public/js/features/board-notice.js)
 * ================================================================== */
{
  const n = createBoardNotice();
  const avisos = [];
  for (let i = 0; i < 40; i++) avisos.push(n.shouldAnnounce({ type: i % 2 ? "stroke-chunk" : "add" }));
  assert.equal(avisos.filter(Boolean).length, 1, "40 operações de desenho = 1 aviso");
  const m = createBoardNotice();
  m.seen();
  assert.equal(m.shouldAnnounce({ type: "add" }), false, "quem já abriu o canvas não é avisado");
  assert.equal(createBoardNotice().shouldAnnounce({ type: "cursor" }), false, "ponteiro não é desenho");
  ok("canvas: 'fulano está desenhando' aparece uma vez, não a cada traço");
}

console.log(`\n${passou} blocos de verificação passaram.`);
process.exit(0);

/* ------------------------------------------------------------------ */

function zipSimples(arquivos) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const [nome, dados] of arquivos) {
    const n = Buffer.from(nome);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(dados.length, 18);
    h.writeUInt32LE(dados.length, 22);
    h.writeUInt16LE(n.length, 26);
    locais.push(h, n, dados);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt32LE(dados.length, 20);
    c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrais.push(c, n);
    offset += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

function lerNomesTar(tar) {
  const nomes = [];
  for (let p = 0; p + 512 <= tar.length; ) {
    const h = tar.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    const base = h.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    const prefixo = h.toString("utf8", 345, 500).replace(/\0.*$/s, "");
    nomes.push(prefixo ? `${prefixo}/${base}` : base);
    const tam = parseInt(h.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
    p += 512 + Math.ceil(tam / 512) * 512;
  }
  return nomes;
}
