/**
 * features/quizzv.js — o celular com o QuizzV como controle do Quiz.
 *
 * O celular não é um par da chamada: ele fala só com o navegador da própria
 * pessoa, pelo servidor (src/quizzv.js). Este módulo é esse navegador do
 * outro lado do fio — a ponte:
 *
 *   - o que o celular pede (carregar um quiz, começar, responder, próxima)
 *     vira a mesma chamada que um clique faria no Quiz (features/festa.js);
 *     a resposta dada no celular é a resposta DESTA pessoa;
 *   - o que o Quiz mostra vira um resumo pequeno (a "vista") que vai para o
 *     celular desenhar do jeito dele.
 *
 * O gabarito só vai ao celular depois de revelado — o celular mostra o que a
 * pessoa veria na tela, nem mais nem menos.
 */
import { Emitter } from "../lib/emitter.js";
import qrcode from "../../vendor/qr.js";
import { logoQuizzv } from "../ui/quizzv-marca.js";

/** Versão do protocolo celular ↔ chamada (igual a src/quizzv.js). */
export const QUIZZV_PROTOCOLO = 1;

/* ================================================================== *
 * Pareamento
 * ================================================================== */

/**
 * O endereço que o QR carrega: uma página https comum (/quizzv), com o token
 * no FRAGMENTO — a parte da URL que o navegador nunca manda a servidor
 * nenhum, nem ao túnel. Lido pela câmera do QuizzV, o app já sabe para onde
 * conectar; lido pela câmera comum do celular, a página explica e oferece
 * abrir no app (ou responder ali mesmo).
 */
export function linkDePareamento(origem, token) {
  return `${origem.replace(/\/+$/, "")}/quizzv#${token}`;
}

/** O mesmo, no formato que abre direto o aplicativo QuizzV. */
export function linkDoQuizzv(origem, token) {
  return `quizzv://vcall?u=${encodeURIComponent(origem.replace(/\/+$/, ""))}&p=${encodeURIComponent(token)}`;
}

/**
 * Desenha um QR code como SVG, aqui mesmo: mandar o endereço a um serviço de
 * QR na internet entregaria o token a um terceiro (e a CSP nem deixaria).
 * Sempre escuro sobre branco, nos dois temas — leitor de celular barato não
 * lê QR invertido.
 */
export function qrSvg(texto, { titulo = "QR code para parear o celular", comLogo = true } = {}) {
  // Com o logo do QuizzV no meio, a correção de erro vai ao máximo (H, ~30%):
  // o logo cobre bem menos que isso e o código continua lendo de primeira.
  const q = qrcode(0, comLogo ? "H" : "M");
  q.addData(texto);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  }
  const NS = "http://www.w3.org/2000/svg";
  const borda = 4; // a "zona quieta" que o padrão exige em volta
  const lado = n + borda * 2;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `${-borda} ${-borda} ${lado} ${lado}`);
  svg.setAttribute("class", "quizzvQr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", titulo);
  svg.setAttribute("shape-rendering", "crispEdges");
  const fundo = document.createElementNS(NS, "rect");
  for (const [k, v] of [["x", -borda], ["y", -borda], ["width", lado], ["height", lado], ["fill", "#fff"]]) fundo.setAttribute(k, String(v));
  const caminho = document.createElementNS(NS, "path");
  caminho.setAttribute("d", d);
  caminho.setAttribute("fill", "#000");
  svg.append(fundo, caminho);
  if (comLogo) {
    // Um quadrado branco com cantos redondos e o logo por cima, no centro
    // (longe dos três quadrados de posição dos cantos).
    const t = Math.round(n * 0.22);
    const x0 = (n - t) / 2;
    const placa = document.createElementNS(NS, "rect");
    for (const [k, v] of [["x", x0 - 0.6], ["y", x0 - 0.6], ["width", t + 1.2], ["height", t + 1.2], ["rx", 1.6], ["fill", "#fff"]]) placa.setAttribute(k, String(v));
    const logo = logoQuizzv({ fixo: true });
    for (const [k, v] of [["x", x0], ["y", x0], ["width", t], ["height", t]]) logo.setAttribute(k, String(v));
    logo.setAttribute("shape-rendering", "geometricPrecision");
    svg.append(placa, logo);
  }
  return svg;
}

/* ================================================================== *
 * A vista: o que o celular mostra
 * ================================================================== */

