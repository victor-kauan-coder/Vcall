/**
 * features/tabuleiro.js — jogos de tabuleiro e de palavras: Jogo da velha,
 * Lig 4, Forca, Jogo da memória e Sorteios (roleta, dados e moeda). Só a
 * lógica; o desenho fica em ui/tabuleiro.js.
 *
 * Mesmas regras de convivência de features/festa.js: o estado mora no
 * EstadoJogos, cada jogada é uma escrita pequena e só quem tem a vez mexe
 * no tabuleiro (então duas pessoas nunca disputam a mesma chave). Na velha
 * e no Lig 4 dá para jogar contra o computador quando se está sozinho: a
 * jogada dele é calculada por quem está jogando contra ele.
 */
import { Emitter } from "../lib/emitter.js";
import { aleatorio, compacto, desofuscar, embaralhar, normalizar, novoId, ofuscar, sortear } from "./jogos.js";
import { CARTAS_MEMORIA, PALAVRAS } from "./bancos.js";

const texto = (v, max = 40) => (typeof v === "string" ? v.slice(0, max) : "");
export const BOT = "__bot";

/* ================================================================== *
 * Duelos de dois (velha e Lig 4): sentar, jogar, revanche
 * ================================================================== */

class Duelo extends Emitter {
  #botPendente = 0;

  constructor(estado, prefixo, { nome = () => "", agora = () => Date.now(), atrasoBot = 650 } = {}) {
    super();
    this.estado = estado;
    this.px = prefixo;
    this.nome = nome;
    this.agora = agora;
    this.atrasoBot = atrasoBot;
  }
  get eu() {
    return this.estado.eu;
  }
  get vazio() {
    return " ".repeat(this.casas);
  }
  /**
   * A partida: o tabuleiro em `<px>/j` e cada lugar na sua chave
   * (`<px>/p1`, `<px>/p2`), para duas pessoas sentarem ao mesmo tempo sem
   * uma apagar a outra. Sem tabuleiro gravado, a mesa está vazia.
   */
  partida() {
    const g = this.estado.ler(`${this.px}/j`);
    const j = g && typeof g.id === "string" && typeof g.t === "string" && g.t.length === this.casas ? g : { id: "0", t: this.vazio, vez: 1, ultima: null, n: 0 };
    const lugar = (n) => {
      const p = this.estado.ler(`${this.px}/p${n}`);
      return p && typeof p.id === "string" ? { id: p.id.slice(0, 64), nome: texto(p.nome) } : null;
    };
    return { ...j, vez: j.vez === 2 ? 2 : 1, p1: lugar(1), p2: lugar(2) };
  }

  /** Senta num dos lados (1 começa); com o outro lado vazio, a partida espera. */
  sentar(lado) {
    const j = this.partida();
    if (lado !== 1 && lado !== 2) return false;
    if (j[`p${lado}`] && j[`p${lado}`].id !== this.eu) return false;
    const outro = lado === 1 ? 2 : 1;
    const pares = [[`${this.px}/p${lado}`, { id: this.eu, nome: this.nome().slice(0, 40) }]];
    if (j[`p${outro}`]?.id === this.eu || j[`p${outro}`]?.id === BOT) pares.push([`${this.px}/p${outro}`, null]);
    this.estado.definir(pares);
    return true;
  }

  /** Contra o computador: eu começo, ele responde. */
  contraBot() {
    this.estado.definir([
      [`${this.px}/p1`, { id: this.eu, nome: this.nome().slice(0, 40) }],
      [`${this.px}/p2`, { id: BOT, nome: "Computador" }],
      [`${this.px}/j`, { id: novoId(), t: this.vazio, vez: 1, ultima: null, n: 0 }],
    ]);
  }

  /** Mesa limpa, lugares vagos (para outra dupla jogar). */
  novaPartida() {
    this.estado.definir([
      [`${this.px}/p1`, null],
      [`${this.px}/p2`, null],
      [`${this.px}/j`, { id: novoId(), t: this.vazio, vez: 1, ultima: null, n: 0 }],
    ]);
  }

