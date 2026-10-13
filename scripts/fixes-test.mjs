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
import { descreverFontes, montarResposta, sessaoWayland, audioDoSistemaSuportado, umPorVez } from "../desktop/captura.js";
import { lerZip, montarTar, zipParaTarGz, nomeDoModelo, responderModelo } from "../desktop/fala.js";
import { destinoDoLink } from "../desktop/protocol.js";
import { linkAbrir, linkDaSala, linkDoAplicativo, linkWhatsApp, salaDoFragmento, ehCelular } from "../public/js/lib/invite.js";
import { createBoardNotice } from "../public/js/features/board-notice.js";
import { argsParaX11, executavelParaRegistrar, modoDeReabrir, namespacesDisponiveis, opcoesDeExibicao, precisaSemSandbox } from "../desktop/linux.js";
import { adaptarEncoder, jaAdaptado } from "../desktop/whisper-curto.js";
import { assinar, confere, nomeNaRelease, sha512DoArquivo } from "../desktop/assinatura.js";
import { maisNova, modoDeInstalacao } from "../desktop/atualizacao.js";
import { tipoDoCodigo } from "../public/js/ui/tela-erro.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync as gravar } from "node:fs";
import { tmpdir } from "node:os";
import { join as juntar } from "node:path";
import { Acordo, limpar, quadrosPara, tokensPara, wer } from "../public/js/features/whisper-nucleo.js";
import { Codigo, Desenho, DuasVerdades, Mimica, QuemSouEu, Quiz, Roda, Stop as StopJogo, valida } from "../public/js/features/festa.js";
import { BOT, Forca, Lig4, Memoria, Sorteios, Velha, resultadoLig4, resultadoVelha } from "../public/js/features/tabuleiro.js";
import { Chuva, Combo, ComboRemoto, DO_ANTIGO, REACOES, SINAIS, Sinais, validar as validarReacao } from "../public/js/features/reacoes.js";
import { BARALHOS, Daily, EstadoJogos, Poker, Retro, compacto, daily, historias, mesaPoker, resultado, retro } from "../public/js/features/jogos.js";
import { LinkTailscale, MENSAGENS, escolherPorta, interpretarFalha, lerEstado, urlDe } from "../desktop/tailscale.js";
import { ehDaRede, ehIpTailscale } from "../src/rede.js";
import { RoomRegistry, Participant } from "../src/rooms.js";
import { normalizeRoomMeta } from "../src/protocol.js";
import { RedeVcall, limparSala, paresOnline, pareceVcall } from "../desktop/rede.js";
import { ehIpTailscale as ehIpTailscaleNavegador } from "../public/js/core/stats.js";
import { clientIp } from "../src/signaling.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

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
function cliente(porta = PORT) {
  const ws = new WebSocket(`ws://localhost:${porta}`);
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
  const antes = a.msgs.length;
  const b2 = cliente();
  const w2 = await b2.entrar(id, { nome: "Beto 2", session: TOK("b") });
  // Para a Ana ele nunca saiu: mesmo id, nada de saída e entrada (que
  // derrubariam a conexão direta e o áudio e o vídeo dele).
  assert.equal(w2.you.id, w1.you.id, "quem volta pela mesma aba mantém o id");
  const perfil = await a.esperar((m) => m.t === "profile" && m.id === w1.you.id);
  assert.equal(perfil.name, "Beto 2", "o nome novo chega aos outros");
  await espera(150);
  assert.ok(!a.msgs.slice(antes).some((m) => m.t === "peer-leave" || m.t === "peer-join"), "nenhum aviso de saída ou de entrada");
  assert.equal(w2.peers.length, 1, "quem volta vê só a Ana, e não um fantasma de si mesmo");
  // Outra aba (outra sessão) do mesmo Beto não derruba a primeira.
  const b3 = cliente();
  await b3.entrar(id, { nome: "Beto 2", session: TOK("c") });
  await espera(200);
  assert.equal(b2.ws.readyState, WebSocket.OPEN, "sessões diferentes convivem");
  ok("sincronização: quem cai e volta mantém o id e a conexão direta (sem duplicata)");
  for (const c of [a, b2, b3]) c.ws.close();
}

/* -- queda sem aviso: a saída espera a mesma aba voltar; sair pelo botão é na hora -- */
{
  const PORTA2 = PORT - 1;
  const srv = createHttpServer({});
  attachSignaling(srv, { graca: 400 });
  await new Promise((r) => srv.listen(PORTA2, r));
  const id = sala("graca");
  const a = cliente(PORTA2);
  await a.entrar(id, { nome: "Ana", session: TOK("a") });

  const b = cliente(PORTA2);
  const wb = await b.entrar(id, { nome: "Beto", session: TOK("b") });
  b.ws.terminate(); // queda de rede: sem leave, sem código 1000
  await espera(150);
  assert.ok(!a.msgs.some((m) => m.t === "peer-leave"), "não some na primeira oscilação");
  const saiu = await a.esperar((m) => m.t === "peer-leave" && m.id === wb.you.id, 2000);
  assert.ok(saiu, "não voltou a tempo: a saída é anunciada");

  const c = cliente(PORTA2);
  const wc = await c.entrar(id, { nome: "Caio", session: TOK("c") });
  c.send({ t: "leave" });
  const t0 = Date.now();
  await a.esperar((m) => m.t === "peer-leave" && m.id === wc.you.id, 300);
  assert.ok(Date.now() - t0 < 300, "quem sai pelo botão sai na hora");
  ok("sincronização: queda espera a volta antes de virar saída; o botão Sair é imediato");
  a.ws.close();
  srv.close();
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

  // Readmitir: o anfitrião vê a lista (sem o id do aparelho) e deixa voltar.
  const lista = await host.esperar((m) => m.t === "banned" && m.list.length === 1);
  assert.equal(lista.list[0].name, "Guest");
  assert.ok(!JSON.stringify(lista).includes(TOK("dg")), "o anfitrião não vê o identificador do aparelho");
  const intruso = cliente();
  await intruso.entrar(id, { nome: "Intruso" });
  intruso.send({ t: "moderate", action: "unban", target: lista.list[0].id });
  assert.ok(await intruso.esperar((m) => m.t === "error" && m.error === "not-host"), "só o anfitrião readmite");
  host.send({ t: "moderate", action: "unban", target: lista.list[0].id });
  const depois = await host.esperar((m) => m.t === "banned" && m.readmitted === "Guest");
  assert.equal(depois.list.length, 0);
  const voltou = cliente();
  assert.ok((await voltou.entrar(id, { nome: "Guest", device: TOK("dg") })).you, "readmitido entra pelo mesmo aparelho");
  voltou.ws.close();
  intruso.ws.close();
  ok("moderação: o anfitrião deixa voltar quem removeu (e só ele)");

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

/* -- CF-Connecting-IP: só quando ligado (app de mesa / TRUST_CLOUDFLARE) -- */
{
  // Com a opção desligada (padrão do servidor), forjar o cabeçalho não
  // escapa do limite de conexões por endereço.
  const { config } = await import("../src/config.js");
  const limite = config.limits.maxSocketsPerIp;
  const abertos = [];
  let recusados = 0;
  for (let i = 0; i < limite + 3; i++) {
    const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { "cf-connecting-ip": `203.0.113.${i + 1}` } });
    const r = await new Promise((res) => {
      ws.on("open", () => res(true));
      ws.on("error", () => res(false));
    });
    if (r) abertos.push(ws);
    else recusados += 1;
  }
  assert.ok(recusados >= 3, "cabeçalho forjado não pode furar o limite por endereço");
  for (const ws of abertos) ws.close();
  ok("segurança: CF-Connecting-IP forjado não fura o limite de conexões");
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

  // O app caía no Linux com dois pedidos de captura ao mesmo tempo (duas
  // sessões do portal no mesmo PipeWire): agora é um por vez, com prazo.
  let t = 0;
  const fila = umPorVez(1000, () => t);
  const a = fila.pegar();
  assert.ok(a !== null, "o primeiro pedido passa");
  assert.equal(fila.pegar(), null, "o segundo, no meio do primeiro, é recusado");
  fila.soltar(a);
  const b = fila.pegar();
  assert.ok(b !== null, "depois de responder, a vez volta");
  t = 1500;
  const c = fila.pegar();
  assert.ok(c !== null, "portal que nunca respondeu não prende a vez para sempre");
  fila.soltar(b);
  assert.equal(fila.pegar(), null, "a vez vencida, ao soltar atrasada, não libera a vez nova");
  ok("desktop: um pedido de captura por vez, com prazo");
}

