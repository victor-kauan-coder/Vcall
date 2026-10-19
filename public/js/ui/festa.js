/**
 * ui/festa.js — as telas dos jogos de festa: Desenha e Adivinha, Mímica,
 * Stop, Quiz, Quem sou eu?, Roda de perguntas, Duas verdades e uma mentira
 * e Palavras-código. A lógica está em features/festa.js.
 *
 * Duas decisões que valem para todas:
 *
 *   - CAMPOS DE TEXTO NASCEM UMA VEZ. O formulário do Stop, o palpite do
 *     desenho e as frases das Duas verdades são criados quando a rodada
 *     começa e nunca refeitos enquanto ela dura: o que a pessoa digita e o
 *     foco do teclado não se perdem quando outra pessoa joga.
 *   - O VÍDEO É DA CHAMADA. Mímica e Quem sou eu? mostram a câmera de quem
 *     está jogando usando o mesmo fluxo que já chega no quadrinho (nada de
 *     conexão nova); o vídeo daqui é sempre mudo, o som continua vindo da
 *     chamada.
 */
import { el, icon } from "../lib/dom.js";
import { CORES_LAPIS, ESPESSURAS, MODOS_RODA, TELA, TIMES } from "../features/festa.js";
import { CATEGORIAS_STOP, MIMICAS, PALAVRAS, PERSONAGENS } from "../features/bancos.js";
import { ranking } from "../features/jogos.js";
import { Vista, abertura, ajuste, anelTempo, botao, campo, faixa, placar, podio, rosto, seletor, sincronizar, trocar } from "./jogos-comum.js";

const nomeDe = (pessoas, id, eu, padrao = "Alguém") => (id === eu ? "Você" : pessoas.find((p) => p.id === id)?.nome || padrao);

/** Um <video> mudo com a câmera de alguém (ou o rosto, se a câmera estiver desligada). */
function janelaDeVideo(classe = "") {
  const video = el("video", { autoplay: true, playsInline: true, muted: true, class: "jg-video__v" });
  const sem = el("div.jg-video__sem");
  const no = el(`div.jg-video${classe ? `.${classe}` : ""}`, {}, [video, sem]);
  let id = null;
  return {
    no,
    mostrar(pessoa, stream, { espelho = false } = {}) {
      const temVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);
      if (video.srcObject !== (temVideo ? stream : null)) video.srcObject = temVideo ? stream : null;
      if (temVideo) video.play?.().catch(() => {});
      no.classList.toggle("is-sem-video", !temVideo);
      no.classList.toggle("is-espelho", espelho);
      if (id !== pessoa?.id) {
        id = pessoa?.id || null;
        sem.replaceChildren(rosto(pessoa, 96), el("span.muted", { text: "câmera desligada" }));
      }
    },
  };
}

/* ================================================================== *
 * Desenha e Adivinha
 * ================================================================== */

export class VistaDesenho extends Vista {
  #cor = CORES_LAPIS[0];
  #esp = ESPESSURAS[1];
  #traco = null;
  #desenhados = new Map();
  #escala = 1;
  #acerto = null; // { n, texto } o que eu digitei quando acertei
  #rodadaConversa = -1;

