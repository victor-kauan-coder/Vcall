/**
 * features/reacoes.js — reações e sinais da chamada, sem desenho.
 *
 * Dois tipos, como no Zoom e no Meet:
 *
 *   - REAÇÕES: um emoji que sobe do quadrinho de quem reagiu e some. Clicar
 *     várias vezes seguidas faz combo (×2, ×3…); a mesma reação de três
 *     pessoas em poucos segundos vira chuva na tela inteira.
 *   - SINAIS: ficam no quadrinho até a pessoa tirar (ou o tempo deles
 *     acabar): Sim, Não, Mais devagar, Mais rápido, Pode repetir?, Não estou
 *     ouvindo, Já volto. Sim e Não viram uma votação rápida, com a contagem
 *     na tela para todos.
 *
 * Tudo vai pelo canal direto da chamada (o mesmo do quadro), não pelo
 * servidor. Este arquivo só decide O QUÊ: o desenho está em ui/reacoes.js.
 */
import { Emitter } from "../lib/emitter.js";

/** Reações rápidas: id da rede -> emoji do sprite e nome para leitor de tela. */
export const REACOES = [
  { id: "joinha", emoji: "thumbs-up", nome: "Joinha" },
  { id: "amei", emoji: "red-heart", nome: "Amei" },
  { id: "risos", emoji: "face-with-tears-of-joy", nome: "Kkkk" },
  { id: "uau", emoji: "face-with-open-mouth", nome: "Uau" },
  { id: "palmas", emoji: "clapping-hands", nome: "Palmas" },
  { id: "festa", emoji: "party-popper", nome: "Festa" },
  { id: "fogo", emoji: "fire", nome: "Arrasou" },
  { id: "hmm", emoji: "thinking-face", nome: "Hmm…" },
  { id: "triste", emoji: "crying-face", nome: "Triste" },
  { id: "valeu", emoji: "folded-hands", nome: "Valeu" },
  { id: "cem", emoji: "hundred-points", nome: "Perfeito" },
  { id: "bora", emoji: "rocket", nome: "Bora!" },
  { id: "incrivel", emoji: "star-struck", nome: "Incrível" },
  { id: "isso", emoji: "raising-hands", nome: "Isso aí!" },
  { id: "olho", emoji: "eyes", nome: "Tô de olho" },
  { id: "apaixonado", emoji: "smiling-face-with-heart-eyes", nome: "Apaixonado" },
  { id: "morri", emoji: "skull", nome: "Morri" },
  { id: "explodiu", emoji: "exploding-head", nome: "Explodiu a mente" },
];

/**
 * Sinais que ficam no quadrinho, com os ícones do app (Lucide). `dura` em
 * ms (0 = até a pessoa tirar).
 * `grupo`: só um sinal de cada grupo por pessoa (Sim tira o Não).
 */
export const SINAIS = [
  { id: "sim", icone: "check", nome: "Sim", grupo: "voto", dura: 90_000 },
  { id: "nao", icone: "x", nome: "Não", grupo: "voto", dura: 90_000 },
  { id: "devagar", icone: "turtle", nome: "Mais devagar", grupo: "ritmo", dura: 45_000 },
  { id: "rapido", icone: "rabbit", nome: "Mais rápido", grupo: "ritmo", dura: 45_000 },
  { id: "repete", icone: "repeat", nome: "Pode repetir?", grupo: "pedido", dura: 30_000 },
  { id: "semaudio", icone: "volume-x", nome: "Não estou ouvindo", grupo: "pedido", dura: 30_000 },
  { id: "javolto", icone: "coffee", nome: "Já volto", grupo: "ausente", dura: 0 },
];

/** Reações do protocolo antigo (pelo servidor), para quem ainda manda assim. */
export const DO_ANTIGO = { like: "joinha", clap: "palmas", heart: "amei", laugh: "risos", wow: "uau", question: "hmm" };