/* ================================================================== *
 * Atualização automática (desktop/assinatura.js, desktop/atualizacao.js)
 * ================================================================== */
{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const chavePrivada = privateKey.export({ type: "pkcs8", format: "pem" });
  const chavePublica = publicKey.export({ type: "spki", format: "pem" });
  const pasta = mkdtempSync(juntar(tmpdir(), "vcall-assina-"));
  const arquivo = juntar(pasta, "VcallSetup-3.7.0.exe");
  gravar(arquivo, Buffer.from("instalador de mentira"));
  const sha512 = await sha512DoArquivo(arquivo);
  const assinatura = assinar({ versao: "3.7.0", sha512, chavePrivada });

  assert.equal(confere({ versao: "3.7.0", sha512, assinatura, chavePublica }), true, "o pacote assinado por nós passa");
  assert.equal(confere({ versao: "v3.7.0", sha512, assinatura, chavePublica }), true, "a tag com v na frente é a mesma versão");
  gravar(arquivo, Buffer.from("instalador trocado no caminho"));
  const outro = await sha512DoArquivo(arquivo);
  assert.equal(confere({ versao: "3.7.0", sha512: outro, assinatura, chavePublica }), false, "arquivo trocado: recusa");
  assert.equal(confere({ versao: "3.8.0", sha512, assinatura, chavePublica }), false, "instalador antigo fingindo ser versão nova: recusa");
  const intrusa = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal(confere({ versao: "3.7.0", sha512, assinatura: assinar({ versao: "3.7.0", sha512, chavePrivada: intrusa }), chavePublica }), false, "assinado por outra chave: recusa");
  assert.equal(confere({ versao: "3.7.0", sha512, assinatura: "lixo", chavePublica }), false, "assinatura malformada: recusa, sem exceção");
  assert.equal(confere({ versao: "3.7.0", sha512, assinatura: "", chavePublica }), false, "sem assinatura: recusa");

  const nomes = ["Vcall-3.7.0-x86_64.AppImage", "Vcall-3.7.0-amd64.deb", "Vcall-3.7.0-x86_64.rpm", "Vcall-3.7.0-x64.pacman"];
  assert.equal(nomeNaRelease(nomes, "Vcall-3.7.0-amd64.deb"), "Vcall-3.7.0-amd64.deb");
  assert.equal(nomeNaRelease(nomes, "update.rpm"), "Vcall-3.7.0-x86_64.rpm", "nome diferente no disco: acha pela extensão");
  assert.equal(nomeNaRelease(nomes, "algo.zip"), null);

  assert.equal(modoDeInstalacao({ plataforma: "win32", empacotado: true }), "sozinho");
  assert.equal(modoDeInstalacao({ plataforma: "linux", empacotado: true, appImage: true }), "sozinho");
  assert.equal(modoDeInstalacao({ plataforma: "linux", empacotado: true, tipoPacote: "deb\n" }), "senha", "Ubuntu/Fedora: o sistema pede a senha");
  assert.equal(modoDeInstalacao({ plataforma: "linux", empacotado: true, tipoPacote: "rpm" }), "senha");
  assert.equal(modoDeInstalacao({ plataforma: "linux", empacotado: true, tipoPacote: "pacman" }), "manual", "pacman fora do latest-linux.yml: só avisa");
  assert.equal(modoDeInstalacao({ plataforma: "linux", empacotado: true }), "manual", ".tar.gz: só avisa");
  assert.equal(modoDeInstalacao({ plataforma: "win32", empacotado: false }), "manual", "rodando do código-fonte: só avisa");
  assert.equal(maisNova("v3.10.0", "3.9.0"), true, "3.10 é mais nova que 3.9");
  assert.equal(maisNova("3.7.0", "3.7.0"), false);
  ok("atualização: só instala o que foi assinado por nós, na versão certa; modo por tipo de instalação");
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

/* ================================================================== *
 * Linux: Fedora, Arch, Ubuntu… (desktop/linux.js)
 * ================================================================== */
{
  const proc = (valores) => (caminho) => {
    if (caminho in valores) return valores[caminho];
    throw new Error("ENOENT");
  };
  const ubuntu2404 = proc({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1\n" });
  const fedora = proc({ "/proc/sys/user/max_user_namespaces": "63432\n" });
  const arch = proc({});
  const debianAntigo = proc({ "/proc/sys/kernel/unprivileged_userns_clone": "0" });
  assert.equal(namespacesDisponiveis(fedora), true);
  assert.equal(namespacesDisponiveis(arch), true, "sem os arquivos de restrição, está liberado");
  assert.equal(namespacesDisponiveis(ubuntu2404), false);
  assert.equal(namespacesDisponiveis(debianAntigo), false);

  const appimage = { APPIMAGE: "/home/ana/Vcall-3.1.0-x86_64.AppImage" };
  assert.equal(precisaSemSandbox({ plataforma: "linux", env: appimage, ler: ubuntu2404 }), true, "AppImage no Ubuntu 24.04: só assim abre");
  assert.equal(precisaSemSandbox({ plataforma: "linux", env: appimage, ler: fedora }), false, "no Fedora o sandbox continua ligado");
  assert.equal(precisaSemSandbox({ plataforma: "linux", env: {}, ler: ubuntu2404 }), false, "pacote .deb: nunca desliga");
  // Electron 38+ abre como Wayland nativo, e lá a janela não se posiciona:
  // com XWayland disponível, o Vcall reabre por ele. A opção vai na linha de
  // comando de verdade (via appendSwitch ela só chegava à GPU, e o app não
  // abria no Fedora). GTK 3 sempre.
  const argv = ["/opt/Vcall/vcall", "vcall://sala/abc"];
  const x11 = (env, a = argv) => argsParaX11({ plataforma: "linux", env, argv: a });
  assert.deepEqual(x11({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }), ["vcall://sala/abc", "--ozone-platform=x11"], "Fedora/Ubuntu GNOME: reabre pelo XWayland, com o link");
  assert.equal(x11({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }, [...argv, "--ozone-platform=x11"]), null, "já reaberto: não entra em laço");
  assert.equal(x11({ XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" }, [...argv, "--ozone-platform=wayland"]), null, "escolha da pessoa vale");
  assert.equal(x11({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }), null, "Wayland sem XWayland: fica nativo");
  assert.equal(x11({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), null, "X11: nada a fazer");
  assert.equal(argsParaX11({ plataforma: "win32", env: { DISPLAY: ":0", WAYLAND_DISPLAY: "w" }, argv }), null, "fora do Linux, nada");
  // Reabrir sem sair do processo: no AppImage, sair desmonta /tmp/.mount_* e
  // a cópia reaberta não subia ("Cannot mount AppImage").
  assert.equal(modoDeReabrir({ temExecve: true }), "execve", "com execve (Electron 44): o mesmo processo vira o novo");
  assert.equal(modoDeReabrir({ temExecve: false }), "reabrir");
  const main = (await import("node:fs")).readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.ok(/modoDeReabrir\(\) === "execve"[\s\S]{0,80}process\.execve\(process\.execPath/.test(main), "o main.js usa o execve antes de qualquer janela");
  assert.deepEqual(opcoesDeExibicao({ plataforma: "linux" }), [["gtk-version", "3"]]);
  assert.deepEqual(opcoesDeExibicao({ plataforma: "win32", env: {} }), [], "fora do Linux, nada");
  assert.equal(precisaSemSandbox({ plataforma: "win32", env: appimage, ler: ubuntu2404 }), false);

  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: appimage, execPath: "/tmp/.mount_x/vcall" }), appimage.APPIMAGE, "AppImage registra o próprio arquivo");
  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: {}, execPath: "/opt/Vcall/vcall" }), null, ".deb/.rpm/pacman já têm .desktop");
  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: {}, execPath: "/home/ana/vcall/vcall" }), "/home/ana/vcall/vcall", ".tar.gz registra onde está");
  ok("Linux: sandbox, link vcall:// e XWayland sem perder o AppImage, no Fedora, Arch, Ubuntu 24.04 e Debian");
}

/* ------------------------------------------------------------------ *
 * Tela de erro: o que a Cloudflare responde vira a explicação certa
 * ------------------------------------------------------------------ */
{
  // 530 (erro 1033) e 502: o Vcall de quem convidou fechou ou caiu.
  assert.equal(tipoDoCodigo(530), "tunel");
  assert.equal(tipoDoCodigo(502), "tunel");
  assert.equal(tipoDoCodigo(521), "tunel");
  assert.equal(tipoDoCodigo(524), "demora", "524 é tempo esgotado na Cloudflare");
  assert.equal(tipoDoCodigo(504), "demora");
  assert.equal(tipoDoCodigo(500), "servidor");
  assert.equal(tipoDoCodigo(530, false), "internet", "sem internet vence qualquer código");
  ok("tela de erro: código da Cloudflare vira a explicação certa");
}