/**
 * Resume a vista do Quiz (features/festa.js) para o celular. Sem o gabarito
 * antes da revelação; tempos em "quanto falta", nunca em horário — relógio de
 * celular adiantado não muda nada.
 */
const txt = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

export function vistaParaCelular(v, { eu = "", pessoas = [] } = {}) {
  const base = { v: QUIZZV_PROTOCOLO, fase: v.fase, fonte: v.fonte || v.cfg?.fonte || "vcall" };
  if (v.quizzv) base.quizzv = { titulo: txt(v.quizzv.titulo, 80), qtd: v.quizzv.qtd, tempo: v.quizzv.tempo };
  if (v.fase === "lobby") return base;

  const placar = (v.placar || []).map((x) => ({ nome: txt(x.nome, 40), total: Number(x.total) || 0, eu: !!x.eu }));
  const pos = placar.findIndex((x) => x.eu) + 1;
  Object.assign(base, {
    k: v.k ?? null,
    total: v.total,
    titulo: txt(v.titulo, 80),
    placar: placar.slice(0, 10),
    eu: pos ? { pos, total: placar[pos - 1].total } : null,
    pessoas: pessoas.length,
  });
  if (v.fase === "fim") return base;

  if (v.fase === "preparar") {
    base.contagemMs = Math.max(0, Math.round((v.contagem || 0) * 1000));
    return base;
  }
  const revelada = v.fase === "revelada";
  base.limite = v.limite;
  base.restanteMs = Math.max(0, Math.round((v.restante || 0) * 1000));
  base.responderam = v.responderam;
  base.faltam = v.faltam;
  base.pergunta = { texto: v.pergunta.texto, opcoes: v.pergunta.opcoes };
  if (revelada) {
    base.pergunta.certa = v.pergunta.certa;
    base.pergunta.explicacao = txt(v.pergunta.explicacao, 1000);
    base.porOpcao = (v.porOpcao || []).map((nomes) => nomes.length);
  }
  if (v.minha) {
    base.minha = { e: v.minha.e };
    if (revelada) Object.assign(base.minha, { certo: !!v.minha.certo, pontos: v.minha.pontos || 0, seq: v.minha.seq || 0 });
  }
  return base;
}

/** A parte da vista que, mudando, merece um envio (o tempo o celular conta sozinho). */
function assinatura(vista) {
  const { restanteMs, contagemMs, ...resto } = vista;
  return JSON.stringify(resto);
}

/* ================================================================== *
 * A ponte
 * ================================================================== */

/**
 * @fires PonteQuizzV#mudou      — conectou, desconectou ou chegou o token
 * @fires PonteQuizzV#aviso      — texto para um toast
 */
export class PonteQuizzV extends Emitter {
  conectado = false;
  /** Nome do app do outro lado ("QuizzV 1.9.0", "navegador"). */
  app = "";
  token = null;
  #ultima = "";
  #pendente = 0;