  montar() {
    this.raiz = el("div.desenho-raiz");
    this.c.corpo.append(this.raiz);
    this.ouvir(this.l, "tela", (ev) => this.#naTela(ev));
    this.ouvir(this.l, "conversa", () => this.#desenharConversa());
  }

  relogio() {
    const f = this.l.fase();
    return f === "jogando" || f === "revelada" || f === "escolhendo";
  }

  tique() {
    this.l.manter(this.pessoas());
    if (this.p?.anel) this.p.anel.definir(this.l.restante(), Number(this.l.r?.tempo) || 80);
    this.desenhar();
  }

  desenhar() {
    const pessoas = this.pessoas();
    const fase = this.l.fase();
    if (fase === "lobby") {
      this.p = null;
      trocar(this.raiz, "lobby", () => this.#abertura(pessoas));
      return;
    }
    if (!this.p || !this.p.no.isConnected) this.#montarJogo();
    const p = this.p;
    const r = this.l.r;
    const souDaVez = r.de === this.eu;
    const ordem = this.l.ordem();

    // Topo: tempo, palavra (ou tracinhos) e de quem é a vez.
    p.anel.no.hidden = fase !== "jogando";
    if (fase === "jogando") p.anel.definir(this.l.restante(), Number(r.tempo) || 80);
    let palavra;
    if (fase === "fim") palavra = ["fim"];
    else if (fase === "escolhendo") palavra = ["escolhendo", souDaVez, r.nome];
    else if (fase === "revelada") palavra = ["revelada", this.c.estado.ler("dz/fim")?.palavra || ""];
    else if (souDaVez) palavra = ["minha", this.l.minha?.palavra || ""];
    else palavra = ["forma", this.l.formaVisivel(r), this.l.acertei() ? this.#acerto?.texto || "" : ""];
    trocar(p.palavra, JSON.stringify(palavra), () => this.#palavra(palavra, r));
    p.vez.textContent = fase === "fim" ? "" : `Vez ${Math.min(Number(r.k) + 1, Number(r.total))} de ${r.total}`;

    // Ferramentas só para quem desenha.
    const podeDesenhar = souDaVez && fase === "jogando";
    p.ferramentas.hidden = !podeDesenhar;
    p.quadro.classList.toggle("is-meu", podeDesenhar);

    // A cobertura do quadro: escolher palavra, revelação, fim.
    let sig = "";
    if (fase === "escolhendo") sig = `escolhendo|${r.n}|${souDaVez}`;
    else if (fase === "revelada") sig = `revelada|${r.n}|${JSON.stringify(this.l.acertos())}`;
    else if (fase === "fim") sig = `fim|${r.n}|${JSON.stringify(this.c.estado.ler("dz/placar"))}`;
    trocar(p.cobre, sig, () => this.#cobertura(fase, r, souDaVez, pessoas));
    p.cobre.hidden = !sig;

    // Placar: o total até a vez anterior + os pontos desta vez.
    const base = this.c.estado.ler("dz/placar");
    const desta = fase === "jogando" || fase === "revelada" ? this.l.pontosDaVez(r) : {};
    const acertaram = new Set(this.l.acertos(r).map((a) => a.id));
    const lista = ranking(base, pessoas, this.eu).map((x) => ({ ...x, pontos: x.pontos + (desta[x.id] || 0) }));
    for (const o of ordem) if (!lista.some((x) => x.id === o.id) && desta[o.id]) lista.push({ id: o.id, nome: o.nome, pontos: desta[o.id], eu: o.id === this.eu });
    lista.sort((a, b) => b.pontos - a.pontos);
    placar(
      p.placar,
      lista.map((x) => ({ ...x, marca: x.id === r.de && fase !== "fim" ? "desenha" : acertaram.has(x.id) ? "acertou" : "", extra: x.id === r.de && fase !== "fim" ? "desenhando" : acertaram.has(x.id) ? `+${desta[x.id] || 0}` : "" })),
      { pessoas },
    );

    // Palpite: só para quem adivinha e ainda não acertou.
    const podeChutar = fase === "jogando" && !souDaVez && !this.l.acertei();
    p.palpite.disabled = !podeChutar;
    p.palpite.placeholder = souDaVez ? "Você está desenhando" : this.l.acertei() ? "Você acertou! Espere os outros" : fase === "jogando" ? "Seu palpite…" : "Espere a próxima vez";
    if (this.#rodadaConversa !== r.n) {
      this.#rodadaConversa = r.n;
      this.#desenharConversa();
    }
  }

  #abertura(pessoas) {
    const cfg = this.l.config();
    return abertura({
      icone: "palette",
      titulo: "Desenha e Adivinha",
      regras: ["Na sua vez, escolha uma palavra e desenhe. Nada de letras!", "Os outros chutam no campo ao lado: quem acerta antes ganha mais.", "Quem desenha ganha pontos por cada pessoa que acerta."],
      ajustes: [
        ajuste("Tempo por desenho", seletor("Tempo", [45, 60, 80, 100, 120].map((s) => [s, `${s} s`]), cfg.tempo, (v) => this.l.configurar({ tempo: Number(v) }))),
        ajuste("Voltas", seletor("Voltas", [1, 2, 3].map((n) => [n, `${n} volta${n > 1 ? "s" : ""}`]), cfg.voltas, (v) => this.l.configurar({ voltas: Number(v) }))),
        ajuste("Palavras", seletor("Categoria", [["todas", "Todas"], ...Object.keys(PALAVRAS).map((c) => [c, c])], cfg.cat, (v) => this.l.configurar({ cat: v }))),
      ],
      acoes: [botao(pessoas.length < 2 ? "Chame mais alguém para jogar" : "Começar", { tipo: "primary", icone: "palette", classe: "btn--lg", desligado: pessoas.length < 2, onClick: () => this.l.comecar(this.pessoas()) })],
    });
  }

  #montarJogo() {
    this.raiz.replaceChildren();
    const canvas = el("canvas.desenho__tela", { "aria-label": "Quadro do desenho" });
    const ctx = canvas.getContext("2d");
    const cobre = el("div.desenho__cobre", { hidden: true });
    const quadro = el("div.desenho__quadro", {}, [canvas, cobre]);
    const anel = anelTempo(52);
    const palavra = el("div.desenho__palavra", { "aria-live": "polite" });
    const vez = el("span.muted.desenho__vez");
    const ferramentas = el("div.desenho__ferramentas", { role: "toolbar", "aria-label": "Lápis" });
    const cores = el("div.desenho__cores");
    for (const cor of CORES_LAPIS) {
      const b = el("button.desenho__cor", { type: "button", "aria-label": cor === "#ffffff" ? "Borracha (branco)" : `Cor ${cor}`, "aria-pressed": String(cor === this.#cor), style: { "--cor": cor } }, cor === "#ffffff" ? [icon("eraser", { size: "sm" })] : []);
      b.addEventListener("click", () => {
        this.#cor = cor;
        for (const x of cores.children) x.setAttribute("aria-pressed", String(x === b));
      });
      cores.append(b);
    }
    const tamanhos = el("div.desenho__tamanhos");
    for (const esp of ESPESSURAS) {
      const b = el("button.desenho__esp", { type: "button", "aria-label": `Espessura ${esp}`, "aria-pressed": String(esp === this.#esp), style: { "--esp": `${Math.max(6, esp)}px` } }, [el("i")]);
      b.addEventListener("click", () => {
        this.#esp = esp;
        for (const x of tamanhos.children) x.setAttribute("aria-pressed", String(x === b));
      });
      tamanhos.append(b);
    }
    ferramentas.append(cores, tamanhos, botao("", { icone: "undo-2", rotulo: "Desfazer", tipo: "ghost", onClick: () => this.l.desfazer() }), botao("", { icone: "trash-2", rotulo: "Limpar tudo", tipo: "ghost", onClick: () => this.l.limparTela() }));
    const conversa = el("ol.desenho__conversa", { "aria-live": "polite", "aria-label": "Palpites" });
    const palpite = campo({
      placeholder: "Seu palpite…",
      max: 60,
      aoEnviar: (t) => {
        const r = this.l.chutar(t);
        if (r === "acertou") {
          this.#acerto = { n: this.l.r?.n, texto: t.trim() };
          this.c.confete();
        }
        this.desenhar();
      },
      classe: "desenho__palpite",
    });
    this.p = {
      canvas,
      ctx,
      cobre,
      quadro,
      anel,
      palavra,
      vez,
      ferramentas,
      conversa,
      palpite,
      placar: el("ol.jg-placar.desenho__placar"),
    };
    this.p.no = el("div.desenho", {}, [
      el("div.desenho__topo", {}, [anel.no, palavra, vez]),
      el("div.desenho__meio", {}, [quadro, ferramentas]),
      el("aside.desenho__lado", {}, [this.p.placar, conversa, palpite]),
    ]);
    this.raiz.append(this.p.no);
    this.#ligarCaneta();
    const ro = new ResizeObserver(() => this.#medir());
    ro.observe(quadro);
    this.aoDestruir(() => ro.disconnect());
    this.#medir();
  }

  /** O canvas tem a resolução da tela (nítido em tela retina) e escala para 800×600. */
  #medir() {
    const { canvas, quadro } = this.p;
    const r = quadro.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.width * 0.75 * dpr);
    this.#escala = canvas.width / TELA.w;
    this.#refazer();
  }

  #refazer() {
    const { ctx, canvas } = this.p;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.#escala, 0, 0, this.#escala, 0, 0);
    this.#desenhados.clear();
    for (const [id, t] of this.l.tracos) this.#tracar(id, t);
  }

  /** Desenha o traço a partir do último ponto já desenhado (só o pedaço novo). */
  #tracar(id, t) {
    const { ctx } = this.p;
    const de = this.#desenhados.get(id) || 0;
    const p = t.p;
    if (p.length < 2 || de >= p.length) return;
    ctx.strokeStyle = t.cor;
    ctx.fillStyle = t.cor;
    ctx.lineWidth = t.esp;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], t.esp / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const inicio = Math.max(0, de - 2);
      ctx.beginPath();
      ctx.moveTo(p[inicio], p[inicio + 1]);
      for (let i = inicio + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
    this.#desenhados.set(id, p.length);
  }

  #naTela(ev) {
    if (!this.p) return;
    if (ev.tipo === "limpa" || ev.tipo === "refaz") this.#refazer();
    else if (ev.tipo === "ponto") this.#tracar(ev.id, ev.t);
  }

  #ligarCaneta() {
    const { canvas } = this.p;
    const ponto = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * TELA.w, ((e.clientY - r.top) / r.height) * TELA.h];
    };
    let ultimo = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.l.r?.de !== this.eu || this.l.fase() !== "jogando" || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = ponto(e);
      this.#traco = this.l.iniciarTraco(this.#cor, this.#esp, x, y);
      ultimo = [x, y];
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.#traco) return;
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const [x, y] = ponto(ev);
        // Pontos a menos de 2 px do anterior não mudam o desenho: ficam de fora.
        if (ultimo && Math.hypot(x - ultimo[0], y - ultimo[1]) < 2) continue;
        ultimo = [x, y];
        this.l.estenderTraco(this.#traco, x, y);
      }
    });
    const soltar = () => {
      if (this.#traco) this.l.terminarTraco(this.#traco);
      this.#traco = null;
      ultimo = null;
    };
    canvas.addEventListener("pointerup", soltar);
    canvas.addEventListener("pointercancel", soltar);
  }

  #palavra(info, r) {
    const [tipo] = info;
    if (tipo === "fim") return el("strong", { text: "Fim de jogo!" });
    if (tipo === "escolhendo") return el("span.muted", { text: info[1] ? "Escolha a palavra que você vai desenhar" : `${info[2] || "Alguém"} está escolhendo a palavra…` });
    if (tipo === "revelada") return info[1] ? el("span", {}, [el("span.muted", { text: "Era " }), el("strong.desenho__era", { text: info[1] })]) : el("span.muted", { text: "Fim da vez" });
    if (tipo === "minha") return el("span", {}, [el("span.jogos__rotulo", { text: "Desenhe" }), el("strong.desenho__era", { text: info[1] })]);
    // Tracinhos: um por letra, e as dicas que já abriram.
    const forma = String(info[1] || "");
    const letras = [...forma].filter((ch) => /[\p{L}\p{N}_]/u.test(ch)).length;
    return el("span.desenho__forma", {}, [
      el(
        "span.desenho__tracos",
        { "aria-label": `${letras} letras` },
        [...forma].map((ch) => {
          // "_" é letra escondida; espaço e hífen aparecem como são, sem tracinho.
          if (ch === " ") return el("span.is-espaco");
          if (ch !== "_" && !/[\p{L}\p{N}]/u.test(ch)) return el("span.is-sinal", { text: ch });
          return el("span", { text: ch === "_" ? "" : ch });
        }),
      ),
      info[2] ? el("span.desenho__acertei", {}, [icon("check"), el("span", { text: info[2] })]) : el("span.muted", { text: `${letras} letras${r?.cat ? ` · ${r.cat}` : ""}` }),
    ]);
  }

  #cobertura(fase, r, souDaVez, pessoas) {
    if (fase === "escolhendo" && souDaVez) {
      const lista = el("div.desenho__opcoes");
      const preencher = (trocar) => {
        lista.replaceChildren(
          ...this.l.opcoes({ trocar }).map((o) =>
            el("button.desenho__opcao", { type: "button", onClick: () => this.l.escolher(o.palavra, o.cat) }, [el("strong", { text: o.palavra }), el("span.muted", { text: o.cat })]),
          ),
        );
      };
      preencher(false);
      const propria = campo({ placeholder: "Ou escreva a sua palavra", max: 40, aoEnviar: (t) => this.l.escolher(t, ""), limpar: false });
      return el("div.desenho__escolha", {}, [
        el("h3", { text: "Sua vez de desenhar! Escolha:" }),
        lista,
        el("div.jg-rodape", {}, [botao("Outras palavras", { icone: "shuffle", tipo: "ghost", onClick: () => preencher(true) }), propria]),
      ]);
    }
    if (fase === "escolhendo") {
      const quem = pessoas.find((x) => x.id === r.de);
      return el("div.desenho__espera", {}, [rosto(quem || { nome: r.nome }, 72), el("p", { text: `${r.nome || "Alguém"} está escolhendo a palavra…` }), quem ? null : botao("Pular a vez (saiu)", { icone: "skip-forward", onClick: () => this.l.pular(this.pessoas()) })]);
    }
    if (fase === "revelada") {
      const fim = this.c.estado.ler("dz/fim");
      const acertos = this.l.acertos(r);
      const pts = this.l.pontosDaVez(r);
      return el("div.desenho__revela", {}, [
        el("span.jogos__rotulo", { text: "A palavra era" }),
        el("strong.desenho__revelaPalavra", { text: fim?.palavra || "?" }),
        el(
          "ul.desenho__acertos",
          {},
          acertos.length
            ? acertos.map((a) => el("li", {}, [icon("check"), el("span", { text: nomeDe(pessoas, a.id, this.eu, a.nome) }), el("b", { text: `+${pts[a.id] || 0}` })]))
            : [el("li.muted", { text: "Ninguém acertou desta vez." })],
        ),
        el("p.muted", { text: "A próxima vez começa em instantes…" }),
        botao("Próxima agora", { icone: "skip-forward", onClick: () => this.l.proxima(this.pessoas()) }),
      ]);
    }
    const lista = ranking(this.c.estado.ler("dz/placar"), pessoas, this.eu);
    return podio(lista, { pessoas, acoes: [botao("Jogar de novo", { tipo: "primary", icone: "rotate-ccw", onClick: () => this.l.comecar(this.pessoas()) })] });
  }

