#!/usr/bin/env node
/**
 * scripts/features-test.mjs — verificação das partes testáveis fora do navegador.
 *
 * Não abre navegador: exercita a geometria do canvas, o desfazer/refazer e a
 * remontagem de arquivos — os três lugares onde um erro passa despercebido
 * até alguém ver a nota com o texto cortado, o Ctrl+Z apagando o que não devia
 * ou um anexo que chega corrompido.
 *
 *   node scripts/features-test.mjs
 */
import assert from "node:assert/strict";

// O módulo toca o DOM só dentro de métodos, mas as dependências que ele
// importa mexem em `document` ao carregar. Um esboço mínimo basta.
const noop = () => {};
const stubNode = new Proxy(
  { style: {}, dataset: {}, classList: { add: noop, remove: noop }, setAttribute: noop, append: noop },
  { get: (t, k) => (k in t ? t[k] : noop) },
);
globalThis.document = {
  createElement: () => stubNode,
  createElementNS: () => stubNode,
  createTextNode: () => stubNode,
  querySelector: () => null,
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: noop };

const { bounds, hits, wrapText, readableInk, constrain } = await import("../public/js/features/canvas.js");

/* -- caixa envolvente de nota e texto -- */
const note = { type: "note", x: 10, y: 20, w: 100, h: 80, text: "oi", size: 16 };
assert.deepEqual(bounds(note), { x: 10, y: 20, w: 100, h: 80 });
assert.ok(hits(note, { x: 50, y: 50 }, 2), "ponto dentro da nota tem de acertar");
assert.ok(!hits(note, { x: 500, y: 50 }, 2), "ponto longe da nota não pode acertar");

/* -- quebra de linha -- */
// Métrica falsa: cada caractere mede 10. Torna a conta previsível.
const ctx = { measureText: (s) => ({ width: s.length * 10 }) };
assert.deepEqual(wrapText(ctx, "abc def ghi", 80), ["abc def", "ghi"]);
assert.deepEqual(wrapText(ctx, "linha1\nlinha2", 1000), ["linha1", "linha2"]);
// Uma palavra maior que a largura não pode virar linha vazia nem sumir.
assert.deepEqual(wrapText(ctx, "supercalifragilistico", 50), ["supercalifragilistico"]);

/* -- tinta legível sobre o papel da nota -- */
assert.equal(readableInk("#ffd166"), "#101014", "papel amarelo pede tinta escura");
assert.equal(readableInk("#b98bff"), "#ffffff", "papel roxo pede tinta clara");
assert.equal(readableInk("var(--board-ink)"), "#101014", "cor não-hexadecimal cai no padrão");

/* -- Shift travando a forma -- */
const sq = constrain({ x: 0, y: 0 }, { x: 100, y: 30 }, "rect");
assert.deepEqual(sq, { x: 100, y: 100 }, "quadrado usa o maior lado");
const neg = constrain({ x: 0, y: 0 }, { x: -80, y: -10 }, "ellipse");
assert.deepEqual(neg, { x: -80, y: -80 }, "o sinal do arrasto tem de ser mantido");
const diag = constrain({ x: 0, y: 0 }, { x: 100, y: 5 }, "line");
assert.ok(Math.abs(diag.y) < 1e-9 && Math.abs(diag.x - 100.12) < 0.5, "linha quase reta cai em 0°");

console.log("✓ canvas: geometria, quebra de linha, contraste e travas de Shift");

/* -- desfazer e refazer --
 * A pilha guarda o que foi feito; desfazer executa o inverso. Escrevê-la ao
 * contrário faz Ctrl+Z virar um nada e Ctrl+Shift+Z apagar o conteúdo — foi
 * exatamente o que aconteceu antes desta verificação existir. */
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.cancelAnimationFrame = noop;
const { InfiniteCanvas } = await import("../public/js/features/canvas.js");

const c = new InfiniteCanvas({ selfId: "eu", selfName: "Eu", getRoster: () => [] });
const id = "eu-obj-1";
c.add({ id, by: "eu", seq: 1, rev: 1, type: "note", x: 0, y: 0, w: 100, h: 80, text: "" },
  { local: false, record: true });
assert.equal(c.objects.size, 1);

c.apply("eu", { type: "noop" }); // ruído: mensagem desconhecida não pode quebrar nada
assert.equal(c.objects.size, 1, "uma mensagem desconhecida não pode mexer na cena");

// Alterar uma propriedade e desfazer tem de voltar ao valor anterior — foi
// aqui que a pilha escrita ao contrário reaplicava o valor novo.
c.selection.add(id);
c.setColor("#37d399");
assert.equal(c.objects.get(id).color, "#37d399");
assert.ok(c.undo(), "desfazer a mudança de cor");
assert.equal(c.objects.get(id).color, null, "desfazer devolve a cor que havia antes");
assert.ok(c.redo(), "refazer a mudança de cor");
assert.equal(c.objects.get(id).color, "#37d399", "refazer aplica a cor de novo");
assert.ok(c.undo());
c.selection.clear();