  /**
   * @param {object} o
   * @param {{ send(m: object): boolean, on(t: string, fn: Function): any }} o.signaling
   * @param {import("./festa.js").Quiz} o.quiz
   * @param {() => {id:string, nome:string}[]} o.pessoas
   * @param {() => string} o.eu        id desta pessoa na chamada
   * @param {() => string} o.nome      nome desta pessoa
   * @param {() => void} o.abrirQuiz   abre o Quiz nesta tela (e avisa a sala)
   * @param {() => void} o.parear      mostra o QR de pareamento
   */
  constructor({ signaling, quiz, pessoas, eu, nome, abrirQuiz, parear }) {
    super();
    this.sig = signaling;
    this.quiz = quiz;
    this.pessoas = pessoas;
    this.eu = eu;
    this.nome = nome;
    this.abrirQuiz = abrirQuiz;
    this.parearUi = parear;

    signaling.on("quiz-pareamento", (m) => {
      this.token = typeof m.token === "string" ? m.token : null;
      this.#definirConexao(!!m.conectado, m.app);
    });
    signaling.on("quiz-celular", (m) => this.#definirConexao(!!m.conectado, m.app));
    signaling.on("quiz-do-celular", (m) => this.#executar(m.a));
  }

  /** Pede o token (o servidor devolve sempre o mesmo enquanto a pessoa estiver na sala). */
  pedirToken() {
    this.sig.send({ t: "quiz-parear" });
  }

  /** Abre o QR. Chamado pelo botão "Pelo celular" do Quiz. */
  parear() {
    this.parearUi?.();
  }

  /** A aba reconectou com outro id: o token antigo morreu com ele. */
  esquecerToken() {
    this.token = null;
    this.emit("mudou");
  }

  #definirConexao(conectado, app = "") {
    const antes = this.conectado;
    this.conectado = conectado;
    this.app = typeof app === "string" ? app : "";
    if (conectado && !antes) {
      this.emit("aviso", { texto: "Celular conectado ao Quiz", tom: "ok" });
      this.enviar({ forcar: true });
    } else if (!conectado && antes) {
      this.emit("aviso", { texto: "O celular do Quiz desconectou", tom: "warn" });
    }
    this.emit("mudou");
  }

  /* -------------------------------------------------------------- *
   * Celular -> jogo
   * -------------------------------------------------------------- */

  #executar(a) {
    if (!a || typeof a !== "object") return;
    const q = this.quiz;
    const pessoas = this.pessoas();
    switch (a.tipo) {
      case "carregar": {
        // O celular escolheu um quiz da biblioteca: ele entra no lobby do
        // Quiz para todos, pronto para começar.
        this.abrirQuiz();
        if (q.jogo() && q.vista(pessoas).fase !== "fim") {
          this.#avisarCelular("Já tem um quiz em andamento na chamada. Espere acabar, ou encerre pelo celular.");
          break;
        }
        if (!q.carregarQuizzv(a.quiz, { tempo: a.tempo, qtd: a.qtd, embaralhar: a.embaralhar, de: this.nome() })) {
          this.#avisarCelular("Esse quiz não tem perguntas que o Vcall consiga mostrar.");
          break;
        }
        if (q.jogo()) q.encerrar(); // pódio de uma partida anterior: volta ao lobby
        this.emit("aviso", { texto: `Quiz “${a.quiz.titulo}” chegou do celular`, tom: "ok" });
        break;
      }
      case "comecar": {
        this.abrirQuiz();
        if (q.jogo() && q.vista(pessoas).fase !== "fim") break; // dois toques: já começou
        if (!q.quizzv()) {
          this.#avisarCelular("Escolha um quiz no QuizzV primeiro.");
          break;
        }
        q.configurar({ fonte: "quizzv" });
        q.comecar();
        break;
      }
      case "responder": {
        // Só vale para a pergunta que está na tela agora: um toque atrasado,
        // de uma pergunta que já passou, não pode cair na seguinte.
        if (q.passo()?.k !== a.k) break;
        q.responder(a.e);
        break;
      }
      case "proxima": {
        const v = q.vista(pessoas);
        if (v.fase === "revelada") q.proxima();
        break;
      }
      case "encerrar":
        q.encerrar();
        break;
      case "vista":
        break;
    }
    this.enviar({ forcar: true });
  }

  #aviso = null;
  #avisarCelular(texto) {
    this.#aviso = { texto, n: (this.#aviso?.n || 0) + 1 };
  }

  /* -------------------------------------------------------------- *
   * Jogo -> celular
   * -------------------------------------------------------------- */

  /**
   * Manda a vista ao celular — só quando algo que ele mostra mudou. O estado
   * dos jogos muda muitas vezes por segundo numa sala cheia; agrupar num
   * quadro e comparar a assinatura deixa isto em poucas mensagens por pergunta.
   */
  enviar({ forcar = false } = {}) {
    if (!this.conectado) return;
    if (forcar) {
      this.#ultima = "";
      this.#mandar();
      return;
    }
    if (this.#pendente) return;
    this.#pendente = setTimeout(() => {
      this.#pendente = 0;
      this.#mandar();
    }, 120);
  }

  /** Chamado a cada segundo: a fase também muda com o tempo (preparar → pergunta → revelada). */
  tique() {
    if (this.conectado) this.enviar();
  }

  #mandar() {
    const pessoas = this.pessoas();
    const vista = vistaParaCelular(this.quiz.vista(pessoas), { eu: this.eu(), pessoas });
    if (this.#aviso) vista.aviso = this.#aviso;
    const sig = assinatura(vista);
    if (sig === this.#ultima) return;
    this.#ultima = sig;
    this.sig.send({ t: "quiz-para-celular", v: vista });
  }
}
