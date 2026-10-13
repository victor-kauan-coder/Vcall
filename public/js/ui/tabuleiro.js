/**
 * ui/tabuleiro.js — as telas do Jogo da velha, do Lig 4, da Forca, do Jogo
 * da memória e dos Sorteios. A lógica está em features/tabuleiro.js.
 *
 * Como na mesa do Poker, cada casa e cada carta tem chave e assinatura e só
 * é refeita quando muda: a peça que cai é a única que anima, a carta que
 * vira é a única que gira.
 */
import { el, icon } from "../lib/dom.js";
import { BOT, COLUNAS, GIRO_MS, MAX_ERROS, TAMANHOS_MEMORIA } from "../features/tabuleiro.js";
import { PALAVRAS } from "../features/bancos.js";
import { Vista, abertura, ajuste, botao, campo, faixa, placar, rosto, seletor, sincronizar, svg, trocar } from "./jogos-comum.js";

/* ================================================================== *
 * Duelos: Jogo da velha e Lig 4
 * ================================================================== */

class VistaDuelo extends Vista {
  #festejado = "";

  montar() {
    this.lugares = el("div.duelo__lugares");
    this.status = el("div.duelo__status");
    this.tabuleiro = this.criarTabuleiro();
    this.acoes = el("div.duelo__acoes");
    this.placar = el("ol.jg-placar.duelo__placar");
    this.c.corpo.append(
      el("div.duelo", { class: `duelo--${this.tipo}` }, [
        el("div.duelo__palco", {}, [this.lugares, this.status, this.tabuleiro, this.acoes]),
        el("aside.duelo__lado", {}, [el("h3.jogos__titulo", {}, [icon("trophy"), el("span", { text: "Vitórias" })]), this.placar, (this.empates = el("p.muted.duelo__empates"))]),
      ]),
    );
  }

  desenhar() {
    const v = this.l.vista(this.pessoas());
    this.v = v;
    const pessoas = this.pessoas();
    // Lugares
    sincronizar(
      this.lugares,
      [1, 2].map((lado) => {
        const p = v[`p${lado}`];
        return {
          chave: `p${lado}`,
          sig: JSON.stringify([p?.id, p?.nome, p?.presente, v.vez === lado && v.fase === "jogando", v.meuLado, pessoas.find((x) => x.id === p?.id)?.avatar || null]),
          criar: () => this.#lugar(lado, p, v),
        };
      }),
    );
    // Situação
    const souJogador = v.meuLado > 0;
    let msg;
    let tom = "";
    if (v.fase === "esperando") msg = v.p1 || v.p2 ? "Esperando o outro jogador sentar…" : "Sentem-se para jogar (ou jogue contra o computador).";
    else if (v.fase === "fim") {
      if (!v.vencedor) {
        msg = "Deu velha! Empate.";
        tom = "aviso";
      } else {
        const p = v[`p${v.vencedor}`];
        msg = p.id === this.eu ? "Você venceu!" : `${p.nome} venceu!`;
        tom = "ok";
      }
    } else if (v.minhaVez) {
      msg = "Sua vez!";
      tom = "vez";
    } else msg = `Vez de ${v[`p${v.vez}`]?.nome || "…"}`;
    faixa(this.status, `${msg}|${tom}`, [el("span", { text: msg })], tom);
    if (v.fase === "fim" && v.vencedor && this.#festejado !== `${v.id}/${v.n}`) {
      this.#festejado = `${v.id}/${v.n}`;
      if (v[`p${v.vencedor}`]?.id === this.eu) this.c.confete();
    }
    this.desenharTabuleiro(v);
    // Ações
    const sozinho = pessoas.length < 2;
    const contraBot = v.p1?.id === BOT || v.p2?.id === BOT;
    trocar(this.acoes, JSON.stringify([v.fase, souJogador, contraBot, sozinho]), () =>
      el("div.duelo__botoes", {}, [
        v.fase === "fim" && souJogador ? botao("Revanche", { icone: "rotate-ccw", tipo: "primary", onClick: () => this.l.revanche() }) : null,
        !souJogador || v.fase === "fim" ? botao("Jogar contra o computador", { icone: "bot", tipo: sozinho && !contraBot ? "primary" : "", onClick: () => this.l.contraBot() }) : null,
        v.fase !== "esperando" ? botao("Nova partida", { icone: "plus", onClick: () => this.l.novaPartida() }) : null,
        souJogador ? botao("Sair do lugar", { icone: "log-out", tipo: "ghost", onClick: () => this.l.levantar() }) : null,
      ]),
    );
    placar(
      this.placar,
      v.placar.map((p) => ({ id: p.id, nome: p.nome, pontos: p.vitorias, eu: p.id === this.eu })),
      { pessoas, unidade: "", vazio: "Ninguém venceu ainda." },
    );
    this.empates.textContent = v.empates ? `Empates: ${v.empates}` : "";
  }

