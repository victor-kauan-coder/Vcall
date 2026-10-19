#!/usr/bin/env node
/**
 * scripts/quizzv-test.mjs — o celular com o QuizzV, do lado do servidor.
 *
 * Servidor de verdade, participantes e "celulares" de verdade (WebSocket). O
 * servidor só pareia e leva recados entre o celular e o navegador da própria
 * pessoa; cada bloco prova uma garantia disso: o celular não vira participante,
 * só fala com quem o pareou, recados malformados não passam, e nada sobra
 * quando a pessoa ou a sala vão embora.
 *
 *   node scripts/quizzv-test.mjs
 */
import assert from "node:assert/strict";
import { WebSocket } from "ws";

import { createHttpServer } from "../src/http.js";
import { attachSignaling } from "../src/signaling.js";
import { parseClientMessage } from "../src/protocol.js";
import { QUIZZV_PROTOCOLO, normalizarAcao, normalizarQuizzv } from "../src/quizzv.js";

let passou = 0;
const ok = (nome) => {
  passou += 1;
  console.log(`✓ ${nome}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 3097;
const server = createHttpServer({});
const { registry } = attachSignaling(server, { graca: 400 });
await new Promise((r) => server.listen(PORT, r));

function conexao() {
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
  return {
    ws,
    msgs,
    fechado: new Promise((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason) }))),
    aberto: new Promise((r, rej) => {
      ws.on("open", r);
      ws.on("error", rej);
    }),
    send: (m) => ws.send(JSON.stringify(m)),
    /** A próxima mensagem que satisfaz `pred` — ou uma que já chegou. */
    esperar(pred, ms = 3000) {
      const ja = msgs.find(pred);
      if (ja) return Promise.resolve(ja);
      const origem = new Error().stack.split(/\r?\n/)[2]?.trim();
      return new Promise((resolve, reject) => {
        const f = { pred, resolve };
        fila.push(f);
        setTimeout(() => {
          const i = fila.indexOf(f);
          if (i >= 0) fila.splice(i, 1);
          reject(new Error(`mensagem não chegou ${origem}`));
        }, ms);
      });
    },
    limpar: () => msgs.splice(0),
  };
}

async function participante(room, nome, extra = {}) {
  const c = conexao();
  await c.aberto;
  c.send({ t: "join", room, profile: { name: nome }, state: {}, ...extra });
  c.welcome = await c.esperar((m) => m.t === "welcome" || m.t === "error");
  c.id = c.welcome.you?.id;
  return c;
}

async function tokenDe(p) {
  p.limpar();
  p.send({ t: "quiz-parear" });
  return (await p.esperar((m) => m.t === "quiz-pareamento")).token;
}

async function celular(token, v = QUIZZV_PROTOCOLO) {
  const c = conexao();
  await c.aberto;
  c.send({ t: "quiz-ola", token, v, app: "QuizzV 1.9.0" });
  c.ola = await c.esperar((m) => m.t === "quiz-conectado" || m.t === "quiz-erro");
  return c;
}

const sala = (n) => `sala-quizzv-${n}-${Math.random().toString(36).slice(2, 12)}`;

const QUIZ = {
  titulo: "Capitais",
  perguntas: [
    { texto: "Capital do Piauí?", opcoes: ["Teresina", "Recife", "Fortaleza"], correta: 0, explicacao: "Desde 1852." },
    { texto: "O Sol é uma estrela?", opcoes: ["Verdadeiro", "Falso"], correta: 0 },
  ],
};

/* -- validação -- */
{
  assert.ok(normalizarQuizzv(QUIZ));
  assert.equal(normalizarQuizzv({ perguntas: [] }), null, "sem perguntas não passa");
  assert.equal(normalizarQuizzv({ perguntas: [{ texto: "a", opcoes: ["só uma"], correta: 0 }] }), null);
  assert.equal(normalizarQuizzv({ perguntas: [{ texto: "a", opcoes: ["x", "y"], correta: 2 }] }), null, "gabarito fora das alternativas");
  assert.equal(normalizarQuizzv({ perguntas: [{ texto: "a", opcoes: ["1", "2", "3", "4", "5", "6"], correta: 0 }] }), null, "no máximo 5 alternativas");
  assert.equal(normalizarQuizzv({ perguntas: Array(101).fill(QUIZ.perguntas[0]) }), null, "no máximo 100 perguntas");
  assert.equal(normalizarQuizzv({ perguntas: [{ texto: "a", opcoes: ["x", ""], correta: 0 }] }), null, "alternativa vazia");
  assert.equal(normalizarQuizzv({ perguntas: [QUIZ.perguntas[0]] }).titulo, "Quiz do QuizzV");
  assert.equal(normalizarQuizzv({ perguntas: [{ ...QUIZ.perguntas[0], texto: "x".repeat(5000) }] }).perguntas[0].texto.length, 1500, "textos longos são cortados");
  const carga = normalizarAcao({ tipo: "carregar", quiz: QUIZ, tempo: 999, qtd: 50, embaralhar: 1 });
  assert.equal(carga.tempo, 20, "tempo fora da lista vira 20 s");
  assert.equal(carga.qtd, 2, "não pede mais perguntas do que o quiz tem");
  assert.equal(carga.embaralhar, true);
  assert.equal(normalizarAcao({ tipo: "responder", k: 0, e: 5 }), null, "alternativa F não existe");
  assert.equal(normalizarAcao({ tipo: "apagar-tudo" }), null, "ação desconhecida");
  assert.equal(parseClientMessage(JSON.stringify({ t: "quiz-do-celular", a: { tipo: "responder", k: "x", e: 0 } })).ok, false);
  assert.equal(parseClientMessage(JSON.stringify({ t: "quiz-para-celular", v: { x: "y".repeat(30_000) } })).error, "too-large");
  assert.equal(parseClientMessage(JSON.stringify({ t: "quiz-ola", token: "curto" })).ok, false);
  ok("validação: quiz, ações e vistas malformados não passam do servidor");
}

/* -- auditoria de segurança: objeto aninhado demais derrubava o servidor -- */
{
  const fundo = (n) => "[".repeat(n) + "1" + "]".repeat(n);
  // Antes da correção, qualquer uma destas ~10 kB encerrava o processo (todas as chamadas caíam).
  const preAuth = conexao();
  await preAuth.aberto;
  preAuth.send({ t: "ping", n: 0 });
  preAuth.ws.send(`{"t":"quiz-para-celular","v":{"x":${fundo(5000)}}}`);
  assert.equal((await preAuth.esperar((m) => m.t === "error")).error, "malformed", "vista aninhada demais é recusada, sem autenticação nenhuma");

  const sozinho = await participante(sala("profundo"), "Ataque");
  sozinho.ws.send(`{"t":"board","op":{"x":${fundo(5000)}}}`);
  sozinho.ws.send(`{"t":"signal","to":"${sozinho.id}","d":{"x":${fundo(5000)}}}`);
  await espera(200);
  assert.equal(sozinho.msgs.filter((m) => m.t === "error" && m.error === "malformed").length, 2, "quadro e sinalização aninhados demais são recusados");

  // O servidor continua de pé: alguém novo entra normalmente.
  const depois = await participante(sala("depois"), "Normal");
  assert.equal(depois.welcome.t, "welcome", "o servidor segue atendendo");
  assert.equal(parseClientMessage(JSON.stringify({ t: "board", op: { a: [[[1, 2], [3, 4]]], b: { c: { d: 1 } } } })).ok, true, "operações normais do quadro continuam passando");
  for (const c of [preAuth, sozinho, depois]) c.ws.close(1000);
  ok("segurança: mensagem aninhada demais não derruba mais o servidor (pré-autenticação, quadro e sinalização)");
}

/* -- pareamento -- */
const id = sala("principal");
const ana = await participante(id, "Ana");
const beto = await participante(id, "Beto");
{
  const token = await tokenDe(ana);
  const cel = await celular(token);
  assert.equal(cel.ola.t, "quiz-conectado");
  assert.equal(cel.ola.voce.id, ana.id, "o celular age em nome de quem o pareou");
  assert.equal(cel.ola.voce.nome, "Ana");
  const aviso = await ana.esperar((m) => m.t === "quiz-celular" && m.conectado);
  assert.equal(aviso.app, "QuizzV 1.9.0", "a pessoa sabe qual app conectou");
  await espera(150);
  assert.ok(!beto.msgs.some((m) => m.t === "peer-join"), "o celular não aparece como participante");
  assert.ok(!beto.msgs.some((m) => m.t === "quiz-celular"), "os outros nem ficam sabendo do celular de Ana");
  assert.equal(await tokenDe(ana), token, "pedir de novo devolve o mesmo token (o QR não muda)");
  ana.cel = cel;
  ana.token = token;
  ok("pareamento: o celular conecta em nome da pessoa, sem virar participante");
}
{
  const falso = await celular("x".repeat(24));
  assert.equal(falso.ola.erro, "pareamento-invalido");
  assert.equal((await falso.fechado).code, 1000);
  const velho = await celular(ana.token, 99);
  assert.equal(velho.ola.erro, "versao");
  assert.equal(velho.ola.servidor, QUIZZV_PROTOCOLO);
  ok("pareamento: token inventado e versão incompatível são recusados com motivo");
}

/* -- recados nos dois sentidos -- */
{
  ana.limpar();
  ana.cel.send({ t: "quiz-do-celular", a: { tipo: "carregar", quiz: QUIZ, tempo: 15, qtd: 0 } });
  const pedido = await ana.esperar((m) => m.t === "quiz-do-celular");
  assert.equal(pedido.a.tipo, "carregar");
  assert.equal(pedido.a.quiz.perguntas.length, 2);
  assert.equal(pedido.a.tempo, 15);
  ana.cel.send({ t: "quiz-do-celular", a: { tipo: "responder", k: 0, e: 2 } });
  const resp = await ana.esperar((m) => m.t === "quiz-do-celular" && m.a.tipo === "responder");
  assert.deepEqual(resp.a, { tipo: "responder", k: 0, e: 2 });
  await espera(100);
  assert.ok(!beto.msgs.some((m) => m.t === "quiz-do-celular"), "o recado vai só para o navegador da dona do celular");

  ana.send({ t: "quiz-para-celular", v: { fase: "pergunta", k: 0, texto: "Capital do Piauí?" } });
  const vista = await ana.cel.esperar((m) => m.t === "quiz-vista");
  assert.equal(vista.v.texto, "Capital do Piauí?");

  // Beto não consegue escrever na tela do celular de Ana.
  const celBeto = await celular(await tokenDe(beto));
  beto.send({ t: "quiz-para-celular", v: { fase: "falsa" } });
  await celBeto.esperar((m) => m.t === "quiz-vista");
  await espera(100);
  assert.ok(!ana.cel.msgs.some((m) => m.t === "quiz-vista" && m.v.fase === "falsa"), "cada um só fala com os próprios celulares");
  beto.cel = celBeto;

  const r = ana.esperar((m) => m.t === "quiz-erro");
  ana.send({ t: "quiz-do-celular", a: { tipo: "proxima" } });
  assert.equal((await r).erro, "so-pelo-celular");

  const r2 = ana.cel.esperar((m) => m.t === "error");
  ana.cel.send({ t: "quiz-do-celular", a: { tipo: "responder", k: 0, e: 9 } });
  assert.equal((await r2).error, "malformed", "ação inválida do celular é recusada");
  const r3 = ana.cel.esperar((m) => m.t === "quiz-erro" && m.erro === "nao-permitido");
  ana.cel.send({ t: "chat", text: "oi" });
  assert.ok(await r3, "o celular não manda nada além de recados do quiz");
  const r4 = ana.cel.esperar((m) => m.t === "pong");
  ana.cel.send({ t: "ping", n: 7 });
  assert.equal((await r4).n, 7, "o celular tem batimento");
  ok("recados: celular → navegador da pessoa e de volta, sem vazar para os outros");
}

/* -- um terceiro aparelho derruba o mais antigo -- */
{
  ana.cel.limpar();
  const segundo = await celular(ana.token);
  assert.equal(segundo.ola.t, "quiz-conectado", "um segundo aparelho é aceito");
  const terceiro = await celular(ana.token);
  assert.equal(terceiro.ola.t, "quiz-conectado");
  const caiu = await ana.cel.esperar((m) => m.t === "quiz-erro");
  assert.equal(caiu.erro, "substituido", "o mais antigo é desligado com motivo");
  segundo.ws.close();
  ana.cel = terceiro;
  ok("aparelhos: no máximo dois por pessoa");
}

/* -- a aba da pessoa cai e volta: o celular continua valendo -- */
{
  const SESSAO = "sessao-da-carla-abcdefgh";
  const carla = await participante(id, "Carla", { session: SESSAO });
  const tokenCarla = await tokenDe(carla);
  const cel = await celular(tokenCarla);
  carla.ws.terminate(); // queda sem aviso: entra na tolerância de reconexão
  await espera(50);
  cel.limpar();
  cel.send({ t: "quiz-do-celular", a: { tipo: "proxima" } });
  const fora = await cel.esperar((m) => m.t === "quiz-erro");
  assert.equal(fora.erro, "chamada-fora", "sem a aba da pessoa, o celular é avisado em vez de falar sozinho");
  const volta = await participante(id, "Carla", { session: SESSAO });
  assert.equal(volta.id, carla.id, "a aba volta com o mesmo id");
  assert.ok(await volta.esperar((m) => m.t === "quiz-celular" && m.conectado), "e já sabe que o celular está lá");
  cel.send({ t: "quiz-do-celular", a: { tipo: "proxima" } });
  assert.ok(await volta.esperar((m) => m.t === "quiz-do-celular"), "e os recados voltam a chegar");
  ok("reconexão da aba: o pareamento sobrevive à queda curta");

  // Saiu de vez: o celular cai e o token morre.
  const motivo = cel.esperar((m) => m.t === "quiz-erro" && m.erro === "saiu-da-chamada");
  volta.ws.close(1000);
  assert.ok(await motivo);
  const depois = await celular(tokenCarla);
  assert.equal(depois.ola.erro, "pareamento-invalido", "o token de quem saiu não vale mais");
  ok("saída: quem sai leva o celular junto");
}

/* -- token morre com a pessoa -- */
{
  const token = ana.token;
  const fechou = ana.cel.esperar((m) => m.t === "quiz-erro");
  ana.ws.close(1000);
  assert.equal((await fechou).erro, "saiu-da-chamada");
  const tentativa = await celular(token);
  assert.equal(tentativa.ola.erro, "pareamento-invalido", "o token não vale depois que a pessoa sai");
  ok("token: deixa de valer quando a pessoa sai da chamada");
}

/* -- a sala acaba: nada sobra -- */
{
  const fechou = beto.cel.esperar((m) => m.t === "quiz-erro");
  beto.ws.close(1000);
  assert.equal((await fechou).erro, "saiu-da-chamada");
  await espera(100);
  assert.equal(registry.get(id), undefined, "a sala some");
  assert.equal([...registry.pareamentos.values()].filter((e) => e.roomId === id).length, 0, "nenhum pareamento sobra");
  ok("sala vazia: celulares desligados e pareamentos apagados");
}


/* ================================================================== *
 * O Quiz com perguntas do QuizzV, no estado compartilhado dos jogos
 * (features/festa.js) — três "navegadores" ligados como pelo canal direto.
 * ================================================================== */
{
  const { EstadoJogos, pedacosDoEstado } = await import("../public/js/features/jogos.js");
  const { Quiz, QUIZZV_MAX } = await import("../public/js/features/festa.js");
  const { vistaParaCelular } = await import("../public/js/features/quizzv.js");

  let agora = 1_000_000;
  const relogio = () => agora;
  const maiorMensagem = { n: 0 };
  const rede = [];
  function navegador(id, nome) {
    const estado = new EstadoJogos({ eu: id });
    const quiz = new Quiz(estado, { nome: () => nome, agora: relogio });
    const n = { id, nome, estado, quiz };
    estado.on("enviar", (lote) => {
      // O que o canal direto levaria: precisa caber numa mensagem.
      maiorMensagem.n = Math.max(maiorMensagem.n, JSON.stringify({ type: "jogo", o: lote }).length);
      for (const outro of rede) if (outro !== n) outro.estado.aplicar(JSON.parse(JSON.stringify(lote)));
    });
    rede.push(n);
    return n;
  }
  const ana = navegador("ana-id", "Ana");
  const beto = navegador("beto-id", "Beto");
  const pessoas = () => rede.map((n) => ({ id: n.id, nome: n.nome }));

  // Um quiz "de verdade": 62 perguntas, alternativas longas, aspas e acentos.
  const grande = {
    titulo: "Direito Constitucional",
    perguntas: Array.from({ length: 62 }, (_, i) => ({
      texto: `Pergunta ${i + 1}: "${"á".repeat(1450)}"`,
      opcoes: ["A) " + '"'.repeat(290), "B) segunda", "C) terceira", "D) quarta", "E) Todas as anteriores"],
      correta: i % 5,
      explicacao: '"'.repeat(1000),
    })),
  };
  assert.ok(ana.quiz.carregarQuizzv(grande, { tempo: 15, qtd: 0, de: "Ana" }), "o quiz é aceito");
  assert.ok(maiorMensagem.n < 64 * 1024, `cada mensagem cabe no canal direto (${maiorMensagem.n} bytes)`);
  const qv = beto.quiz.quizzv();
  assert.ok(qv, "o outro navegador recebe o quiz inteiro");
  assert.equal(qv.n, 62);
  assert.equal(beto.quiz.config().fonte, "quizzv", "e o lobby passa a oferecer o quiz do QuizzV");
  const lobby = vistaParaCelular(beto.quiz.vista(pessoas()), { eu: beto.id, pessoas: pessoas() });
  assert.equal(lobby.fase, "lobby");
  assert.equal(lobby.quizzv.titulo, "Direito Constitucional");

  // Quem chega no meio recebe o estado em pedaços que cabem no canal.
  const pedacos = pedacosDoEstado(ana.estado.instantaneo());
  assert.ok(pedacos.length > 1, "o estado grande vai em vários pedaços");
  assert.ok(pedacos.every((p) => JSON.stringify({ type: "jogo", o: p }).length < 64 * 1024), "nenhum pedaço passa do limite do canal");
  const caio = navegador("caio-id", "Caio");
  for (const p of pedacos) caio.estado.aplicar(JSON.parse(JSON.stringify(p)));
  assert.equal(caio.quiz.quizzv()?.n, 62, "quem chegou depois tem o quiz completo");
  ok("QuizzV no Quiz: um quiz grande cabe no canal direto e chega a quem entra no meio");

  // Uma carga menor depois apaga as sobras, sem crescer o estado.
  const pequeno = {
    titulo: "Capitais",
    perguntas: [
      { texto: "Capital do Piauí?", opcoes: ["Teresina", "Parnaíba", "Picos"], correta: 0, explicacao: "Desde 1852." },
      { texto: "O Sol é uma estrela?", opcoes: ["Verdadeiro", "Falso"], correta: 0 },
    ],
  };
  const chavesAntes = ana.estado.mapa.size;
  ana.quiz.carregarQuizzv(pequeno, { tempo: 10 });
  assert.equal(ana.estado.mapa.size, chavesAntes, "uma carga nova reaproveita as mesmas chaves");
  assert.equal(caio.quiz.quizzv().n, 2);
  assert.equal(caio.estado.ler("qz/q/40"), null, "as perguntas que sobraram da carga anterior são apagadas");
  assert.equal(QUIZZV_MAX, 100);

  // Começar: a ordem das alternativas é a do QuizzV (sem embaralhar).
  beto.quiz.comecar();
  agora += 3100; // passa a contagem 3, 2, 1
  const v1 = caio.quiz.vista(pessoas());
  assert.equal(v1.fase, "pergunta");
  assert.equal(v1.titulo, "Capitais");
  assert.deepEqual(v1.pergunta.opcoes, ["Teresina", "Parnaíba", "Picos"], "as alternativas ficam na ordem do QuizzV");
  assert.deepEqual(v1.letras, ["A", "B", "C"]);
  const celular = vistaParaCelular(v1, { eu: caio.id, pessoas: pessoas() });
  assert.equal(celular.pergunta.certa, undefined, "o celular não recebe o gabarito antes da revelação");
  assert.equal(celular.pergunta.explicacao, undefined, "nem a explicação");
  assert.ok(celular.restanteMs > 9000 && celular.restanteMs <= 10_000);

  // Todos respondem: revela; o celular passa a ver a certa e a explicação.
  agora += 1000;
  assert.ok(ana.quiz.responder(0));
  assert.ok(beto.quiz.responder(2));
  assert.equal(beto.quiz.responder(1), false, "uma resposta por pergunta");
  assert.equal(caio.quiz.responder(7), false, "alternativa que não existe");
  assert.ok(caio.quiz.responder(0));
  const v2 = vistaParaCelular(ana.quiz.vista(pessoas()), { eu: ana.id, pessoas: pessoas() });
  assert.equal(v2.fase, "revelada", "todo mundo respondeu: revela");
  assert.equal(v2.pergunta.certa, 0);
  assert.equal(v2.pergunta.explicacao, "Desde 1852.");
  assert.deepEqual(v2.porOpcao, [2, 0, 1]);
  assert.equal(v2.minha.certo, true);
  assert.ok(v2.minha.pontos > 900);
  assert.equal(v2.eu.pos, 1);

  // O líder (menor id) passa para a próxima 6 s depois (o app chama manter() a cada segundo).
  for (const n of rede) n.quiz.manter(pessoas());
  agora += 6100;
  for (const n of rede) n.quiz.manter(pessoas());
  agora += 1600;
  const v3 = beto.quiz.vista(pessoas());
  assert.equal(v3.k, 1);
  assert.equal(v3.fase, "pergunta");
  assert.deepEqual(v3.letras, ["A", "B"], "verdadeiro ou falso: só duas alternativas");
  agora += 11_000; // o tempo acaba sem ninguém responder
  assert.equal(beto.quiz.vista(pessoas()).fase, "revelada");
  beto.quiz.proxima();
  agora += 1600;
  const fim = vistaParaCelular(caio.quiz.vista(pessoas()), { eu: caio.id, pessoas: pessoas() });
  assert.equal(fim.fase, "fim");
  assert.equal(fim.titulo, "Capitais");
  assert.equal(fim.placar.length, 3);

  // "Usar as perguntas do Vcall" volta ao banco de sempre.
  ana.quiz.encerrar();
  ana.quiz.configurar({ fonte: "vcall" });
  ana.quiz.comecar();
  const comum = beto.quiz.vista(pessoas());
  assert.equal(comum.total, 10, "o Quiz de sempre continua igual");
  assert.equal(comum.letras.length, 4);
  ok("QuizzV no Quiz: mesma partida em todos, gabarito só depois de revelar, e o Quiz de sempre intacto");
}

server.close();
console.log(`\n${passou} verificações do QuizzV passaram.`);
process.exit(0);