/* ------------------------------------------------------------------ *
 * Legendas: o núcleo do reconhecimento e o encoder "curto"
 * ------------------------------------------------------------------ */
{
  // Palavras confirmadas só quando duas leituras concordam, e nunca voltam.
  const a = new Acordo();
  assert.deepEqual(a.ler("bom dia"), { confirmado: "", provisorio: "bom dia" });
  assert.deepEqual(a.ler("Bom dia a"), { confirmado: "Bom dia", provisorio: "a" });
  assert.deepEqual(a.ler("bom dia a todos"), { confirmado: "Bom dia a", provisorio: "todos" });
  assert.equal(a.ler("bom tia").confirmado, "Bom dia a", "o confirmado não muda com uma leitura pior");

  assert.equal(limpar("Obrigado por assistir!"), "", "alucinação clássica descartada");
  assert.equal(limpar("[Música] oi pessoal"), "oi pessoal");
  assert.equal(limpar("sim sim sim sim sim"), "sim", "laço de repetição colapsado");
  assert.equal(limpar("vamos começar", "hoje nós vamos começar"), "", "eco do contexto descartado");
  assert.equal(limpar("  ok,  vamos lá "), "ok, vamos lá");

  assert.equal(quadrosPara(16_000 * 3), 400, "3 s de fala + 1 s de folga");
  assert.equal(quadrosPara(16_000 * 40), 3000, "nunca passa da janela de 30 s");
  assert.ok(tokensPara(16_000 * 2) < tokensPara(16_000 * 8), "limite de texto cresce com o áudio");

  assert.deepEqual(wer("Bom dia, a todos!", "bom dia a todos"), { erros: 0, palavras: 4 }, "pontuação e caixa não contam");
  assert.equal(wer("o prazo é sexta", "o prado é sexta feira").erros, 2);

  // Encoder de brinquedo com a mesma estrutura do Whisper: y = x + posições.
  const modelo = encoderDeBrinquedo();
  const curto = adaptarEncoder(modelo);
  assert.ok(jaAdaptado(curto) && !jaAdaptado(modelo));
  assert.equal(adaptarEncoder(curto), curto, "adaptar de novo não muda nada");
  const ort = (await import("onnxruntime-node")).default;
  const rodar = async (bytes, t) => {
    const s = await ort.InferenceSession.create(bytes, { logSeverityLevel: 3 });
    const x = new Float32Array(t * 2).fill(1);
    try {
      const r = await s.run({ x: new ort.Tensor("float32", x, [1, t, 2]) });
      return { y: [...r.y.data], saidas: s.outputNames };
    } catch (err) {
      return { erro: err.message, saidas: s.outputNames };
    }
  };
  const antes = await rodar(modelo, 3);
  assert.ok(antes.erro, "o original não aceita 3 posições (só 1500)");
  const depois = await rodar(curto, 3);
  assert.deepEqual(depois.y, [1, 1, 2, 2, 3, 3], "3 posições: x + posições[0..2]");
  assert.deepEqual(depois.saidas, ["y"], "as saídas de atenção saem do modelo");
  const cheio = await rodar(curto, 1500);
  assert.equal(cheio.y.length, 3000, "os 30 s inteiros continuam funcionando");
  ok("legendas: palavras confirmadas, limpeza de alucinações e encoder curto (saída idêntica)");
}

/* ------------------------------------------------------------------ *
 * Jogos de equipe: o estado converge, e ninguém vê o voto antes da hora
 * ------------------------------------------------------------------ */
{
  // Três pessoas; as mensagens chegam fora de ordem e às vezes repetidas.
  let semente = 7;
  const sorte = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const ids = ["aaa", "bbb", "ccc"];
  const nos = ids.map((id) => new EstadoJogos({ eu: id }));
  const fila = [];
  for (const n of nos) n.on("enviar", (lote) => nos.forEach((m) => m !== n && fila.push([m, lote])));
  const entregar = () => {
    while (fila.length) {
      const [m, lote] = fila.splice(Math.floor(sorte() * fila.length), 1)[0];
      m.aplicar(lote);
      if (sorte() < 0.3) m.aplicar(lote);
    }
  };
  const pessoas = ids.map((id) => ({ id, nome: id.toUpperCase() }));
  const igual = () => {
    const s0 = JSON.stringify([...nos[0].mapa].sort());
    for (const n of nos) assert.equal(JSON.stringify([...n.mapa].sort()), s0, "os três estados são idênticos");
  };

  // Planning Poker: o voto fica em casa até alguém revelar.
  const pk = nos.map((n) => new Poker(n, { nome: () => n.eu }));
  pk[0].adicionarHistorias(["Login com Google", "Tela de perfil"]);
  entregar();
  pk[0].votar("5");
  pk[1].votar("8");
  pk[2].votar("5");
  entregar();
  for (const n of nos) {
    const m = mesaPoker(n, { pessoas });
    assert.ok(m.todosVotaram && m.jogadores.every((j) => j.votou && j.valor == null), "todos votaram, nenhum valor à vista");
    assert.ok(!JSON.stringify(n.instantaneo()).includes('"8"'), "o 8 não saiu do aparelho de quem votou");
  }
  pk[1].revelar({ ms: 0 });
  entregar();
  entregar();
  for (const [i, n] of nos.entries()) {
    const v = mesaPoker(n, { pessoas, meuVoto: pk[i].meuVoto(), agora: Date.now() + 10 });
    assert.ok(v.revelado);
    assert.deepEqual(v.jogadores.map((j) => j.valor), ["5", "8", "5"]);
    assert.deepEqual([v.resultado.media, v.resultado.mediana, v.resultado.maioria, v.resultado.concordancia], [6, 5, "5", 67]);
  }
  igual();
  pk[0].salvarEstimativa(historias(nos[0])[0].id, "5");
  entregar();
  assert.equal(historias(nos[2])[0].estimativa, "5");
  const seguinte = mesaPoker(nos[2], { pessoas });
  assert.equal(seguinte.historia, historias(nos[2])[1].id, "salvar a estimativa passa para a próxima história");
  assert.ok(!seguinte.jogadores.some((j) => j.votou), "e a votação recomeça limpa");

  // Quem chega depois recebe tudo de uma vez e fica igual.
  const novo = new EstadoJogos({ eu: "ddd" });
  novo.aplicar(nos[1].instantaneo());
  assert.equal(JSON.stringify([...novo.mapa].sort()), JSON.stringify([...nos[1].mapa].sort()));

  // Resultado: consenso, "?" não conta, camisetas e ½.
  assert.equal(resultado(["8", "8", "8"]).consenso, true);
  assert.equal(resultado(["8"]).consenso, false, "uma pessoa sozinha não é consenso");
  assert.equal(resultado(["3", "5", "?"]).validos, 2);
  assert.equal(resultado(["M", "G", "M"], BARALHOS.camisetas).maioria, "M");
  assert.equal(resultado(["½", "1"], BARALHOS.modificado).media, 0.8);

  // Retrospectiva: notas escondidas enquanto se escreve, 3 pontos por pessoa.
  const rt = nos.map((n) => new Retro(n, { nome: () => n.eu }));
  rt[0].adicionarNota(0, "Pareamento ajudou muito");
  rt[1].adicionarNota(2, "Daily mais curta");
  entregar();
  let vista = retro(nos[2], { pessoas });
  assert.ok(vista.colunas.flatMap((c) => c.notas).every((n) => n.texto == null), "texto dos outros escondido na escrita");
  assert.deepEqual(vista.escreveram.map((x) => x.notas), [1, 1, 0], "mas dá para ver quem já escreveu");
  rt[2].fase("votar");
  entregar();
  entregar();
  vista = retro(nos[2], { pessoas });
  assert.deepEqual(vista.colunas.flatMap((c) => c.notas).map((n) => n.texto).sort(), ["Daily mais curta", "Pareamento ajudou muito"]);
  const nota = vista.colunas[0].notas[0].id;
  for (let k = 0; k < 3; k += 1) assert.ok(rt[2].votar(nota, +1));
  assert.equal(rt[2].votar(nota, +1), false, "o quarto ponto é recusado");
  entregar();
  assert.equal(retro(nos[0]).colunas[0].notas[0].votos, 3);

  // Daily: ordem sorteada e tempo de cada um, igual para todos.
  const dl = nos.map((n) => new Daily(n));
  dl[0].sortear(pessoas);
  entregar();
  const t0 = Date.now();
  dl[1].proximo(t0);
  entregar();
  assert.equal(Math.round(daily(nos[2], { agora: t0 + 30_000 }).decorrido), 30);
  // Duas pessoas apertam "Próximo" ao mesmo tempo: avança uma vez só.
  dl[2].proximo(t0 + 100_000);
  dl[0].proximo(t0 + 100_000);
  entregar();
  assert.equal(daily(nos[1], { agora: t0 + 100_000 }).i, 1, "dois cliques juntos não pulam ninguém");
  dl[0].proximo(t0 + 160_000);
  entregar();
  dl[1].proximo(t0 + 200_000);
  entregar();
  const fim = daily(nos[2], { agora: t0 + 300_000 });
  assert.ok(fim.fim);
  assert.deepEqual(fim.ordem.map((o) => o.segundos), [100, 60, 40]);
  igual();

  // O que chega de fora e não presta é descartado.
  const e = new EstadoJogos({ eu: "x" });
  const aceitos = e.aplicar([
    ["../etc", 1, 1, "a"],
    ["p/h/x", "x".repeat(9999), 2, "a"],
    ["p/atual", "ok", 1e300, "a"],
    ["jogo", "poker", 3, "a"],
  ]);
  assert.deepEqual(aceitos, ["jogo"], "chave estranha, valor enorme e relógio absurdo recusados");
  ok("jogos: Poker, Retro e Daily convergem fora de ordem; voto e nota só aparecem na hora certa");
}