assert.ok(c.undo(), "desfazer a criação tem de funcionar");
assert.equal(c.objects.size, 0, "desfazer a criação apaga o objeto");
assert.ok(c.redo(), "refazer tem de funcionar");
assert.equal(c.objects.size, 1, "refazer recria o objeto");
assert.equal(c.objects.get(id).type, "note", "refazer recria o objeto igual");
assert.equal(c.undo(), true);
assert.equal(c.undo(), false, "pilha vazia não desfaz mais nada");

console.log("✓ canvas: desfazer e refazer nos dois sentidos");

/* -- remontagem de arquivos --
 * A recepção junta pedaços numerados. Contar pedaços repetidos como novos faz
 * a contagem bater o total com buracos no meio, e o arquivo sai corrompido sem
 * nenhum erro visível — é o tipo de falha que só aparece no computador do
 * outro, horas depois. */
let ultimoBlob = null;
globalThis.URL.createObjectURL = (b) => {
  ultimoBlob = b;
  return "blob:teste";
};
const { FileTransfer, formatSize } = await import("../public/js/features/transfer.js");

const t = new FileTransfer({ selfId: "eu" });
const recebidos = [];
t.on("file", (f) => recebidos.push(f));

const conteudo = "arquivo de teste com acento: ação";
const b64 = Buffer.from(conteudo, "utf8").toString("base64");
const meio = Math.ceil(b64.length / 2);

// Mensagem que não é dela tem de ser devolvida, senão engoliria as operações
// do canvas que passam pelo mesmo canal.
assert.equal(t.apply("a", { type: "add", op: {} }), false, "operação do canvas não é arquivo");
assert.equal(t.apply("a", { type: "file-chunk", id: "x", i: 0 }), true, "pedaço sem início é dela, e é descartado");

t.apply("a", { type: "file-begin", id: "f1", meta: { name: "t.txt", size: 32, mime: "text/plain" }, total: 2 });
t.apply("a", { type: "file-chunk", id: "f1", i: 1, total: 2, data: b64.slice(meio) });
t.apply("a", { type: "file-chunk", id: "f1", i: 1, total: 2, data: b64.slice(meio) }); // repetido
assert.equal(recebidos.length, 0, "um pedaço repetido não pode completar o arquivo");
t.apply("a", { type: "file-chunk", id: "f1", i: 0, total: 2, data: b64.slice(0, meio) });
assert.equal(recebidos.length, 1, "arquivo completo depois do último pedaço que faltava");
assert.equal(recebidos[0].name, "t.txt");
assert.equal(await ultimoBlob.text(), conteudo, "o conteúdo remontado tem de ser idêntico ao original");

// Arquivo grande demais é recusado na chegada, não só no envio: o remetente
// pode ser uma versão antiga do app.
t.apply("a", { type: "file-begin", id: "f2", meta: { name: "g", size: 999e6 }, total: 1 });
t.apply("a", { type: "file-chunk", id: "f2", i: 0, total: 1, data: b64 });
assert.equal(recebidos.length, 1, "arquivo acima do teto não entra");

assert.equal(formatSize(512), "512 B");
assert.equal(formatSize(2048), "2 kB");
assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");

console.log("✓ arquivos: pedaços fora de ordem, repetidos e acima do limite");

/* -- sincronização do canvas: traços fantasma --
 * O pedaço de um traço pode chegar DEPOIS do "add" que o encerra: o caminho
 * pelo servidor é mais lento que o DataChannel e a ordem entre os dois não é
 * garantida. Sem a guarda, esse pedaço atrasado recriava um traço "em
 * andamento" que nunca terminava — ficava desenhado na tela até recarregar. */
const c2 = new InfiniteCanvas({ selfId: "eu", selfName: "Eu", getRoster: () => [] });
const traco = {
  id: "outro-t1", by: "outro", seq: 5, rev: 1, type: "pen",
  color: "#fff", width: 2, alpha: 1, rotation: 0,
  points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
};
c2.apply("outro", { type: "add", op: traco });
assert.equal(c2.objects.size, 1);
c2.apply("outro", {
  type: "stroke-chunk", id: "outro-t1", by: "outro", seq: 5,
  tool: "pen", color: "#fff", width: 2, from: 0, points: [{ x: 99, y: 99 }],
});
assert.equal(c2.objects.size, 1, "o pedaço atrasado não pode criar um segundo traço");
assert.deepEqual(
  c2.objects.get("outro-t1").points.at(-1),
  { x: 10, y: 10 },
  "e não pode alterar o traço que já virou objeto",
);