  /** Sai do lugar. Contra o computador, a mesa fica vaga. */
  levantar() {
    const j = this.partida();
    const lado = this.meuLado(j);
    if (!lado) return;
    const contraBot = j.p1?.id === BOT || j.p2?.id === BOT;
    this.estado.definir(contraBot ? [[`${this.px}/p1`, null], [`${this.px}/p2`, null]] : [[`${this.px}/p${lado}`, null]]);
  }

  meuLado(j = this.partida()) {
    if (!j) return 0;
    return j.p1?.id === this.eu ? 1 : j.p2?.id === this.eu ? 2 : 0;
  }

  /** Pode jogar agora? (é a minha vez, a partida está completa e não acabou) */
  minhaVez(j = this.partida()) {
    return !!j && !!j.p1 && !!j.p2 && j[`p${j.vez}`]?.id === this.eu && !this.resultado(j.t).fim;
  }

  /** Aplica uma jogada no tabuleiro (texto); devolve o novo texto ou null. */
  aplicar() {
    return null;
  }

  jogar(pos) {
    const j = this.partida();
    if (!this.minhaVez(j)) return false;
    return this.#mover(j, pos, j.vez);
  }

  #mover(j, pos, quem) {
    const r = this.aplicar(j.t, pos, quem);
    if (!r) return false;
    const fim = this.resultado(r.t);
    const pares = [[`${this.px}/j`, { id: j.id === "0" ? novoId() : j.id, t: r.t, vez: quem === 1 ? 2 : 1, ultima: r.i, n: (Number(j.n) || 0) + 1 }]];
    if (fim.fim) {
      // Quem fez a última jogada anota o placar (uma escrita só).
      const pl = this.estado.ler(`${this.px}/pts`) || {};
      const vit = { ...(pl.v || {}) };
      const nomes = { ...(pl.nomes || {}) };
      if (fim.vencedor) {
        const p = j[`p${fim.vencedor}`];
        if (p) {
          vit[p.id] = (Number(vit[p.id]) || 0) + 1;
          nomes[p.id] = texto(p.nome);
        }
      }
      pares.push([`${this.px}/pts`, { v: vit, nomes, empates: (Number(pl.empates) || 0) + (fim.vencedor ? 0 : 1) }]);
    }
    this.estado.definir(pares);
    this.#talvezBot();
    return true;
  }

  /** É a vez do computador e eu sou quem joga contra ele: calculo e jogo. */
  #talvezBot() {
    const j = this.partida();
    if (!j || this.#botPendente || this.resultado(j.t).fim) return;
    const bot = j.p1?.id === BOT ? 1 : j.p2?.id === BOT ? 2 : 0;
    if (!bot || j.vez !== bot || j[`p${bot === 1 ? 2 : 1}`]?.id !== this.eu) return;
    this.#botPendente = setTimeout(() => {
      this.#botPendente = 0;
      const agora = this.partida();
      if (agora.n !== j.n || agora.vez !== bot || this.resultado(agora.t).fim) return;
      const pos = this.jogadaDoBot(agora.t, bot);
      if (pos != null) this.#mover(agora, pos, bot);
    }, this.atrasoBot);
  }

  /** Mesmo par, lados trocados, tabuleiro limpo. */
  revanche() {
    const j = this.partida();
    this.estado.definir([
      [`${this.px}/p1`, j.p2],
      [`${this.px}/p2`, j.p1],
      [`${this.px}/j`, { id: novoId(), t: this.vazio, vez: 1, ultima: null, n: 0 }],
    ]);
    this.#talvezBot();
  }

  zerarPlacar() {
    this.estado.definir([[`${this.px}/pts`, { v: {}, nomes: {}, empates: 0 }]]);
  }

  /** Para o relógio da tela: se a vez é do computador (e a jogada se perdeu), joga. */
  manter() {
    this.#talvezBot();
  }

  vista(pessoas = []) {
    const j = this.partida();
    const pl = this.estado.ler(`${this.px}/pts`) || {};
    const placar = Object.entries(pl.v || {})
      .map(([id, n]) => ({ id, nome: id === BOT ? "Computador" : pessoas.find((p) => p.id === id)?.nome || texto(pl.nomes?.[id]) || "Saiu", vitorias: Number(n) || 0 }))
      .sort((a, b) => b.vitorias - a.vitorias);
    const r = this.resultado(j.t);
    const nomeDe = (p) => (p ? (p.id === BOT ? "Computador" : pessoas.find((x) => x.id === p.id)?.nome || texto(p.nome)) : null);
    return {
      fase: !j.p1 || !j.p2 ? "esperando" : r.fim ? "fim" : "jogando",
      id: j.id,
      t: j.t,
      vez: j.vez,
      ultima: j.ultima ?? null,
      p1: j.p1 ? { ...j.p1, nome: nomeDe(j.p1), presente: j.p1.id === BOT || pessoas.some((p) => p.id === j.p1.id) } : null,
      p2: j.p2 ? { ...j.p2, nome: nomeDe(j.p2), presente: j.p2.id === BOT || pessoas.some((p) => p.id === j.p2.id) } : null,
      meuLado: this.meuLado(j),
      minhaVez: this.minhaVez(j),
      ...r,
      placar,
      empates: Number(pl.empates) || 0,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Jogo da velha
 * ------------------------------------------------------------------ */

const LINHAS_VELHA = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function resultadoVelha(t) {
  for (const l of LINHAS_VELHA) {
    const [a, b, c] = l;
    if (t[a] !== " " && t[a] === t[b] && t[a] === t[c]) return { fim: true, vencedor: t[a] === "x" ? 1 : 2, linha: l };
  }
  return { fim: !t.includes(" "), vencedor: 0, linha: null };
}

/** Minimax completo (a velha é pequena): o computador nunca perde. */
function minimaxVelha(t, vez, eu) {
  const r = resultadoVelha(t);
  if (r.fim) return { nota: r.vencedor === eu ? 10 : r.vencedor ? -10 : 0 };
  const marca = vez === 1 ? "x" : "o";
  let melhor = null;
  for (let i = 0; i < 9; i += 1) {
    if (t[i] !== " ") continue;
    const n = minimaxVelha(t.slice(0, i) + marca + t.slice(i + 1), vez === 1 ? 2 : 1, eu).nota;
    const nota = n > 0 ? n - 1 : n < 0 ? n + 1 : 0; // ganhar logo, perder tarde
    if (!melhor || (vez === eu ? nota > melhor.nota : nota < melhor.nota)) melhor = { nota, i, empatadas: [i] };
    else if (nota === melhor.nota) melhor.empatadas.push(i);
  }
  return melhor;
}

export class Velha extends Duelo {
  casas = 9;
  constructor(estado, o = {}) {
    super(estado, "jv", o);
  }
  aplicar(t, i, quem) {
    if (!Number.isInteger(i) || i < 0 || i > 8 || t[i] !== " ") return null;
    return { t: t.slice(0, i) + (quem === 1 ? "x" : "o") + t.slice(i + 1), i };
  }
  resultado(t) {
    return resultadoVelha(t);
  }
  jogadaDoBot(t, bot) {
    // A primeira jogada varia (canto ou centro), para não ser sempre igual.
    if (t === this.vazio) return [0, 2, 4, 6, 8][aleatorio(5)];
    const m = minimaxVelha(t, bot, bot);
    return m ? m.empatadas[aleatorio(m.empatadas.length)] : null;
  }
}

/* ------------------------------------------------------------------ *
 * Lig 4 (7 colunas × 6 linhas; a peça cai até a última livre)
 * ------------------------------------------------------------------ */

export const COLUNAS = 7;
export const LINHAS = 6;

export function resultadoLig4(t) {
  const em = (l, c) => (l >= 0 && l < LINHAS && c >= 0 && c < COLUNAS ? t[l * COLUNAS + c] : " ");
  for (let l = 0; l < LINHAS; l += 1)
    for (let c = 0; c < COLUNAS; c += 1) {
      const v = em(l, c);
      if (v === " ") continue;
      for (const [dl, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        if ([1, 2, 3].every((k) => em(l + dl * k, c + dc * k) === v)) {
          return { fim: true, vencedor: v === "x" ? 1 : 2, linha: [0, 1, 2, 3].map((k) => (l + dl * k) * COLUNAS + c + dc * k) };
        }
      }
    }
  return { fim: !t.includes(" "), vencedor: 0, linha: null };
}

function cairNa(t, c) {
  for (let l = LINHAS - 1; l >= 0; l -= 1) if (t[l * COLUNAS + c] === " ") return l * COLUNAS + c;
  return -1;
}

/** Nota de uma posição para o computador: janelas de 4 com peças dele e nenhuma do outro. */
function notaLig4(t, eu) {
  const minha = eu === 1 ? "x" : "o";
  const dele = eu === 1 ? "o" : "x";
  let nota = 0;
  // O centro vale mais: dá mais jeitos de fazer quatro.
  for (let l = 0; l < LINHAS; l += 1) if (t[l * COLUNAS + 3] === minha) nota += 3;
  const janela = (cs) => {
    const m = cs.filter((v) => v === minha).length;
    const d = cs.filter((v) => v === dele).length;
    const v = cs.filter((x) => x === " ").length;
    if (m === 4) return 1000;
    if (m === 3 && v === 1) return 6;
    if (m === 2 && v === 2) return 2;
    if (d === 3 && v === 1) return -8;
    return 0;
  };
  for (let l = 0; l < LINHAS; l += 1)
    for (let c = 0; c < COLUNAS; c += 1)
      for (const [dl, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        const fimL = l + dl * 3;
        const fimC = c + dc * 3;
        if (fimL < 0 || fimL >= LINHAS || fimC < 0 || fimC >= COLUNAS) continue;
        nota += janela([0, 1, 2, 3].map((k) => t[(l + dl * k) * COLUNAS + c + dc * k]));
      }
  return nota;
}

function minimaxLig4(t, prof, alfa, beta, vez, eu) {
  const r = resultadoLig4(t);
  if (r.fim) return { nota: r.vencedor === eu ? 100000 + prof : r.vencedor ? -100000 - prof : 0 };
  if (prof === 0) return { nota: notaLig4(t, eu) };
  const marca = vez === 1 ? "x" : "o";
  // Do centro para as bordas: o corte alfa-beta funciona melhor.
  const ordem = [3, 2, 4, 1, 5, 0, 6];
  let melhor = null;
  for (const c of ordem) {
    const i = cairNa(t, c);
    if (i < 0) continue;
    const nt = t.slice(0, i) + marca + t.slice(i + 1);
    const { nota } = minimaxLig4(nt, prof - 1, alfa, beta, vez === 1 ? 2 : 1, eu);
    if (!melhor || (vez === eu ? nota > melhor.nota : nota < melhor.nota)) melhor = { nota, c };
    if (vez === eu) alfa = Math.max(alfa, nota);
    else beta = Math.min(beta, nota);
    if (alfa >= beta) break;
  }
  return melhor || { nota: 0 };
}

export class Lig4 extends Duelo {
  casas = COLUNAS * LINHAS;
  constructor(estado, o = {}) {
    super(estado, "lig", o);
  }
  /** `pos` é a coluna (0 a 6). */
  aplicar(t, c, quem) {
    if (!Number.isInteger(c) || c < 0 || c >= COLUNAS) return null;
    const i = cairNa(t, c);
    if (i < 0) return null;
    return { t: t.slice(0, i) + (quem === 1 ? "x" : "o") + t.slice(i + 1), i };
  }
  resultado(t) {
    return resultadoLig4(t);
  }
  jogadaDoBot(t, bot) {
    return minimaxLig4(t, 5, -Infinity, Infinity, bot, bot).c ?? null;
  }
}

/* ================================================================== *
 * Forca (cooperativa: todo mundo chuta letras para a mesma palavra)
 * ================================================================== */

export const MAX_ERROS = 6;
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class Forca extends Emitter {
  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
  }
  get eu() {
    return this.estado.eu;
  }
  jogo() {
    const j = this.estado.ler("fc/j");
    if (!j || typeof j.id !== "string") return null;
    const palavra = desofuscar(j.w, j.id);
    return palavra ? { ...j, palavra } : null;
  }

  /** Palavra sorteada do banco (uma categoria vira a dica). */
  nova(cat = "todas") {
    const cats = cat !== "todas" && PALAVRAS[cat] ? [cat] : Object.keys(PALAVRAS);
    const todas = cats.flatMap((c) => PALAVRAS[c].map((p) => [p, c])).filter(([p]) => compacto(p).length >= 4);
    const [palavra, c] = todas[aleatorio(todas.length)];
    this.#comecar(palavra, c, null);
  }

  /** Alguém escolhe a palavra (e não joga esta). */
  propor(palavra, dica = "") {
    const p = String(palavra || "").trim().slice(0, 30);
    if (compacto(p).length < 3 || !/^[\p{L} -]+$/u.test(p)) return false;
    this.#comecar(p, String(dica || "").trim().slice(0, 40) || "Desafio", this.eu);
    return true;
  }

  #comecar(palavra, dica, por) {
    const id = novoId();
    this.estado.definir([["fc/j", { id, w: ofuscar(palavra, id), dica, por, nome: por ? this.nome().slice(0, 40) : "" }]]);
  }

  letras(j = this.jogo()) {
    if (!j) return new Map();
    const m = new Map();
    for (const [k, v] of this.estado.com("fc/l/")) if (v?.j === j.id && ALFABETO.includes(k.slice(5))) m.set(k.slice(5), v);
    return m;
  }

  chutar(letra) {
    const j = this.jogo();
    const l = normalizar(letra).toUpperCase().slice(0, 1);
    if (!j || !ALFABETO.includes(l) || !l || j.por === this.eu || this.letras(j).has(l) || this.vista().fim) return false;
    this.estado.definir([[`fc/l/${l}`, { j: j.id, nome: this.nome().slice(0, 40) }]]);
    return true;
  }

  /** Chutar a palavra inteira: acertou, ganhou; errou, conta um erro. */
  arriscar(palpite) {
    const j = this.jogo();
    if (!j || j.por === this.eu || this.vista().fim) return null;
    const certo = compacto(palpite) === compacto(j.palavra);
    const atual = this.estado.ler(`fc/p/${this.eu}`);
    const erros = atual?.j === j.id ? Number(atual.erros) || 0 : 0;
    this.estado.definir([[`fc/p/${this.eu}`, { j: j.id, erros: erros + (certo ? 0 : 1), acertou: certo || atual?.acertou === true, nome: this.nome().slice(0, 40) }]]);
    return certo;
  }

  vista() {
    const j = this.jogo();
    if (!j) return { fase: "lobby", cats: Object.keys(PALAVRAS) };
    const chutadas = this.letras(j);
    const base = compacto(j.palavra).toUpperCase();
    const erradas = [...chutadas.keys()].filter((l) => !base.includes(l));
    let errosPalavra = 0;
    let quemAcertou = null;
    for (const [, v] of this.estado.com("fc/p/")) {
      if (v?.j !== j.id) continue;
      errosPalavra += Math.min(MAX_ERROS, Number(v.erros) || 0);
      if (v.acertou) quemAcertou = texto(v.nome) || "Alguém";
    }
    const erros = Math.min(MAX_ERROS, erradas.length + errosPalavra);
    const posicoes = [...j.palavra].map((ch) => {
      const n = normalizar(ch).toUpperCase();
      if (!/[A-Z]/.test(n)) return { ch, aberta: true, espaco: ch === " " };
      return { ch: ch.toUpperCase(), aberta: chutadas.has(n) };
    });
    const ganhou = !!quemAcertou || posicoes.every((p) => p.aberta);
    const perdeu = !ganhou && erros >= MAX_ERROS;
    return {
      fase: ganhou ? "ganhou" : perdeu ? "perdeu" : "jogando",
      fim: ganhou || perdeu,
      dica: texto(j.dica),
      por: j.por ? { id: j.por, nome: texto(j.nome) } : null,
      souAutor: j.por === this.eu,
      posicoes: ganhou || perdeu ? posicoes.map((p) => ({ ...p, aberta: true, revelada: !p.aberta })) : posicoes,
      erros,
      erradas,
      chutadas: [...chutadas.keys()],
      quemChutou: Object.fromEntries([...chutadas].map(([l, v]) => [l, texto(v.nome)])),
      quemAcertou,
      alfabeto: ALFABETO,
      max: MAX_ERROS,
    };
  }
}

/* ================================================================== *
 * Jogo da memória
 * ================================================================== */

export const TAMANHOS_MEMORIA = { 12: "Fácil · 12 cartas", 20: "Médio · 20 cartas", 30: "Difícil · 30 cartas" };

export class Memoria extends Emitter {
  #fechar = 0;

  constructor(estado, { nome = () => "", agora = () => Date.now(), espera = 1100 } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
    this.espera = espera;
  }
  get eu() {
    return this.estado.eu;
  }
  /** O jogo em andamento — conferido: cartas são nomes do sprite, em pares. */
  jogo() {
    const j = this.estado.ler("mem/j");
    if (!j || typeof j.id !== "string" || !Array.isArray(j.cartas) || !Array.isArray(j.ordem) || !j.ordem.length) return null;
    if (![12, 20, 30].includes(j.cartas.length) || !j.cartas.every((c) => typeof c === "string" && /^[a-z0-9-]{1,40}$/.test(c))) return null;
    return j;
  }
  vez(j = this.jogo()) {
    const v = this.estado.ler("mem/vez");
    if (!j || !v || v.j !== j.id) return null;
    return { ...v, abertas: Array.isArray(v.abertas) ? v.abertas.filter((i) => Number.isInteger(i) && i >= 0 && i < j.cartas.length).slice(0, 2) : [] };
  }

  /** Embaralha as cartas e a ordem de quem joga. */
  comecar(pessoas, tamanho = 20) {
    const pares = TAMANHOS_MEMORIA[tamanho] ? tamanho / 2 : 10;
    const cartas = embaralhar(sortear(CARTAS_MEMORIA, pares).flatMap((x) => [x, x]));
    const ordem = embaralhar(pessoas.map((p) => ({ id: p.id, nome: String(p.nome || "").slice(0, 40) }))).slice(0, 12);
    const id = novoId();
    this.estado.definir([
      ["mem/j", { id, cartas, ordem }],
      ["mem/vez", { j: id, i: 0, k: 0, abertas: [] }],
    ]);
  }

  pares(j = this.jogo()) {
    const m = new Map();
    if (!j) return m;
    for (const [k, v] of this.estado.com("mem/par/")) {
      const i = Number(k.slice(8));
      if (v?.j === j.id && Number.isInteger(i)) m.set(i, v);
    }
    return m;
  }

  daVez(j = this.jogo(), v = this.vez(j)) {
    return j && v ? j.ordem[v.i % j.ordem.length] : null;
  }

  virar(i) {
    const j = this.jogo();
    const v = this.vez(j);
    if (!j || !v || this.daVez(j, v)?.id !== this.eu || !Number.isInteger(i) || i < 0 || i >= j.cartas.length) return false;
    if (v.abertas.length >= 2 || v.abertas.includes(i) || this.pares(j).has(i)) return false;
    const abertas = [...v.abertas, i];
    if (abertas.length < 2) {
      this.estado.definir([["mem/vez", { ...v, abertas }]]);
      return true;
    }
    const [a, b] = abertas;
    if (j.cartas[a] === j.cartas[b]) {
      // Par! Fica com a vez.
      const nome = this.nome().slice(0, 40);
      this.estado.definir([
        [`mem/par/${a}`, { j: j.id, por: this.eu, nome }],
        [`mem/par/${b}`, { j: j.id, por: this.eu, nome }],
        ["mem/vez", { ...v, abertas: [], k: v.k + 1, ultimoPar: [a, b] }],
      ]);
      return true;
    }
    // Errou: as duas ficam à mostra um pouco e a vez passa.
    this.estado.definir([["mem/vez", { ...v, abertas }]]);
    clearTimeout(this.#fechar);
    this.#fechar = setTimeout(() => this.#passar(j.id, v.k), this.espera);
    return true;
  }

  #passar(id, k) {
    const j = this.jogo();
    const v = this.vez(j);
    if (!j || j.id !== id || !v || v.k !== k) return;
    this.estado.definir([["mem/vez", { j: j.id, i: (v.i + 1) % j.ordem.length, k: v.k + 1, abertas: [] }]]);
  }

  /** Quem tinha a vez saiu: qualquer um passa adiante. */
  pularVez() {
    const j = this.jogo();
    const v = this.vez(j);
    if (j && v) this.estado.definir([["mem/vez", { j: j.id, i: (v.i + 1) % j.ordem.length, k: v.k + 1, abertas: [] }]]);
  }

  /** Quem chegou depois entra no fim da fila. */
  entrar() {
    const j = this.jogo();
    if (!j || j.ordem.some((p) => p.id === this.eu) || j.ordem.length >= 12) return;
    this.estado.definir([["mem/j", { ...j, ordem: [...j.ordem, { id: this.eu, nome: this.nome().slice(0, 40) }] }]]);
  }

  vista(pessoas = []) {
    const j = this.jogo();
    if (!j) return { fase: "lobby", tamanhos: TAMANHOS_MEMORIA };
    const v = this.vez(j);
    const pares = this.pares(j);
    const cartas = j.cartas.map((nome, i) => {
      const par = pares.get(i);
      const aberta = !!v?.abertas.includes(i);
      return { i, nome: par || aberta ? texto(nome, 30) : null, aberta, par: par ? par.por : null };
    });
    const pontos = new Map(j.ordem.map((p) => [p.id, 0]));
    for (const p of pares.values()) pontos.set(p.por, (pontos.get(p.por) || 0) + 0.5);
    const jogadores = j.ordem.map((p, i) => ({
      id: p.id,
      nome: pessoas.find((x) => x.id === p.id)?.nome || texto(p.nome),
      pares: pontos.get(p.id) || 0,
      daVez: v ? v.i % j.ordem.length === i : false,
      presente: pessoas.some((x) => x.id === p.id),
      eu: p.id === this.eu,
    }));
    const fim = pares.size === j.cartas.length;
    const maximo = Math.max(...jogadores.map((x) => x.pares));
    const daVez = this.daVez(j, v);
    const errou = !!v && v.abertas.length === 2 && j.cartas[v.abertas[0]] !== j.cartas[v.abertas[1]];
    return {
      fase: fim ? "fim" : "jogando",
      id: j.id,
      cartas,
      colunas: j.cartas.length === 12 ? 4 : j.cartas.length === 20 ? 5 : 6,
      jogadores,
      minhaVez: daVez?.id === this.eu && !fim,
      daVez: daVez ? { id: daVez.id, nome: pessoas.find((x) => x.id === daVez.id)?.nome || texto(daVez.nome), presente: pessoas.some((x) => x.id === daVez.id) } : null,
      jogadas: v?.k || 0,
      errou,
      ultimoPar: v?.ultimoPar || null,
      vencedores: fim ? jogadores.filter((x) => x.pares === maximo) : [],
      participo: j.ordem.some((p) => p.id === this.eu),
    };
  }
}

/* ================================================================== *
 * Sorteios: roleta, dados e moeda
 *
 * Quem gira sorteia o resultado e grava junto o momento; todo mundo anima
 * a roleta até o mesmo lugar, no mesmo tempo.
 * ================================================================== */

export const GIRO_MS = 4200;

export class Sorteios extends Emitter {
  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
  }
  get eu() {
    return this.estado.eu;
  }

  opcoes(pessoas = []) {
    const o = this.estado.ler("rl/opcoes");
    const lista = Array.isArray(o) ? o.map((x) => texto(x, 40).trim()).filter(Boolean).slice(0, 30) : [];
    return lista.length ? lista : pessoas.map((p) => texto(p.nome, 40) || "Convidado");
  }

  definirOpcoes(lista) {
    const limpa = lista.map((x) => String(x || "").trim().slice(0, 40)).filter(Boolean).slice(0, 30);
    this.estado.definir([["rl/opcoes", limpa.length ? limpa : null]]);
  }

  /** O histórico de cada um fica na chave dele: dois sorteios juntos não se apagam. */
  #historico(item) {
    const h = this.estado.ler(`rl/h/${this.eu}`);
    return [`rl/h/${this.eu}`, [item, ...(Array.isArray(h) ? h : [])].slice(0, 5)];
  }

  girar(pessoas = []) {
    const opcoes = this.opcoes(pessoas);
    if (opcoes.length < 2) return false;
    const alvo = aleatorio(opcoes.length);
    const inicio = this.agora();
    const nome = this.nome().slice(0, 40);
    this.estado.definir([
      ["rl/giro", { id: novoId(), opcoes, alvo, voltas: 4 + aleatorio(3), desvio: aleatorio(1000) / 1000, inicio, por: nome }],
      this.#historico({ t: "roleta", r: opcoes[alvo], por: nome, em: inicio + GIRO_MS }),
    ]);
    return true;
  }

  /** Tira o último sorteado da roleta (para sortear a ordem de todo mundo). */
  tirarSorteado(pessoas = []) {
    const g = this.estado.ler("rl/giro");
    if (!g || !Array.isArray(g.opcoes)) return;
    const resto = this.opcoes(pessoas).filter((x) => x !== g.opcoes[g.alvo]);
    this.definirOpcoes(resto);
  }

  rolar(qtd = 2) {
    const n = Math.max(1, Math.min(6, qtd));
    const valores = Array.from({ length: n }, () => 1 + aleatorio(6));
    const inicio = this.agora();
    const nome = this.nome().slice(0, 40);
    this.estado.definir([
      ["rl/dados", { id: novoId(), valores, inicio, por: nome }],
      this.#historico({ t: "dados", r: `${valores.join(" + ")}${n > 1 ? ` = ${valores.reduce((a, b) => a + b, 0)}` : ""}`, por: nome, em: inicio + 1200 }),
    ]);
  }

  moeda() {
    const lado = aleatorio(2) ? "cara" : "coroa";
    const inicio = this.agora();
    const nome = this.nome().slice(0, 40);
    this.estado.definir([
      ["rl/moeda", { id: novoId(), lado, giros: 4 + aleatorio(3), inicio, por: nome }],
      this.#historico({ t: "moeda", r: lado === "cara" ? "Cara" : "Coroa", por: nome, em: inicio + 1600 }),
    ]);
  }

  vista(pessoas = []) {
    const agora = this.agora();
    const g = this.estado.ler("rl/giro");
    const d = this.estado.ler("rl/dados");
    const m = this.estado.ler("rl/moeda");
    const h = [...this.estado.com("rl/h/")].flatMap(([, v]) => (Array.isArray(v) ? v.slice(0, 5) : []));
    const giro =
      g && Array.isArray(g.opcoes) && Number.isInteger(g.alvo) && g.alvo < g.opcoes.length
        ? { id: g.id, opcoes: g.opcoes.map((x) => texto(x, 40)), alvo: g.alvo, voltas: Math.min(8, Number(g.voltas) || 4), desvio: Math.max(0, Math.min(1, Number(g.desvio) || 0.5)), inicio: Number(g.inicio) || 0, por: texto(g.por), parado: agora >= (Number(g.inicio) || 0) + GIRO_MS }
        : null;
    return {
      opcoes: this.opcoes(pessoas),
      usandoNomes: !Array.isArray(this.estado.ler("rl/opcoes")),
      giro,
      dados: d && Array.isArray(d.valores) ? { id: d.id, valores: d.valores.filter((v) => Number.isInteger(v) && v >= 1 && v <= 6).slice(0, 6), inicio: Number(d.inicio) || 0, por: texto(d.por) } : null,
      moeda: m && (m.lado === "cara" || m.lado === "coroa") ? { id: m.id, lado: m.lado, giros: Math.min(8, Number(m.giros) || 4), inicio: Number(m.inicio) || 0, por: texto(m.por) } : null,
      historico: h
        .filter((x) => x && Number(x.em) <= agora)
        .sort((a, b) => Number(b.em) - Number(a.em))
        .slice(0, 8)
        .map((x) => ({ t: texto(x.t, 10), r: texto(x.r, 40), por: texto(x.por) })),
    };
  }
}