/* ------------------------------------------------------------------ *
 * Tailscale: o link pela rede privada de quem convida
 * ------------------------------------------------------------------ */
{
  // Respostas de verdade do CLI (tailscale v1.104, deslogado e sem daemon).
  const deslogado = { BackendState: "NeedsLogin", Self: { DNSName: "", TailscaleIPs: null }, Health: ["Tailscale is stopped."] };
  assert.equal(lerEstado(deslogado).motivo, "deslogado");
  assert.equal(interpretarFalha("Logged out."), MENSAGENS.deslogado);
  assert.equal(
    interpretarFalha("failed to connect to local tailscaled (which appears to be running as tailscaled, pid 1). Got error: ...; not running?"),
    MENSAGENS["sem-daemon"],
  );
  assert.match(interpretarFalha("flag provided but not defined: -https"), /1\.52/, "versão antiga pede atualização");
  assert.equal(interpretarFalha("serve config denied", "linux"), MENSAGENS.operador, "no Linux: o comando do operador");

  const rodando = {
    BackendState: "Running",
    Self: { DNSName: "maquina.tail1234.ts.net.", TailscaleIPs: ["100.101.5.5", "fd7a:115c:a1e0::5"] },
    CurrentTailnet: { Name: "time@example.com", MagicDNSEnabled: true },
    CertDomains: ["maquina.tail1234.ts.net"],
  };
  const e = lerEstado(rodando);
  assert.deepEqual([e.pronto, e.nome, e.ipv4, e.https], [true, "maquina.tail1234.ts.net", "100.101.5.5", true]);
  assert.equal(lerEstado({ ...rodando, CurrentTailnet: { MagicDNSEnabled: false } }).motivo, "sem-dns");

  // Não pisa no que a pessoa já publica.
  assert.equal(escolherPorta({}, "m.ts.net"), 443);
  assert.equal(escolherPorta({ TCP: { 443: { HTTPS: true } } }, "m.ts.net"), 8443);
  assert.equal(escolherPorta({ Web: { "m.ts.net:443": {} }, Foreground: { s1: { TCP: { 8443: {} } } } }, "m.ts.net"), 10000);
  assert.equal(escolherPorta({ TCP: { 443: {}, 8443: {}, 10000: {} } }, "m.ts.net"), null);
  assert.equal(urlDe("m.ts.net", 443), "https://m.ts.net");
  assert.equal(urlDe("m.ts.net", 8443), "https://m.ts.net:8443");

  // Endereços da tailnet: a mesma regra no servidor e no navegador.
  for (const [ip, sim] of [["100.64.0.1", true], ["100.127.255.254", true], ["100.63.0.1", false], ["100.128.0.1", false], ["::ffff:100.101.5.5", true], ["fd7a:115c:a1e0::1", true], ["192.168.0.10", false], ["", false]]) {
    assert.equal(ehIpTailscale(ip), sim, ip);
    assert.equal(ehIpTailscaleNavegador(ip), sim, `navegador: ${ip}`);
  }

  // O IP real de quem entra pelo `tailscale serve` (que SUBSTITUI o X-Forwarded-For).
  const pedido = (headers, ip = "127.0.0.1") => ({ socket: { remoteAddress: ip }, headers });
  assert.equal(clientIp(pedido({ "x-forwarded-for": "100.101.102.103" }), { trustTailscale: true }), "100.101.102.103");
  assert.equal(clientIp(pedido({ "x-forwarded-for": "100.101.102.103" }), { trustTailscale: false }), "127.0.0.1", "desligado, não confia");
  assert.equal(clientIp(pedido({ "x-forwarded-for": "8.8.8.8" }), { trustTailscale: true }), "127.0.0.1", "fora da tailnet, não confia");
  assert.equal(
    clientIp(pedido({ "x-forwarded-for": "100.101.102.103", "cf-connecting-ip": "203.0.113.9" }), { trustTailscale: true, trustCloudflare: true }),
    "203.0.113.9",
    "pelo túnel do Cloudflare, um X-Forwarded-For forjado não vale",
  );
  assert.equal(clientIp(pedido({ "x-forwarded-for": "100.101.102.103" }, "192.168.0.7"), { trustTailscale: true }), "192.168.0.7", "só de dentro da máquina");

  // O fluxo inteiro, com um `tailscale serve` de mentira (sem shell: roda até no Windows).
  const falso = ({ habilitar = false, morre = false } = {}) => {
    const chamadas = [];
    const gerar = (cli, args) => {
      chamadas.push(args.join(" "));
      const proc = new EventEmitter();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.morto = false;
      proc.kill = () => {
        proc.morto = true;
        setImmediate(() => proc.emit("exit", null));
      };
      setTimeout(() => {
        if (morre) {
          proc.stderr.write("serve config denied\n");
          return setTimeout(() => proc.emit("exit", 1), 5);
        }
        if (habilitar) proc.stdout.write("\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nX\n");
        setTimeout(() => proc.stdout.write("Available within your tailnet:\n\nhttps://maquina.tail1234.ts.net/\n\nPress Ctrl+C to exit.\n"), habilitar ? 40 : 5);
      }, 5);
      falso.ultimo = proc;
      return proc;
    };
    const rodar = async (cli, args) =>
      args[0] === "status"
        ? { code: 0, stdout: JSON.stringify(rodando), stderr: "" }
        : { code: 0, stdout: JSON.stringify({ TCP: { 443: {} } }), stderr: "" };
    return { achar: async () => "tailscale", rodar, gerar, pedir: async () => 200, chamadas };
  };

  const f1 = falso({ habilitar: true });
  const link = new LinkTailscale(7718, f1);
  const estados = [];
  link.on("status", (st) => estados.push(st.state + (st.habilitar ? `:${st.habilitar}` : "")));
  assert.equal(await link.start(), "https://maquina.tail1234.ts.net:8443");
  assert.deepEqual(f1.chamadas, ["serve --https=8443 http://127.0.0.1:7718"], "primeiro plano (sem --bg), na 8443 porque a 443 estava em uso");
  assert.deepEqual(estados, ["conferindo", "habilitar:https://login.tailscale.com/f/serve?node=nX", "verificando", "pronto"]);
  link.stop();
  assert.ok(falso.ultimo.morto, "desligar mata o serve (e o Tailscale desfaz a publicação)");
  assert.equal(link.url, null);

  // O serve cai sozinho (Tailscale fechado): o link some.
  const f2 = falso();
  const link2 = new LinkTailscale(7718, f2);
  await link2.start();
  falso.ultimo.emit("exit", 0);
  assert.deepEqual([link2.state, link2.url], ["parado", null]);

  // Sem permissão no Linux: a mensagem diz o que fazer.
  const link3 = new LinkTailscale(7718, falso({ morre: true }));
  await assert.rejects(link3.start(), (err) => err.message === interpretarFalha("serve config denied"));
  assert.equal(link3.state, "erro");
  ok("Tailscale: estados reais do CLI, porta livre, IP da tailnet, serve em primeiro plano que morre junto");
}