  #desenharConversa() {
    if (!this.p) return;
    const pessoas = this.pessoas();
    const itens = this.l.conversa.slice(-60);
    sincronizar(
      this.p.conversa,
      itens.map((c, i) => ({
        chave: `${this.l.tracosDe}|${i}`,
        sig: "",
        criar: () => {
          if (c.tipo === "acertou") return el("li.is-acertou", {}, [icon("check"), el("span", { text: `${c.de === this.eu ? "Você" : nomeDe(pessoas, c.de, this.eu, c.nome)} acertou!` })]);
          if (c.tipo === "quase") return el("li.is-quase", {}, [icon("flame"), el("span", { text: c.de === this.eu ? "Você está quase!" : `${nomeDe(pessoas, c.de, this.eu)} está quase!` })]);
          return el("li", {}, [el("b", { text: `${c.meu ? "Você" : nomeDe(pessoas, c.de, this.eu)}: ` }), el("span", { text: c.texto })]);
        },
      })),
    );
    this.p.conversa.scrollTop = this.p.conversa.scrollHeight;
  }
}

/* ================================================================== *
 * Mímica
 * ================================================================== */

export class VistaMimica extends Vista {
  montar() {
    this.raiz = el("div.mimica-raiz");
    this.c.corpo.append(this.raiz);
  }
  relogio() {
    const f = this.l.fase();
    return f === "jogando" || f === "revelada" || f === "escolhendo";
  }
  tique() {
    this.l.manter(this.pessoas());
    if (this.p?.anel && this.l.fase() === "jogando") this.p.anel.definir(this.l.restante(), Number(this.l.r?.tempo) || 60);
    this.desenhar();
  }

  desenhar() {
    const pessoas = this.pessoas();
    const fase = this.l.fase();
    if (fase === "lobby") {
      this.p = null;
      const cfg = this.l.config();
      trocar(this.raiz, "lobby", () =>
        abertura({
          icone: "drama",
          titulo: "Mímica",
          regras: ["Na sua vez, você vê uma palavra e imite sem falar: sua câmera fica em destaque para todos.", "Os outros chutam em voz alta.", "Quem imita aponta quem acertou: os dois ganham pontos."],
          ajustes: [
            ajuste("Tempo", seletor("Tempo", [30, 45, 60, 80, 100].map((s) => [s, `${s} s`]), cfg.tempo, (v) => this.l.configurar({ tempo: Number(v) }))),
            ajuste("Voltas", seletor("Voltas", [1, 2, 3].map((n) => [n, `${n} volta${n > 1 ? "s" : ""}`]), cfg.voltas, (v) => this.l.configurar({ voltas: Number(v) }))),
            ajuste("Tema", seletor("Tema", [["todas", "Tudo"], ...Object.keys(MIMICAS).map((c) => [c, c])], cfg.cat, (v) => this.l.configurar({ cat: v }))),
          ],
          acoes: [botao(pessoas.length < 2 ? "Chame mais alguém para jogar" : "Começar", { tipo: "primary", icone: "drama", classe: "btn--lg", desligado: pessoas.length < 2, onClick: () => this.l.comecar(this.pessoas()) })],
        }),
      );
      return;
    }
    if (!this.p || !this.p.no.isConnected) {
      this.raiz.replaceChildren();
      this.p = { video: janelaDeVideo("mimica__video"), anel: anelTempo(56), info: el("div.mimica__info"), cartao: el("div.mimica__cartao"), placar: el("ol.jg-placar") };
      this.p.no = el("div.mimica", {}, [
        el("div.mimica__palco", {}, [this.p.video.no, el("div.mimica__sobre", {}, [this.p.anel.no, this.p.info]), this.p.cartao]),
        el("aside.mimica__lado", {}, [el("h3.jogos__titulo", { text: "Placar" }), this.p.placar]),
      ]);
      this.raiz.append(this.p.no);
    }
    const p = this.p;
    const r = this.l.r;
    const souDaVez = r.de === this.eu;
    const ator = pessoas.find((x) => x.id === r.de) || { id: r.de, nome: r.nome };
    p.video.mostrar(ator, this.c.videoDe(r.de), { espelho: souDaVez });
    p.anel.no.hidden = fase !== "jogando";
    if (fase === "jogando") p.anel.definir(this.l.restante(), Number(r.tempo) || 60);
    trocar(p.info, `${fase}|${r.n}`, () =>
      el("div", {}, [
        el("strong", { text: fase === "fim" ? "Fim de jogo!" : souDaVez ? "Sua vez de imitar!" : `${r.nome} está imitando` }),
        fase === "jogando" && r.cat ? el("span.jg-chip", { text: r.cat }) : null,
        fase !== "fim" ? el("span.muted", { text: `Vez ${Math.min(Number(r.k) + 1, Number(r.total))} de ${r.total}` }) : null,
      ]),
    );
    const fim = this.c.estado.ler("mm/fim");
    const sig = JSON.stringify([fase, r.n, souDaVez, fase === "jogando" && souDaVez ? this.l.minha?.palavra : "", fase === "revelada" ? fim : "", fase === "fim" ? this.c.estado.ler("mm/placar") : "", pessoas.map((x) => x.id)]);
    trocar(p.cartao, sig, () => this.#cartao(fase, r, souDaVez, pessoas, fim));
    const base = this.c.estado.ler("mm/placar");
    placar(p.placar, ranking(base, pessoas, this.eu).map((x) => ({ ...x, marca: x.id === r.de && fase !== "fim" ? "desenha" : "", extra: x.id === r.de && fase !== "fim" ? "imitando" : "" })), { pessoas });
  }

  #cartao(fase, r, souDaVez, pessoas, fim) {
    if (fase === "escolhendo" && souDaVez) {
      const lista = el("div.desenho__opcoes");
      const preencher = (trocar) =>
        lista.replaceChildren(...this.l.opcoes({ trocar }).map((o) => el("button.desenho__opcao", { type: "button", onClick: () => this.l.escolher(o.palavra, o.cat) }, [el("strong", { text: o.palavra }), el("span.muted", { text: o.cat })])));
      preencher(false);
      return el("div.mimica__escolha", {}, [el("h3", { text: "Escolha o que vai imitar (só você vê):" }), lista, botao("Outras", { icone: "shuffle", tipo: "ghost", onClick: () => preencher(true) })]);
    }
    if (fase === "escolhendo") {
      const aqui = pessoas.some((x) => x.id === r.de);
      return el("div.mimica__aviso", {}, [el("p", { text: `${r.nome || "Alguém"} está escolhendo… prestem atenção na câmera!` }), aqui ? null : botao("Pular a vez (saiu)", { icone: "skip-forward", onClick: () => this.l.pular(this.pessoas()) })]);
    }
    if (fase === "jogando" && souDaVez) {
      const outros = pessoas.filter((x) => x.id !== this.eu);
      return el("div.mimica__ator", {}, [
        el("span.jogos__rotulo", { text: "Imite sem falar" }),
        el("strong.mimica__palavra", { text: this.l.minha?.palavra || "?" }),
        el("span.jogos__rotulo", { text: "Quem acertou?" }),
        el(
          "div.mimica__quem",
          {},
          outros.map((x) => el("button.mimica__pessoa", { type: "button", onClick: () => this.l.acertou(x.id, x.nome) }, [rosto(x, 28), el("span.truncate", { text: x.nome })])),
        ),
        botao("Ninguém acertou", { tipo: "ghost", onClick: () => this.l.encerrar() }),
      ]);
    }
    if (fase === "jogando") return el("div.mimica__aviso", {}, [icon("megaphone"), el("p", { text: "Chute em voz alta!" })]);
    if (fase === "revelada") {
      const pts = this.l.pontosDaVez(r);
      return el("div.mimica__revela", {}, [
        el("span.jogos__rotulo", { text: "Era" }),
        el("strong.mimica__palavra", { text: fim?.palavra || "?" }),
        el("p", { text: fim?.quem ? `${nomeDe(pessoas, fim.quem, this.eu, fim.nomeQuem)} acertou! +${pts[fim.quem] || 0}` : "Ninguém acertou desta vez." }),
        botao("Próxima agora", { icone: "skip-forward", onClick: () => this.l.proxima(this.pessoas()) }),
      ]);
    }
    return podio(ranking(this.c.estado.ler("mm/placar"), pessoas, this.eu), { pessoas, acoes: [botao("Jogar de novo", { tipo: "primary", icone: "rotate-ccw", onClick: () => this.l.comecar(this.pessoas()) })] });
  }
}

/* ================================================================== *
 * Stop
 * ================================================================== */

export class VistaStop extends Vista {
  #rodadaForm = -1;
  #campos = new Map();