  #lugar(lado, p, v) {
    const marca = el(`span.duelo__marca.duelo__marca--${lado}`, { "aria-hidden": "true" });
    if (!p) {
      return el("div.duelo__lugar.is-vago", {}, [marca, el("span.muted", { text: lado === 1 ? "Começa" : "Responde" }), botao("Sentar aqui", { tipo: "primary", onClick: () => this.l.sentar(lado) })]);
    }
    const pessoa = this.pessoas().find((x) => x.id === p.id);
    return el("div.duelo__lugar", { class: `${v.vez === lado && v.fase === "jogando" ? "is-vez" : ""} ${p.presente ? "" : "is-saiu"}` }, [
      marca,
      p.id === BOT ? el("span.duelo__bot", {}, [icon("bot")]) : rosto(pessoa || p, 34),
      el("strong.truncate", { text: p.id === this.eu ? `${p.nome} (você)` : p.nome }),
      !p.presente ? el("span.muted", { text: "saiu" }) : null,
    ]);
  }
}

export class VistaVelha extends VistaDuelo {
  tipo = "velha";
  criarTabuleiro() {
    return el("div.velha", { role: "grid", "aria-label": "Tabuleiro" });
  }
  desenharTabuleiro(v) {
    const linha = new Set(v.linha || []);
    sincronizar(
      this.tabuleiro,
      [...v.t].map((c, i) => ({
        chave: String(i),
        sig: `${c}|${linha.has(i)}|${v.minhaVez && c === " "}`,
        criar: () => {
          const b = el("button.velha__casa", { type: "button", "aria-label": `Casa ${i + 1}${c !== " " ? `: ${c.toUpperCase()}` : ""}`, disabled: !(v.minhaVez && c === " "), class: linha.has(i) ? "is-linha" : "" }, [
            c !== " " ? el(`span.marca.marca--${c}`, { "aria-hidden": "true" }) : null,
          ]);
          b.addEventListener("click", () => this.l.jogar(i));
          return b;
        },
      })),
    );
  }
}

export class VistaLig4 extends VistaDuelo {
  tipo = "lig4";
  criarTabuleiro() {
    this.colunas = el("div.lig4__colunas");
    this.grade = el("div.lig4__grade", { "aria-hidden": "true" });
    return el("div.lig4", { role: "group", "aria-label": "Tabuleiro do Lig 4" }, [this.grade, this.colunas]);
  }
  desenharTabuleiro(v) {
    const linha = new Set(v.linha || []);
    sincronizar(
      this.grade,
      [...v.t].map((c, i) => ({
        chave: String(i),
        sig: `${c}|${linha.has(i)}|${v.ultima === i}`,
        criar: () => {
          const casa = el("div.lig4__casa", { class: linha.has(i) ? "is-linha" : "" });
          if (c !== " ") {
            const peca = el(`span.peca.peca--${c}`);
            // A última peça cai do alto da coluna até a casa dela.
            if (v.ultima === i) {
              peca.classList.add("is-caindo");
              peca.style.setProperty("--queda", String(Math.floor(i / COLUNAS) + 1));
            }
            casa.append(peca);
          }
          return casa;
        },
      })),
    );
    const cheias = [...Array(COLUNAS).keys()].map((col) => v.t[col] !== " ");
    sincronizar(
      this.colunas,
      cheias.map((cheia, col) => ({
        chave: String(col),
        sig: `${v.minhaVez && !cheia}|${v.meuLado}`,
        criar: () => {
          const b = el("button.lig4__coluna", { type: "button", "aria-label": `Coluna ${col + 1}`, disabled: !(v.minhaVez && !cheia), class: `lado-${v.meuLado}` });
          b.addEventListener("click", () => this.l.jogar(col));
          return b;
        },
      })),
    );
  }
}