/* ------------------------------------------------------------------ *
 * Rede Tailscale: chamadas de todos os computadores e "Na minha rede"
 * ------------------------------------------------------------------ */
{
  // Quem é "da rede": a própria máquina, ou quem veio pelo tailscale serve.
  const pedido = (headers = {}, ip = "127.0.0.1") => ({ socket: { remoteAddress: ip }, headers });
  assert.equal(ehDaRede(pedido()), true, "a janela do app, na própria máquina");
  assert.equal(ehDaRede(pedido({ "x-forwarded-for": "100.101.102.103" }), { trustTailscale: true }), true, "pela tailnet");
  assert.equal(ehDaRede(pedido({ "x-forwarded-for": "100.101.102.103" }), { trustTailscale: false }), false);
  assert.equal(ehDaRede(pedido({ "cf-connecting-ip": "203.0.113.9" }), { trustTailscale: true }), false, "pelo túnel do Cloudflare, não");
  assert.equal(ehDaRede(pedido({ "x-forwarded-for": "203.0.113.9" }), { trustTailscale: true }), false, "proxy de fora da tailnet, não");
  assert.equal(ehDaRede(pedido({}, "192.168.0.20")), false, "outro computador direto, não");
  assert.equal(ehDaRede(pedido(), { trustProxy: true }), false, "atrás de proxy declarado, sem endereço da tailnet, não");

  // Visibilidade "rede": o servidor aceita e o diretório só mostra para a rede.
  assert.equal(normalizeRoomMeta({ visibility: "rede" }).visibility, "rede");
  assert.equal(normalizeRoomMeta({ visibility: "qualquer" }).visibility, "private");
  const reg = new RoomRegistry();
  const ID = (c) => c.repeat(20);
  const entrar = (sala) => sala.add(new Participant({ readyState: 1, send() {} }, { room: sala.id, profile: { name: "Ana" }, state: { mic: true } }));
  entrar(reg.ensure(ID("p"), { name: "Pública", visibility: "public" }));
  entrar(reg.ensure(ID("r"), { name: "Do time", visibility: "rede" }));
  entrar(reg.ensure(ID("x"), { name: "Segredo", visibility: "private" }));
  assert.deepEqual(reg.directory().map((r) => r.name), ["Pública"], "de fora: só a pública");
  assert.deepEqual(reg.directory({ rede: true }).map((r) => r.name).sort(), ["Do time", "Pública"], "da rede: pública e da rede, nunca a privada");

  // As mesmas regras pela HTTP de verdade: /api/rooms e /api/rede.
  const srv = createHttpServer({ registry: reg, trustTailscale: true, rede: async () => ({ disponivel: true, computadores: [] }) });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const pegar = async (caminho, headers = {}) => {
    const res = await fetch(base + caminho, { headers });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const local = await pegar("/api/rooms");
  assert.equal(local.json.servidor, "vcall", "o servidor se identifica para a varredura da rede");
  assert.deepEqual(local.json.rooms.map((r) => r.name).sort(), ["Do time", "Pública"]);
  const pelaTailnet = await pegar("/api/rooms", { "x-forwarded-for": "100.101.102.103" });
  assert.equal(pelaTailnet.json.rooms.length, 2, "quem vem pela tailnet vê a sala da rede");
  const peloTunel = await pegar("/api/rooms", { "cf-connecting-ip": "203.0.113.9" });
  assert.deepEqual(peloTunel.json.rooms.map((r) => r.name), ["Pública"], "pelo link público, a sala da rede não existe");
  assert.equal((await pegar("/api/rede")).status, 200);
  assert.equal((await pegar("/api/rede", { "cf-connecting-ip": "203.0.113.9" })).status, 404, "a lista da rede não vaza pelo túnel");
  srv.close();

  // A varredura: só computadores ligados, só quem é Vcall, e com prazo.
  const st = {
    BackendState: "Running",
    Self: { DNSName: "eu.tail1.ts.net.", TailscaleIPs: ["100.64.0.1"] },
    CurrentTailnet: { Name: "time", MagicDNSEnabled: true },
    Peer: {
      a: { DNSName: "notebook-ana.tail1.ts.net.", HostName: "notebook-ana", Online: true, TailscaleIPs: ["100.64.0.2", "fd7a:115c:a1e0::2"], OS: "windows" },
      b: { DNSName: "celular.tail1.ts.net.", HostName: "celular", Online: true, TailscaleIPs: ["100.64.0.3"], OS: "android" },
      c: { DNSName: "desligado.tail1.ts.net.", HostName: "desligado", Online: false, TailscaleIPs: ["100.64.0.4"] },
      d: { DNSName: "malicioso.tail1.ts.net.", HostName: "malicioso", Online: true, TailscaleIPs: ["100.64.0.5"] },
    },
  };
  assert.deepEqual(paresOnline(st).map((p) => p.curto), ["notebook-ana", "celular", "malicioso"]);
  assert.equal(pareceVcall({ rooms: [], stats: { publicRooms: 0 } }), true, "um Vcall 3.9 (sem a marca) também conta");
  assert.equal(pareceVcall({ rooms: [] }), false);
  assert.equal(limparSala({ id: "../../etc", name: "x" }), null, "id de sala inválido é descartado");

  let agora = 1_000_000;
  const pedidos = [];
  const salaAna = { id: ID("a"), code: "ABC123", name: "Planning", visibility: "rede", size: 3, max: 16, host: { name: "Ana", avatar: { style: "thumbs", seed: "a" } } };
  const pedir = async (url, ip) => {
    pedidos.push(url);
    if (url.startsWith("https://notebook-ana.tail1.ts.net:8443/")) return { status: 200, json: { servidor: "vcall", versao: "3.10.0", rooms: [salaAna] } };
    if (url.startsWith("https://malicioso.tail1.ts.net/")) {
      return { status: 200, json: { servidor: "vcall", rooms: [{ id: ID("m"), name: "y".repeat(5000), size: -5, host: { name: { toString: 1 } }, extra: "<script>" }] } };
    }
    throw new Error("ECONNREFUSED");
  };
  const rede = new RedeVcall({
    achar: async () => "tailscale",
    rodar: async () => ({ code: 0, stdout: JSON.stringify(st), stderr: "" }),
    pedir,
    eu: () => ({ url: "https://eu.tail1.ts.net", salas: [] }),
    agora: () => agora,
  });
  const lista = await rede.listar();
  assert.equal(lista.disponivel, true);
  const nomes = lista.computadores.map((c) => c.curto);
  assert.equal(nomes[0], "eu", "este computador primeiro");
  assert.deepEqual(nomes.slice(1).sort(), ["malicioso", "notebook-ana"], "o celular sem Vcall e o desligado ficam de fora");
  const ana = lista.computadores.find((c) => c.curto === "notebook-ana");
  assert.equal(ana.url, "https://notebook-ana.tail1.ts.net:8443", "achou o Vcall na porta em que ele está");
  assert.equal(ana.salas[0].name, "Planning");
  const mal = lista.computadores.find((c) => c.curto === "malicioso").salas[0];
  assert.equal(mal.name.length, 48, "nome gigante cortado");
  assert.equal(mal.size, 0, "número inválido zerado");
  assert.equal(mal.host.name, "", "tipo errado vira vazio");
  assert.ok(!("extra" in mal), "campo desconhecido não passa");

  // Logo depois: devolve a lista guardada, sem perguntar de novo.
  const antes = pedidos.length;
  await rede.listar();
  assert.equal(pedidos.length, antes, "lista fresca vem do cache");
  // Mais tarde: quem não é Vcall (o celular) não é perguntado por 2 minutos.
  agora += 10_000;
  await rede.listar();
  await new Promise((r) => setTimeout(r, 20));
  const novos = pedidos.slice(antes);
  assert.ok(!novos.some((u) => u.includes("celular")), "o celular sem Vcall não é perguntado de novo tão cedo");
  agora += 31_000;
  await rede.listar();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(pedidos.slice(antes + novos.length).some((u) => u.includes("celular")), "depois de 30 s, é perguntado de novo (pode ter ligado o Vcall)");
  assert.ok(novos.some((u) => u.startsWith("https://notebook-ana.tail1.ts.net:8443/")), "o Vcall conhecido é perguntado primeiro na porta certa");

  // Sem Tailscale pronto: a rede some do painel, sem erro.
  const semLogin = new RedeVcall({ achar: async () => "tailscale", rodar: async () => ({ stdout: JSON.stringify({ BackendState: "NeedsLogin" }) }) });
  assert.deepEqual(await semLogin.listar(), { disponivel: false, motivo: "deslogado", computadores: [] });
  ok("rede Tailscale: sala \"Na minha rede\" só para a tailnet, varredura dos computadores com Vcall, dados de fora limpos");
}

/* ------------------------------------------------------------------ *
 * Jogos de festa e de tabuleiro: segredo que não vaza, placar que soma
 * uma vez, vez que passa sozinha e o computador que não perde na velha
 * ------------------------------------------------------------------ */
{
  let sementeJ = 11;
  const sorte = () => ((sementeJ = (sementeJ * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  /** Uma mesa de jogo: N estados que se falam fora de ordem e com repetição. */
  function mesa(ids) {
    const nos = ids.map((id) => new EstadoJogos({ eu: id }));
    const fila = [];
    for (const n of nos) n.on("enviar", (lote) => nos.forEach((m) => m !== n && fila.push([m, lote])));
    const entregar = () => {
      while (fila.length) {
        const [m, lote] = fila.splice(Math.floor(sorte() * fila.length), 1)[0];
        m.aplicar(lote);
        if (sorte() < 0.3) m.aplicar(lote);
      }
    };
    const igual = () => {
      const s0 = JSON.stringify([...nos[0].mapa].sort());
      for (const n of nos) assert.equal(JSON.stringify([...n.mapa].sort()), s0, "estados iguais");
    };
    const pessoas = ids.map((id) => ({ id, nome: id[0].toUpperCase() + id.slice(1) }));
    return { nos, entregar, igual, pessoas };
  }
  let relogio = 1_000_000;
  const agora = () => relogio;

  /* Desenha e Adivinha */
  {
    const { nos, entregar, igual, pessoas } = mesa(["ana", "bia", "caio"]);
    const dz = nos.map((n, i) => new Desenho(n, { nome: () => pessoas[i].nome, agora }));
    // eventos efêmeros (traços, palpites) entre todos
    dz.forEach((d, i) => d.on("evento", (ev) => dz.forEach((o, k) => k !== i && o.receber(nos[i].eu, JSON.parse(JSON.stringify(ev))))));
    dz[0].comecar(pessoas);
    entregar();
    const r = dz[1].r;
    assert.equal(r.fase, "escolhendo");
    const desenhista = dz.findIndex((d) => d.eu === r.de);
    const outros = [0, 1, 2].filter((i) => i !== desenhista);
    assert.equal(dz[desenhista].opcoes().length, 3);
    assert.ok(dz[desenhista].escolher("Guarda-chuva", "Objeto"));
    entregar();
    for (const n of nos) assert.ok(!JSON.stringify(n.instantaneo()).toLowerCase().includes("chuva"), "a palavra não sai do computador de quem desenha");
    assert.equal(dz[outros[0]].formaVisivel(), "______-_____");
    // traço
    const t = dz[desenhista].iniciarTraco("#e53935", 10, 100, 100);
    dz[desenhista].estenderTraco(t, 120, 130);
    dz[desenhista].estenderTraco(t, 150, 170);
    dz[desenhista].terminarTraco(t);
    await espera(250);
    assert.deepEqual(dz[outros[1]].tracos.get(t).p, [100, 100, 120, 130, 150, 170], "o traço chega inteiro");
    // alguém de fora tentando desenhar é ignorado
    dz[outros[0]].receber(nos[outros[1]].eu, { tipo: "trc", n: r.n, id: "falso", c: "#e53935", e: 4, p: [1, 2] });
    assert.ok(!dz[outros[0]].tracos.has("falso"), "só quem desenha mexe na tela");
    // palpites
    let quase = 0;
    dz[outros[1]].on("conversa", () => (quase = dz[outros[1]].conversa.filter((c) => c.tipo === "quase").length));
    assert.equal(dz[outros[1]].chutar("guarda chuvo"), "errou");
    assert.equal(quase, 1, "quem desenha avisa: está quase");
    relogio += 20_000;
    assert.equal(dz[outros[0]].chutar("guarda  CHUVA"), "acertou");
    entregar();
    assert.equal(dz[outros[0]].chutar("de novo"), "nada", "quem acertou não chuta mais");
    relogio += 30_000;
    dz[desenhista].manter(pessoas);
    entregar();
    assert.ok(nos.every((n) => n.ler("dz/dica")?.l?.length === 1), "uma letra de dica com metade do tempo");
    assert.equal(dz[outros[1]].chutar("guarda-chuva"), "acertou");
    entregar();
    dz[desenhista].manter(pessoas); // todos acertaram: encerra
    entregar();
    assert.equal(dz[outros[0]].fase(), "revelada");
    assert.equal(nos[outros[0]].ler("dz/fim").palavra, "Guarda-chuva");
    const pts = dz[0].pontosDaVez();
    assert.ok(pts[nos[outros[0]].eu] > pts[nos[outros[1]].eu], "quem acertou antes ganha mais");
    assert.equal(pts[nos[desenhista].eu], 120, "quem desenha ganha por acerto");
    dz[desenhista].manter(pessoas); // começa a contar a pausa da revelação
    relogio += 7000;
    dz[desenhista].manter(pessoas);
    entregar();
    assert.equal(dz[2].r.fase, "escolhendo");
    assert.notEqual(dz[2].r.de, nos[desenhista].eu, "a vez passa");
    assert.equal(nos[1].ler("dz/placar").pts[nos[desenhista].eu], 120);
    // 1 volta = 3 vezes; com 2 voltas, 6
    igual();
  }

  /* Mímica */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia"]);
    const mm = nos.map((n, i) => new Mimica(n, { nome: () => pessoas[i].nome, agora }));
    mm[1].comecar(pessoas);
    entregar();
    const ator = mm.findIndex((m) => m.eu === m.r.de);
    const outro = 1 - ator;
    mm[ator].escolher("tocar violão", "Ação");
    entregar();
    assert.ok(!JSON.stringify(nos[outro].instantaneo()).includes("violão"));
    relogio += 10_000;
    mm[ator].acertou(nos[outro].eu, "B");
    entregar();
    assert.equal(nos[outro].ler("mm/fim").palavra, "tocar violão");
    const p = mm[outro].pontosDaVez();
    assert.ok(p[nos[outro].eu] > 100 && p[nos[ator].eu] === 75);
  }

  /* Stop */
  {
    const { nos, entregar, igual, pessoas } = mesa(["ana", "bia", "caio"]);
    const st = nos.map((n, i) => new StopJogo(n, { nome: () => pessoas[i].nome, agora }));
    st[0].configurar({ cats: ["nome", "animal", "cor"] });
    st[0].novaRodada(pessoas);
    entregar();
    const L = st[2].r.letra;
    assert.ok(/^[A-Z]$/.test(L));
    const resp = [
      { nome: `${L}ucas`, animal: `${L}eão`, cor: `${L}ilás` },
      { nome: `${L}ucas`, animal: `${L}ontra`, cor: "Quase" }, // Q nunca é sorteado
      { nome: `${L}eandro`, animal: `${L}xyz`, cor: "" },
    ];
    resp.forEach((r, i) => Object.entries(r).forEach(([c, v]) => st[i].escrever(c, v)));
    assert.ok(!st[1].podeParar(), "com resposta de outra letra, não dá para gritar STOP");
    assert.ok(st[0].podeParar());
    for (const n of nos) assert.ok(![...n.com("st/a/")].length, "ninguém vê nada antes do STOP");
    st[0].gritarStop();
    entregar();
    entregar();
    assert.equal([...nos[1].com("st/a/")].length, 3, "com o STOP, todos publicam");
    st[0].escrever("cor", "mudou depois");
    // vetos: duas pessoas anulam o animal inventado do Caio
    st[0].vetar("caio", "animal");
    st[1].vetar("caio", "animal");
    entregar();
    const v = st[2].vista(pessoas);
    const por = Object.fromEntries(v.jogadores.map((j) => [j.id, j]));
    assert.equal(por.ana.celulas.nome.pontos, 5, "nome repetido vale 5");
    assert.equal(por.caio.celulas.nome.pontos, 10, "nome único vale 10");
    assert.equal(por.caio.celulas.animal.pontos, 0, "anulado pela maioria vale 0");
    assert.equal(por.bia.celulas.cor.pontos, 0, "outra letra vale 0");
    assert.equal(por.caio.celulas.cor.pontos, 0, "em branco vale 0");
    st[1].novaRodada(pessoas);
    entregar();
    assert.equal(nos[0].ler("st/placar").pts.ana, por.ana.pontos, "o placar soma a rodada anterior");
    assert.notEqual(st[0].r.letra, L, "não repete a letra");
    igual();
  }

  /* Quiz */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia"]);
    const qz = nos.map((n, i) => new Quiz(n, { nome: () => pessoas[i].nome, agora }));
    qz[0].configurar({ qtd: 5, tempo: 20 });
    qz[0].comecar();
    entregar();
    assert.equal(qz[1].vista(pessoas).fase, "preparar");
    relogio += 3000;
    const p = qz[1].pergunta();
    assert.equal(p.opcoes.length, 4);
    relogio += 2000;
    assert.ok(qz[0].responder(p.certa));
    assert.ok(!qz[0].responder((p.certa + 1) % 4), "uma resposta por pergunta");
    relogio += 8000;
    assert.ok(qz[1].responder((p.certa + 1) % 4));
    entregar();
    const vi = qz[1].vista(pessoas);
    assert.equal(vi.fase, "revelada", "todos responderam: revela");
    assert.equal(vi.placar[0].id, "ana");
    assert.equal(vi.placar[0].total, 950, "certo em 2 s de 20: 950");
    assert.equal(vi.placar[1].total, 0);
    qz[0].manter(pessoas);
    relogio += 6500;
    qz[0].manter(pessoas);
    entregar();
    assert.equal(qz[1].passo().k, 1, "o líder passa para a próxima");
  }

  /* Roda */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia", "caio"]);
    const rp = nos.map((n, i) => new Roda(n, { nome: () => pessoas[i].nome, agora }));
    rp[0].proxima("prefere", pessoas);
    entregar();
    rp[0].votar(0);
    rp[1].votar(1);
    entregar();
    for (const n of nos) assert.ok(![...n.com("rp/val/")].length, "voto escondido até revelar");
    rp[2].votar(0);
    entregar();
    rp.forEach((r) => r.manter(pessoas));
    entregar();
    entregar();
    const v = rp[1].vista(pessoas);
    assert.equal(v.fase, "revelada");
    assert.deepEqual(v.lados.map((l) => l.length), [2, 1]);
    rp[1].proxima("quem", pessoas);
    entregar();
    rp[0].votar("bia");
    rp[1].votar("bia");
    rp[2].votar("ana");
    entregar();
    rp[0].revelar();
    entregar();
    entregar();
    assert.deepEqual(rp[2].vista(pessoas).ranking.map((x) => [x.nome, x.n]), [["Bia", 2], ["Ana", 1]]);
  }

  /* Duas verdades */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia", "caio"]);
    const dv = nos.map((n, i) => new DuasVerdades(n, { nome: () => pessoas[i].nome, agora }));
    dv[0].publicar(["Já morei no Japão", "Toco piano", "Tenho 3 gatos"], 2);
    dv[1].publicar(["A", "B", "C"], 0);
    entregar();
    assert.ok(!JSON.stringify(nos[2].instantaneo()).includes('"i":'), "a mentira não está no estado");
    dv[2].proxima(pessoas);
    entregar();
    const vez = dv[2].vez();
    const autor = dv.findIndex((d) => d.eu === vez.de);
    const mentira = dv[autor].minha.i;
    const outros = [0, 1, 2].filter((i) => i !== autor);
    dv[outros[0]].votar(mentira);
    dv[outros[1]].votar((mentira + 1) % 3);
    entregar();
    assert.ok(dv[autor].revelar(pessoas));
    entregar();
    const vi = dv[outros[1]].vista(pessoas);
    assert.equal(vi.mentira, mentira);
    const pl = nos[0].ler("dv/placar").pts;
    assert.equal(pl[nos[outros[0]].eu], 100);
    assert.equal(pl[nos[autor].eu], 50);
  }

  /* Palavras-código */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia", "caio", "duda"]);
    const pc = nos.map((n, i) => new Codigo(n, { nome: () => pessoas[i].nome, agora }));
    pc[0].novoJogo();
    pc[0].sortearTimes(pessoas);
    entregar();
    const j = pc[1].jogo();
    assert.equal(j.palavras.length, 25);
    assert.equal([...j.chave].filter((c) => c === "x").length, 1);
    assert.ok(!JSON.stringify(nos[1].instantaneo()).includes(j.chave), "a chave não fica à vista");
    const vez = pc[0].vez().time;
    const mestre = pc.find((p) => p.meuTime().time === vez && p.meuTime().mestre);
    const agente = pc.find((p) => p.meuTime().time === vez && !p.meuTime().mestre);
    assert.ok(!agente.apontar(0), "sem dica não aponta");
    assert.ok(mestre.darDica("bicho", 2));
    entregar();
    assert.ok(agente.vista(pessoas).cartas.every((c) => c.cor === null), "o agente não vê as cores");
    assert.ok(mestre.vista(pessoas).cartas.every((c) => c.cor), "o mestre vê");
    const minha = [...j.chave].findIndex((c) => c === vez);
    agente.apontar(minha);
    entregar();
    assert.equal(pc[3].vez().time, vez, "acertou: continua");
    const neutra = [...j.chave].findIndex((c) => c === "n");
    agente.apontar(neutra);
    entregar();
    assert.notEqual(pc[3].vez().time, vez, "neutra: passa a vez");
    const outroMestre = pc.find((p) => p.meuTime().time !== vez && p.meuTime().mestre);
    const outroAgente = pc.find((p) => p.meuTime().time !== vez && !p.meuTime().mestre);
    outroMestre.darDica("tudo", 0);
    entregar();
    outroAgente.apontar(j.chave.indexOf("x"));
    entregar();
    const fim = pc[0].vista(pessoas);
    assert.equal(fim.vencedor, vez, "quem acha a bomba perde");
  }

  /* Velha e Lig 4 */
  {
    assert.deepEqual(resultadoVelha("xxx o o  ").vencedor, 1);
    assert.equal(resultadoVelha("xoxxoxoxo").fim, true);
    // o computador nunca perde da velha (200 partidas contra jogadas ao acaso)
    const { nos } = mesa(["ana"]);
    const v = new Velha(nos[0], { agora });
    for (let k = 0; k < 200; k += 1) {
      let t = "         ";
      let vez = k % 2 ? 1 : 2; // às vezes o humano começa
      const bot = 2;
      while (!resultadoVelha(t).fim) {
        const livres = [...t].map((c, i) => (c === " " ? i : -1)).filter((i) => i >= 0);
        const livre = vez === bot ? v.jogadaDoBot(t, bot) : livres[Math.floor(sorte() * livres.length)];
        t = v.aplicar(t, livre, vez).t;
        vez = vez === 1 ? 2 : 1;
      }
      assert.notEqual(resultadoVelha(t).vencedor, 1, `o computador perdeu: ${t}`);
    }
    // duas pessoas
    const m = mesa(["ana", "bia"]);
    const jv = m.nos.map((n, i) => new Velha(n, { nome: () => m.pessoas[i].nome, agora }));
    jv[0].sentar(1);
    m.entregar();
    jv[1].sentar(2);
    m.entregar();
    assert.ok(!jv[1].jogar(4), "não é a vez dela");
    for (const [q, i] of [[0, 0], [1, 4], [0, 1], [1, 5], [0, 2]]) {
      assert.ok(jv[q].jogar(i));
      m.entregar();
    }
    const fim = jv[1].vista(m.pessoas);
    assert.equal(fim.vencedor, 1);
    assert.deepEqual(fim.placar.map((p) => [p.nome, p.vitorias]), [["Ana", 1]]);
    jv[1].revanche();
    m.entregar();
    assert.equal(jv[0].vista(m.pessoas).p1.id, "bia", "revanche troca os lados");
    // Lig 4: a peça cai, quatro na diagonal ganha, e o computador bloqueia
    const lg = new Lig4(nos[0], { agora });
    let t = " ".repeat(42);
    t = lg.aplicar(t, 3, 1).t;
    t = lg.aplicar(t, 3, 2).t;
    assert.equal(t[35 + 3], "x");
    assert.equal(t[28 + 3], "o");
    let bloqueio = " ".repeat(42);
    for (const c of [0, 1, 2]) bloqueio = lg.aplicar(bloqueio, c, 1).t;
    assert.equal(lg.jogadaDoBot(bloqueio, 2), 3, "bloqueia a linha de três");
    let ganha = bloqueio;
    for (const c of [0, 1, 2]) ganha = lg.aplicar(ganha, c, 2).t;
    assert.equal(lg.jogadaDoBot(ganha, 2), 3, "e ganha quando pode (antes de bloquear)");
    let diag = " ".repeat(42);
    for (const [c, q] of [[0, 1], [1, 2], [1, 1], [2, 2], [2, 2], [2, 1], [3, 2], [3, 2], [3, 2], [3, 1]]) diag = lg.aplicar(diag, c, q).t;
    assert.equal(resultadoLig4(diag).vencedor, 1, "diagonal");
  }

  /* Forca */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia"]);
    const fc = nos.map((n, i) => new Forca(n, { nome: () => pessoas[i].nome, agora }));
    assert.ok(fc[0].propor("Pão de Açúcar", "Lugar"));
    entregar();
    assert.ok(!JSON.stringify(nos[1].instantaneo()).includes("Açúcar"));
    assert.ok(!fc[0].chutar("a"), "quem escolheu não joga");
    fc[1].chutar("ã");
    entregar();
    let v = fc[0].vista();
    assert.equal(v.posicoes.filter((p) => p.aberta && p.ch !== " ").length, 3, "o A abre Ã, A e Á");
    for (const l of "PODECUR") fc[1].chutar(l);
    entregar();
    assert.equal(fc[0].vista().fase, "ganhou");
    fc[0].nova();
    entregar();
    for (const l of "KWYZQX") fc[1].chutar(l);
    entregar();
    v = fc[1].vista();
    if (!compacto(fc[1].jogo().palavra).match(/[kwyzqx]/)) assert.equal(v.fase, "perdeu");
  }

  /* Memória */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia"]);
    const mem = nos.map((n, i) => new Memoria(n, { nome: () => pessoas[i].nome, agora, espera: 10 }));
    mem[0].comecar(pessoas, 12);
    entregar();
    const j = mem[0].jogo();
    const daVez = mem.findIndex((m) => m.eu === mem[0].daVez().id);
    const outro = 1 - daVez;
    assert.ok(!mem[outro].virar(0), "fora da vez não vira");
    const a = 0;
    const b = j.cartas.indexOf(j.cartas[0], 1);
    mem[daVez].virar(a);
    entregar();
    mem[daVez].virar(b);
    entregar();
    assert.equal(mem[outro].vista(pessoas).jogadores.find((x) => x.id === nos[daVez].eu).pares, 1);
    assert.equal(mem[outro].daVez().id, nos[daVez].eu, "par: continua a vez");
    const c = j.cartas.findIndex((x, i) => i !== a && i !== b);
    const d = j.cartas.findIndex((x, i) => i !== a && i !== b && x !== j.cartas[c]);
    mem[daVez].virar(c);
    mem[daVez].virar(d);
    entregar();
    assert.equal(mem[outro].vista(pessoas).cartas.filter((x) => x.aberta).length, 2, "errou: as duas aparecem");
    await espera(150);
    entregar();
    assert.equal(mem[outro].daVez().id, nos[outro].eu, "e a vez passa");
  }

  /* Sorteios */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia"]);
    const rl = nos.map((n, i) => new Sorteios(n, { nome: () => pessoas[i].nome, agora }));
    rl[0].girar(pessoas);
    entregar();
    const g = rl[1].vista(pessoas).giro;
    assert.ok(["Ana", "Bia"].includes(g.opcoes[g.alvo]));
    rl[1].rolar(3);
    rl[0].moeda();
    entregar();
    assert.equal(rl[0].vista(pessoas).dados.valores.length, 3);
    relogio += 5000;
    assert.equal(rl[1].vista(pessoas).historico.length, 3);
  }

  /* Quem sou eu */
  {
    const { nos, entregar, pessoas } = mesa(["ana", "bia", "caio"]);
    const qs = nos.map((n, i) => new QuemSouEu(n, { nome: () => pessoas[i].nome, agora }));
    qs[0].sortear(pessoas);
    entregar();
    const v = qs[1].vista(pessoas);
    assert.equal(v.cartas.find((c) => c.eu).quem, null, "a minha carta fica escondida");
    assert.ok(v.cartas.filter((c) => !c.eu).every((c) => c.quem), "as dos outros aparecem");
    qs[0].marcar("bia", "acertou");
    entregar();
    assert.ok(qs[1].vista(pessoas).cartas.find((c) => c.eu).quem, "acertou: a dela aparece para ela");
  }

  // Duas pessoas sentam ao mesmo tempo, cada uma num lado: as duas ficam.
  {
    const m = mesa(["ana", "bia"]);
    const lg = m.nos.map((n, i) => new Lig4(n, { nome: () => m.pessoas[i].nome, agora }));
    lg[0].sentar(1);
    lg[1].sentar(2);
    m.entregar();
    const v = lg[0].vista(m.pessoas);
    assert.deepEqual([v.p1?.id, v.p2?.id], ["ana", "bia"], "lugares em chaves separadas não se apagam");
  }
  ok("jogos de festa e tabuleiro: palavra, resposta e voto só saem na hora; placar, vez e computador certos");
}