  montar() {
    this.raiz = el("div.stop-raiz");
    this.c.corpo.append(this.raiz);
  }
  relogio() {
    return !!this.l.r && !this.l.parado() && this.l.config().tempo > 0;
  }
  tique() {
    this.l.manter(this.pessoas());
    this.desenhar();
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      this.#rodadaForm = -1;
      trocar(this.raiz, `lobby|${v.cfg.cats.join()}|${v.cfg.tempo}`, () => this.#abertura(v));
      return;
    }
    if (v.fase === "escrevendo") {
      if (this.#rodadaForm !== v.n || !this.form?.isConnected) this.#montarForm(v);
      this.#atualizarForm(v);
      return;
    }
    this.#rodadaForm = -1;
    trocar(this.raiz, `conf|${v.n}|${JSON.stringify(v.jogadores)}|${JSON.stringify(v.placar)}`, () => this.#conferencia(v, pessoas));
  }

  #abertura(v) {
    const chips = el("div.stop__cats", { role: "group", "aria-label": "Categorias" });
    for (const [id, nome] of Object.entries(CATEGORIAS_STOP)) {
      const b = el("button.jg-chip.jg-chip--botao", { type: "button", "aria-pressed": String(v.cfg.cats.includes(id)), text: nome });
      b.addEventListener("click", () => this.l.alternarCategoria(id));
      chips.append(b);
    }
    return abertura({
      icone: "hand",
      titulo: "Stop!",
      regras: ["Sai uma letra. Escreva uma palavra com ela em cada categoria.", "Terminou tudo? Aperte STOP: todo mundo para na hora.", "Resposta só sua vale 10, repetida vale 5. Inventou? A turma anula."],
      ajustes: [ajuste(`Categorias (${v.cfg.cats.length})`, chips), ajuste("Tempo máximo", seletor("Tempo", [[0, "Sem limite"], [60, "1 min"], [90, "1 min 30"], [120, "2 min"], [180, "3 min"]], v.cfg.tempo, (x) => this.l.configurar({ tempo: Number(x) })))],
      acoes: [botao("Sortear a letra", { tipo: "primary", icone: "hand", classe: "btn--lg", onClick: () => this.l.novaRodada(this.pessoas()) })],
    });
  }

  #montarForm(v) {
    this.#rodadaForm = v.n;
    this.#campos.clear();
    this.raiz.replaceChildren();
    const grade = el("div.stop__grade");
    for (const c of v.cats) {
      const input = el("input.input", { type: "text", maxLength: 40, autocomplete: "off", spellcheck: false, "aria-label": c.nome, placeholder: `${v.letra}…`, value: this.l.minhaResposta(c.id) });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          const campos = [...this.#campos.values()].map((x) => x.input);
          const prox = campos[campos.indexOf(input) + 1];
          if (prox) prox.focus();
          else if (this.l.podeParar()) this.l.gritarStop();
        }
      });
      input.addEventListener("input", () => {
        this.l.escrever(c.id, input.value);
        this.#atualizarForm(this.l.vista(this.pessoas()));
      });
      const ok = el("span.stop__ok", { "aria-hidden": "true" }, [icon("check")]);
      this.#campos.set(c.id, { input, ok });
      grade.append(el("label.stop__campo", {}, [el("span.stop__rotulo", { text: c.nome }), el("span.stop__entrada", {}, [input, ok])]));
    }
    this.letra = el("div.stop__letra", { text: v.letra, "aria-label": `Letra ${v.letra}` });
    this.tempo = el("span.stop__tempo");
    this.botaoStop = el("button.stop__botao", { type: "button" }, [el("span", { text: "STOP!" })]);
    this.botaoStop.addEventListener("click", () => this.l.gritarStop());
    this.form = el("div.stop", {}, [
      el("div.stop__topo", {}, [this.letra, el("div.stop__dica", {}, [el("strong", { text: `Tudo com ${v.letra}!` }), el("span.muted", { text: "Preencha todas e grite STOP." }), this.tempo])]),
      grade,
      el("div.stop__acoes", {}, [this.botaoStop]),
    ]);
    this.raiz.append(this.form);
    requestAnimationFrame(() => [...this.#campos.values()][0]?.input.focus({ preventScroll: true }));
  }

  #atualizarForm(v) {
    for (const [, { input, ok }] of this.#campos) ok.classList.toggle("is-on", valida(input.value, v.letra));
    this.botaoStop.disabled = !this.l.podeParar();
    this.tempo.textContent = v.restante != null ? `Tempo: ${Math.ceil(v.restante)} s` : "";
    this.tempo.classList.toggle("is-acabando", v.restante != null && v.restante <= 10);
  }

  #conferencia(v, pessoas) {
    const cabeca = el("tr", {}, [el("th", { text: "" }), ...v.cats.map((c) => el("th", { scope: "col", text: c.nome })), el("th", { scope: "col", text: "Rodada" })]);
    const linhas = v.jogadores.map((j) =>
      el("tr", { class: j.id === this.eu ? "is-eu" : "" }, [
        el("th", { scope: "row" }, [el("span.stop__quem", {}, [rosto(pessoas.find((p) => p.id === j.id) || j, 24), el("span.truncate", { text: j.id === this.eu ? "Você" : j.nome })])]),
        ...v.cats.map((c) => {
          const cel = j.celulas[c.id] || { texto: "", pontos: 0 };
          const minha = j.id === this.eu;
          const conteudo = [
            el("span.stop__resposta", { text: cel.texto || "—" }),
            el(`b.stop__pts.stop__pts--${cel.pontos}`, { text: String(cel.pontos) }),
            cel.vetos ? el("span.stop__vetos", { title: "Votos para anular" }, [icon("thumbs-down"), el("span", { text: String(cel.vetos) })]) : null,
          ];
          const classe = `${cel.valida ? "" : "is-invalida"} ${cel.repetida ? "is-repetida" : ""} ${cel.meuVeto ? "is-meu-veto" : ""}`;
          if (minha || !cel.texto || cel.letraErrada) return el("td", { class: classe }, [el("span.stop__celula", {}, conteudo)]);
          const b = el("button.stop__celula", { type: "button", "aria-pressed": String(cel.meuVeto), "aria-label": `${cel.texto}: ${cel.meuVeto ? "tirar meu voto para anular" : "votar para anular"}` }, conteudo);
          b.addEventListener("click", () => this.l.vetar(j.id, c.id));
          return el("td", { class: classe }, [b]);
        }),
        el("td.stop__total", {}, [el("b", { text: String(j.pontos) })]),
      ]),
    );
    const quem = v.quemParou ? (v.quemParou.id === this.eu ? "Você gritou STOP!" : `${v.quemParou.nome} gritou STOP!`) : "Acabou o tempo!";
    const geral = ranking(v.placar, pessoas, this.eu).map((x) => ({ ...x, pontos: x.pontos + (v.jogadores.find((j) => j.id === x.id)?.pontos || 0) }));
    geral.sort((a, b) => b.pontos - a.pontos);
    const pl = el("ol.jg-placar");
    placar(pl, geral, { pessoas });
    return el("div.stop.stop--conferir", {}, [
      el("div.stop__topo", {}, [el("div.stop__letra.is-parada", { text: v.letra }), el("div.stop__dica", {}, [el("strong", { text: quem }), el("span.muted", { text: "Confiram as respostas. Clique na de alguém para votar e anular (inventada, não vale…)." })])]),
      el("div.stop__tabelaRolagem", {}, [el("table.stop__tabela", {}, [el("thead", {}, [cabeca]), el("tbody", {}, linhas)])]),
      el("div.stop__fim", {}, [el("div", {}, [el("h3.jogos__titulo", { text: "Placar geral (com esta rodada)" }), pl]), el("div.stop__acoes", {}, [botao("Próxima letra", { tipo: "primary", icone: "skip-forward", classe: "btn--lg", onClick: () => this.l.novaRodada(this.pessoas()) }), botao("Encerrar o jogo", { tipo: "ghost", onClick: () => this.l.novoJogo() })])]),
    ]);
  }
}

