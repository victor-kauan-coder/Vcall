#!/usr/bin/env node
/**
 * scripts/host-test.mjs — o painel de controle do executável.
 *
 * Existe por causa de uma falha real, encontrada só ao testar com o túnel de
 * verdade no ar: o cloudflared roda na MESMA máquina e reencaminha para
 * 127.0.0.1, então toda requisição vinda da internet chegava com endereço de
 * origem local. A checagem de "só a própria máquina" passava, e o painel que
 * liga e desliga o túnel respondia para qualquer um que entrasse pelo link.
 *
 * O teste imita as duas situações pelos cabeçalhos, que é o que de fato
 * distingue as duas — sem precisar subir um túnel.
 *
 *   node scripts/host-test.mjs
 */
import assert from "node:assert/strict";
import http from "node:http";

const { isLocalRequest } = await import("../desktop/guard.js");

const req = (headers, ip = "127.0.0.1") => ({ socket: { remoteAddress: ip }, headers });

/* -- quem está na máquina -- */
assert.equal(isLocalRequest(req({ host: "127.0.0.1:3000" })), true, "a própria página local entra");
assert.equal(isLocalRequest(req({ host: "localhost:3000" })), true, "localhost também");
assert.equal(isLocalRequest(req({ host: "[::1]:3000" }, "::1")), true, "IPv6 local também");

/* -- quem veio pelo túnel --
 * O endereço de origem é local nos três casos: é exatamente essa a armadilha. */
assert.equal(
  isLocalRequest(req({ host: "abc-def.trycloudflare.com" })),
  false,
  "requisição do túnel tem Host do Cloudflare e NÃO pode passar",
);
assert.equal(
  isLocalRequest(req({ host: "127.0.0.1:3000", "cf-connecting-ip": "203.0.113.7" })),
  false,
  "cabeçalho de proxy desqualifica mesmo com Host local",
);
assert.equal(
  isLocalRequest(req({ host: "127.0.0.1:3000", "x-forwarded-for": "203.0.113.7" })),
  false,
  "x-forwarded-for idem",
);

/* -- quem está fora da máquina -- */
assert.equal(isLocalRequest(req({ host: "127.0.0.1:3000" }, "192.168.1.50")), false, "outro computador da rede não entra");

/* -- o guarda inteiro, com token, contra um servidor de verdade -- */
const { hostControl } = await import("../desktop/guard.js");
const TOKEN = "segredo-de-teste";
const control = hostControl({
  token: TOKEN,
  acoes: { status: async () => ({ estado: "parado" }) },
});

const server = http.createServer(async (rq, rs) => {
  if (await control(rq, rs, {})) return;
  rs.writeHead(200);
  rs.end("app");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const pegar = async (caminho, headers = {}) => {
  const r = await fetch(base + caminho, { headers });
  return { status: r.status, corpo: await r.text() };
};

assert.equal((await pegar("/")).status, 200, "o app segue respondendo");
assert.equal((await pegar(`/__host/status?t=${TOKEN}`)).status, 200, "controle local com token");
assert.equal((await pegar("/__host/status")).status, 403, "sem token, recusa");
assert.equal((await pegar(`/__host/status?t=errado`)).status, 403, "token errado, recusa");
assert.equal(
  (await pegar(`/__host/status?t=${TOKEN}`, { "cf-ray": "abc" })).status,
  404,
  "vindo de proxy, some — nem confirma que o painel existe",
);
assert.equal((await pegar(`/__host/coisa?t=${TOKEN}`)).status, 404, "ação desconhecida");

server.close();
console.log("✓ executável: painel de controle só responde à própria máquina");

/* -- aperto de mão sem token --
 * A página precisa descobrir que está dentro do aplicativo mesmo quando a
 * janela foi aberta sem o token na URL (link vcall://, recarregar, endereço
 * digitado). Isso NÃO pode virar uma porta para quem vem pelo túnel: o token
 * daria acesso a ligar e desligar o túnel de quem hospeda. */
const SEGREDO = "token-secreto-de-teste";
const control2 = hostControl({
  token: SEGREDO,
  abertas: { hello: async () => ({ app: true, token: SEGREDO }) },
  acoes: { status: async () => ({ estado: "parado" }) },
});

const srv2 = http.createServer(async (rq, rs) => {
  if (await control2(rq, rs, {})) return;
  rs.writeHead(200);
  rs.end("app");
});
await new Promise((r) => srv2.listen(0, "127.0.0.1", r));
const b2 = `http://127.0.0.1:${srv2.address().port}`;

const local = await fetch(`${b2}/__host/hello`);
assert.equal(local.status, 200, "a própria máquina recebe o aperto de mão");
assert.equal((await local.json()).token, SEGREDO, "e recebe o token");

/*
 * A mesma rota, com a marca de quem passou pelo Cloudflare.
 *
 * Feito com http.request cru, e não com fetch: `Host` é um cabeçalho proibido
 * para o fetch, que o sobrescreve em silêncio. Um teste escrito com fetch
 * passaria sem nunca ter exercitado o caso — que é justamente o principal.
 */
const pedirCru = (caminho, headers) =>
  new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: srv2.address().port, path: caminho, headers },
      (res) => {
        let corpo = "";
        res.on("data", (c) => (corpo += c));
        res.on("end", () => resolve({ status: res.statusCode, corpo }));
      },
    );
    req.end();
  });