/* ------------------------------------------------------------------ *
 * Reações: combo sem inundar a rede, chuva só com várias pessoas, sinais
 * que vencem sozinhos e dado de fora conferido
 * ------------------------------------------------------------------ */
{
  // Combo: 9 cliques em 600 ms viram no máximo 3 mensagens, com a soma certa.
  let t = 0;
  const enviados = [];
  const combo = new Combo((id, n) => enviados.push([id, n]), { janela: 250, agora: () => t });
  const tamanhos = [];
  for (let i = 0; i < 9; i += 1) {
    t = i * 70;
    tamanhos.push(combo.soltar("festa"));
  }
  assert.deepEqual(tamanhos, [1, 2, 3, 4, 5, 6, 7, 8, 9], "o combo cresce na hora, sem esperar a rede");
  await espera(300);
  combo.descarregar();
  assert.ok(enviados.length <= 3, `9 cliques viraram ${enviados.length} mensagens`);
  assert.equal(enviados.reduce((a, [, n]) => a + n, 0), 9, "nenhum clique se perde");
  t = 5000;
  assert.equal(combo.soltar("festa"), 1, "depois de uma pausa, o combo recomeça");
  assert.equal(combo.soltar("amei"), 1, "outra reação recomeça o combo");
  combo.descarregar();

  // Do outro lado, os lotes somam: quem vê também vê o ×9.
  const remoto = new ComboRemoto({ janela: 1500 });
  assert.equal(remoto.somar("ana", "festa", 3, 0), 3);
  assert.equal(remoto.somar("ana", "festa", 4, 250), 7);
  assert.equal(remoto.somar("bia", "festa", 1, 300), 1, "cada pessoa tem o próprio combo");
  assert.equal(remoto.somar("ana", "festa", 2, 500), 9);
  assert.equal(remoto.somar("ana", "festa", 1, 3000), 1, "1,5 s sem nada e o combo zera");

  // Chuva: a mesma reação de 3 pessoas em 4 s; uma pessoa clicando sem parar não basta.
  const chuva = new Chuva({ pessoas: 3, janela: 4000, pausa: 6000 });
  for (let i = 0; i < 20; i += 1) assert.equal(chuva.registrar("palmas", "ana", i * 50), false, "uma pessoa só não faz chover");
  assert.equal(chuva.registrar("palmas", "bia", 1000), false);
  assert.equal(chuva.registrar("palmas", "caio", 2000), true, "a terceira pessoa faz chover");
  assert.equal(chuva.registrar("palmas", "duda", 2500), false, "e não chove de novo logo em seguida");
  assert.equal(chuva.registrar("fogo", "ana", 2600) || chuva.registrar("fogo", "bia", 2700), false);
  assert.equal(chuva.registrar("fogo", "caio", 9000), false, "reações espalhadas por mais de 4 s não contam juntas");

  // Sinais: um por grupo, vencem no prazo de quem recebe, e "Já volto" não vence.
  let agora = 0;
  const sinais = new Sinais({ agora: () => agora });
  const mudancas = [];
  sinais.on("mudou", (m) => mudancas.push(m));
  assert.deepEqual(sinais.alternar("ana", "sim"), ["sim"]);
  assert.deepEqual(sinais.alternar("ana", "nao"), ["nao"], "Não tira o Sim");
  assert.deepEqual(sinais.alternar("ana", "devagar"), ["nao", "devagar"], "grupos diferentes convivem");
  assert.deepEqual(sinais.alternar("ana", "devagar"), ["nao"], "clicar de novo desliga");
  sinais.definir("bia", ["sim", "nao", "javolto", "inventado"]);
  assert.deepEqual(sinais.de("bia"), ["nao", "javolto"], "o que chega pela rede também respeita os grupos");
  sinais.definir("caio", ["nao"]);
  assert.deepEqual(sinais.contagem(), { nao: 3, javolto: 1 });
  assert.deepEqual(sinais.porSinal().nao.sort(), ["ana", "bia", "caio"]);
  agora = 91_000;
  assert.equal(sinais.vencer(), true);
  assert.deepEqual(sinais.de("ana"), [], "o Não some depois de 90 s");
  assert.deepEqual(sinais.de("bia"), ["javolto"], "o Já volto fica até a pessoa tirar");
  assert.ok(mudancas.some((m) => m.pessoa === "caio" && m.ids.length === 0), "quem venceu avisa a tela");
  sinais.esquecer("bia");
  assert.deepEqual(sinais.porSinal(), {}, "quem sai da chamada leva os sinais junto");
  const n = mudancas.length;
  sinais.definir("ana", []);
  assert.equal(mudancas.length, n, "sem mudança, sem repintar");

  // O que chega pelo canal é dado de fora.
  assert.deepEqual(validarReacao({ type: "reacao", r: "festa", n: 3 }), { tipo: "reacao", id: "festa", n: 3 });
  assert.equal(validarReacao({ type: "reacao", r: "festa", n: 1e9 }).n, 20, "lote enorme vira 20");
  assert.equal(validarReacao({ type: "reacao", r: "festa", n: "5" }).n, 1);
  assert.equal(validarReacao({ type: "reacao", r: "<img src=x>" }), null);
  assert.equal(validarReacao({ type: "reacao", r: "__proto__" }), null);
  assert.deepEqual(validarReacao({ type: "sinal", s: ["sim", "sim", "x", 7] }), { tipo: "sinal", ids: ["sim"] });
  assert.deepEqual(validarReacao({ type: "sinal", s: "sim" }), { tipo: "sinal", ids: [] });
  assert.equal(validarReacao(null), null);

  // Catálogo: ids únicos, e todo emoji existe no sprite (senão aparece um buraco).
  const { readFileSync } = await import("node:fs");
  const sprite = readFileSync(new URL("../public/vendor/emoji.svg", import.meta.url), "utf8");
  const ids = [...REACOES, ...SINAIS].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  for (const x of REACOES) assert.ok(sprite.includes(`id="e-${x.emoji}"`), `falta o emoji ${x.emoji} no sprite`);
  // Fora das reações, nada de emoji: sinais, jogos e cartas usam os ícones do app.
  const icones = readFileSync(new URL("../public/vendor/icons.svg", import.meta.url), "utf8");
  const { JOGOS } = await import("../public/js/features/jogos.js");
  const { CARTAS_MEMORIA } = await import("../public/js/features/bancos.js");
  const nomes = [...SINAIS.map((x) => x.icone), ...Object.values(JOGOS).map((j) => j.icone), ...CARTAS_MEMORIA, "thumbs-up", "heart", "party-popper", "laugh", "coffee", "flame"];
  for (const n of nomes) assert.ok(icones.includes(`id="i-${n}"`), `falta o ícone ${n} no sprite`);
  assert.ok(CARTAS_MEMORIA.length >= 15, "pares suficientes para o tabuleiro difícil");
  for (const novo of Object.values(DO_ANTIGO)) assert.ok(REACOES.some((r) => r.id === novo), "reação antiga sem par novo");
  ok("reações: combo em poucas mensagens e igual dos dois lados, chuva só com 3 pessoas, sinais que vencem, dado de fora conferido");
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

/**
 * Um ONNX mínimo com a forma do encoder do Whisper: y = Add(x, embed_positions.weight),
 * posições [1500, 2] com valores i (linha i), e uma saída "encoder_attentions.0"
 * que o adaptador deve remover. Protobuf escrito à mão.
 */
function encoderDeBrinquedo() {
  const v = (n) => {
    const o = [];
    let x = BigInt(n);
    do {
      let b = Number(x & 0x7fn);
      x >>= 7n;
      if (x) b |= 0x80;
      o.push(b);
    } while (x);
    return Buffer.from(o);
  };
  const b = (num, c) => Buffer.concat([v((num << 3) | 2), v(c.length), c]);
  const t = (num, s) => b(num, Buffer.from(s));
  const i = (num, n) => Buffer.concat([v(num << 3), v(n)]);
  const tipo = (dims) =>
    b(2, b(1, Buffer.concat([i(1, 1), b(2, Buffer.concat(dims.map((d) => b(1, typeof d === "number" ? i(1, d) : t(2, d)))))])));
  const valor = (nome, dims) => Buffer.concat([t(1, nome), tipo(dims)]);
  const pesos = Buffer.alloc(1500 * 2 * 4);
  for (let k = 0; k < 1500; k += 1) {
    pesos.writeFloatLE(k, k * 8);
    pesos.writeFloatLE(k, k * 8 + 4);
  }
  const grafo = Buffer.concat([
    b(1, Buffer.concat([t(1, "x"), t(1, "embed_positions.weight"), t(2, "y"), t(3, "/Add_2"), t(4, "Add")])),
    b(1, Buffer.concat([t(1, "y"), t(2, "encoder_attentions.0"), t(3, "/Id"), t(4, "Identity")])),
    t(2, "brinquedo"),
    b(5, Buffer.concat([i(1, 1500), i(1, 2), i(2, 1), t(8, "embed_positions.weight"), b(9, pesos)])),
    b(11, valor("x", [1, "T", 2])),
    b(12, valor("y", [1, "T", 2])),
    b(12, valor("encoder_attentions.0", [1, "T", 2])),
  ]);
  return Buffer.concat([i(1, 7), b(8, Buffer.concat([t(1, ""), i(2, 11)])), b(7, grafo)]);
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