function valida(resposta, letra) {
  const t = String(resposta || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return t.length >= 2 && t[0] === String(letra || "").toLowerCase();
}

/* ================================================================== *
 * Quiz
 * ================================================================== */

const CORES_QUIZ = ["vermelho", "azul", "amarelo", "verde", "roxo"];

export class VistaQuiz extends Vista {
  #revelada = "";
  #celular = null;

  montar() {
    this.raiz = el("div.quiz-raiz");
    this.c.corpo.append(this.raiz);
    // Responder pelo celular (QuizzV): no topo da mesa, em qualquer fase.
    const qv = this.c.quizzv;
    if (qv) {
      this.#celular = botao("", { tipo: "ghost", icone: "smartphone", classe: "quizzv__botao", onClick: () => qv.parear() });
      this.c.extra.append(this.#celular);
      this.ouvir(qv, "mudou", () => this.#pintarCelular());
      this.#pintarCelular();
    }
  }

  #pintarCelular() {
    const b = this.#celular;
    if (!b) return;
    const ligado = !!this.c.quizzv?.conectado;
    b.classList.toggle("is-ligado", ligado);
    b.dataset.tip = ligado ? "Celular conectado (QuizzV)" : "Responder pelo celular (QuizzV)";
    b.dataset.tipPlacement = "bottom";
    b.setAttribute("aria-label", b.dataset.tip);
    b.replaceChildren(icon("smartphone", { size: "sm" }), el("span.quizzv__rotulo", { text: ligado ? "Celular conectado" : "Pelo celular" }));
  }
  relogio() {
    return !!this.l.jogo();
  }
  tique() {
    this.l.manter(this.pessoas());
    this.desenhar();
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      const cfg = v.cfg;
      const qv = v.quizzv;
      if (cfg.fonte === "quizzv" && qv) {
        trocar(this.raiz, `lobby-qv|${qv.carga}|${qv.qtd}|${qv.tempo}`, () =>
          abertura({
            icone: "smartphone",
            titulo: qv.titulo,
            regras: [
              `${qv.qtd} ${qv.qtd === 1 ? "pergunta" : "perguntas"} do QuizzV${qv.de ? ` de ${qv.de}` : ""}, ${qv.tempo} s cada${qv.embaralhar ? ", em ordem sorteada" : ""}.`,
              "Responda aqui ou pelo celular. Acertou rápido, mais pontos.",
              "No fim, o pódio.",
            ],
            acoes: [
              botao("Começar", { tipo: "primary", icone: "lightbulb", classe: "btn--lg", onClick: () => this.l.comecar() }),
              botao("Usar as perguntas do Vcall", { tipo: "ghost", onClick: () => this.l.configurar({ fonte: "vcall" }) }),
            ],
          }),
        );
        return;
      }
      trocar(this.raiz, `lobby|${JSON.stringify(cfg)}|${qv?.carga || ""}`, () =>
        abertura({
          icone: "lightbulb",
          titulo: "Quiz",
          regras: ["Todo mundo vê a mesma pergunta ao mesmo tempo.", "Acertou rápido, mais pontos (até 1.000 por pergunta).", "No fim, o pódio."],
          ajustes: [
            ajuste("Tema", seletor("Tema", [["todos", "Todos os temas"], ...Object.entries(v.temas)], cfg.tema, (x) => this.l.configurar({ tema: x }))),
            ajuste("Perguntas", seletor("Perguntas", [5, 10, 15, 20].map((n) => [n, `${n} perguntas`]), cfg.qtd, (x) => this.l.configurar({ qtd: Number(x) }))),
            ajuste("Tempo", seletor("Tempo", [10, 15, 20, 30].map((n) => [n, `${n} s por pergunta`]), cfg.tempo, (x) => this.l.configurar({ tempo: Number(x) }))),
          ],
          acoes: [
            botao("Começar", { tipo: "primary", icone: "lightbulb", classe: "btn--lg", onClick: () => this.l.comecar() }),
            // O quiz do QuizzV que já veio nesta chamada continua à mão.
            qv
              ? botao(`Usar “${qv.titulo}” (QuizzV)`, { tipo: "ghost", icone: "smartphone", onClick: () => this.l.configurar({ fonte: "quizzv" }) })
              : this.c.quizzv
                ? botao("Usar um quiz do meu QuizzV", { tipo: "ghost", icone: "smartphone", onClick: () => this.c.quizzv.parear() })
                : null,
          ].filter(Boolean),
        }),
      );
      return;
    }
    if (v.fase === "fim") {
      trocar(this.raiz, `fim|${JSON.stringify(v.placar)}`, () =>
        podio(
          v.placar.map((x) => ({ id: x.id, nome: x.nome, pontos: x.total, eu: x.eu })),
          { pessoas, titulo: v.titulo ? `Fim de “${v.titulo}”!` : "Fim do quiz!", acoes: [botao("Jogar de novo", { tipo: "primary", icone: "rotate-ccw", onClick: () => this.l.comecar() }), botao("Trocar tema", { tipo: "ghost", onClick: () => this.l.encerrar() })] },
        ),
      );
      return;
    }
    if (v.fase === "preparar") {
      trocar(this.raiz, `prep|${v.k}|${v.contagem}`, () => el("div.quiz__preparar", {}, [el("span.jogos__rotulo", { text: v.k === 0 ? "Preparem-se!" : `Pergunta ${v.k + 1}` }), el("strong.quiz__contagem", { text: String(v.contagem || "") })]));
      return;
    }
    if (!this.p || !this.p.no.isConnected || this.p.k !== v.k) this.#montarPergunta(v);
    const p = this.p;
    p.barra.style.setProperty("--p", String(v.restante / v.limite));
    p.tempo.textContent = v.fase === "revelada" ? "" : String(Math.ceil(v.restante));
    const revelada = v.fase === "revelada";
    p.opcoes.forEach((b, i) => {
      b.disabled = revelada || !!v.minha;
      b.classList.toggle("is-minha", v.minha?.e === i);
      b.classList.toggle("is-certa", revelada && i === v.pergunta.certa);
      b.classList.toggle("is-errada", revelada && i !== v.pergunta.certa);
      const quem = b.querySelector(".quiz__quem");
      quem.textContent = revelada && v.porOpcao ? v.porOpcao[i].join(", ") : "";
    });
    let status;
    if (revelada) {
      const m = v.minha;
      status = m ? (m.certo ? `Certo! +${m.pontos}${m.seq > 1 ? ` · ${m.seq} seguidas` : ""}` : "Errou! A certa está em verde.") : "Tempo esgotado.";
    } else status = v.minha ? `Resposta enviada! Esperando os outros (${v.responderam} responderam)` : `${v.responderam} responderam`;
    trocar(p.status, `${status}|${revelada}`, () => el(`p.quiz__status${revelada && v.minha?.certo ? ".is-certo" : revelada ? ".is-errou" : ""}`, { text: status }));
    // A explicação que veio no quiz do QuizzV, só depois de revelar.
    const explicacao = revelada ? v.pergunta.explicacao || "" : "";
    trocar(p.explicacao, `${v.k}|${explicacao}`, () => (explicacao ? el("p.quiz__explicacao", {}, [icon("info", { size: "sm" }), el("span", { text: explicacao })]) : el("span")));
    if (revelada && this.#revelada !== `${v.k}`) {
      this.#revelada = `${v.k}`;
      if (v.minha?.certo) this.c.confete();
    }
    trocar(p.rodape, `${revelada}|${v.k}`, () => (revelada ? botao(v.k + 1 >= v.total ? "Ver o resultado" : "Próxima pergunta", { tipo: "primary", icone: "skip-forward", onClick: () => this.l.proxima() }) : el("span")));
    placar(p.placar, v.placar.slice(0, 8).map((x) => ({ id: x.id, nome: x.nome, pontos: x.total, eu: x.eu, extra: x.seq > 1 ? `${x.seq} seguidas` : "" })), { pessoas, vazio: "Ninguém respondeu ainda." });
  }

  #montarPergunta(v) {
    this.raiz.replaceChildren();
    const barra = el("div.quiz__barra", { "aria-hidden": "true" }, [el("i")]);
    const tempo = el("b.quiz__tempo");
    const opcoes = v.pergunta.opcoes.map((o, i) => {
      const b = el(`button.quiz__opcao.quiz__opcao--${CORES_QUIZ[i]}`, { type: "button" }, [el("span.quiz__letra", { text: v.letras[i] }), el("span.quiz__texto", { text: o }), el("span.quiz__quem")]);
      b.addEventListener("click", () => {
        if (this.l.responder(i)) this.desenhar();
      });
      return b;
    });
    this.p = { k: v.k, barra, tempo, opcoes, status: el("div"), explicacao: el("div"), rodape: el("div.quiz__rodape"), placar: el("ol.jg-placar") };
    this.p.no = el("div.quiz", {}, [
      el("div.quiz__palco", {}, [
        el("div.quiz__cabeca", {}, [el("span.jg-chip", { text: `Pergunta ${v.k + 1} de ${v.total}` }), v.pergunta.tema ? el("span.muted", { text: v.pergunta.tema }) : v.titulo ? el("span.muted.truncate", { text: v.titulo }) : null, tempo]),
        barra,
        // Enunciado longo (texto-base de prova, vindo do QuizzV): letra menor e as quebras de linha dele.
        el("h2.quiz__pergunta", { class: v.pergunta.texto.length > 220 ? "quiz__pergunta--longa" : "", text: v.pergunta.texto }),
        el("div.quiz__opcoes", { dataset: { n: opcoes.length } }, opcoes),
        this.p.status,
        this.p.explicacao,
        this.p.rodape,
      ]),
      el("aside.quiz__lado", {}, [el("h3.jogos__titulo", { text: "Placar" }), this.p.placar]),
    ]);
    this.raiz.append(this.p.no);
  }
}

/* ================================================================== *
 * Quem sou eu?
 * ================================================================== */

export class VistaQuemSouEu extends Vista {
  #cat = "todas";
  #videos = new Map();