// A cena de quem reconecta FUNDE com a local em vez de substituí-la: cada lado
// desenhou enquanto o canal esteve fechado, e nada pode ser perdido.
c2.apply("outro", {
  type: "scene", clock: 9,
  objects: [traco, { ...traco, id: "outro-t2", seq: 6 }],
});
assert.equal(c2.objects.size, 2, "a cena recebida soma o que falta sem duplicar o que já existe");

console.log("✓ canvas: pedaço atrasado não vira fantasma, cena funde sem perder desenho");

/* -- grade de vídeo em salas grandes --
 * `auto-fit` com largura mínima fixa só olha a largura: numa tela larga com
 * dezesseis pessoas ele fazia onze colunas e duas linhas, e cada ladrilho saía
 * em retrato estreito — a pior forma possível para vídeo, que é deitado. */
const { bestColumns } = await import("../public/js/ui/stage.js");

// 1280x620 é uma janela de notebook comum, já descontadas barra e controles.
assert.equal(bestColumns(16, 1280, 620), 4, "dezesseis pessoas cabem em 4x4");
assert.equal(bestColumns(9, 1280, 620), 3, "nove em 3x3");
assert.equal(bestColumns(2, 1280, 620), 2, "duas lado a lado");
assert.equal(bestColumns(1, 1280, 620), 1);

// Tela alta e estreita (celular deitado ao contrário): mais linhas, não mais colunas.
assert.ok(bestColumns(6, 400, 900) <= 2, "numa tela estreita a grade empilha");

// Não pode devolver número inválido com medidas degeneradas.
assert.equal(bestColumns(4, 0, 0), 1);
assert.equal(bestColumns(0, 1280, 620), 1);

// A forma escolhida tem de ficar perto de 16:9 e nunca em retrato extremo.
for (const n of [5, 7, 11, 13, 16]) {
  const cols = bestColumns(n, 1280, 620);
  const prop = 1280 / cols / (620 / Math.ceil(n / cols));
  assert.ok(prop > 0.9, `com ${n} pessoas o ladrilho não pode ficar em retrato (${prop.toFixed(2)})`);
}

console.log("✓ grade: colunas escolhidas pela proporção, sem ladrilho em retrato");

/* -- imagem é fundo, não rabisco --
 * Escrever sobre uma foto e depois corrigir com a borracha não pode levar a
 * foto junto. Quem quiser tirar a imagem usa selecionar + Delete, que é o
 * caminho explícito. */
const c3 = new InfiniteCanvas({ selfId: "eu", selfName: "Eu", getRoster: () => [] });

const imagem = {
  id: "img1", by: "eu", seq: 1, rev: 1, type: "image",
  x: 0, y: 0, w: 200, h: 200, rotation: 0, alpha: 1, src: "",
};
const risco = {
  id: "risco1", by: "eu", seq: 2, rev: 1, type: "pen",
  color: "#fff", width: 4, alpha: 1, rotation: 0,
  points: [{ x: 50, y: 50 }, { x: 60, y: 60 }],
};
c3.objects.set(imagem.id, imagem);
c3.objects.set(risco.id, risco);

// A borracha passa exatamente por cima dos dois.
c3.apagarParaTeste({ x: 55, y: 55 });
assert.ok(c3.objects.has("img1"), "a borracha NÃO pode apagar a imagem");
assert.ok(!c3.objects.has("risco1"), "mas apaga o que foi escrito em cima dela");

// O caminho explícito continua funcionando.
c3.selection.add("img1");
c3.deleteSelection();
assert.ok(!c3.objects.has("img1"), "selecionar e apagar remove a imagem");

console.log("✓ canvas: a borracha apaga o traço e preserva a imagem embaixo");

/* -- fone Bluetooth em modo viva-voz -- */
const { isHandsFree } = await import("../public/js/ui/handsfree.js");
for (const rotulo of [
  "Headset (WH-1000XM4 Hands-Free AG Audio)",
  "Padrão - Fone de ouvido (JBL Tune 510BT Hands-Free)",
  "Headset Head Unit (HSP/HFP)",
  "Microfone (Galaxy Buds Viva-voz)",
]) assert.ok(isHandsFree(rotulo), `viva-voz não reconhecido: ${rotulo}`);
for (const rotulo of ["Microfone (Realtek(R) Audio)", "USB Headset Microphone", "Microphone Array (Intel® Smart Sound)", ""])
  assert.ok(!isHandsFree(rotulo), `falso positivo: ${rotulo}`);
console.log("✓ áudio: detecta o microfone Bluetooth em modo viva-voz sem confundir com fone USB");
