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
import { argsParaX11, executavelParaRegistrar, namespacesDisponiveis, opcoesDeExibicao, precisaSemSandbox } from "../desktop/linux.js";
import { adaptarEncoder, jaAdaptado } from "../desktop/whisper-curto.js";
import { assinar, confere, nomeNaRelease, sha512DoArquivo } from "../desktop/assinatura.js";
import { maisNova, modoDeInstalacao } from "../desktop/atualizacao.js";
import { tipoDoCodigo } from "../public/js/ui/tela-erro.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync as gravar } from "node:fs";
import { tmpdir } from "node:os";
import { join as juntar } from "node:path";
import { Acordo, limpar, quadrosPara, tokensPara, wer } from "../public/js/features/whisper-nucleo.js";

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
  assert.deepEqual(opcoesDeExibicao({ plataforma: "linux" }), [["gtk-version", "3"]]);
  assert.deepEqual(opcoesDeExibicao({ plataforma: "win32", env: {} }), [], "fora do Linux, nada");
  assert.equal(precisaSemSandbox({ plataforma: "win32", env: appimage, ler: ubuntu2404 }), false);

  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: appimage, execPath: "/tmp/.mount_x/vcall" }), appimage.APPIMAGE, "AppImage registra o próprio arquivo");
  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: {}, execPath: "/opt/Vcall/vcall" }), null, ".deb/.rpm/pacman já têm .desktop");
  assert.equal(executavelParaRegistrar({ plataforma: "linux", env: {}, execPath: "/home/ana/vcall/vcall" }), "/home/ana/vcall/vcall", ".tar.gz registra onde está");
  ok("Linux: sandbox e link vcall:// certos no Fedora, Arch, Ubuntu 24.04 e Debian");
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