  montar() {
    this.raiz = el("div.qse-raiz");
    this.c.corpo.append(this.raiz);
  }
  relogio() {
    return !!this.l.jogo();
  }
  tique() {
    // Só os vídeos (câmera que liga e desliga); o resto muda pelo estado.
    for (const [id, j] of this.#videos) j.mostrar(this.pessoas().find((p) => p.id === id), this.c.videoDe(id), { espelho: id === this.eu });
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      this.#videos.clear();
      trocar(this.raiz, "lobby", () =>
        abertura({
          icone: "scan-face",
          titulo: "Quem sou eu?",
          regras: ["Cada um ganha um personagem colado na testa: todo mundo vê, menos você.", "Na sua vez, faça perguntas de sim ou não à turma.", "Acertou? Alguém marca. Quem descobrir primeiro ganha."],
          ajustes: [ajuste("Personagens", seletor("Personagens", [["todas", "De tudo um pouco"], ...Object.keys(PERSONAGENS).map((c) => [c, c])], this.#cat, (x) => (this.#cat = x)))],
          acoes: [botao(pessoas.length < 2 ? "Chame mais alguém para jogar" : "Sortear os personagens", { tipo: "primary", icone: "scan-face", classe: "btn--lg", desligado: pessoas.length < 2, onClick: () => this.l.sortear(this.pessoas(), this.#cat) })],
        }),
      );
      return;
    }
    if (!this.p || !this.p.no.isConnected) {
      this.raiz.replaceChildren();
      this.#videos.clear();
      this.p = { status: el("div"), grade: el("div.qse__grade"), acoes: el("div.jg-rodape") };
      this.p.no = el("div.qse", {}, [this.p.status, this.p.grade, this.p.acoes]);
      this.raiz.append(this.p.no);
    }
    const p = this.p;
    const vez = v.cartas.find((c) => c.daVez);
    let msg;
    let tom = "";
    if (v.fase === "fim") {
      msg = "Todo mundo terminou!";
      tom = "ok";
    } else if (vez?.eu) {
      msg = "Sua vez: pergunte algo de sim ou não!";
      tom = "vez";
    } else msg = vez ? `Vez de ${vez.nome} perguntar` : "Perguntem à vontade!";
    faixa(p.status, `${msg}|${tom}`, [el("span", { text: msg }), vez && v.fase !== "fim" ? botao("Passar a vez", { icone: "skip-forward", tipo: "ghost", onClick: () => this.l.passarVez(this.pessoas()) }) : null], tom);
    sincronizar(
      p.grade,
      v.cartas.map((c) => ({
        chave: c.id,
        sig: JSON.stringify([c.quem, c.terminou, c.posicao, c.daVez, c.temCarta, c.nome, c.escolhidoPor]),
        criar: () => this.#cartao(c),
      })),
    );
    trocar(p.acoes, `${v.faltamCarta}|${v.fase}`, () =>
      el("div.jg-rodape", {}, [
        v.faltamCarta ? botao(`Dar personagem a quem chegou (${v.faltamCarta})`, { icone: "user-plus", onClick: () => this.l.completar(this.pessoas()) }) : null,
        botao("Nova rodada", { icone: "shuffle", tipo: v.fase === "fim" ? "primary" : "ghost", onClick: () => this.l.sortear(this.pessoas(), this.l.jogo()?.cat || this.#cat) }),
      ]),
    );
    this.tique();
  }

  #cartao(c) {
    const pessoa = this.pessoas().find((p) => p.id === c.id) || c;
    let janela = this.#videos.get(c.id);
    if (!janela) {
      janela = janelaDeVideo("qse__video");
      this.#videos.set(c.id, janela);
    }
    janela.mostrar(pessoa, this.c.videoDe(c.id), { espelho: c.eu });
    const papel = el("div.qse__papel", { class: c.eu && !c.terminou ? "is-segredo" : "" }, [el("span", { text: !c.temCarta ? "sem personagem" : c.quem ?? "???" })]);
    const acoes = el("div.qse__acoes");
    if (c.temCarta && !c.terminou) {
      if (c.eu) {
        acoes.append(botao("Acertei!", { icone: "check", tipo: "primary", onClick: () => this.l.marcar(c.id, "acertou") }), botao("Desisto", { tipo: "ghost", onClick: () => this.l.marcar(c.id, "desistiu") }));
      } else {
        acoes.append(
          botao("Acertou", { icone: "check", onClick: () => this.l.marcar(c.id, "acertou") }),
          botao("", { icone: "pencil", rotulo: `Escolher outro personagem para ${c.nome}`, tipo: "ghost", onClick: () => this.#trocar(c, acoes) }),
        );
      }
    }
    return el("article.qse__cartao", { class: `${c.daVez ? "is-vez" : ""} ${c.terminou ? `is-${c.terminou}` : ""} ${c.eu ? "is-eu" : ""}` }, [
      el("div.qse__tela", {}, [janela.no, papel, c.posicao ? el(`span.qse__medalha${c.posicao <= 3 ? `.jg-pos--${c.posicao}` : ""}`, { text: `${c.posicao}º`, "aria-label": `${c.posicao}º a acertar` }) : null]),
      el("div.qse__nome", {}, [el("strong.truncate", { text: c.eu ? `${c.nome} (você)` : c.nome }), c.terminou === "desistiu" ? el("span.muted", { text: "desistiu" }) : c.posicao ? el("span.muted", { text: `acertou em ${c.posicao}º` }) : null]),
      acoes,
    ]);
  }

  #trocar(c, onde) {
    const i = campo({
      placeholder: `Personagem para ${c.nome}`,
      max: 60,
      aoEnviar: (t) => this.l.definirPara(c.id, t, c.nome),
    });
    onde.replaceChildren(i);
    i.focus();
  }
}

/* ================================================================== *
 * Roda de perguntas
 * ================================================================== */

export class VistaRoda extends Vista {
  #festejado = 0;

  montar() {
    const modos = el("div.jogos__abas", { role: "tablist", "aria-label": "Tipo de pergunta" });
    this.botoesModo = {};
    for (const [id, m] of Object.entries(MODOS_RODA)) {
      const b = el("button.jogos__aba", { type: "button", role: "tab", text: m.nome });
      b.addEventListener("click", () => this.l.proxima(id, this.pessoas()));
      this.botoesModo[id] = b;
      modos.append(b);
    }
    this.c.extra.append(modos);
    this.raiz = el("div.roda-raiz");
    this.c.corpo.append(this.raiz);
  }
  relogio() {
    return !!this.l.q && !this.l.revelada();
  }
  tique() {
    this.l.manter(this.pessoas());
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    for (const [id, b] of Object.entries(this.botoesModo)) b.setAttribute("aria-selected", String(v.modo === id));
    if (v.fase === "lobby") {
      trocar(this.raiz, "lobby", () =>
        abertura({
          icone: "messages-square",
          titulo: "Roda de perguntas",
          regras: ["Perguntas para conhecer melhor a turma (e rir um pouco).", "Os votos ficam escondidos até todo mundo votar.", "Escolha o tipo:"],
          acoes: Object.entries(MODOS_RODA).map(([id, m]) => botao(m.nome, { tipo: id === "prefere" ? "primary" : "", onClick: () => this.l.proxima(id, this.pessoas()) })),
        }),
      );
      return;
    }
    const sig = JSON.stringify([v.n, v.fase, v.meu, v.votaram.map((x) => x.id), v.lados?.map((l) => l.map((x) => x.id)), v.ja?.length, v.nunca?.length, v.ranking, v.alvo, pessoas.map((p) => p.id)]);
    trocar(this.raiz, sig, () => this.#cartao(v, pessoas));
    if (v.fase === "revelada" && this.#festejado !== v.n) {
      this.#festejado = v.n;
      this.c.confete();
    }
  }

  #cartao(v, pessoas) {
    const total = pessoas.length;
    const rodape = el("div.roda__rodape", {}, [
      v.fase === "votando" ? el("span.muted", { text: `${v.votaram.length} de ${total} votaram` }) : null,
      v.fase === "votando" ? botao("Revelar agora", { tipo: "ghost", icone: "eye", onClick: () => this.l.revelar() }) : null,
      botao("Próxima pergunta", { tipo: v.fase === "votando" ? "" : "primary", icone: "skip-forward", onClick: () => this.l.proxima(v.modo, this.pessoas()) }),
      botao("Escrever a minha", { tipo: "ghost", icone: "pencil", onClick: (e) => this.#escrever(v.modo, e.currentTarget.parentElement) }),
    ]);
    let corpo;
    if (v.modo === "prefere") corpo = this.#prefere(v);
    else if (v.modo === "eununca") corpo = this.#euNunca(v);
    else if (v.modo === "quem") corpo = this.#quem(v, pessoas);
    else corpo = this.#gelo(v, pessoas);
    return el("div.roda", { class: `roda--${v.modo}` }, [el("span.jogos__rotulo", { text: v.nomeModo }), corpo, rodape]);
  }

  #prefere(v) {
    const [a, b] = Array.isArray(v.texto) ? v.texto : ["?", "?"];
    const revelada = v.fase === "revelada";
    const lado = (i, texto) => {
      const votos = revelada ? v.lados[i] : null;
      const pct = revelada && v.total ? Math.round((votos.length / v.total) * 100) : 0;
      const b = el(`button.roda__lado.roda__lado--${i ? "b" : "a"}`, { type: "button", "aria-pressed": String(v.meu === i), disabled: revelada }, [
        el("span.roda__texto", { text: texto }),
        revelada ? el("span.roda__pct", { style: { "--pct": `${pct}%` } }, [el("b", { text: `${pct}%` }), el("span.muted", { text: votos.map((x) => x.nome).join(", ") || "ninguém" })]) : v.meu === i ? el("span.jg-chip", { text: "seu voto" }) : null,
      ]);
      b.addEventListener("click", () => this.l.votar(i));
      return b;
    };
    return el("div.roda__duelo", {}, [lado(0, a), el("span.roda__ou", { text: "ou" }), lado(1, b)]);
  }

  #euNunca(v) {
    const revelada = v.fase === "revelada";
    const opcao = (id, texto, em) => {
      const b = el("button.roda__opcao", { type: "button", "aria-pressed": String(v.meu === id), disabled: revelada }, [icon(em), el("span", { text: texto })]);
      b.addEventListener("click", () => this.l.votar(id));
      return b;
    };
    return el("div.roda__eununca", {}, [
      el("h2.roda__frase", { text: v.texto || "" }),
      revelada
        ? el("div.roda__colunas", {}, [
            el("div", {}, [el("h3", {}, [icon("check"), el("span", { text: `Já fizeram (${v.ja.length})` })]), el("p", { text: v.ja.map((x) => x.nome).join(", ") || "ninguém" })]),
            el("div", {}, [el("h3", {}, [icon("x"), el("span", { text: `Nunca (${v.nunca.length})` })]), el("p", { text: v.nunca.map((x) => x.nome).join(", ") || "ninguém" })]),
          ])
        : el("div.roda__opcoes", {}, [opcao("ja", "Já fiz", "check"), opcao("nunca", "Nunca fiz", "x")]),
    ]);
  }

  #quem(v, pessoas) {
    const revelada = v.fase === "revelada";
    const frase = el("h2.roda__frase", { text: `Quem da call é mais provável de ${v.texto || "…"}?` });
    if (revelada) {
      const max = Math.max(1, ...v.ranking.map((x) => x.n));
      return el("div", {}, [
        frase,
        el(
          "ol.roda__ranking",
          {},
          v.ranking.map((x, i) =>
            el("li", { class: i === 0 ? "is-primeiro" : "" }, [i === 0 ? icon("crown") : el("span"), rosto(pessoas.find((p) => p.id === x.id) || x, 32), el("strong.truncate", { text: x.nome }), el("span.roda__barra", { style: { "--pct": `${(x.n / max) * 100}%` } }), el("b", { text: `${x.n}` })]),
          ),
        ),
      ]);
    }
    return el("div", {}, [
      frase,
      el(
        "div.roda__pessoas",
        {},
        pessoas.map((p) => {
          const b = el("button.roda__pessoa", { type: "button", "aria-pressed": String(v.meu === p.id) }, [rosto(p, 48), el("span.truncate", { text: p.id === this.eu ? "Eu" : p.nome })]);
          b.addEventListener("click", () => this.l.votar(p.id));
          return b;
        }),
      ),
    ]);
  }

  #gelo(v, pessoas) {
    const alvo = v.alvo ? pessoas.find((p) => p.id === v.alvo.id) || v.alvo : null;
    return el("div.roda__gelo", {}, [
      el("h2.roda__frase", { text: v.texto || "" }),
      alvo ? el("div.roda__alvo", {}, [rosto(alvo, 56), el("span", {}, [el("span.jogos__rotulo", { text: "Quem responde" }), el("strong", { text: alvo.id === this.eu ? "Você!" : alvo.nome })])]) : null,
    ]);
  }

  #escrever(modo, onde) {
    const a = campo({ placeholder: modo === "prefere" ? "Opção A" : modo === "quem" ? "…ser o primeiro a chegar" : modo === "eununca" ? "Eu nunca…" : "Sua pergunta", max: 140, limpar: false, aoEnviar: () => enviar() });
    const b = modo === "prefere" ? campo({ placeholder: "Opção B", max: 140, limpar: false, aoEnviar: () => enviar() }) : null;
    const enviar = () => this.l.propria(modo, a.value, b?.value || "");
    onde.replaceChildren(a, b, botao("Usar", { tipo: "primary", onClick: enviar }));
    a.focus();
  }
}

/* ================================================================== *
 * Duas verdades e uma mentira
 * ================================================================== */

export class VistaDuasVerdades extends Vista {
  #editando = false;

  montar() {
    this.raiz = el("div.dv-raiz");
    this.c.corpo.append(this.raiz);
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "escrevendo") {
      if (this.#editando || !v.euPronto) {
        if (!this.form?.isConnected) this.#montarForm(v);
        this.#atualizarProntos(v);
        return;
      }
      this.form = null;
      trocar(this.raiz, `pronto|${v.prontos.map((p) => p.id).join()}|${v.faltam.length}`, () =>
        el("div.dv", {}, [
          el("div.dv__pronto", {}, [icon("check"), el("h2", { text: "Suas frases estão prontas!" }), el("p.muted", { text: "Quando todo mundo estiver pronto, alguém começa." })]),
          this.#listaProntos(v),
          el("div.jg-rodape", {}, [botao("Começar", { tipo: "primary", icone: "play", desligado: v.prontos.length < 2, onClick: () => this.l.proxima(this.pessoas()) }), botao("Editar as minhas", { tipo: "ghost", icone: "pencil", onClick: () => ((this.#editando = true), this.desenhar()) })]),
        ]),
      );
      return;
    }
    this.form = null;
    if (v.fase === "fim") {
      trocar(this.raiz, `fim|${JSON.stringify(v.placar)}`, () =>
        podio(ranking(v.placar, pessoas, this.eu), { pessoas, acoes: [botao("Jogar de novo", { tipo: "primary", icone: "rotate-ccw", onClick: () => this.l.novoJogo() })] }),
      );
      return;
    }
    const sig = JSON.stringify([v.fase, v.vez.n, v.meuVoto, v.votaram, v.mentira, v.porFrase, v.autor, v.minhaMentira, JSON.stringify(v.placar)]);
    trocar(this.raiz, sig, () => this.#rodada(v, pessoas));
  }

  #montarForm(v) {
    const minha = this.l.minha?.j === this.l.j ? this.l.minha : null;
    const nomes = ["Primeira", "Segunda", "Terceira"];
    let mentira = minha?.mentira ?? 2;
    const campos = [0, 1, 2].map((i) => {
      const input = el("input.input", { type: "text", maxLength: 140, placeholder: `${nomes[i]} frase sobre você`, value: minha?.frases?.[i] || "", "aria-label": `${nomes[i]} frase` });
      input.addEventListener("keydown", (e) => e.stopPropagation());
      return input;
    });
    const radios = [0, 1, 2].map((i) => {
      const r = el("input", { type: "radio", name: "dv-mentira", checked: i === mentira, "aria-label": `A ${nomes[i].toLowerCase()} é a mentira` });
      r.addEventListener("change", () => (mentira = i));
      return r;
    });
    const enviar = () => {
      if (this.l.publicar(campos.map((c) => c.value), mentira)) {
        this.#editando = false;
        this.desenhar();
      } else this.c.avisar("Escreva as três frases e marque qual é a mentira.", "warn");
    };
    this.prontos = el("div");
    this.form = el("div.dv", {}, [
      abertura({
        icone: "badge-question-mark",
        titulo: "Duas verdades e uma mentira",
        regras: ["Escreva três coisas sobre você: duas verdades e uma mentira.", "Na sua vez, a turma vota em qual é a mentira.", "Quem acerta ganha 100; você ganha 50 por cada um que enganar."],
      }),
      el(
        "div.dv__form",
        {},
        campos.map((c, i) => el("div.dv__linha", {}, [c, el("label.dv__radio", {}, [radios[i], el("span", { text: "mentira" })])])),
      ),
      el("div.jg-rodape", {}, [botao("Pronto!", { tipo: "primary", icone: "check", onClick: enviar })]),
      this.prontos,
    ]);
    this.raiz.replaceChildren(this.form);
  }

  #atualizarProntos(v) {
    trocar(this.prontos, `${v.prontos.map((p) => p.id).join()}|${v.faltam.length}`, () => this.#listaProntos(v));
  }

  #listaProntos(v) {
    return el("div.dv__prontos", {}, [
      el("span.jogos__rotulo", { text: `Prontos (${v.prontos.length})` }),
      el("div.dv__rostos", {}, v.prontos.map((p) => el("span.jg-chip", { text: p.id === this.eu ? "Você" : p.nome }))),
      v.faltam.length ? el("span.muted", { text: `Escrevendo: ${v.faltam.map((p) => p.nome).join(", ")}` }) : null,
    ]);
  }

  #rodada(v, pessoas) {
    const revelada = v.fase === "revelada";
    const autor = pessoas.find((p) => p.id === v.autor.id) || v.autor;
    const cartoes = v.frases.map((f, i) => {
      const ehMentira = revelada && v.mentira === i;
      const b = el("button.dv__frase", { type: "button", disabled: revelada || v.souAutor, "aria-pressed": String(v.meuVoto === i), class: `${revelada ? (ehMentira ? "is-mentira" : "is-verdade") : ""} ${v.minhaMentira === i ? "is-minha-mentira" : ""}` }, [
        el("span.dv__n", { text: String(i + 1) }),
        el("span.dv__texto", { text: f }),
        revelada ? el("span.dv__selo", { text: ehMentira ? "MENTIRA" : "verdade" }) : v.minhaMentira === i ? el("span.dv__selo", { text: "sua mentira" }) : v.meuVoto === i ? el("span.jg-chip", { text: "seu voto" }) : null,
        revelada && v.porFrase[i].length ? el("span.dv__quem", { text: v.porFrase[i].join(", ") }) : null,
      ]);
      b.addEventListener("click", () => this.l.votar(i));
      return b;
    });
    const acoes = [];
    if (!revelada && v.souAutor) acoes.push(botao("Revelar a mentira", { tipo: "primary", icone: "eye", onClick: () => this.l.revelar(this.pessoas()) }));
    if (!revelada && !v.autor.presente) acoes.push(botao("Pular (saiu)", { icone: "skip-forward", onClick: () => this.l.proxima(this.pessoas()) }));
    if (revelada) acoes.push(botao(v.restam ? "Próxima pessoa" : "Ver o resultado", { tipo: "primary", icone: "skip-forward", onClick: () => this.l.proxima(this.pessoas()) }));
    const pl = el("ol.jg-placar");
    placar(pl, ranking(v.placar, pessoas, this.eu), { pessoas });
    return el("div.dv.dv--rodada", {}, [
      el("div.dv__palco", {}, [
        el("div.dv__autor", {}, [rosto(autor, 56), el("h2", { text: v.souAutor ? "Suas frases: qual será que vão achar?" : `Qual é a mentira de ${v.autor.nome}?` })]),
        el("div.dv__frases", {}, cartoes),
        el("p.muted", { text: revelada ? "" : v.souAutor ? `${v.votaram} votaram · faltam ${v.faltam}` : `${v.votaram} votaram${v.meuVoto != null ? " · você já votou (dá para trocar)" : ""}` }),
        el("div.jg-rodape", {}, acoes),
      ]),
      el("aside.dv__lado", {}, [el("h3.jogos__titulo", { text: "Placar" }), pl]),
    ]);
  }
}

/* ================================================================== *
 * Palavras-código
 * ================================================================== */

export class VistaCodigo extends Vista {
  #apontada = null;
  #festejado = "";

  montar() {
    this.raiz = el("div.pc-raiz");
    this.c.corpo.append(this.raiz);
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      trocar(this.raiz, `lobby|${JSON.stringify(v.times)}|${JSON.stringify(v.eu)}`, () =>
        el("div.pc", {}, [
          abertura({
            icone: "swords",
            titulo: "Palavras-código",
            regras: ["Dois times. Cada um tem um mestre, que vê de que time é cada palavra.", "O mestre dá uma dica de UMA palavra e um número; o time aponta as cartas.", "Ache todas as suas antes do outro time. Cuidado com a bomba!"],
            acoes: [botao("Sortear os times", { icone: "shuffle", onClick: () => this.l.sortearTimes(this.pessoas()) }), botao("Começar a partida", { tipo: "primary", icone: "swords", onClick: () => this.l.novoJogo() })],
          }),
          this.#times(v),
          ["v", "a"].some((t) => !v.times[t].some((m) => m.mestre) || !v.times[t].some((m) => !m.mestre))
            ? el("p.muted.pc__aviso", { text: "Cada time precisa de um mestre e de pelo menos um agente (o ideal é 4 pessoas ou mais)." })
            : null,
        ]),
      );
      return;
    }
    const sig = JSON.stringify([v.cartas.map((c) => [c.revelada, c.cor]), v.vez, v.dica, v.restam, v.vencedor, v.times, v.eu, this.#apontada, v.podeDarDica]);
    trocar(this.raiz, sig, () => this.#jogo(v));
    if (v.vencedor && this.#festejado !== JSON.stringify(v.cartas.map((c) => c.palavra))) {
      this.#festejado = JSON.stringify(v.cartas.map((c) => c.palavra));
      if (v.eu?.time === v.vencedor) this.c.confete();
    }
  }

  #times(v) {
    const coluna = (t) =>
      el(`div.pc__time.pc__time--${t}`, {}, [
        el("h3", { text: `Time ${TIMES[t]}` }),
        el(
          "ul",
          {},
          v.times[t].length ? v.times[t].map((m) => el("li", {}, [m.mestre ? icon("crown", { label: "mestre" }) : el("span.pc__agente"), el("span.truncate", { text: m.eu ? `${m.nome} (você)` : m.nome }), m.mestre ? el("span.muted", { text: "mestre" }) : null])) : [el("li.muted", { text: "ninguém ainda" })],
        ),
        el("div.pc__entrar", {}, [botao("Entrar", { tipo: "ghost", onClick: () => this.l.entrar(t, false) }), botao("Ser mestre", { tipo: "ghost", icone: "crown", onClick: () => this.l.entrar(t, true) })]),
      ]);
    return el("div.pc__times", {}, [coluna("v"), coluna("a")]);
  }

  #jogo(v) {
    const minhaVez = v.podeApontar;
    const grade = el(
      "div.pc__grade",
      { role: "grid" },
      v.cartas.map((c) => {
        const apontada = this.#apontada === c.i && minhaVez && !c.revelada;
        const b = el("button.pc__carta", { type: "button", disabled: !minhaVez || c.revelada, class: `${c.revelada ? `is-revelada is-${c.cor}` : c.cor ? `dica-${c.cor}` : ""} ${apontada ? "is-apontada" : ""}`, "aria-label": `${c.palavra}${c.revelada ? ` (${c.cor === "x" ? "bomba" : c.cor === "n" ? "neutra" : TIMES[c.cor]})` : ""}` }, [
          c.cor === "x" ? icon("bomb") : null,
          el("span", { text: c.palavra }),
          apontada ? el("span.pc__confirma", { text: "clique de novo para revelar" }) : null,
        ]);
        b.addEventListener("click", () => {
          if (this.#apontada === c.i) {
            this.#apontada = null;
            this.l.apontar(c.i);
          } else this.#apontada = c.i;
          this.desenhar();
        });
        return b;
      }),
    );
    let topo;
    if (v.vencedor) topo = el("div.jg-faixa.jg-faixa--ok", {}, [icon("trophy"), el("strong", { text: `Time ${TIMES[v.vencedor]} venceu!` }), el("span.muted", { text: v.motivo })]);
    else {
      const dica = v.dica ? el("span.pc__dica", {}, [el("span.jogos__rotulo", { text: "Dica" }), el("strong", { text: v.dica.palavra.toUpperCase() }), el("b", { text: v.dica.n === 0 ? "∞" : String(v.dica.n) }), v.restam != null ? el("span.muted", { text: `restam ${v.restam}` }) : null]) : el("span.muted", { text: `Esperando a dica do mestre ${TIMES[v.vez].toLowerCase()}…` });
      topo = el(`div.jg-faixa.pc__vez.pc__vez--${v.vez}`, {}, [el("strong", { text: `Vez do ${TIMES[v.vez]}` }), dica]);
    }
    const placar = el("div.pc__placar", {}, [el("span.pc__resta.pc__resta--v", { text: `${v.faltam.v}` }), el("span.muted", { text: "faltam" }), el("span.pc__resta.pc__resta--a", { text: `${v.faltam.a}` })]);
    const acoes = el("div.jg-rodape");
    if (v.podeDarDica) {
      const palavra = campo({ placeholder: "Dica (uma palavra)", max: 30, limpar: false, aoEnviar: () => enviar() });
      const n = seletor("Quantas cartas", [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((x) => [x, x === 0 ? "∞" : String(x)]), 1, () => {});
      const enviar = () => {
        if (!this.l.darDica(palavra.value, Number(n.value))) this.c.avisar("A dica é uma palavra só (sem espaço).", "warn");
      };
      acoes.append(palavra, n, botao("Dar dica", { tipo: "primary", onClick: enviar }));
    }
    if (minhaVez) acoes.append(botao("Passar a vez", { icone: "skip-forward", tipo: "ghost", onClick: () => this.l.passar() }));
    if (v.vencedor) acoes.append(botao("Nova partida", { tipo: "primary", icone: "rotate-ccw", onClick: () => this.l.novoJogo() }));
    else acoes.append(botao("Novo tabuleiro", { tipo: "ghost", icone: "shuffle", onClick: () => this.l.novoJogo() }));
    const souMestre = v.eu?.mestre;
    const papel = v.eu ? `Você: ${souMestre ? "mestre" : "agente"} do ${TIMES[v.eu.time]}${souMestre ? " (você vê as cores)" : ""}` : "Você está assistindo. Entre num time ao lado.";
    return el("div.pc.pc--jogo", {}, [
      el("div.pc__palco", {}, [el("div.pc__cabeca", {}, [topo, placar]), grade, el("p.muted", { text: papel }), acoes]),
      el("aside.pc__lado", {}, [this.#times(v)]),
    ]);
  }
}

export const VISTAS_FESTA = {
  desenho: VistaDesenho,
  stop: VistaStop,
  quiz: VistaQuiz,
  mimica: VistaMimica,
  quemsoueu: VistaQuemSouEu,
  roda: VistaRoda,
  verdades: VistaDuasVerdades,
  codigo: VistaCodigo,
};