const POR_ID = new Map(REACOES.map((r) => [r.id, r]));
const SINAL_POR_ID = new Map(SINAIS.map((s) => [s.id, s]));
export const reacao = (id) => POR_ID.get(id) || null;
export const sinal = (id) => SINAL_POR_ID.get(id) || null;

/** O que chegou pelo canal é uma reação ou um sinal válido? (Dado de fora.) */
export function validar(op) {
  if (!op || typeof op !== "object") return null;
  if (op.type === "reacao" && POR_ID.has(op.r)) {
    const n = Number.isInteger(op.n) ? Math.max(1, Math.min(20, op.n)) : 1;
    return { tipo: "reacao", id: op.r, n };
  }
  if (op.type === "sinal") {
    const lista = Array.isArray(op.s) ? op.s.filter((id) => SINAL_POR_ID.has(id)).slice(0, SINAIS.length) : [];
    return { tipo: "sinal", ids: [...new Set(lista)] };
  }
  return null;
}

/**
 * Cliques repetidos viram uma mensagem só, a cada `janela` ms, com a
 * quantidade. Na tela, o combo cresce na hora (sem esperar a rede); pela
 * rede, no máximo 4 mensagens por segundo, por mais rápido que se clique.
 */
export class Combo {
  #pendente = new Map(); // id -> quantos ainda não foram enviados
  #seq = { id: null, n: 0, ate: 0 };
  #timer = 0;

  constructor(enviar, { janela = 250, combo = 1200, agora = () => performance.now() } = {}) {
    this.enviar = enviar;
    this.janela = janela;
    this.combo = combo;
    this.agora = agora;
  }