/* ================================================================== *
 * Forca
 * ================================================================== */

export class VistaForca extends Vista {
  #festejado = "";
  #ultimoErro = 0;

  montar() {
    this.raiz = el("div.forca");
    this.c.corpo.append(this.raiz);
    this.cat = "todas";
  }

  desenhar() {
    const v = this.l.vista();
    if (v.fase === "lobby") {
      trocar(this.raiz, "lobby", () => this.#abertura());
      return;
    }
    if (!this.partes || !this.partes.no.isConnected) {
      this.raiz.replaceChildren();
      this.#montarJogo();
    }
    const p = this.partes;
    trocar(p.dica, JSON.stringify([v.dica, v.por?.nome, v.souAutor]), () =>
      el("div.forca__dica", {}, [
        el("span.jg-chip", { text: v.dica }),
        v.por ? el("span.muted", { text: v.souAutor ? "Você escolheu esta palavra: só assista!" : `Escolhida por ${v.por.nome}` }) : null,
      ]),
    );
    // O boneco: uma parte por erro.
    p.boneco.querySelectorAll("[data-parte]").forEach((n) => n.classList.toggle("is-on", Number(n.dataset.parte) <= v.erros));
    if (v.erros > this.#ultimoErro && v.fase === "jogando") {
      p.boneco.classList.remove("is-tremendo");
      void p.boneco.getBoundingClientRect();
      p.boneco.classList.add("is-tremendo");
    }
    this.#ultimoErro = v.erros;
    p.erros.textContent = `${v.erros} de ${MAX_ERROS} erros`;
    sincronizar(
      p.palavra,
      v.posicoes.map((x, i) => ({
        chave: String(i),
        sig: `${x.ch}|${x.aberta}|${x.revelada || false}|${x.espaco || false}`,
        criar: () => (x.espaco ? el("span.forca__espaco") : el("span.forca__letra", { class: `${x.aberta ? "is-aberta" : ""} ${x.revelada ? "is-revelada" : ""}`, text: x.aberta ? x.ch : "" })),
      })),
    );
    const jogando = v.fase === "jogando" && !v.souAutor;
    sincronizar(
      p.teclado,
      [...v.alfabeto].map((l) => {
        const usada = v.chutadas.includes(l);
        const errada = v.erradas.includes(l);
        return {
          chave: l,
          sig: `${usada}|${errada}|${jogando}`,
          criar: () => {
            const b = el("button.forca__tecla", { type: "button", text: l, disabled: usada || !jogando, class: usada ? (errada ? "is-errada" : "is-certa") : "", title: usada ? `${v.quemChutou[l] || ""}` : "" });
            b.addEventListener("click", () => this.l.chutar(l));
            return b;
          },
        };
      }),
    );
    p.arriscar.hidden = !jogando;
    let msg = "";
    let tom = "";
    if (v.fase === "ganhou") {
      msg = v.quemAcertou ? `${v.quemAcertou} acertou a palavra! O boneco está salvo.` : "Palavra completa! O boneco está salvo.";
      tom = "ok";
    } else if (v.fase === "perdeu") {
      msg = "Enforcado… a palavra está aí em cima.";
      tom = "erro";
    }
    faixa(p.status, `${msg}|${tom}`, msg ? [el("span", { text: msg })] : [], tom);
    if (v.fase === "ganhou" && this.#festejado !== v.dica + v.posicoes.map((x) => x.ch).join("")) {
      this.#festejado = v.dica + v.posicoes.map((x) => x.ch).join("");
      this.c.confete();
    }
  }

  #abertura() {
    const cats = [["todas", "Todas as categorias"], ...Object.keys(PALAVRAS).map((c) => [c, c])];
    const sel = seletor("Categoria", cats, this.cat, (v) => (this.cat = v));
    const propria = campo({ placeholder: "Ou escreva uma palavra para os outros adivinharem", max: 30, aoEnviar: (t) => this.#propor(t), limpar: false });
    return abertura({
      icone: "type",
      titulo: "Forca",
      regras: ["Todo mundo chuta letras para a mesma palavra.", "A cada erro, uma parte do boneco aparece. Seis erros e acabou.", "Quem souber pode arriscar a palavra inteira (errar conta um erro)."],
      ajustes: [ajuste("Categoria", sel)],
      acoes: [botao("Sortear palavra", { tipo: "primary", icone: "dices", onClick: () => this.l.nova(this.cat) })],
      rodape: el("div.jg-propria", {}, [propria, botao("Desafiar", { onClick: () => this.#propor(propria.value) })]),
    });
  }

  #propor(t) {
    if (!this.l.propor(t)) this.c.avisar("Use só letras (de 3 a 30), sem números.", "warn");
  }

  #montarJogo() {
    const boneco = svg("svg", { viewBox: "0 0 120 140", class: "forca__boneco", role: "img", "aria-label": "Boneco da forca" }, [
      svg("path", { d: "M10 132 H70 M30 132 V10 H82 V24", class: "forca__poste" }),
      svg("circle", { cx: 82, cy: 36, r: 12, "data-parte": 1, class: "forca__parte" }),
      svg("path", { d: "M82 48 V88", "data-parte": 2, class: "forca__parte" }),
      svg("path", { d: "M82 58 L66 74", "data-parte": 3, class: "forca__parte" }),
      svg("path", { d: "M82 58 L98 74", "data-parte": 4, class: "forca__parte" }),
      svg("path", { d: "M82 88 L68 112", "data-parte": 5, class: "forca__parte" }),
      svg("path", { d: "M82 88 L96 112", "data-parte": 6, class: "forca__parte" }),
    ]);
    const arriscar = campo({
      placeholder: "Arriscar a palavra inteira…",
      max: 30,
      aoEnviar: (t) => {
        const certo = this.l.arriscar(t);
        if (certo === false) this.c.avisar("Não é essa! Conta um erro.", "warn");
      },
    });
    const sel = seletor("Categoria", [["todas", "Todas"], ...Object.keys(PALAVRAS).map((c) => [c, c])], this.cat, (v) => (this.cat = v));
    this.partes = {
      dica: el("div"),
      boneco,
      erros: el("span.muted.forca__erros"),
      palavra: el("div.forca__palavra", { "aria-live": "polite" }),
      teclado: el("div.forca__teclado", { role: "group", "aria-label": "Letras" }),
      arriscar: el("div.forca__arriscar", {}, [arriscar]),
      status: el("div"),
    };
    const p = this.partes;
    p.no = el("div.forca__jogo", {}, [
      p.dica,
      el("div.forca__meio", {}, [el("div.forca__desenho", {}, [boneco, p.erros]), p.palavra]),
      p.status,
      p.teclado,
      p.arriscar,
      el("div.jg-rodape", {}, [sel, botao("Nova palavra", { icone: "refresh-cw", onClick: () => this.l.nova(this.cat) }), botao("Escolher uma palavra", { icone: "pencil", tipo: "ghost", onClick: () => this.l.estado.definir([["fc/j", null]]) })]),
    ]);
    this.raiz.append(p.no);
  }
}

/* ================================================================== *
 * Jogo da memória
 * ================================================================== */

export class VistaMemoria extends Vista {
  #tamanho = 20;
  #festejado = "";

  montar() {
    this.raiz = el("div.memoria-raiz");
    this.c.corpo.append(this.raiz);
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      trocar(this.raiz, "lobby", () =>
        abertura({
          icone: "brain",
          titulo: "Jogo da memória",
          regras: ["Cada um na sua vez vira duas cartas.", "Achou um par? Ponto, e joga de novo.", "Sozinho também vale: tente achar tudo com menos jogadas."],
          ajustes: [ajuste("Tamanho", seletor("Tamanho", Object.entries(TAMANHOS_MEMORIA), this.#tamanho, (x) => (this.#tamanho = Number(x))))],
          acoes: [botao("Embaralhar e começar", { tipo: "primary", icone: "brain", onClick: () => this.l.comecar(pessoas, this.#tamanho) })],
        }),
      );
      return;
    }
    if (!this.p || !this.p.no.isConnected) {
      this.raiz.replaceChildren();
      this.p = { grade: el("div.memoria__grade"), jogadores: el("ol.memoria__jogadores"), info: el("div.memoria__info"), status: el("div") };
      this.p.no = el("div.memoria", {}, [
        el("div.memoria__mesa", {}, [this.p.status, this.p.grade]),
        el("aside.memoria__lado", {}, [el("h3.jogos__titulo", { text: "Pares" }), this.p.jogadores, this.p.info]),
      ]);
      this.raiz.append(this.p.no);
    }
    const p = this.p;
    p.grade.style.setProperty("--cols", String(v.colunas));
    // As cartas nascem uma vez por jogo e só trocam de classe: assim a
    // virada anima (uma carta refeita já nasceria virada, sem o giro).
    if (p.grade.dataset.jogo !== v.id || p.grade.children.length !== v.cartas.length) {
      p.grade.dataset.jogo = v.id;
      p.grade.replaceChildren(
        ...v.cartas.map((c) => {
          const b = el("button.carta-mem", { type: "button" }, [el("span.carta-mem__dentro", {}, [el("span.carta-mem__verso", { "aria-hidden": "true" }), el("span.carta-mem__frente")])]);
          b.addEventListener("click", () => this.l.virar(c.i));
          return b;
        }),
      );
    }
    v.cartas.forEach((c, i) => {
      const b = p.grade.children[i];
      const virada = c.aberta || !!c.par;
      b.classList.toggle("is-virada", virada);
      b.classList.toggle("is-par", !!c.par);
      b.classList.toggle("is-errou", v.errou && c.aberta);
      b.disabled = !v.minhaVez || virada;
      b.setAttribute("aria-label", virada ? `Carta: ${c.nome}` : `Carta ${i + 1}, virada para baixo`);
      const frente = b.querySelector(".carta-mem__frente");
      if (c.nome && frente.dataset.nome !== c.nome) {
        frente.dataset.nome = c.nome;
        frente.replaceChildren(icon(c.nome));
        frente.style.setProperty("--cor", corDaCarta(c.nome));
      }
    });
    let msg;
    let tom = "";
    if (v.fase === "fim") {
      const nomes = v.vencedores.map((x) => (x.eu ? "você" : x.nome));
      msg = v.jogadores.length === 1 ? `Tudo achado em ${v.jogadas} jogadas!` : v.vencedores.length > 1 ? `Empate entre ${nomes.join(" e ")}!` : `${nomes[0] === "você" ? "Você venceu" : `${nomes[0]} venceu`}!`;
      tom = "ok";
    } else if (v.minhaVez) {
      msg = "Sua vez: vire duas cartas.";
      tom = "vez";
    } else msg = `Vez de ${v.daVez?.nome || "…"}`;
    faixa(p.status, `${msg}|${tom}`, [el("span", { text: msg })], tom);
    const fimId = v.fase === "fim" ? v.cartas.length + "|" + v.jogadas : "";
    if (fimId && this.#festejado !== fimId) {
      this.#festejado = fimId;
      if (v.vencedores.some((x) => x.eu)) this.c.confete();
    }
    sincronizar(
      p.jogadores,
      v.jogadores.map((j) => ({
        chave: j.id,
        sig: JSON.stringify([j.nome, j.pares, j.daVez, j.presente, j.eu]),
        criar: () =>
          el("li.memoria__jogador", { class: `${j.daVez ? "is-vez" : ""} ${j.presente ? "" : "is-saiu"}` }, [
            rosto(pessoas.find((x) => x.id === j.id) || j, 28),
            el("span.truncate", { text: j.eu ? `${j.nome} (você)` : j.nome }),
            el("b", { text: String(j.pares) }),
          ]),
      })),
    );
    trocar(p.info, JSON.stringify([v.jogadas, v.daVez?.presente, v.participo, v.fase]), () =>
      el("div.memoria__acoes", {}, [
        el("p.muted", { text: `${v.jogadas} jogadas` }),
        !v.participo && v.fase !== "fim" ? botao("Entrar no jogo", { tipo: "primary", onClick: () => this.l.entrar() }) : null,
        v.daVez && !v.daVez.presente && v.fase !== "fim" ? botao("Pular a vez (saiu)", { icone: "skip-forward", onClick: () => this.l.pularVez() }) : null,
        botao("Novo jogo", { icone: "shuffle", tipo: v.fase === "fim" ? "primary" : "ghost", onClick: () => this.l.estado.definir([["mem/j", null], ["mem/vez", null]]) }),
      ]),
    );
  }
}

/* ================================================================== *
 * Sorteios: roleta, dados e moeda
 * ================================================================== */

/** Cada figura da memória tem sempre a mesma cor (das cores da marca e vizinhas). */
const CORES_CARTA = ["#fd4d87", "#f7862f", "#7c5cff", "#16a34a", "#0ea5e9", "#e11d48", "#d97706", "#0d9488"];
function corDaCarta(nome) {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_CARTA[h % CORES_CARTA.length];
}

const CORES_ROLETA = ["#f06292", "#ffb74d", "#4db6ac", "#7986cb", "#ba68c8", "#4fc3f7", "#aed581", "#ff8a65", "#9575cd", "#4dd0e1", "#f48fb1", "#ffd54f"];
const PONTOS_DADO = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export class VistaSorteios extends Vista {
  #aba = "roleta";
  #giroVisto = "";
  #dadosVisto = "";
  #moedaVista = "";
  #angulo = 0;
  #qtdDados = 2;

  montar() {
    const abas = el("div.jogos__abas", { role: "tablist", "aria-label": "Sorteio" });
    this.botoesAba = {};
    for (const [id, nome, em] of [
      ["roleta", "Roleta", "ferris-wheel"],
      ["dados", "Dados", "dices"],
      ["moeda", "Cara ou coroa", "coins"],
    ]) {
      const b = el("button.jogos__aba", { type: "button", role: "tab", "aria-selected": String(id === this.#aba) }, [icon(em, { size: "sm" }), el("span", { text: nome })]);
      b.addEventListener("click", () => {
        this.#aba = id;
        for (const [k, x] of Object.entries(this.botoesAba)) x.setAttribute("aria-selected", String(k === id));
        for (const [k, x] of Object.entries(this.paineis)) x.hidden = k !== id;
        this.desenhar();
      });
      this.botoesAba[id] = b;
      abas.append(b);
    }
    this.c.extra.append(abas);

    // Roleta
    this.disco = el("div.roleta__disco");
    this.resultadoRoleta = el("div.roleta__resultado", { "aria-live": "polite" });
    this.opcoesTxt = el("textarea.input.roleta__opcoes", { rows: 6, "aria-label": "Opções da roleta, uma por linha", placeholder: "Uma opção por linha" });
    this.opcoesTxt.addEventListener("keydown", (e) => e.stopPropagation());
    this.opcoesTxt.addEventListener("change", () => this.l.definirOpcoes(this.opcoesTxt.value.split(/\r?\n/)));
    const roleta = el("div.sorteio.sorteio--roleta", {}, [
      el("div.roleta", {}, [el("div.roleta__ponteiro", { "aria-hidden": "true" }), this.disco, el("div.roleta__miolo", { "aria-hidden": "true" }, [icon("sparkles")])]),
      el("div.roleta__lado", {}, [
        this.resultadoRoleta,
        botao("Girar", { tipo: "primary", icone: "ferris-wheel", classe: "btn--lg", onClick: () => this.l.girar(this.pessoas()) || this.c.avisar("Ponha pelo menos duas opções.", "warn") }),
        el("label.jg-ajuste", {}, [el("span.jogos__rotulo", { text: "Opções" }), this.opcoesTxt]),
        el("div.jg-rodape", {}, [
          botao("Nomes da chamada", { icone: "users", tipo: "ghost", onClick: () => this.l.definirOpcoes([]) }),
          botao("Tirar o sorteado", { icone: "minus", tipo: "ghost", onClick: () => this.l.tirarSorteado(this.pessoas()) }),
        ]),
      ]),
    ]);
    // Dados
    this.dados = el("div.dados", { "aria-live": "polite" });
    const dados = el("div.sorteio.sorteio--dados", { hidden: true }, [
      this.dados,
      el("div.jg-rodape", {}, [
        seletor("Quantos dados", [1, 2, 3, 4, 5, 6].map((n) => [n, `${n} dado${n > 1 ? "s" : ""}`]), this.#qtdDados, (x) => (this.#qtdDados = Number(x))),
        botao("Rolar", { tipo: "primary", icone: "dices", classe: "btn--lg", onClick: () => this.l.rolar(this.#qtdDados) }),
      ]),
      (this.somaDados = el("p.dados__soma")),
    ]);
    // Moeda
    this.moeda = el("div.moeda", {}, [el("div.moeda__face.moeda__face--cara", { text: "CARA" }), el("div.moeda__face.moeda__face--coroa", { text: "COROA" })]);
    this.resultadoMoeda = el("p.moeda__resultado", { "aria-live": "polite" });
    const moeda = el("div.sorteio.sorteio--moeda", { hidden: true }, [el("div.moeda__palco", {}, [this.moeda]), this.resultadoMoeda, botao("Jogar a moeda", { tipo: "primary", icone: "coins", classe: "btn--lg", onClick: () => this.l.moeda() })]);
    this.paineis = { roleta, dados, moeda };
    this.historico = el("ol.sorteio__historico");
    this.c.corpo.append(el("div.sorteios", {}, [roleta, dados, moeda, el("aside.sorteio__lado", {}, [el("h3.jogos__titulo", { text: "Últimos resultados" }), this.historico])]));
  }

  relogio() {
    const v = this.v;
    const agora = Date.now();
    return !!v && ((v.giro && !v.giro.parado) || (v.dados && agora - v.dados.inicio < 1400) || (v.moeda && agora - v.moeda.inicio < 1800));
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    this.v = v;
    this.#desenharRoleta(v);
    this.#desenharDados(v);
    this.#desenharMoeda(v);
    if (document.activeElement !== this.opcoesTxt) {
      const texto = v.usandoNomes ? "" : v.opcoes.join("\n");
      if (this.opcoesTxt.value !== texto) this.opcoesTxt.value = texto;
      this.opcoesTxt.placeholder = v.usandoNomes ? `Usando os nomes da chamada:\n${v.opcoes.join("\n")}` : "Uma opção por linha";
    }
    sincronizar(
      this.historico,
      v.historico.length
        ? v.historico.map((h, i) => ({
            chave: `${i}|${h.t}|${h.r}|${h.por}`,
            sig: "",
            criar: () => el("li", {}, [icon(h.t === "roleta" ? "ferris-wheel" : h.t === "dados" ? "dices" : "coins", { size: "sm" }), el("strong.truncate", { text: h.r }), el("span.muted.truncate", { text: h.por })]),
          }))
        : [{ chave: "vazio", sig: "", criar: () => el("li.muted", { text: "Nada sorteado ainda." }) }],
    );
  }

  /** O disco: uma fatia por opção (conic-gradient) e os nomes na direção do raio. */
  #disco(opcoes) {
    const fatia = 360 / opcoes.length;
    const cores = opcoes.map((_, i) => CORES_ROLETA[i % CORES_ROLETA.length]);
    // Com número ímpar de fatias, a última não repete a cor da primeira.
    if (opcoes.length > 1 && opcoes.length % CORES_ROLETA.length === 1) cores[cores.length - 1] = CORES_ROLETA[5];
    this.disco.style.background = `conic-gradient(${cores.map((c, i) => `${c} ${i * fatia}deg ${(i + 1) * fatia}deg`).join(", ")})`;
    this.disco.replaceChildren(
      ...opcoes.map((o, i) => {
        const meio = (i + 0.5) * fatia;
        // Na metade esquerda o nome ficaria de cabeça para baixo: vira o texto.
        const s = el("span.roleta__nome", { class: meio > 180 ? "is-esquerda" : "" }, [el("span", { text: o.length > 16 ? `${o.slice(0, 15)}…` : o })]);
        s.style.setProperty("--ang", `${meio - 90}deg`);
        return s;
      }),
    );
  }

  #desenharRoleta(v) {
    const g = v.giro;
    const opcoes = g && !g.parado ? g.opcoes : g && g.opcoes.join("|") === v.opcoes.join("|") ? g.opcoes : v.opcoes;
    const chave = opcoes.join("|");
    if (this.disco.dataset.opcoes !== chave) {
      this.disco.dataset.opcoes = chave;
      this.#disco(opcoes);
    }
    if (!g) {
      trocar(this.resultadoRoleta, "nada", () => el("p.muted", { text: "Gire para sortear entre as opções." }));
      return;
    }
    if (this.#giroVisto !== g.id) {
      this.#giroVisto = g.id;
      const fatia = 360 / g.opcoes.length;
      const alvo = (g.alvo + 0.15 + 0.7 * g.desvio) * fatia;
      const inicio = this.#angulo % 360;
      const fim = inicio + g.voltas * 360 + ((((360 - alvo - inicio) % 360) + 360) % 360);
      this.#angulo = fim;
      const passou = Date.now() - g.inicio;
      this.disco.getAnimations().forEach((a) => a.cancel());
      if (passou >= GIRO_MS || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.disco.style.transform = `rotate(${fim}deg)`;
      } else {
        this.disco.style.transform = `rotate(${fim}deg)`;
        this.disco.animate([{ transform: `rotate(${inicio}deg)` }, { transform: `rotate(${fim}deg)` }], { duration: GIRO_MS, easing: "cubic-bezier(0.12, 0.75, 0.12, 1)", delay: -Math.max(0, passou) });
      }
      this.#anunciado = false;
    }
    if (!g.parado) {
      trocar(this.resultadoRoleta, `girando|${g.id}`, () => el("p.roleta__girando", { text: `${g.por || "Alguém"} girou…` }));
      return;
    }
    trocar(this.resultadoRoleta, `fim|${g.id}`, () => el("div.roleta__vencedor", {}, [el("span.jogos__rotulo", { text: "Sorteado" }), el("strong", { text: g.opcoes[g.alvo] })]));
    if (!this.#anunciado) {
      this.#anunciado = true;
      if (Date.now() - g.inicio < GIRO_MS + 1500) this.c.confete();
    }
  }
  #anunciado = true;

  #desenharDados(v) {
    const d = v.dados;
    if (!d) {
      trocar(this.dados, "nada", () => el("p.muted", { text: "Escolha quantos dados e role." }));
      this.somaDados.textContent = "";
      return;
    }
    const rolando = Date.now() - d.inicio < 1200;
    trocar(this.dados, `${d.id}|${rolando}`, () =>
      el(
        "div.dados__mesa",
        {},
        d.valores.map((n, i) => {
          const face = el("div.dado", { class: rolando ? "is-rolando" : "", "aria-label": `Dado ${i + 1}: ${n}`, role: "img", style: { "--i": i } });
          const pontos = rolando ? PONTOS_DADO[1 + ((n + i) % 6)] : PONTOS_DADO[n];
          for (let k = 0; k < 9; k += 1) face.append(el("i", { class: pontos.includes(k) ? "is-on" : "" }));
          return face;
        }),
      ),
    );
    this.somaDados.textContent = rolando ? "" : d.valores.length > 1 ? `Soma: ${d.valores.reduce((a, b) => a + b, 0)} · ${d.por}` : d.por;
    if (this.#dadosVisto !== d.id) this.#dadosVisto = d.id;
  }

  #desenharMoeda(v) {
    const m = v.moeda;
    if (!m) {
      this.resultadoMoeda.textContent = "";
      return;
    }
    if (this.#moedaVista !== m.id) {
      this.#moedaVista = m.id;
      const fim = m.giros * 360 + (m.lado === "coroa" ? 180 : 0);
      const passou = Date.now() - m.inicio;
      this.moeda.getAnimations().forEach((a) => a.cancel());
      this.moeda.style.transform = `rotateY(${fim}deg)`;
      if (passou < 1600 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.moeda.animate(
          [
            { transform: "translateY(0) rotateY(0deg)" },
            { transform: `translateY(-70px) rotateY(${fim / 2}deg)`, offset: 0.5 },
            { transform: `translateY(0) rotateY(${fim}deg)` },
          ],
          { duration: 1600, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", delay: -Math.max(0, passou) },
        );
      }
    }
    const caiu = Date.now() - m.inicio >= 1600;
    this.resultadoMoeda.textContent = caiu ? `${m.lado === "cara" ? "Cara" : "Coroa"}! · ${m.por}` : "…";
  }
}

export const VISTAS_TABULEIRO = { velha: VistaVelha, lig4: VistaLig4, forca: VistaForca, memoria: VistaMemoria, sorteios: VistaSorteios };
