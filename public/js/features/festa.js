/**
 * features/festa.js — os jogos de festa: Desenha e Adivinha, Mímica, Stop,
 * Quiz, Quem sou eu?, Roda de perguntas, Duas verdades e uma mentira e
 * Palavras-código. Só a lógica; o desenho fica em ui/festa.js.
 *
 * Tudo mora no mesmo estado compartilhado dos jogos de equipe
 * (EstadoJogos, em features/jogos.js): um mapa chave → valor que converge
 * igual em todo mundo, sem servidor novo. As regras de convivência:
 *
 *   - CADA UM ESCREVE O QUE É SEU. Resposta, voto e acerto vão numa chave
 *     com o id de quem jogou (`st/a/<id>`, `qz/r/<id>`…): duas pessoas
 *     jogando ao mesmo tempo nunca disputam a mesma chave.
 *   - O QUE É SEGREDO FICA EM CASA ATÉ A HORA. Como no Planning Poker: a
 *     resposta do Stop, o voto da Roda e a mentira das Duas verdades ficam
 *     no computador de quem jogou e só são publicados quando a rodada
 *     revela. A palavra do Desenha e Adivinha nunca sai do computador de
 *     quem desenha: os outros conferem o palpite por uma impressão digital
 *     (`resumo`).
 *   - RODADAS SÓ CRESCEM. Cada rodada tem um número `n` que nunca volta;
 *     respostas velhas, com outro `n`, são ignoradas sem precisar apagar.
 *   - O PLACAR SOMA UMA VEZ. `somarPlacar` lembra a última rodada somada;
 *     quem passa para a próxima rodada leva o placar junto, e dois cliques
 *     ao mesmo tempo dão o mesmo resultado.
 *   - TAREFA AUTOMÁTICA TEM DONO. Acabar o tempo, revelar quando todos
 *     votaram, passar a vez: quem faz é quem desenha (ou atua), ou o menor
 *     id presente (`lider`). `manter()` é chamado pelo relógio da tela.
 *
 * São jogos entre amigos: quem abrir o console consegue espiar uma ou outra
 * coisa (a ordem das cartas da memória, a chave das Palavras-código). O
 * que importa, voto e palavra secreta, não viaja antes da hora.
 */
import { Emitter } from "../lib/emitter.js";
import { aleatorio, compacto, desofuscar, embaralhar, lider, normalizar, novoId, ofuscar, resumo, somarPlacar, sortear } from "./jogos.js";
import {
  CATEGORIAS_STOP,
  EU_NUNCA,
  LETRAS_STOP,
  MIMICAS,
  PALAVRAS,
  PERSONAGENS,
  PREFERE,
  QUEBRA_GELO,
  QUEM_DA_CALL,
  QUIZ,
  STOP_PADRAO,
  TEMAS_QUIZ,
} from "./bancos.js";

const texto = (v, max = 60) => (typeof v === "string" ? v.slice(0, max) : "");
const nomesDe = (pessoas) => Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));
const presentesDe = (pessoas) => new Set(pessoas.map((p) => p.id));
const mesmaRodada = (v, n) => v && typeof v === "object" && v.n === n;

/** Distância de edição (para o "quase lá" do Desenha e Adivinha). */
export function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** A palavra com as letras escondidas ("gu____-c____"), revelando `letras`. */
export function mascara(palavra, letras = []) {
  const abertas = new Map(letras);
  return [...palavra].map((ch, i) => (/[\p{L}\p{N}]/u.test(ch) ? (abertas.get(i) ?? "_") : ch)).join("");
}

/**
 * A vez de cada um: quem vem depois de `k` na `ordem`, pulando quem saiu.
 * `total` é quantas vezes a roda gira (pessoas × voltas).
 */
export function proximoDaVez(ordem, k, presentes, total) {
  for (let j = k; j < total; j += 1) {
    const p = ordem[j % ordem.length];
    if (p && presentes.has(p.id)) return { k: j, pessoa: p };
  }
  return null;
}

/* ================================================================== *
 * Rodízio: a base do Desenha e Adivinha e da Mímica
 *
 * Uma pessoa por vez sabe a palavra (desenha ou imita); as outras
 * adivinham. A palavra nunca entra no estado antes do fim da vez.
 * ================================================================== */

class Rodizio extends Emitter {
  /** A palavra que eu escolhi: { n, palavra } — só existe no meu computador. */
  minha = null;
  #opcoes = null;
  #fimEscrito = 0;
  #proximaPedida = 0;

  constructor(estado, prefixo, banco, { nome = () => "", agora = () => Date.now(), tempo = 80 } = {}) {
    super();
    this.estado = estado;
    this.px = prefixo;
    this.banco = banco;
    this.nome = nome;
    this.agora = agora;
    this.tempoPadrao = tempo;
  }

  get eu() {
    return this.estado.eu;
  }
  get r() {
    const r = this.estado.ler(`${this.px}/r`);
    return r && typeof r === "object" && Number.isSafeInteger(r.n) ? r : null;
  }
  config() {
    const c = this.estado.ler(`${this.px}/cfg`) || {};
    return {
      tempo: [30, 45, 60, 80, 100, 120].includes(c.tempo) ? c.tempo : this.tempoPadrao,
      voltas: [1, 2, 3, 4].includes(c.voltas) ? c.voltas : 2,
      cat: typeof c.cat === "string" && (c.cat === "todas" || this.banco[c.cat]) ? c.cat : "todas",
    };
  }
  configurar(mudanca) {
    this.estado.definir([[`${this.px}/cfg`, { ...this.config(), ...mudanca }]]);
  }
  ordem() {
    const o = this.estado.ler(`${this.px}/ordem`);
    return Array.isArray(o) ? o.filter((p) => p && typeof p.id === "string").slice(0, 32) : [];
  }

  /** Começa um jogo novo com quem está na chamada, em ordem sorteada. */
  comecar(pessoas) {
    if (!pessoas.length) return;
    const ordem = embaralhar(pessoas.map((p) => ({ id: p.id, nome: String(p.nome || "").slice(0, 40) })));
    const n = (this.r?.n || 0) + 1;
    this.minha = null;
    this.estado.definir([
      [`${this.px}/ordem`, ordem],
      [`${this.px}/placar`, { n: n - 1, pts: {}, nomes: {} }],
      [`${this.px}/r`, { n, k: 0, de: ordem[0].id, nome: ordem[0].nome, fase: "escolhendo", total: ordem.length * this.config().voltas }],
    ]);
  }