  /** Um clique. Devolve o tamanho do combo atual (1, 2, 3…). */
  soltar(id) {
    const t = this.agora();
    this.#seq = this.#seq.id === id && t < this.#seq.ate ? { id, n: this.#seq.n + 1, ate: t + this.combo } : { id, n: 1, ate: t + this.combo };
    this.#pendente.set(id, (this.#pendente.get(id) || 0) + 1);
    if (!this.#timer) this.#timer = setTimeout(() => this.descarregar(), this.janela);
    return this.#seq.n;
  }

  descarregar() {
    clearTimeout(this.#timer);
    this.#timer = 0;
    for (const [id, n] of this.#pendente) this.enviar(id, Math.min(n, 20));
    this.#pendente.clear();
  }
}

/**
 * O combo de quem está do outro lado: os lotes que chegam (no máximo 4 por
 * segundo) somam enquanto não passar `janela` ms sem nenhum, para o "×5" ser
 * igual na tela de todos.
 */
export class ComboRemoto {
  #seq = new Map(); // "pessoa|id" -> { n, ate }

  constructor({ janela = 1500 } = {}) {
    this.janela = janela;
  }

  /** Chegaram `n` reações de alguém; devolve o tamanho do combo dessa pessoa. */
  somar(pessoa, id, n = 1, agora = performance.now()) {
    const chave = `${pessoa}|${id}`;
    const s = this.#seq.get(chave);
    const total = s && agora < s.ate ? Math.min(999, s.n + n) : n;
    this.#seq.set(chave, { n: total, ate: agora + this.janela });
    if (this.#seq.size > 200) for (const [k, v] of this.#seq) if (v.ate <= agora) this.#seq.delete(k);
    return total;
  }
}

/**
 * Chuva: a mesma reação de `pessoas` pessoas diferentes em `janela` ms.
 * Dispara uma vez e espera `pausa` ms antes de poder chover de novo.
 */
export class Chuva {
  #vistos = new Map(); // id -> Map(pessoa -> quando)
  #ultima = new Map(); // id -> quando choveu

  constructor({ pessoas = 3, janela = 4000, pausa = 6000 } = {}) {
    this.pessoas = pessoas;
    this.janela = janela;
    this.pausa = pessoas > 0 ? pausa : 0;
  }

  /** Registra uma reação; devolve true quando é hora de chover. */
  registrar(id, pessoa, agora = performance.now()) {
    const vistos = this.#vistos.get(id) || new Map();
    vistos.set(pessoa, agora);
    for (const [p, t] of vistos) if (agora - t > this.janela) vistos.delete(p);
    this.#vistos.set(id, vistos);
    if (vistos.size < this.pessoas) return false;
    if (agora - (this.#ultima.get(id) ?? -Infinity) < this.pausa) return false;
    this.#ultima.set(id, agora);
    return true;
  }
}

/**
 * Os sinais de cada pessoa. Emite "mudou" ({ pessoa, ids }) quando os sinais
 * de alguém mudam (inclusive quando vencem).
 */
export class Sinais extends Emitter {
  /** pessoa -> Map(id -> vence em (0 = nunca)) */
  #de = new Map();

  constructor({ agora = () => Date.now() } = {}) {
    super();
    this.agora = agora;
  }

  /** Os sinais ativos de alguém, em ordem do catálogo. */
  de(pessoa) {
    this.vencer();
    const m = this.#de.get(pessoa);
    return m ? SINAIS.filter((s) => m.has(s.id)).map((s) => s.id) : [];
  }

  /** Liga ou desliga um sinal de alguém (desliga o outro do mesmo grupo). */
  alternar(pessoa, id) {
    const s = sinal(id);
    if (!s) return this.de(pessoa);
    const m = new Map(this.#de.get(pessoa) || []);
    if (m.has(id)) m.delete(id);
    else {
      for (const outro of SINAIS) if (outro.grupo === s.grupo) m.delete(outro.id);
      m.set(id, s.dura ? this.agora() + s.dura : 0);
    }
    return this.#guardar(pessoa, m);
  }

  /** Substitui todos os sinais de alguém (o que chega pela rede). */
  definir(pessoa, ids) {
    const m = new Map();
    for (const id of ids || []) {
      const s = sinal(id);
      if (!s) continue;
      for (const outro of SINAIS) if (outro.grupo === s.grupo) m.delete(outro.id);
      // Quem recebe conta o próprio prazo: os relógios das máquinas não batem.
      m.set(id, s.dura ? this.agora() + s.dura : 0);
    }
    return this.#guardar(pessoa, m);
  }

  esquecer(pessoa) {
    if (this.#de.delete(pessoa)) this.emit("mudou", { pessoa, ids: [] });
  }

  limparTodos() {
    for (const pessoa of [...this.#de.keys()]) this.esquecer(pessoa);
  }

  /** Quantas pessoas estão com cada sinal (para a votação rápida na tela). */
  contagem() {
    this.vencer();
    const c = {};
    for (const m of this.#de.values()) for (const id of m.keys()) c[id] = (c[id] || 0) + 1;
    return c;
  }

  /** Quem está com cada sinal: { sim: [pessoa, …], … } (para o placar). */
  porSinal() {
    this.vencer();
    const out = {};
    for (const [pessoa, m] of this.#de) for (const id of m.keys()) (out[id] ||= []).push(pessoa);
    return out;
  }

  /** Tira os sinais vencidos. Devolve true se algo mudou. */
  vencer() {
    const t = this.agora();
    let mudou = false;
    for (const [pessoa, m] of this.#de) {
      let tirou = false;
      for (const [id, ate] of m) {
        if (ate && ate <= t) {
          m.delete(id);
          tirou = true;
        }
      }
      if (tirou) {
        mudou = true;
        if (!m.size) this.#de.delete(pessoa);
        this.emit("mudou", { pessoa, ids: m.size ? SINAIS.filter((s) => m.has(s.id)).map((s) => s.id) : [] });
      }
    }
    return mudou;
  }

  #guardar(pessoa, m) {
    const antes = (this.#de.get(pessoa) && [...this.#de.get(pessoa).keys()].sort().join()) || "";
    if (m.size) this.#de.set(pessoa, m);
    else this.#de.delete(pessoa);
    const ids = SINAIS.filter((s) => m.has(s.id)).map((s) => s.id);
    if ([...m.keys()].sort().join() !== antes) this.emit("mudou", { pessoa, ids });
    return ids;
  }
}