for (const cabecalho of [
  { host: "abc.trycloudflare.com" },
  { host: "127.0.0.1", "cf-ray": "x" },
  { host: "127.0.0.1", "x-forwarded-for": "1.2.3.4" },
]) {
  const fora = await pedirCru("/__host/hello", cabecalho);
  assert.equal(fora.status, 404, `hello não pode responder a ${JSON.stringify(cabecalho)}`);
  assert.ok(!fora.corpo.includes(SEGREDO), "o token NUNCA pode aparecer numa resposta para fora");
}

// E o caminho legítimo continua funcionando pelo mesmo método.
const cru = await pedirCru("/__host/hello", { host: "127.0.0.1" });
assert.equal(cru.status, 200);
assert.ok(cru.corpo.includes(SEGREDO));

srv2.close();
console.log("✓ executável: o aperto de mão entrega o token só na própria máquina");

/* -- links vcall:// --
 * A janela do aplicativo não tem barra de endereço: quem a vê não consegue
 * conferir onde está. Abrir nela qualquer endereço que chegue por um link seria
 * entregar uma tela sem identificação para quem mandou o link. */
const { destinoDoLink } = await import("../desktop/protocol.js");
const sala = "ABCDEFGHIJKLMNOP";
const comUrl = (u) => `vcall://join?u=${encodeURIComponent(u)}`;

// Convites legítimos
assert.deepEqual(
  destinoDoLink(comUrl(`https://abc.trycloudflare.com/#${sala}`)),
  { tipo: "remoto", url: `https://abc.trycloudflare.com/#${sala}` },
  "convite por túnel https é aceito",
);
assert.equal(
  destinoDoLink(comUrl(`http://192.168.1.5:7717/#${sala}`))?.tipo,
  "remoto",
  "convite na rede local por http é aceito",
);
assert.deepEqual(
  destinoDoLink(`vcall://${sala}`),
  { tipo: "local", room: sala },
  "a forma curta continua abrindo a sala no servidor local",
);

// O que não pode passar
assert.equal(destinoDoLink(comUrl(`http://site-malicioso.example/#${sala}`)), null, "http externo não entra");
assert.equal(destinoDoLink(comUrl("https://site-qualquer.example/")), null, "sem sala no fim, não é convite");
assert.equal(destinoDoLink(comUrl("https://banco.example/#login")), null, "fragmento que não é id de sala não entra");
assert.equal(destinoDoLink(comUrl("javascript:alert(1)")), null, "esquema executável não entra");
assert.equal(destinoDoLink(comUrl("file:///C:/Windows/System32/")), null, "arquivo local não entra");
assert.equal(destinoDoLink("https://site.example/"), null, "link que não é vcall:// não entra");
assert.equal(destinoDoLink("vcall://sala-curta"), null, "id fora do formato não entra");

console.log("✓ executável: links vcall:// só abrem sala de verdade, em servidor confiável");

/* -- ciclo de vida --
 * Fechar a janela tem de derrubar o programa E o túnel. Enquanto isso não
 * existia, o endereço público continuava no ar aceitando quem tivesse o link,
 * depois de a pessoa achar que tinha fechado tudo. */
const { Vida, BATIMENTO_MS } = await import("../desktop/vida.js");

// Batimento chegando: continua vivo.
const v1 = new Vida();
let encerrou1 = null;
v1.on("encerrar", (m) => (encerrou1 = m));
v1.iniciar();
v1.bateu();
await new Promise((r) => setTimeout(r, 1200));
assert.equal(encerrou1, null, "com batimento recente, não pode encerrar");
v1.parar();

// Batimento parou: encerra depois da carência (3 batimentos).
const v2 = new Vida();
let encerrou2 = null;
v2.on("encerrar", (m) => (encerrou2 = m));
v2.iniciar();
v2.bateu();
await new Promise((r) => setTimeout(r, BATIMENTO_MS * 3 + 1500));
assert.ok(encerrou2, "sem batimento por três períodos, tem de encerrar");
v2.parar();

/*
 * Aviso de saída seguido de batimento = RECARREGAMENTO, não fechamento.
 *
 * Este caso vem de um bug real: `pagehide` dispara igual ao recarregar e ao
 * fechar. Sem a distinção, apertar F5 (ou clicar em "Nova sala", que recarrega)
 * desligava o programa no meio do caminho — a página voltava sem estilo nenhum,
 * porque o servidor que serviria o CSS já tinha morrido.
 */
const v3 = new Vida();
let encerrou3 = null;
v3.on("encerrar", (m) => (encerrou3 = m));
v3.iniciar();
v3.bateu();
v3.fechou();
await new Promise((r) => setTimeout(r, 600));
v3.bateu(); // a página voltou do recarregamento
await new Promise((r) => setTimeout(r, 3500));
assert.equal(encerrou3, null, "recarregar a página NÃO pode desligar o programa");
v3.parar();

// Aviso de saída sem batimento depois = fechou de verdade.
const v3b = new Vida();
let encerrou3b = null;
v3b.on("encerrar", (m) => (encerrou3b = m));
v3b.iniciar();
v3b.bateu();
v3b.fechou();
await new Promise((r) => setTimeout(r, 3500));
assert.equal(encerrou3b, "janela fechada", "fechar de verdade encerra logo depois do aviso");
v3b.parar();

// Encerrar é uma vez só: dois caminhos não podem disparar dois desligamentos.
const v4 = new Vida();
let vezes = 0;
v4.on("encerrar", () => (vezes += 1));
v4.iniciar();
v4.bateu();
v4.fechou();
v4.fechou();
await new Promise((r) => setTimeout(r, 3500));
assert.equal(vezes, 1, "o desligamento não pode disparar duas vezes");
v4.parar();

console.log("✓ executável: a janela fechando derruba o programa e o túnel");