  /** Três sugestões para quem está na vez (sorteadas aqui, não no estado). */
  opcoes({ trocar = false } = {}) {
    const r = this.r;
    if (!r) return [];
    if (!trocar && this.#opcoes?.n === r.n) return this.#opcoes.lista;
    const cat = this.config().cat;
    const cats = cat === "todas" ? Object.keys(this.banco) : [cat];
    const todas = cats.flatMap((c) => this.banco[c].map((p) => ({ palavra: p, cat: c })));
    this.#opcoes = { n: r.n, lista: sortear(todas, 3) };
    return this.#opcoes.lista;
  }

  /** Quem está na vez escolhe a palavra: o relógio começa para todos. */
  escolher(palavra, cat = "") {
    const r = this.r;
    const p = String(palavra || "").trim().slice(0, 40);
    if (!r || r.de !== this.eu || r.fase !== "escolhendo" || compacto(p).length < 2) return false;
    this.minha = { n: r.n, palavra: p };
    const sal = novoId();
    this.estado.definir([
      [
        `${this.px}/r`,
        {
          ...r,
          fase: "jogando",
          inicio: this.agora(),
          tempo: this.config().tempo,
          sal,
          h: resumo(compacto(p), sal),
          forma: mascara(p),
          cat: String(cat || "").slice(0, 20),
        },
      ],
    ]);
    this.emit("escolheu", { n: r.n });
    return true;
  }

  /** Fim da vez (todos acertaram, tempo acabou, ou quem joga encerrou). */
  encerrar(extra = {}) {
    const r = this.r;
    if (!r || r.fase !== "jogando" || this.#fimEscrito === r.n) return;
    const fim = this.estado.ler(`${this.px}/fim`);
    if (mesmaRodada(fim, r.n)) return;
    this.#fimEscrito = r.n;
    const palavra = this.minha?.n === r.n ? this.minha.palavra : null;
    this.estado.definir([[`${this.px}/fim`, { n: r.n, palavra, ...extra }]]);
  }

  /** Pontos desta vez, por pessoa (calculado igual em todo computador). */
  pontosDaVez() {
    return {};
  }

  /** Passa para a próxima pessoa (ou termina o jogo), somando o placar. */
  proxima(pessoas) {
    const r = this.r;
    if (!r || r.fase === "fim") return;
    const ordem = this.ordem();
    const total = Number(r.total) || ordem.length * this.config().voltas;
    const placar = somarPlacar(this.estado.ler(`${this.px}/placar`), r.n, this.pontosDaVez(r, pessoas), { ...nomesDe(ordem), ...nomesDe(pessoas) });
    const seguinte = proximoDaVez(ordem, (Number(r.k) || 0) + 1, presentesDe(pessoas), total);
    const novo = seguinte
      ? { n: r.n + 1, k: seguinte.k, de: seguinte.pessoa.id, nome: seguinte.pessoa.nome, fase: "escolhendo", total }
      : { n: r.n + 1, k: total, fase: "fim", total };
    this.estado.definir([
      [`${this.px}/placar`, placar],
      [`${this.px}/r`, novo],
    ]);
  }

  /** Quem está na vez sumiu ou não quer jogar: pula sem pontos para ele. */
  pular(pessoas) {
    this.proxima(pessoas);
  }

  restante(r = this.r) {
    if (!r || r.fase !== "jogando") return 0;
    return Math.max(0, (Number(r.inicio) + Number(r.tempo) * 1000 - this.agora()) / 1000);
  }

  /** Estado da vez: "lobby", "escolhendo", "jogando", "revelada" ou "fim". */
  fase() {
    const r = this.r;
    if (!r) return "lobby";
    if (r.fase === "fim") return "fim";
    if (r.fase === "escolhendo") return "escolhendo";
    return mesmaRodada(this.estado.ler(`${this.px}/fim`), r.n) ? "revelada" : "jogando";
  }

  /**
   * As tarefas automáticas, chamadas pelo relógio da tela: encerrar quando
   * o tempo acaba e passar a vez alguns segundos depois da revelação.
   */
  manter(pessoas) {
    const r = this.r;
    if (!r) return;
    const fase = this.fase();
    const souDaVez = r.de === this.eu;
    const daVezAqui = presentesDe(pessoas).has(r.de);
    const souLider = lider(pessoas) === this.eu;
    if (fase === "jogando") {
      // Quem joga encerra na hora; o líder, se quem joga saiu, ou com folga
      // depois do tempo (quem joga pode ter fechado a mesa).
      const acabou = this.terminou(r, pessoas);
      const folga = this.agora() > Number(r.inicio) + Number(r.tempo) * 1000 + 3000;
      if ((souDaVez && acabou) || (souLider && !souDaVez && (!daVezAqui || (acabou && folga)))) this.encerrar();
    } else if (fase === "revelada") {
      // Passa a vez uns segundos depois de revelar.
      if (!this.#visto.has(r.n)) this.#visto.set(r.n, this.agora());
      const espera = this.agora() - this.#visto.get(r.n);
      if (this.#proximaPedida !== r.n && ((souDaVez && espera > 6000) || (souLider && espera > (daVezAqui ? 12000 : 8000)))) {
        this.#proximaPedida = r.n;
        this.proxima(pessoas);
      }
    } else if (fase === "escolhendo" && !daVezAqui && souLider && this.#proximaPedida !== r.n) {
      // Quem tinha a vez saiu antes de escolher: passa para o próximo.
      this.#proximaPedida = r.n;
      this.proxima(pessoas);
    }
  }
  #visto = new Map();

  /** A vez acabou? (o tempo, ou outra regra de cada jogo) */
  terminou(r) {
    return this.restante(r) <= 0;
  }
}

/* ================================================================== *
 * Desenha e Adivinha
 * ================================================================== */

/** Cores e espessuras do lápis (o que chega de fora tem de estar aqui). */
export const CORES_LAPIS = ["#1f1f1f", "#ffffff", "#9aa0a6", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#8e24aa", "#ec407a", "#795548"];
export const ESPESSURAS = [4, 10, 22];
export const TELA = { w: 800, h: 600 };
const MAX_PONTOS_TRACO = 4000;
const MAX_TRACOS = 600;

export class Desenho extends Rodizio {
  /** Os traços da vez atual: id -> { cor, esp, p: [x, y, x, y, …] } */
  tracos = new Map();
  tracosDe = -1;
  /** O que foi dito na vez atual: palpites errados, "quase", acertos. */
  conversa = [];
  #pendente = new Map();
  #timer = 0;
  #dicas = 0;

  constructor(estado, o = {}) {
    super(estado, "dz", PALAVRAS, { tempo: 80, ...o });
    estado.on("mudou", (chaves) => this.#aoMudar(chaves));
  }

  #aoMudar(chaves) {
    const r = this.r;
    if (!r) return;
    if (this.tracosDe !== r.n) {
      this.tracos.clear();
      this.conversa = [];
      this.tracosDe = r.n;
      this.#dicas = 0;
      this.emit("tela", { tipo: "limpa" });
    }
    for (const k of chaves) {
      if (!k.startsWith("dz/ok/")) continue;
      const ok = this.estado.ler(k);
      if (mesmaRodada(ok, r.n) && !this.conversa.some((c) => c.tipo === "acertou" && c.de === k.slice(6))) {
        this.conversa.push({ tipo: "acertou", de: k.slice(6), nome: texto(ok.nome, 40) || "Alguém" });
        this.emit("conversa");
      }
    }
  }

  config() {
    return super.config();
  }

  acertos(r = this.r) {
    if (!r) return [];
    const out = [];
    for (const [k, v] of this.estado.com("dz/ok/")) if (mesmaRodada(v, r.n)) out.push({ id: k.slice(6), nome: texto(v.nome, 40), t: Math.max(0, Math.min(1, Number(v.t) || 0)) });
    return out.sort((a, b) => b.t - a.t);
  }

  acertei() {
    const r = this.r;
    return !!r && mesmaRodada(this.estado.ler(`dz/ok/${this.eu}`), r.n);
  }

  /** Um palpite. Certo: vira acerto no estado. Errado: aparece na conversa. */
  chutar(palpite) {
    const r = this.r;
    const t = String(palpite || "").trim().slice(0, 60);
    if (!r || this.fase() !== "jogando" || r.de === this.eu || this.acertei() || !t) return "nada";
    if (resumo(compacto(t), r.sal) === r.h) {
      const fracao = Math.max(0, Math.min(1, this.restante(r) / Number(r.tempo)));
      this.estado.definir([[`dz/ok/${this.eu}`, { n: r.n, t: Math.round(fracao * 1000) / 1000, nome: this.nome().slice(0, 40) }]]);
      return "acertou";
    }
    this.conversa.push({ tipo: "chute", de: this.eu, nome: "Você", texto: t, meu: true });
    this.emit("conversa");
    this.emit("evento", { tipo: "chute", n: r.n, t });
    return "errou";
  }

  /** Pontos: quem acerta ganha mais quanto mais cedo; quem desenha, por acerto. */
  pontosDaVez(r = this.r) {
    const pts = {};
    if (!r || !r.de) return pts;
    const acertos = this.acertos(r);
    for (const a of acertos) pts[a.id] = 50 + Math.round(250 * a.t);
    if (acertos.length) pts[r.de] = (pts[r.de] || 0) + 60 * acertos.length;
    return pts;
  }

  terminou(r, pessoas = []) {
    if (this.restante(r) <= 0) return true;
    const adivinham = pessoas.filter((p) => p.id !== r.de);
    const acertaram = new Set(this.acertos(r).map((a) => a.id));
    return adivinham.length > 0 && adivinham.every((p) => acertaram.has(p.id));
  }

  /** Dicas: com metade e com um quarto do tempo, quem desenha abre uma letra. */
  manter(pessoas) {
    super.manter(pessoas);
    const r = this.r;
    if (!r || r.de !== this.eu || this.fase() !== "jogando" || this.minha?.n !== r.n) return;
    const letras = [...this.minha.palavra].map((ch, i) => [i, ch]).filter(([, ch]) => /[\p{L}\p{N}]/u.test(ch));
    if (letras.length < 4) return;
    const fracao = this.restante(r) / Number(r.tempo);
    const querem = fracao < 0.25 ? 2 : fracao < 0.5 ? 1 : 0;
    const dica = this.estado.ler("dz/dica");
    const ja = mesmaRodada(dica, r.n) && Array.isArray(dica.l) ? dica.l : [];
    if (querem > ja.length && this.#dicas < querem && ja.length < Math.floor(letras.length / 3)) {
      this.#dicas = querem;
      const fechadas = letras.filter(([i]) => !ja.some(([j]) => j === i));
      const nova = fechadas[aleatorio(fechadas.length)];
      if (nova) this.estado.definir([["dz/dica", { n: r.n, l: [...ja, nova] }]]);
    }
  }

  /** A palavra como aparece para quem adivinha: tracinhos e as letras de dica. */
  formaVisivel(r = this.r) {
    if (!r?.forma) return "";
    const dica = this.estado.ler("dz/dica");
    const letras = mesmaRodada(dica, r.n) && Array.isArray(dica.l) ? dica.l.filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && typeof x[1] === "string" && x[1].length === 1) : [];
    const abertas = new Map(letras);
    return [...String(r.forma)].map((ch, i) => (ch === "_" && abertas.has(i) ? abertas.get(i) : ch)).join("");
  }

  /* -------------------------- traços --------------------------- */

  /** Quem desenha: começa um traço. Devolve o id. */
  iniciarTraco(cor, esp, x, y) {
    const r = this.r;
    if (!r || r.de !== this.eu || this.fase() !== "jogando") return null;
    if (this.tracos.size >= MAX_TRACOS) return null;
    const id = novoId().slice(0, 8);
    const t = { cor: CORES_LAPIS.includes(cor) ? cor : CORES_LAPIS[0], esp: ESPESSURAS.includes(esp) ? esp : ESPESSURAS[0], p: [] };
    this.tracos.set(id, t);
    this.estenderTraco(id, x, y);
    return id;
  }

  estenderTraco(id, x, y) {
    const t = this.tracos.get(id);
    if (!t || t.p.length >= MAX_PONTOS_TRACO) return;
    const px = Math.round(Math.max(0, Math.min(TELA.w, x)));
    const py = Math.round(Math.max(0, Math.min(TELA.h, y)));
    t.p.push(px, py);
    this.emit("tela", { tipo: "ponto", id, t });
    const fila = this.#pendente.get(id) || [];
    fila.push(px, py);
    this.#pendente.set(id, fila);
    // Pela rede, no máximo ~16 pacotes por segundo, com vários pontos cada.
    if (!this.#timer) this.#timer = setTimeout(() => this.#descarregar(), 60);
  }

  #descarregar() {
    clearTimeout(this.#timer);
    this.#timer = 0;
    const r = this.r;
    if (!r) return;
    for (const [id, p] of this.#pendente) {
      const t = this.tracos.get(id);
      if (t) this.emit("evento", { tipo: "tr", n: r.n, id, c: t.cor, e: t.esp, p, rapido: true });
    }
    this.#pendente.clear();
  }

  /** Fim do traço: manda o traço inteiro (chega mesmo a quem perdeu pedaços). */
  terminarTraco(id) {
    this.#descarregar();
    const r = this.r;
    const t = this.tracos.get(id);
    if (r && t) this.emit("evento", { tipo: "trc", n: r.n, id, c: t.cor, e: t.esp, p: t.p });
  }

  desfazer() {
    const r = this.r;
    if (!r || r.de !== this.eu) return;
    const ultimo = [...this.tracos.keys()].pop();
    if (!ultimo) return;
    this.tracos.delete(ultimo);
    this.emit("tela", { tipo: "refaz" });
    this.emit("evento", { tipo: "desfaz", n: r.n, id: ultimo });
  }

  limparTela() {
    const r = this.r;
    if (!r || r.de !== this.eu) return;
    this.tracos.clear();
    this.emit("tela", { tipo: "limpa" });
    this.emit("evento", { tipo: "limpa", n: r.n });
  }

  /** Para quem acabou de entrar: o desenho até agora (só quem desenha manda). */
  paraQuemChegou() {
    const r = this.r;
    if (!r || r.de !== this.eu || this.fase() === "escolhendo") return [];
    // Pacotes de até ~48 KB: o canal direto não aceita mensagens enormes.
    const pacotes = [];
    let atual = [];
    let tamanho = 0;
    for (const [id, t] of this.tracos) {
      const x = { id, c: t.cor, e: t.esp, p: t.p };
      const peso = t.p.length * 4 + 40;
      if (atual.length && (tamanho + peso > 48_000 || atual.length >= 50)) {
        pacotes.push({ tipo: "tudo", n: r.n, tracos: atual });
        atual = [];
        tamanho = 0;
      }
      atual.push(x);
      tamanho += peso;
    }
    if (atual.length) pacotes.push({ tipo: "tudo", n: r.n, tracos: atual });
    return pacotes;
  }

  /** Chegou algo de outro participante pelo canal (dado de fora: conferido). */
  receber(de, d) {
    const r = this.r;
    if (!r || !d || typeof d !== "object" || d.n !== r.n) return;
    if (d.tipo === "chute") {
      if (de === r.de || mesmaRodada(this.estado.ler(`dz/ok/${de}`), r.n)) return;
      const t = texto(d.t, 60).trim();
      if (!t) return;
      this.conversa.push({ tipo: "chute", de, texto: t });
      if (this.conversa.length > 200) this.conversa.splice(0, this.conversa.length - 200);
      // Quem desenha sabe a palavra: avisa quem chegou perto.
      if (this.minha?.n === r.n && distancia(compacto(t), compacto(this.minha.palavra)) === 1) this.emit("evento", { tipo: "quase", n: r.n, quem: de });
      this.emit("conversa");
      return;
    }
    if (d.tipo === "quase") {
      if (de !== r.de || typeof d.quem !== "string") return;
      this.conversa.push({ tipo: "quase", de: d.quem });
      this.emit("conversa");
      return;
    }
    // Daqui para baixo, só quem está desenhando mexe na tela.
    if (de !== r.de) return;
    const traco = (x) => {
      if (!x || typeof x.id !== "string" || x.id.length > 16 || !Array.isArray(x.p)) return null;
      const p = x.p.slice(0, MAX_PONTOS_TRACO).map((v) => Math.round(Math.max(0, Math.min(TELA.w, Number(v) || 0))));
      return { id: x.id, cor: CORES_LAPIS.includes(x.c) ? x.c : CORES_LAPIS[0], esp: ESPESSURAS.includes(x.e) ? x.e : ESPESSURAS[0], p };
    };
    if (d.tipo === "tr" || d.tipo === "trc") {
      const t = traco(d);
      if (!t) return;
      const atual = this.tracos.get(t.id);
      if (!atual && this.tracos.size >= MAX_TRACOS) return;
      if (d.tipo === "trc" || !atual) this.tracos.set(t.id, { cor: t.cor, esp: t.esp, p: t.p });
      else if (atual.p.length < MAX_PONTOS_TRACO) atual.p.push(...t.p);
      this.emit("tela", d.tipo === "trc" && atual ? { tipo: "refaz" } : { tipo: "ponto", id: t.id, t: this.tracos.get(t.id) });
    } else if (d.tipo === "tudo" && Array.isArray(d.tracos)) {
      for (const x of d.tracos.slice(0, 50)) {
        const t = traco(x);
        if (t && (this.tracos.has(t.id) || this.tracos.size < MAX_TRACOS)) this.tracos.set(t.id, { cor: t.cor, esp: t.esp, p: t.p });
      }
      this.emit("tela", { tipo: "refaz" });
    } else if (d.tipo === "desfaz" && typeof d.id === "string") {
      if (this.tracos.delete(d.id)) this.emit("tela", { tipo: "refaz" });
    } else if (d.tipo === "limpa") {
      this.tracos.clear();
      this.emit("tela", { tipo: "limpa" });
    }
  }
}

/* ================================================================== *
 * Mímica
 * ================================================================== */

export class Mimica extends Rodizio {
  constructor(estado, o = {}) {
    super(estado, "mm", MIMICAS, { tempo: 60, ...o });
  }

  /** Quem imita aponta quem acertou: os dois ganham pontos, e a vez acaba. */
  acertou(quem, nomeQuem = "") {
    const r = this.r;
    if (!r || r.de !== this.eu || this.fase() !== "jogando" || quem === this.eu) return;
    this.encerrar({ quem: String(quem).slice(0, 64), nomeQuem: String(nomeQuem).slice(0, 40), t: Math.round((this.restante(r) / Number(r.tempo)) * 1000) / 1000 });
  }

  pontosDaVez(r = this.r) {
    const fim = this.estado.ler("mm/fim");
    if (!r || !mesmaRodada(fim, r.n) || !fim.quem) return {};
    return { [fim.quem]: 100 + Math.round(100 * (Number(fim.t) || 0)), [r.de]: 75 };
  }
}

/* ================================================================== *
 * Stop (Adedonha)
 * ================================================================== */

export class Stop extends Emitter {
  /** O que eu escrevi nesta rodada: { n, resp: { categoria: texto } } */
  minhas = { n: 0, resp: {} };

  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
    estado.on("mudou", () => this.publicarSegredos());
  }

  get eu() {
    return this.estado.eu;
  }
  get r() {
    const r = this.estado.ler("st/r");
    return r && Number.isSafeInteger(r.n) && /^[A-Z]$/.test(r.letra) ? r : null;
  }
  config() {
    const c = this.estado.ler("st/cfg") || {};
    const cats = Array.isArray(c.cats) ? c.cats.filter((x) => CATEGORIAS_STOP[x]).slice(0, 12) : [];
    return { cats: cats.length ? cats : STOP_PADRAO, tempo: [0, 60, 90, 120, 180].includes(c.tempo) ? c.tempo : 0 };
  }
  configurar(mudanca) {
    this.estado.definir([["st/cfg", { ...this.config(), ...mudanca }]]);
  }
  alternarCategoria(id) {
    const cats = this.config().cats;
    if (!CATEGORIAS_STOP[id]) return;
    const nova = cats.includes(id) ? cats.filter((c) => c !== id) : [...cats, id];
    if (nova.length >= 3 && nova.length <= 12) this.configurar({ cats: nova });
  }

  parado(r = this.r) {
    return !!r && mesmaRodada(this.estado.ler("st/stop"), r.n);
  }

  /** Sorteia a letra e começa outra rodada (somando o placar da anterior). */
  novaRodada(pessoas = []) {
    const r = this.r;
    const usadas = typeof r?.usadas === "string" ? r.usadas : "";
    let livres = [...LETRAS_STOP].filter((l) => !usadas.includes(l));
    if (!livres.length) livres = [...LETRAS_STOP];
    const letra = livres[aleatorio(livres.length)];
    const pares = [];
    if (r && this.parado(r)) {
      const v = this.vista(pessoas);
      pares.push(["st/placar", somarPlacar(this.estado.ler("st/placar"), r.n, Object.fromEntries(v.jogadores.map((j) => [j.id, j.pontos])), nomesDe(v.jogadores))]);
    }
    pares.push(["st/r", { n: (r?.n || 0) + 1, letra, inicio: this.agora(), usadas: (livres.length === LETRAS_STOP.length ? "" : usadas) + letra, cats: this.config().cats }]);
    this.estado.definir(pares);
  }

  novoJogo() {
    const r = this.r;
    this.estado.definir([
      ["st/placar", { n: r?.n || 0, pts: {}, nomes: {} }],
      ["st/r", null],
    ]);
  }

  escrever(cat, valor) {
    const r = this.r;
    if (!r || this.parado(r)) return;
    if (this.minhas.n !== r.n) this.minhas = { n: r.n, resp: {} };
    this.minhas.resp[cat] = String(valor || "").slice(0, 40);
  }

  minhaResposta(cat) {
    const r = this.r;
    return r && this.minhas.n === r.n ? this.minhas.resp[cat] || "" : "";
  }

  /** Dá para gritar STOP quando tudo está preenchido com a letra certa. */
  podeParar() {
    const r = this.r;
    if (!r || this.parado(r)) return false;
    return (r.cats || this.config().cats).every((c) => valida(this.minhaResposta(c), r.letra));
  }

  gritarStop() {
    const r = this.r;
    if (!this.podeParar()) return false;
    this.estado.definir([
      ["st/stop", { n: r.n, por: this.eu, nome: this.nome().slice(0, 40), em: this.agora() }],
      ["st/a/" + this.eu, { n: r.n, nome: this.nome().slice(0, 40), resp: this.#respostas(r) }],
    ]);
    return true;
  }

  #respostas(r) {
    const out = {};
    for (const c of r.cats || this.config().cats) out[c] = this.minhaResposta(c);
    return out;
  }

  /** Alguém gritou STOP (ou o tempo acabou): a minha resposta vai para todos. */
  publicarSegredos() {
    const r = this.r;
    if (!r || !this.parado(r) || this.minhas.n !== r.n) return;
    if (mesmaRodada(this.estado.ler(`st/a/${this.eu}`), r.n)) return;
    this.estado.definir([[`st/a/${this.eu}`, { n: r.n, nome: this.nome().slice(0, 40), resp: this.#respostas(r) }]]);
  }

  /** Voto para anular a resposta de alguém (palavra que não existe, letra errada…). */
  vetar(alvo, cat) {
    const r = this.r;
    if (!r || !this.parado(r) || alvo === this.eu) return;
    const atual = this.estado.ler(`st/v/${this.eu}`);
    const lista = mesmaRodada(atual, r.n) && Array.isArray(atual.vetos) ? atual.vetos : [];
    const chave = `${alvo}:${cat}`;
    const nova = lista.includes(chave) ? lista.filter((x) => x !== chave) : [...lista, chave].slice(-120);
    this.estado.definir([[`st/v/${this.eu}`, { n: r.n, vetos: nova }]]);
  }

  restante(r = this.r) {
    const tempo = this.config().tempo;
    if (!r || !tempo || this.parado(r)) return null;
    return Math.max(0, (Number(r.inicio) + tempo * 1000 - this.agora()) / 1000);
  }

  manter(pessoas) {
    const r = this.r;
    if (!r || this.parado(r)) return;
    if (this.restante(r) === 0 && lider(pessoas) === this.eu) {
      this.estado.definir([["st/stop", { n: r.n, por: null, nome: "", em: this.agora() }]]);
    }
  }

  vista(pessoas = []) {
    const r = this.r;
    const cfg = this.config();
    const placar = this.estado.ler("st/placar");
    if (!r) return { fase: "lobby", cfg, placar };
    const cats = (Array.isArray(r.cats) ? r.cats : cfg.cats).filter((c) => CATEGORIAS_STOP[c]);
    const parado = this.parado(r);
    const stop = this.estado.ler("st/stop");
    const base = { fase: parado ? "conferindo" : "escrevendo", n: r.n, letra: r.letra, cats: cats.map((id) => ({ id, nome: CATEGORIAS_STOP[id] })), cfg, placar, restante: this.restante(r) };
    if (!parado) return base;

    const respostas = [];
    for (const [k, a] of this.estado.com("st/a/")) if (mesmaRodada(a, r.n) && a.resp && typeof a.resp === "object") respostas.push({ id: k.slice(5), nome: texto(a.nome, 40) || "Alguém", resp: a.resp });
    const vetos = new Map();
    for (const [k, v] of this.estado.com("st/v/")) {
      if (!mesmaRodada(v, r.n) || !Array.isArray(v.vetos)) continue;
      const quem = k.slice(5);
      for (const x of v.vetos) if (typeof x === "string" && !x.startsWith(`${quem}:`)) vetos.set(x, [...(vetos.get(x) || []), quem]);
    }
    const outros = Math.max(1, respostas.length - 1);
    const jogadores = respostas.map((j) => ({ ...j, pontos: 0, celulas: {} }));
    for (const c of cats) {
      const validas = jogadores.map((j) => {
        const t = texto(j.resp[c], 40).trim();
        const contra = vetos.get(`${j.id}:${c}`) || [];
        const ok = valida(t, r.letra);
        const vetada = ok && contra.length > outros / 2;
        return { j, t, ok: ok && !vetada, vetada, contra, chave: compacto(t) };
      });
      for (const v of validas) {
        const iguais = v.ok ? validas.filter((x) => x.ok && x.chave === v.chave).length : 0;
        const pontos = !v.ok ? 0 : iguais > 1 ? 5 : 10;
        v.j.pontos += pontos;
        v.j.celulas[c] = { texto: v.t, valida: v.ok, vetada: v.vetada, letraErrada: !!v.t && !valida(v.t, r.letra), repetida: iguais > 1, pontos, vetos: v.contra.length, meuVeto: v.contra.includes(this.eu) };
      }
    }
    jogadores.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
    return { ...base, jogadores, quemParou: stop?.por ? { id: stop.por, nome: texto(stop.nome, 40) } : null, presentes: pessoas.length };
  }
}

/** A resposta começa com a letra da rodada (sem contar acento)? */
export function valida(resposta, letra) {
  const t = normalizar(resposta);
  return t.length >= 2 && !!letra && t[0] === normalizar(letra)[0];
}

/* ================================================================== *
 * Quiz
 * ================================================================== */

const LETRAS_QUIZ = ["A", "B", "C", "D"];

export class Quiz extends Emitter {
  #revelouEm = new Map();
  #pedida = "";

  constructor(estado, { nome = () => "", agora = () => Date.now(), banco = QUIZ } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
    this.banco = banco;
  }

  get eu() {
    return this.estado.eu;
  }
  config() {
    const c = this.estado.ler("qz/cfg") || {};
    return {
      tema: c.tema === "todos" || TEMAS_QUIZ[c.tema] ? c.tema : "todos",
      qtd: [5, 10, 15, 20].includes(c.qtd) ? c.qtd : 10,
      tempo: [10, 15, 20, 30].includes(c.tempo) ? c.tempo : 20,
    };
  }
  configurar(m) {
    this.estado.definir([["qz/cfg", { ...this.config(), ...m }]]);
  }
  /** O jogo em andamento — conferido: cada pergunta existe e as opções são uma permutação de 0 a 3. */
  jogo() {
    const j = this.estado.ler("qz/jogo");
    if (!j || typeof j.id !== "string" || !Array.isArray(j.qs) || !j.qs.length || j.qs.length > 30) return null;
    const ok = j.qs.every((x) => x && Number.isInteger(x.i) && this.banco[x.i] && Array.isArray(x.o) && x.o.length === 4 && [0, 1, 2, 3].every((k) => x.o.includes(k)));
    return ok ? j : null;
  }
  passo() {
    const p = this.estado.ler("qz/p");
    const j = this.jogo();
    return j && p && p.id === j.id && Number.isInteger(p.k) ? p : null;
  }

  /** Sorteia as perguntas (e a ordem das opções), igual para todos. */
  comecar() {
    const cfg = this.config();
    const indices = this.banco.map((q, i) => [q, i]).filter(([q]) => cfg.tema === "todos" || q.t === cfg.tema).map(([, i]) => i);
    const qs = sortear(indices, cfg.qtd).map((i) => ({ i, o: embaralhar([0, 1, 2, 3]) }));
    const id = novoId();
    this.estado.definir([
      ["qz/jogo", { id, qs, tempo: cfg.tempo }],
      ["qz/p", { id, k: 0, inicio: this.agora() + 3000 }], // 3, 2, 1…
    ]);
  }

  pergunta(k = this.passo()?.k) {
    const j = this.jogo();
    const item = j?.qs?.[k];
    const q = item && this.banco[item.i];
    if (!q || !Array.isArray(item.o)) return null;
    return { texto: q.q, tema: TEMAS_QUIZ[q.t] || "", opcoes: item.o.map((x) => q.o[x]), certa: item.o.indexOf(q.c) };
  }

  minha() {
    const j = this.jogo();
    const r = this.estado.ler(`qz/r/${this.eu}`);
    return j && r && r.id === j.id ? r : null;
  }

  /** Responde a pergunta atual; os pontos dependem da rapidez. */
  responder(escolha) {
    const j = this.jogo();
    const p = this.passo();
    const q = this.pergunta();
    if (!j || !p || !q || !Number.isInteger(escolha) || escolha < 0 || escolha > 3) return false;
    const agora = this.agora();
    const ms = agora - Number(p.inicio);
    const limite = Number(j.tempo || 20) * 1000;
    if (ms < 0 || ms > limite || this.revelada()) return false;
    const minha = this.minha();
    if (minha && minha.k === p.k) return false; // uma resposta por pergunta
    const certo = escolha === q.certa;
    const pontos = certo ? Math.round(1000 * (1 - ms / limite / 2)) : 0;
    const anterior = minha ? Number(minha.total) || 0 : 0;
    const seq = certo ? (minha && minha.k === p.k - 1 && minha.certo ? (Number(minha.seq) || 0) + 1 : 1) : 0;
    this.estado.definir([
      [`qz/r/${this.eu}`, { id: j.id, k: p.k, e: escolha, ms, certo, pontos, total: anterior + pontos, acertos: (minha ? Number(minha.acertos) || 0 : 0) + (certo ? 1 : 0), seq, nome: this.nome().slice(0, 40) }],
    ]);
    return true;
  }

  respostas() {
    const j = this.jogo();
    const out = [];
    if (!j) return out;
    for (const [k, r] of this.estado.com("qz/r/")) if (r?.id === j.id) out.push({ ...r, id: k.slice(5), nome: texto(r.nome, 40) });
    return out;
  }

  /** Revelada: acabou o tempo, ou todo mundo presente respondeu. */
  revelada(pessoas = null) {
    const j = this.jogo();
    const p = this.passo();
    if (!j || !p) return false;
    if (this.agora() > Number(p.inicio) + Number(j.tempo || 20) * 1000) return true;
    if (!pessoas?.length) return false;
    const responderam = new Set(this.respostas().filter((r) => r.k === p.k).map((r) => r.id));
    return pessoas.every((x) => responderam.has(x.id));
  }

  proxima() {
    const j = this.jogo();
    const p = this.passo();
    if (!j || !p) return;
    this.estado.definir([["qz/p", { id: j.id, k: p.k + 1, inicio: this.agora() + 1500 }]]);
  }

  encerrar() {
    this.estado.definir([
      ["qz/jogo", null],
      ["qz/p", null],
    ]);
  }

  /** O líder passa para a próxima pergunta 6 s depois de revelar. */
  manter(pessoas) {
    const j = this.jogo();
    const p = this.passo();
    if (!j || !p || p.k >= j.qs.length || !this.revelada(pessoas)) return;
    const chave = `${j.id}/${p.k}`;
    if (!this.#revelouEm.has(chave)) {
      this.#revelouEm.set(chave, this.agora());
      this.emit("revelou", { k: p.k });
    }
    if (lider(pessoas) === this.eu && this.#pedida !== chave && this.agora() - this.#revelouEm.get(chave) > 6000) {
      this.#pedida = chave;
      this.proxima();
    }
  }

  vista(pessoas = []) {
    const j = this.jogo();
    const p = this.passo();
    const cfg = this.config();
    if (!j || !p) return { fase: "lobby", cfg, temas: TEMAS_QUIZ };
    const respostas = this.respostas();
    const placar = respostas
      .map((r) => ({ id: r.id, nome: pessoas.find((x) => x.id === r.id)?.nome || r.nome || "Saiu", total: Number(r.total) || 0, acertos: Number(r.acertos) || 0, seq: Number(r.seq) || 0, eu: r.id === this.eu }))
      .sort((a, b) => b.total - a.total);
    if (p.k >= j.qs.length) return { fase: "fim", placar, total: j.qs.length, cfg };
    const q = this.pergunta(p.k);
    const agora = this.agora();
    const limite = Number(j.tempo || 20);
    const desta = respostas.filter((r) => r.k === p.k);
    const revelada = this.revelada(pessoas);
    const minha = this.minha();
    return {
      fase: agora < Number(p.inicio) ? "preparar" : revelada ? "revelada" : "pergunta",
      k: p.k,
      total: j.qs.length,
      contagem: Math.max(0, Math.ceil((Number(p.inicio) - agora) / 1000)),
      restante: Math.max(0, limite - (agora - Number(p.inicio)) / 1000),
      limite,
      pergunta: q,
      letras: LETRAS_QUIZ,
      minha: minha && minha.k === p.k ? minha : null,
      responderam: desta.length,
      faltam: pessoas.filter((x) => !desta.some((r) => r.id === x.id)).length,
      porOpcao: revelada ? [0, 1, 2, 3].map((o) => desta.filter((r) => r.e === o).map((r) => r.nome)) : null,
      placar,
      cfg,
    };
  }
}

/* ================================================================== *
 * Quem sou eu?
 * ================================================================== */

export class QuemSouEu extends Emitter {
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
    const j = this.estado.ler("qs/j");
    return j && typeof j.id === "string" ? j : null;
  }

  /** Um personagem para cada um, sem repetir. */
  sortear(pessoas, cat = "todas") {
    const id = novoId();
    const cats = cat !== "todas" && PERSONAGENS[cat] ? [cat] : Object.keys(PERSONAGENS);
    const nomes = sortear(cats.flatMap((c) => PERSONAGENS[c]), pessoas.length);
    const ordem = embaralhar(pessoas.map((p) => p.id));
    this.estado.definir([
      ["qs/j", { id, cat, ordem }],
      ["qs/vez", { j: id, i: 0 }],
      ...pessoas.map((p, i) => [`qs/p/${p.id}`, { j: id, quem: String(nomes[i] || "?").slice(0, 60), por: null, nome: String(p.nome || "").slice(0, 40) }]),
    ]);
  }

  /** Quem chegou depois ganha um personagem também. */
  completar(pessoas) {
    const j = this.jogo();
    if (!j) return;
    const usados = new Set([...this.estado.com("qs/p/")].filter(([, v]) => v?.j === j.id).map(([, v]) => v.quem));
    const faltam = pessoas.filter((p) => this.estado.ler(`qs/p/${p.id}`)?.j !== j.id);
    if (!faltam.length) return;
    const cats = j.cat !== "todas" && PERSONAGENS[j.cat] ? [j.cat] : Object.keys(PERSONAGENS);
    const livres = cats.flatMap((c) => PERSONAGENS[c]).filter((x) => !usados.has(x));
    const nomes = sortear(livres, faltam.length);
    this.estado.definir([
      ["qs/j", { ...j, ordem: [...(Array.isArray(j.ordem) ? j.ordem : []), ...faltam.map((p) => p.id)].slice(0, 40) }],
      ...faltam.map((p, i) => [`qs/p/${p.id}`, { j: j.id, quem: String(nomes[i] || "?").slice(0, 60), por: null, nome: String(p.nome || "").slice(0, 40) }]),
    ]);
  }

  /** Outra pessoa escolhe o personagem de alguém (mais engraçado). */
  definirPara(pessoa, personagem, nomePessoa = "") {
    const j = this.jogo();
    const t = String(personagem || "").trim().slice(0, 60);
    if (!j || !t || pessoa === this.eu) return;
    this.estado.definir([[`qs/p/${pessoa}`, { j: j.id, quem: t, por: this.eu, nome: String(nomePessoa).slice(0, 40) }]]);
  }

  /** Acertou (marcado por quem vê o personagem, ou pela própria pessoa) ou desistiu. */
  marcar(pessoa, como = "acertou") {
    const j = this.jogo();
    if (!j || !["acertou", "desistiu"].includes(como)) return;
    if (this.estado.ler(`qs/ok/${pessoa}`)?.j === j.id) return;
    this.estado.definir([[`qs/ok/${pessoa}`, { j: j.id, como, em: this.agora() }]]);
    if (this.vez()?.id === pessoa) this.passarVez();
  }

  vez() {
    const j = this.jogo();
    const v = this.estado.ler("qs/vez");
    const ordem = Array.isArray(j?.ordem) ? j.ordem : [];
    if (!j || !v || v.j !== j.id || !ordem.length) return null;
    return { i: Number(v.i) || 0, id: ordem[(Number(v.i) || 0) % ordem.length] };
  }

  /** Passa a vez de perguntar para o próximo que ainda não acertou. */
  passarVez(pessoas = null) {
    const j = this.jogo();
    const v = this.vez();
    if (!j || !v) return;
    const ordem = j.ordem;
    for (let d = 1; d <= ordem.length; d += 1) {
      const id = ordem[(v.i + d) % ordem.length];
      const terminou = this.estado.ler(`qs/ok/${id}`)?.j === j.id;
      if (!terminou && (!pessoas || pessoas.some((p) => p.id === id))) {
        this.estado.definir([["qs/vez", { j: j.id, i: (v.i + d) % ordem.length }]]);
        return;
      }
    }
  }

  vista(pessoas = []) {
    const j = this.jogo();
    if (!j) return { fase: "lobby", cats: Object.keys(PERSONAGENS) };
    const vez = this.vez();
    const cartas = pessoas.map((p) => {
      const c = this.estado.ler(`qs/p/${p.id}`);
      const ok = this.estado.ler(`qs/ok/${p.id}`);
      const temCarta = c?.j === j.id;
      const terminou = ok?.j === j.id ? ok.como : null;
      const eu = p.id === this.eu;
      return {
        id: p.id,
        nome: p.nome,
        avatar: p.avatar,
        eu,
        temCarta,
        // A minha fica escondida até eu acertar ou desistir.
        quem: temCarta && (!eu || terminou) ? texto(c.quem, 60) : null,
        escolhidoPor: temCarta && c.por ? c.por : null,
        terminou,
        em: terminou ? Number(ok.em) || 0 : 0,
        daVez: vez?.id === p.id,
      };
    });
    const ordemAcerto = cartas.filter((c) => c.terminou === "acertou").sort((a, b) => a.em - b.em);
    ordemAcerto.forEach((c, i) => (c.posicao = i + 1));
    return { fase: cartas.length && cartas.every((c) => c.terminou) ? "fim" : "jogando", cartas, vez, faltamCarta: cartas.filter((c) => !c.temCarta).length };
  }
}

/* ================================================================== *
 * Roda de perguntas: O que você prefere?, Eu nunca…, Quem da call…,
 * Quebra-gelo
 * ================================================================== */

export const MODOS_RODA = {
  prefere: { nome: "O que você prefere?", banco: PREFERE },
  eununca: { nome: "Eu nunca…", banco: EU_NUNCA },
  quem: { nome: "Quem da call…", banco: QUEM_DA_CALL },
  gelo: { nome: "Quebra-gelo", banco: QUEBRA_GELO },
};

export class Roda extends Emitter {
  /** O meu voto, escondido até revelar: n -> voto */
  #meus = new Map();
  #vistas = new Map();
  #pedida = 0;

  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
    estado.on("mudou", () => this.publicarSegredos());
  }
  get eu() {
    return this.estado.eu;
  }
  get q() {
    const q = this.estado.ler("rp/q");
    return q && Number.isSafeInteger(q.n) && MODOS_RODA[q.modo] ? q : null;
  }

  /** Outra pergunta (sem repetir as que já saíram neste computador). */
  proxima(modo, pessoas = []) {
    const m = MODOS_RODA[modo] ? modo : "prefere";
    const banco = MODOS_RODA[m].banco;
    const vistas = this.#vistas.get(m) || new Set();
    if (vistas.size >= banco.length) vistas.clear();
    const livres = banco.map((_, i) => i).filter((i) => !vistas.has(i));
    const i = livres[aleatorio(livres.length)];
    vistas.add(i);
    this.#vistas.set(m, vistas);
    const q = { n: (this.q?.n || 0) + 1, modo: m, i, em: this.agora() };
    if (m === "gelo" && pessoas.length) {
      const alvo = pessoas[aleatorio(pessoas.length)];
      q.alvo = alvo.id;
      q.nomeAlvo = String(alvo.nome || "").slice(0, 40);
    }
    this.estado.definir([["rp/q", q]]);
  }

  /** Uma pergunta escrita na hora por alguém. */
  propria(modo, textoA, textoB = "") {
    const m = MODOS_RODA[modo] ? modo : "prefere";
    const a = String(textoA || "").trim().slice(0, 140);
    const b = String(textoB || "").trim().slice(0, 140);
    if (!a || (m === "prefere" && !b)) return;
    this.estado.definir([["rp/q", { n: (this.q?.n || 0) + 1, modo: m, t: m === "prefere" ? [a, b] : a, em: this.agora() }]]);
  }

  texto(q = this.q) {
    if (!q) return null;
    if (q.t != null) return q.modo === "prefere" ? (Array.isArray(q.t) ? q.t.map((x) => texto(x, 140)) : null) : texto(q.t, 140);
    return MODOS_RODA[q.modo].banco[q.i] ?? null;
  }

  votar(voto) {
    const q = this.q;
    if (!q || q.modo === "gelo" || this.revelada(q)) return;
    if (q.modo === "prefere" && voto !== 0 && voto !== 1) return;
    if (q.modo === "eununca" && voto !== "ja" && voto !== "nunca") return;
    if (q.modo === "quem" && typeof voto !== "string") return;
    this.#meus.set(q.n, voto);
    this.estado.definir([[`rp/v/${this.eu}`, { n: q.n, nome: this.nome().slice(0, 40) }]]);
  }

  meuVoto(q = this.q) {
    return q ? (this.#meus.get(q.n) ?? null) : null;
  }

  revelada(q = this.q) {
    return !!q && this.estado.ler("rp/rev") === q.n;
  }

  revelar() {
    const q = this.q;
    if (q && !this.revelada(q)) this.estado.definir([["rp/rev", q.n]]);
  }

  publicarSegredos() {
    const q = this.q;
    if (!q || !this.revelada(q) || !this.#meus.has(q.n)) return;
    const v = this.#meus.get(q.n);
    const atual = this.estado.ler(`rp/val/${this.eu}`);
    if (mesmaRodada(atual, q.n) && atual.v === v) return;
    this.estado.definir([[`rp/val/${this.eu}`, { n: q.n, v, nome: this.nome().slice(0, 40) }]]);
  }

  /** Todo mundo votou: o líder revela. */
  manter(pessoas) {
    const q = this.q;
    if (!q || q.modo === "gelo" || this.revelada(q) || this.#pedida === q.n) return;
    const votaram = new Set([...this.estado.com("rp/v/")].filter(([, v]) => mesmaRodada(v, q.n)).map(([k]) => k.slice(5)));
    if (pessoas.length > 1 && pessoas.every((p) => votaram.has(p.id)) && lider(pessoas) === this.eu) {
      this.#pedida = q.n;
      this.revelar();
    }
  }

  vista(pessoas = []) {
    const q = this.q;
    if (!q) return { fase: "lobby", modos: MODOS_RODA };
    const votaram = [...this.estado.com("rp/v/")].filter(([, v]) => mesmaRodada(v, q.n)).map(([k, v]) => ({ id: k.slice(5), nome: texto(v.nome, 40) }));
    const revelada = this.revelada(q);
    const base = { fase: revelada ? "revelada" : "votando", n: q.n, modo: q.modo, nomeModo: MODOS_RODA[q.modo].nome, texto: this.texto(q), votaram, faltam: pessoas.filter((p) => !votaram.some((v) => v.id === p.id)), meu: this.meuVoto(q) };
    if (q.modo === "gelo") return { ...base, fase: "gelo", alvo: q.alvo ? { id: q.alvo, nome: pessoas.find((p) => p.id === q.alvo)?.nome || texto(q.nomeAlvo, 40) } : null };
    if (!revelada) return base;
    const votos = [...this.estado.com("rp/val/")].filter(([, v]) => mesmaRodada(v, q.n)).map(([k, v]) => ({ id: k.slice(7), nome: pessoas.find((p) => p.id === k.slice(7))?.nome || texto(v.nome, 40), v: v.v }));
    if (q.modo === "prefere") return { ...base, lados: [0, 1].map((l) => votos.filter((v) => v.v === l)), total: votos.length };
    if (q.modo === "eununca") return { ...base, ja: votos.filter((v) => v.v === "ja"), nunca: votos.filter((v) => v.v === "nunca"), total: votos.length };
    // Quem da call: quantos votos cada um recebeu (sem dizer quem votou em quem).
    const contagem = new Map();
    for (const v of votos) if (typeof v.v === "string") contagem.set(v.v, (contagem.get(v.v) || 0) + 1);
    const lista = [...contagem].map(([id, n]) => ({ id, nome: pessoas.find((p) => p.id === id)?.nome || "Saiu", n })).sort((a, b) => b.n - a.n);
    return { ...base, ranking: lista, total: votos.length };
  }
}

/** sessionStorage pode não existir (testes) ou recusar (aba privada). */
function guardarNaAba(chave, valor) {
  try {
    globalThis.sessionStorage?.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem problema: só não sobrevive a recarregar */
  }
}
function lerDaAba(chave) {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(chave) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/* ================================================================== *
 * Duas verdades e uma mentira
 * ================================================================== */

export class DuasVerdades extends Emitter {
  /** A minha mentira: { j, i } — só aqui (e na aba, se recarregar) até eu revelar. */
  minha = lerDaAba("vcall:dv");

  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
  }
  get eu() {
    return this.estado.eu;
  }
  /** O jogo atual (antes do primeiro "Novo jogo", um id fixo que todos conhecem). */
  get j() {
    const j = this.estado.ler("dv/j");
    return typeof j === "string" && j ? j.slice(0, 16) : "1";
  }

  novoJogo() {
    const r = this.estado.ler("dv/vez");
    this.minha = null;
    this.estado.definir([
      ["dv/j", novoId()],
      ["dv/vez", null],
      ["dv/placar", { n: Number(r?.n) || 0, pts: {}, nomes: {} }],
    ]);
  }

  /** As minhas três frases (a `mentira` é a posição da falsa, de 0 a 2). */
  publicar(frases, mentira) {
    const j = this.j;
    const limpas = frases.map((f) => String(f || "").trim().slice(0, 140));
    if (limpas.length !== 3 || limpas.some((f) => !f) || ![0, 1, 2].includes(mentira)) return false;
    const ordem = embaralhar([0, 1, 2]);
    this.minha = { j, i: ordem.indexOf(mentira), frases: limpas, mentira };
    guardarNaAba("vcall:dv", this.minha);
    this.estado.definir([[`dv/f/${this.eu}`, { j, frases: ordem.map((i) => limpas[i]), nome: this.nome().slice(0, 40) }]]);
    return true;
  }

  prontos() {
    const j = this.j;
    return [...this.estado.com("dv/f/")].filter(([, v]) => v?.j === j && Array.isArray(v.frases)).map(([k, v]) => ({ id: k.slice(5), nome: texto(v.nome, 40), frases: v.frases.slice(0, 3).map((f) => texto(f, 140)) }));
  }

  vez() {
    const v = this.estado.ler("dv/vez");
    return v && v.j === this.j && Number.isSafeInteger(v.n) ? v : null;
  }

  /** A próxima pessoa a ser adivinhada (entre quem está pronto e ainda não foi). */
  proxima(pessoas = []) {
    const v = this.vez();
    const feitos = new Set(Array.isArray(v?.feitos) ? v.feitos : []);
    if (v) feitos.add(v.de);
    const presentes = presentesDe(pessoas);
    const livres = this.prontos().filter((p) => !feitos.has(p.id) && (!pessoas.length || presentes.has(p.id)));
    const n = (Number(this.estado.ler("dv/vez")?.n) || 0) + 1;
    if (!livres.length) {
      this.estado.definir([["dv/vez", { j: this.j, n, fim: true, feitos: [...feitos] }]]);
      return;
    }
    const de = livres[aleatorio(livres.length)];
    this.estado.definir([["dv/vez", { j: this.j, n, de: de.id, nome: de.nome, feitos: [...feitos].slice(-40) }]]);
  }

  votar(i) {
    const v = this.vez();
    if (!v || v.fim || v.de === this.eu || this.revelada(v) || ![0, 1, 2].includes(i)) return;
    this.estado.definir([[`dv/v/${this.eu}`, { n: v.n, i, nome: this.nome().slice(0, 40) }]]);
  }

  revelada(v = this.vez()) {
    return !!v && mesmaRodada(this.estado.ler("dv/rev"), v.n);
  }

  /** Só quem escreveu sabe qual é a mentira: é quem revela (e soma os pontos). */
  revelar(pessoas = []) {
    const v = this.vez();
    if (!v || v.de !== this.eu || this.revelada(v) || this.minha?.j !== this.j) return false;
    const votos = this.votos(v);
    const pts = {};
    let enganados = 0;
    for (const x of votos) {
      if (x.i === this.minha.i) pts[x.id] = 100;
      else enganados += 1;
    }
    pts[this.eu] = 50 * enganados;
    this.estado.definir([
      ["dv/rev", { n: v.n, i: this.minha.i }],
      ["dv/placar", somarPlacar(this.estado.ler("dv/placar"), v.n, pts, { ...nomesDe(pessoas), ...Object.fromEntries(votos.map((x) => [x.id, x.nome])), [this.eu]: this.nome() })],
    ]);
    return true;
  }

  votos(v = this.vez()) {
    if (!v) return [];
    return [...this.estado.com("dv/v/")].filter(([, x]) => mesmaRodada(x, v.n) && [0, 1, 2].includes(x.i)).map(([k, x]) => ({ id: k.slice(5), i: x.i, nome: texto(x.nome, 40) }));
  }

  vista(pessoas = []) {
    const prontos = this.prontos();
    const v = this.vez();
    const placar = this.estado.ler("dv/placar");
    const eu = this.eu;
    if (!v) return { fase: "escrevendo", prontos, euPronto: prontos.some((p) => p.id === eu), faltam: pessoas.filter((p) => !prontos.some((x) => x.id === p.id)), placar };
    if (v.fim) return { fase: "fim", placar };
    const autor = prontos.find((p) => p.id === v.de);
    const votos = this.votos(v);
    const rev = this.estado.ler("dv/rev");
    const revelada = this.revelada(v);
    return {
      fase: revelada ? "revelada" : "votando",
      vez: v,
      autor: { id: v.de, nome: pessoas.find((p) => p.id === v.de)?.nome || texto(v.nome, 40), presente: pessoas.some((p) => p.id === v.de) },
      frases: autor?.frases || [],
      souAutor: v.de === eu,
      meuVoto: votos.find((x) => x.id === eu)?.i ?? null,
      votaram: votos.length,
      faltam: pessoas.filter((p) => p.id !== v.de && !votos.some((x) => x.id === p.id)).length,
      mentira: revelada ? rev.i : null,
      porFrase: revelada ? [0, 1, 2].map((i) => votos.filter((x) => x.i === i).map((x) => pessoas.find((p) => p.id === x.id)?.nome || x.nome)) : null,
      restam: prontos.filter((p) => !(v.feitos || []).includes(p.id) && p.id !== v.de).length,
      placar,
      minhaMentira: v.de === eu && this.minha?.j === this.j ? this.minha.i : null,
    };
  }
}

/* ================================================================== *
 * Palavras-código (dois times, como o Codenames)
 * ================================================================== */

export const TIMES = { v: "Vermelho", a: "Azul" };

export class Codigo extends Emitter {
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
    const j = this.estado.ler("pc/j");
    if (!j || typeof j.id !== "string" || !Array.isArray(j.palavras) || j.palavras.length !== 25) return null;
    const chave = desofuscar(j.k, j.id);
    return /^[vanx]{25}$/.test(chave) ? { ...j, chave } : null;
  }

  /** Tabuleiro novo: 25 palavras; quem começa tem 9, o outro 8, 7 neutras e 1 bomba. */
  novoJogo() {
    const unicas = Object.values(PALAVRAS)
      .flat()
      .filter((p) => !/[\s-]/.test(p) && p.length <= 11);
    const palavras = sortear([...new Set(unicas)], 25);
    const comeca = aleatorio(2) ? "v" : "a";
    const outro = comeca === "v" ? "a" : "v";
    const chave = embaralhar([...comeca.repeat(9), ...outro.repeat(8), ..."nnnnnnn", "x"]).join("");
    const id = novoId();
    this.estado.definir([
      ["pc/j", { id, palavras, k: ofuscar(chave, id), comeca }],
      ["pc/vez", { j: id, k: 0, time: comeca }],
    ]);
  }

  meuTime() {
    const t = this.estado.ler(`pc/t/${this.eu}`);
    return t && TIMES[t.time] ? t : null;
  }

  entrar(time, mestre = false) {
    if (!TIMES[time]) return;
    this.estado.definir([[`pc/t/${this.eu}`, { time, mestre: !!mestre, nome: this.nome().slice(0, 40) }]]);
  }

  /** Divide quem está na chamada em dois times e escolhe um mestre de cada. */
  sortearTimes(pessoas) {
    const ordem = embaralhar(pessoas);
    this.estado.definir(ordem.map((p, i) => [`pc/t/${p.id}`, { time: i % 2 ? "a" : "v", mestre: i < 2, nome: String(p.nome || "").slice(0, 40) }]));
  }

  vez() {
    const j = this.jogo();
    const v = this.estado.ler("pc/vez");
    return j && v && v.j === j.id && TIMES[v.time] ? v : null;
  }

  dica() {
    const v = this.vez();
    const d = this.estado.ler("pc/dica");
    return v && d && d.j === v.j && d.k === v.k ? d : null;
  }

  /** O mestre do time da vez dá a dica: uma palavra e um número. */
  darDica(palavra, n) {
    const v = this.vez();
    const eu = this.meuTime();
    const p = String(palavra || "").trim().slice(0, 30);
    if (!v || !eu?.mestre || eu.time !== v.time || this.dica() || !p || /\s/.test(p) || !(Number.isInteger(n) && n >= 0 && n <= 9)) return false;
    if (this.vista().vencedor) return false;
    this.estado.definir([["pc/dica", { j: v.j, k: v.k, palavra: p, n, nome: this.nome().slice(0, 40) }]]);
    return true;
  }

  reveladas() {
    const j = this.jogo();
    const out = new Map();
    if (!j) return out;
    for (const [k, c] of this.estado.com("pc/c/")) {
      const i = Number(k.slice(5));
      if (c?.j === j.id && Number.isInteger(i) && i >= 0 && i < 25) out.set(i, c);
    }
    return out;
  }

  /** Um agente do time da vez aponta uma carta. */
  apontar(i) {
    const j = this.jogo();
    const v = this.vez();
    const d = this.dica();
    const eu = this.meuTime();
    if (!j || !v || !d || !eu || eu.mestre || eu.time !== v.time || this.reveladas().has(i) || this.vista().vencedor) return false;
    const cor = j.chave[i];
    const nestaVez = [...this.reveladas().values()].filter((c) => c.k === v.k).length + 1;
    const limite = d.n === 0 ? 25 : d.n + 1;
    const pares = [[`pc/c/${i}`, { j: j.id, k: v.k, time: v.time, por: this.nome().slice(0, 40) }]];
    const outro = v.time === "v" ? "a" : "v";
    if (cor !== v.time || nestaVez >= limite) pares.push(["pc/vez", { j: j.id, k: v.k + 1, time: outro }]);
    this.estado.definir(pares);
    return true;
  }

  passar() {
    const v = this.vez();
    const eu = this.meuTime();
    if (!v || !eu || eu.time !== v.time || !this.dica()) return;
    this.estado.definir([["pc/vez", { j: v.j, k: v.k + 1, time: v.time === "v" ? "a" : "v" }]]);
  }

  vista(pessoas = []) {
    const j = this.jogo();
    const times = { v: [], a: [] };
    for (const [k, t] of this.estado.com("pc/t/")) {
      const id = k.slice(5);
      if (!TIMES[t?.time] || (pessoas.length && !pessoas.some((p) => p.id === id))) continue;
      times[t.time].push({ id, nome: pessoas.find((p) => p.id === id)?.nome || texto(t.nome, 40), mestre: !!t.mestre, eu: id === this.eu });
    }
    const eu = this.meuTime();
    if (!j) return { fase: "lobby", times, eu };
    const reveladas = this.reveladas();
    const souMestre = !!eu?.mestre;
    const cartas = j.palavras.map((palavra, i) => {
      const r = reveladas.get(i);
      return { i, palavra: texto(palavra, 20), revelada: !!r, cor: r || souMestre ? j.chave[i] : null, por: r?.por || "" };
    });
    const faltam = { v: 0, a: 0 };
    for (let i = 0; i < 25; i += 1) if (TIMES[j.chave[i]] && !reveladas.has(i)) faltam[j.chave[i]] += 1;
    let vencedor = null;
    let motivo = "";
    const bomba = j.chave.indexOf("x");
    if (reveladas.has(bomba)) {
      const quem = reveladas.get(bomba).time;
      vencedor = quem === "v" ? "a" : "v";
      motivo = `${TIMES[quem]} achou a bomba`;
    } else if (!faltam.v || !faltam.a) {
      vencedor = !faltam.v ? "v" : "a";
      motivo = "achou todas as palavras";
    }
    const v = this.vez();
    const d = this.dica();
    const nestaVez = v ? [...reveladas.values()].filter((c) => c.k === v.k).length : 0;
    return {
      fase: vencedor ? "fim" : "jogando",
      cartas,
      times,
      eu,
      vez: v?.time || null,
      dica: d ? { palavra: texto(d.palavra, 30), n: d.n, nome: texto(d.nome, 40) } : null,
      restam: d ? (d.n === 0 ? null : d.n + 1 - nestaVez) : null,
      faltam,
      vencedor,
      motivo,
      podeDarDica: !!(v && eu?.mestre && eu.time === v.time && !d && !vencedor),
      podeApontar: !!(v && d && eu && !eu.mestre && eu.time === v.time && !vencedor),
    };
  }
}
