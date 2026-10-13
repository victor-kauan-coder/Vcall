/**
 * ui/jogos.js — a mesa de jogos: Planning Poker, Retrospectiva e Daily.
 *
 * Ocupa o lugar do destaque (como o quadro branco): os vídeos continuam na
 * faixa ao lado. A lógica e o estado compartilhado ficam em
 * features/jogos.js; aqui é só desenho.
 *
 * Leve de propósito:
 *   - redesenha no máximo uma vez por quadro de animação, e só o que mudou:
 *     cada assento, nota, história e ação tem uma assinatura, e um nó só é
 *     refeito quando a dele muda (`sincronizar`). Assim a carta não vira de
 *     novo, a nota não "entra" de novo e o foco do teclado não se perde
 *     quando outra pessoa vota;
 *   - os campos de texto são criados uma vez e nunca perdem o foco nem o
 *     que a pessoa está digitando;
 *   - um único relógio de 250 ms, ligado só enquanto há contagem, cronômetro
 *     ou Daily em andamento;
 *   - nada de canvas nem biblioteca: elementos simples, animações em CSS.
 */
import { el, icon } from "../lib/dom.js";
import { avatarEl } from "./avatars.js";
import {
  BARALHOS,
  FASES_RETRO,
  JOGOS,
  MODELOS_RETRO,
  daily,
  historiaAtual,
  historias,
  mesaPoker,
  retro,
} from "../features/jogos.js";

const EMOJIS = ["👏", "🎉", "😂", "🤔", "☕", "🔥"];
const FASE_NOME = { escrever: "Escrever", votar: "Votar", discutir: "Discutir" };

/** Os nós com `data-chave` de um ou mais contêineres, por chave. */
function porChave(...pais) {
  const m = new Map();
  for (const pai of pais) for (const n of pai.children) if (n.dataset.chave) m.set(n.dataset.chave, n);
  return m;
}

/**
 * Põe em `pai` os itens na ordem dada, reaproveitando todo nó cuja chave e
 * assinatura não mudaram. `criar()` só roda para o que é novo ou mudou; o
 * que é novo de verdade (chave que não existia) ganha `is-nova`, que é
 * quem anima a entrada.
 */
function sincronizar(pai, itens, antigos = porChave(pai)) {
  const nos = itens.map(({ chave, sig, criar }) => {
    const velho = antigos.get(chave);
    if (velho && velho.dataset.sig === sig) return velho;
    const novo = criar();
    novo.dataset.chave = chave;
    novo.dataset.sig = sig;
    if (!velho) novo.classList.add("is-nova");
    return novo;
  });
  nos.forEach((n, i) => {
    if (pai.children[i] !== n) pai.insertBefore(n, pai.children[i] || null);
  });
  while (pai.children.length > nos.length) pai.lastElementChild.remove();
}

const mmss = (s) => {
  const neg = s < 0;
  const t = Math.abs(Math.round(s));
  return `${neg ? "+" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export class PainelJogos {
  aberto = false;
  jogo = "poker";
  #raiz = null;
  #corpo = null;
  #partes = {};
  #pedido = 0;
  #relogio = 0;
  #festejado = "";
  #avisadoTimer = 0;

  /**
   * @param {object} o
   * @param {import("../features/jogos.js").EstadoJogos} o.estado
   * @param {import("../features/jogos.js").Poker} o.poker
   * @param {import("../features/jogos.js").Retro} o.retro
   * @param {import("../features/jogos.js").Daily} o.daily
   * @param {() => {id:string, nome:string, avatar:any, eu:boolean}[]} o.pessoas
   * @param {(para:string, emoji:string) => void} o.aoEmoji
   * @param {() => void} o.aoFechar
   * @param {(texto:string, nome:string, tipo:string) => void} o.baixar
   * @param {(texto:string, aviso:string) => void} o.copiar
   * @param {(texto:string, tom?:string) => void} o.avisar
   */
  constructor(o) {
    this.o = o;
    o.estado.on("mudou", () => this.atualizar());
  }

  /* ---------------------------------------------------------------- */

  montar(container, jogo = this.jogo) {
    if (!this.#raiz) this.#raiz = this.#esqueleto();
    container.append(this.#raiz);
    this.aberto = true;
    this.mostrar(jogo);
  }

  desmontar() {
    this.aberto = false;
    this.#raiz?.remove();
    clearInterval(this.#relogio);
    this.#relogio = 0;
  }

  mostrar(jogo) {
    this.jogo = JOGOS[jogo] ? jogo : "poker";
    for (const [id, b] of Object.entries(this.#partes.abas)) b.setAttribute("aria-selected", String(id === this.jogo));
    this.#corpo.replaceChildren();
    this.#partes.extra.replaceChildren();
    if (this.jogo === "poker") this.#montarPoker();
    else if (this.jogo === "retro") this.#montarRetro();
    else this.#montarDaily();
    this.atualizar();
  }

  atualizar() {
    if (!this.aberto || this.#pedido) return;
    this.#pedido = requestAnimationFrame(() => {
      this.#pedido = 0;
      if (!this.aberto) return;
      if (this.jogo === "poker") this.#desenharPoker();
      else if (this.jogo === "retro") this.#desenharRetro();
      else this.#desenharDaily();
      this.#ajustarRelogio();
    });
  }

  /** Relógio só quando há o que contar: contagem, cronômetro ou Daily. */
  #ajustarRelogio() {
    const e = this.o.estado;
    const timer = e.ler("p/timer");
    const precisa =
      (this.jogo === "poker" && (this.#partes.contando || (timer && timer.fim > Date.now() - 2000))) ||
      (this.jogo === "daily" && daily(e).atual);
    if (precisa && !this.#relogio) this.#relogio = setInterval(() => this.#tique(), 250);
    else if (!precisa && this.#relogio) {
      clearInterval(this.#relogio);
      this.#relogio = 0;
    }
  }

  #tique() {
    if (this.jogo === "daily") this.#desenharDaily();
    else this.#desenharPoker({ soTempo: true });
  }

  /* ---------------------------------------------------------------- *
   * Moldura comum
   * ---------------------------------------------------------------- */

  #esqueleto() {
    const abas = {};
    const lista = el("div.jogos__abas", { role: "tablist", "aria-label": "Jogos" });
    for (const [id, j] of Object.entries(JOGOS)) {
      abas[id] = el("button.jogos__aba", { type: "button", role: "tab", "aria-label": j.nome, dataset: { tip: j.desc, "tip-placement": "bottom" }, onClick: () => this.mostrar(id) }, [
        icon(j.icone, { size: "sm" }),
        el("span", { text: j.nome }),
      ]);
      lista.append(abas[id]);
    }
    const extra = el("div.jogos__extra");
    const fechar = el("button.btn.btn--icon.btn--ghost", { type: "button", "aria-label": "Fechar os jogos", dataset: { tip: "Fechar (os outros continuam)", "tip-placement": "bottom", "tip-align": "end" }, onClick: () => this.o.aoFechar() }, [icon("x", { size: "sm" })]);
    this.#corpo = el("div.jogos__corpo");
    this.#partes = { abas, extra };
    return el("section.jogos", { "aria-label": "Jogos de equipe" }, [el("header.jogos__topo", {}, [lista, extra, fechar]), this.#corpo]);
  }

  #pessoas() {
    return this.o.pessoas();
  }

  /* ---------------------------------------------------------------- *
   * Planning Poker
   * ---------------------------------------------------------------- */

  #montarPoker() {
    const { poker, estado } = this.o;
    const p = this.#partes;

    // Controles do topo
    const baralho = el("select.input.jogos__select", { "aria-label": "Baralho" });
    for (const [id, b] of Object.entries(BARALHOS)) baralho.append(el("option", { value: id, text: b.nome }));
    baralho.addEventListener("change", () => poker.definirBaralho(baralho.value));
    const auto = el("button.btn.btn--ghost.jogos__chip", { type: "button", "aria-pressed": "false", dataset: { tip: "Revela sozinho quando todo mundo votar", "tip-placement": "bottom" }, onClick: () => estado.definir([["p/auto", !estado.ler("p/auto", false)]]) }, [icon("zap", { size: "sm" }), el("span", { text: "Auto" })]);
    const assistir = el("button.btn.btn--ghost.jogos__chip", { type: "button", "aria-pressed": "false", dataset: { tip: "Só assistir: você não conta na votação", "tip-placement": "bottom" }, onClick: () => poker.espectador(!estado.ler(`p/esp/${estado.eu}`, false)) }, [icon("eye", { size: "sm" }), el("span", { text: "Assistir" })]);
    const timerTxt = el("span", { text: "Cronômetro" });
    const timer = el("button.btn.btn--ghost.jogos__chip", { type: "button", dataset: { tip: "Tempo de discussão para todos", "tip-placement": "bottom" }, onClick: () => this.#menuTimer(timer) }, [icon("timer", { size: "sm" }), timerTxt]);
    p.extra.append(baralho, auto, assistir, timer);

    // Mesa
    const topo = el("div.poker__fila");
    const base = el("div.poker__fila");
    const centro = el("div.poker__centro");
    const mesa = el("div.poker__mesa", {}, [centro]);
    const mao = el("div.poker__mao", { role: "radiogroup", "aria-label": "Suas cartas" });
    const historia = el("div.poker__historia");

    // Histórias
    const listaH = el("ol.poker__historias");
    const novas = el("textarea.input.poker__nova", { rows: 2, placeholder: "Nova história (uma por linha)", "aria-label": "Novas histórias", maxLength: 4000 });
    const adicionar = () => {
      const linhas = novas.value.split(/\r?\n/);
      if (!linhas.some((l) => l.trim())) return;
      poker.adicionarHistorias(linhas);
      novas.value = "";
    };
    novas.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        adicionar();
      }
      e.stopPropagation(); // atalhos da chamada não valem aqui
    });
    const lado = el("aside.poker__lado", { "aria-label": "Histórias" }, [
      el("h3.jogos__titulo", { text: "Histórias" }),
      listaH,
      el("div.poker__add.poker__add--pilha", {}, [novas, el("button.btn.btn--primary", { type: "button", onClick: adicionar }, [icon("plus", { size: "sm" }), el("span", { text: "Adicionar" })])]),
      el("div.jogos__rodape", {}, [
        el("button.btn.btn--ghost", { type: "button", onClick: () => this.o.baixar(this.#csv(), "estimativas.csv", "text/csv") }, [icon("download", { size: "sm" }), el("span", { text: "CSV" })]),
        el("button.btn.btn--ghost", { type: "button", onClick: () => this.o.copiar(this.#textoHistorias(), "Estimativas copiadas") }, [icon("copy", { size: "sm" }), el("span", { text: "Copiar" })]),
      ]),
    ]);

    this.#corpo.append(el("div.poker", {}, [el("div.poker__palco", {}, [historia, topo, mesa, base, mao]), lado]));
    Object.assign(p, { baralho, auto, assistir, timer, timerTxt, topo, base, centro, mao, historia, listaH, maoChave: "" });
  }

  #csv() {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    return ["Historia;Estimativa", ...historias(this.o.estado).map((h) => `${esc(h.titulo)};${esc(h.estimativa ?? "")}`)].join("\r\n");
  }

  #textoHistorias() {
    return historias(this.o.estado)
      .map((h) => `${h.titulo}: ${h.estimativa ?? "—"}`)
      .join("\n");
  }

  #menuTimer(ancora) {
    const { estado } = this.o;
    const ativo = estado.ler("p/timer");
    const menu = el("div.jogos__menu", { role: "menu" });
    const fechar = () => menu.remove();
    for (const min of [1, 2, 3, 5]) {
      menu.append(el("button", { type: "button", role: "menuitem", text: `${min} min`, onClick: () => (estado.definir([["p/timer", { fim: Date.now() + min * 60_000, min }]]), fechar()) }));
    }
    if (ativo && ativo.fim > Date.now()) menu.append(el("button", { type: "button", role: "menuitem", text: "Parar", onClick: () => (estado.definir([["p/timer", null]]), fechar()) }));
    ancora.after(menu);
    setTimeout(() => document.addEventListener("pointerdown", (e) => !menu.contains(e.target) && fechar(), { once: true }), 0);
  }

  #desenharPoker({ soTempo = false } = {}) {
    const { estado, poker } = this.o;
    const p = this.#partes;
    if (!p.centro) return;
    const v = mesaPoker(estado, { pessoas: this.#pessoas(), meuVoto: poker.meuVoto() });

    // Cronômetro de discussão
    const t = estado.ler("p/timer");
    if (t && t.fim) {
      const resta = (t.fim - Date.now()) / 1000;
      p.timerTxt.textContent = resta > 0 ? mmss(resta) : "Tempo!";
      p.timer.classList.toggle("is-acabou", resta <= 0);
      if (resta <= 0 && this.#avisadoTimer !== t.fim) {
        this.#avisadoTimer = t.fim;
        this.o.avisar("Acabou o tempo de discussão", "warn");
      }
    } else {
      p.timerTxt.textContent = "Cronômetro";
      p.timer.classList.remove("is-acabou");
    }
    p.contando = v.contagem != null;
    if (soTempo && !p.contando && !p.esperandoRevelar) return;
    p.esperandoRevelar = p.contando;

    p.baralho.value = v.baralhoId;
    p.auto.setAttribute("aria-pressed", String(!!estado.ler("p/auto", false)));
    const souEspectador = !!estado.ler(`p/esp/${estado.eu}`, false);
    p.assistir.setAttribute("aria-pressed", String(souEspectador));

    // História em votação
    const lista = historias(estado);
    const atual = lista.find((h) => h.id === v.historia);
    sincronizar(p.historia, [
      {
        chave: "h",
        sig: atual ? `v|${atual.titulo}` : "livre",
        criar: () =>
          atual
            ? el("div.poker__historiaTxt", {}, [el("span.jogos__rotulo", { text: "Votando" }), el("strong", { text: atual.titulo })])
            : el("div.poker__historiaTxt", {}, [el("span.jogos__rotulo", { text: "Votação livre" }), el("span.muted", { text: "Adicione histórias ao lado para estimar uma de cada vez." })]),
      },
    ]);

    // Assentos: metade em cima, metade embaixo da mesa. Um assento só é
    // refeito quando muda o que ele mostra.
    const pessoas = this.#pessoas();
    const assentos = v.jogadores.map((j) => this.#assento(j, v, pessoas));
    const antigos = porChave(p.topo, p.base);
    sincronizar(p.topo, assentos.filter((_, i) => i % 2 === 0), antigos);
    sincronizar(p.base, assentos.filter((_, i) => i % 2 === 1), antigos);

    // Centro da mesa (refeito só quando muda: o botão não perde o foco)
    const votos = v.jogadores.filter((j) => j.votou).length;
    const chaveCentro = JSON.stringify([v.contagem, v.revelado && v.resultado, votos, v.faltam, souEspectador]);
    if (chaveCentro !== p.centroChave) {
      p.centroChave = chaveCentro;
      p.centro.replaceChildren(...this.#centro(v, votos, souEspectador));
    }
    if (v.revelado && v.resultado?.consenso && this.#festejado !== `${v.historia}/${v.rodada}`) {
      this.#festejado = `${v.historia}/${v.rodada}`;
      this.#confete();
    }
    // Revelação automática: quem tem o menor id faz (os outros só veem).
    if (!v.revelado && v.contagem == null && v.todosVotaram && estado.ler("p/auto", false)) {
      const lider = v.jogadores.filter((j) => j.presente && !j.espectador).map((j) => j.id).sort()[0];
      if (lider === estado.eu) poker.revelar();
    }

    // A mão (ou, revelado, o gráfico e a estimativa a salvar)
    const meu = poker.meuVoto();
    const chaveMao = `${v.revelado}|${v.baralhoId}|${meu}|${souEspectador}|${v.historia}|${v.rodada}|${JSON.stringify(v.resultado?.distribuicao || [])}`;
    if (chaveMao !== p.maoChave) {
      p.maoChave = chaveMao;
      if (v.revelado) p.mao.replaceChildren(this.#grafico(v, atual));
      else if (souEspectador) p.mao.replaceChildren(el("p.poker__aviso", { text: "Você está só assistindo. Clique em “Assistir” para votar." }));
      else
        p.mao.replaceChildren(
          ...v.baralho.cartas.map((c) =>
            el(
              "button.carta.carta--mao",
              {
                type: "button",
                role: "radio",
                "aria-checked": String(meu === c),
                "aria-label": `Carta ${c}`,
                onClick: () => poker.votar(c),
              },
              [el("span", { text: c })],
            ),
          ),
        );
    }

    // Lista de histórias
    sincronizar(
      p.listaH,
      lista.length
        ? lista.map((h) => ({
            chave: h.id,
            sig: JSON.stringify([h.titulo, h.estimativa, h.id === v.historia]),
            criar: () =>
              el("li.poker__item", { class: h.id === v.historia ? "is-atual" : "" }, [
                el("button.poker__itemBtn", { type: "button", "aria-label": `Votar: ${h.titulo}`, onClick: () => poker.escolherHistoria(h.id) }, [
                  el("span.truncate", { text: h.titulo }),
                  h.estimativa != null ? el("span.poker__estimativa", { text: h.estimativa }) : h.id === v.historia ? el("span.jogos__rotulo", { text: "votando" }) : null,
                ].filter(Boolean)),
                el("button.btn.btn--icon.btn--ghost", { type: "button", "aria-label": `Apagar: ${h.titulo}`, onClick: () => poker.apagarHistoria(h.id) }, [icon("trash-2", { size: "sm" })]),
              ]),
          }))
        : [{ chave: "vazio", sig: "", criar: () => el("li.poker__vazio", { text: "Nenhuma história ainda." }) }],
    );
  }

  #centro(v, votos, souEspectador) {
    const { poker } = this.o;
    if (v.contagem != null) return [el("div.poker__contagem", { text: String(v.contagem), "aria-live": "assertive" })];
    if (v.revelado) {
      const r = v.resultado;
      return [
        el("div.poker__resumo", {}, [
          r.media != null ? el("div", {}, [el("span.jogos__rotulo", { text: "Média" }), el("strong", { text: String(r.media).replace(".", ",") })]) : null,
          r.mediana != null ? el("div", {}, [el("span.jogos__rotulo", { text: "Mediana" }), el("strong", { text: String(r.mediana).replace(".", ",") })]) : null,
          el("div", {}, [el("span.jogos__rotulo", { text: "Concordância" }), el("strong", { text: `${r.concordancia}%` })]),
        ].filter(Boolean)),
        el("button.btn.btn--primary", { type: "button", onClick: () => poker.novaRodada() }, [icon("rotate-ccw", { size: "sm" }), el("span", { text: "Nova votação" })]),
      ];
    }
    if (!votos) return [el("p.poker__aviso", { text: souEspectador ? "Assistindo. Esperando os votos…" : "Escolham suas cartas 👇" })];
    return [
      el("button.btn.btn--primary.btn--lg.poker__revelar", { type: "button", onClick: () => poker.revelar() }, [el("span", { text: "Revelar cartas" })]),
      el("p.poker__aviso", { text: v.faltam ? `${votos} votaram · faltam ${v.faltam}` : "Todo mundo votou" }),
    ];
  }

  /** Um assento da mesa, como item de `sincronizar`. */
  #assento(j, v, pessoas) {
    const pessoa = pessoas.find((x) => x.id === j.id);
    const estadoCarta = v.revelado && j.valor != null ? "revelada" : j.votou ? "virada" : "vazia";
    let extremo = false;
    if (v.revelado && v.resultado && j.valor != null) {
      const n = j.valor === "½" ? 0.5 : Number(j.valor);
      extremo = v.resultado.menor !== v.resultado.maior && (n === v.resultado.menor || n === v.resultado.maior);
    }
    return {
      chave: j.id,
      sig: JSON.stringify([estadoCarta, estadoCarta === "revelada" ? j.valor : "", extremo, j.nome, j.eu, j.presente, j.espectador, pessoa?.avatar || null]),
      criar: () => this.#criarAssento(j, pessoa, estadoCarta, extremo, v),
    };
  }

  #criarAssento(j, pessoa, estadoCarta, extremo, v) {
    const carta = el(`div.carta.carta--${estadoCarta}`, { "aria-hidden": "true" }, [el("span", { text: estadoCarta === "revelada" ? j.valor : "" })]);
    if (extremo) carta.classList.add("is-extremo");
    const filhos = [
      carta,
      el("div.assento__quem", {}, [
        pessoa?.avatar ? avatarEl(pessoa.avatar, { title: j.nome }) : null,
        el("span.truncate", { text: j.nome }),
        j.espectador ? icon("eye", { size: "sm", label: "Assistindo" }) : null,
      ].filter(Boolean)),
    ];
    if (j.eu) filhos.push(el("span.assento__voce", { text: "você" }));
    if (!j.eu && j.presente) {
      filhos.push(
        el("button.assento__emoji", { type: "button", "aria-label": `Jogar um emoji em ${j.nome}`, dataset: { tip: "Jogar emoji" }, onClick: (e) => this.#menuEmoji(e.currentTarget, j.id) }, [el("span", { text: "😄" })]),
      );
    }
    const label = j.espectador ? `${j.nome}: assistindo` : v.revelado ? `${j.nome}: ${j.valor ?? "sem voto"}` : `${j.nome}: ${j.votou ? "votou" : "ainda não votou"}`;
    return el("div.assento", { dataset: { id: j.id }, class: `${j.presente ? "" : "is-saiu"} ${j.espectador ? "is-espectador" : ""} ${j.eu ? "is-eu" : ""}`, role: "group", "aria-label": label }, filhos);
  }

  #menuEmoji(ancora, para) {
    const menu = el("div.jogos__menu.jogos__menu--emoji", { role: "menu" });
    for (const e of EMOJIS) menu.append(el("button", { type: "button", role: "menuitem", text: e, "aria-label": e, onClick: () => (this.o.aoEmoji(para, e), menu.remove()) }));
    ancora.after(menu);
    setTimeout(() => document.addEventListener("pointerdown", (ev) => !menu.contains(ev.target) && menu.remove(), { once: true }), 0);
  }

  /** Um emoji atravessa a mesa de quem jogou até o alvo. */
  voarEmoji(de, para, emoji) {
    if (!this.aberto || this.jogo !== "poker" || !EMOJIS.includes(emoji)) return;
    const alvo = this.#raiz.querySelector(`.assento[data-id="${CSS.escape(para)}"] .carta`);
    if (!alvo) return;
    const origem = this.#raiz.querySelector(`.assento[data-id="${CSS.escape(de)}"] .carta`) || this.#partes.centro;
    const a = origem.getBoundingClientRect();
    const b = alvo.getBoundingClientRect();
    const voo = el("span.emoji-voo", { text: emoji, "aria-hidden": "true" });
    voo.style.left = `${a.left + a.width / 2}px`;
    voo.style.top = `${a.top + a.height / 2}px`;
    voo.style.setProperty("--dx", `${b.left - a.left + (b.width - a.width) / 2}px`);
    voo.style.setProperty("--dy", `${b.top - a.top + (b.height - a.height) / 2}px`);
    document.body.append(voo);
    voo.addEventListener("animationend", () => voo.remove(), { once: true });
    setTimeout(() => voo.remove(), 1500);
    alvo.classList.remove("is-atingida");
    void alvo.offsetWidth;
    alvo.classList.add("is-atingida");
  }

  #grafico(v, atual) {
    const r = v.resultado;
    const maximo = Math.max(1, ...r.distribuicao.map((d) => d.n));
    const barras = el(
      "div.poker__barras",
      { role: "img", "aria-label": r.distribuicao.map((d) => `${d.carta}: ${d.n}`).join(", ") },
      r.distribuicao.map((d) =>
        el("div.poker__barra", { class: d.carta === r.maioria ? "is-maioria" : "" }, [
          el("span.poker__barraN", { text: `${d.n} ${d.n === 1 ? "voto" : "votos"}` }),
          el("div.poker__barraCol", { style: { "--h": `${Math.round((d.n / maximo) * 100)}%` } }),
          el("div.carta.carta--mini", {}, [el("span", { text: d.carta })]),
        ]),
      ),
    );
    if (!r.total) return el("p.poker__aviso", { text: "Ninguém votou nesta rodada." });
    const filhos = [barras];
    if (atual) {
      const chips = el("div.poker__salvar", {}, [el("span.jogos__rotulo", { text: "Estimativa de" }), el("strong.truncate", { text: atual.titulo })]);
      const opcoes = [...new Set([r.sugestao, r.maioria, ...r.distribuicao.map((d) => d.carta)].filter((c) => c && c !== "?" && c !== "☕"))];
      for (const c of opcoes) {
        chips.append(
          el("button.btn.jogos__chip", { type: "button", class: c === r.sugestao ? "is-sugestao" : "", "aria-label": `Salvar ${c} como estimativa`, dataset: { tip: c === r.sugestao ? "Sugestão: a carta mais perto da média" : "" }, onClick: () => this.o.poker.salvarEstimativa(atual.id, c) }, [el("span", { text: c })]),
        );
      }
      filhos.push(chips);
    }
    return el("div.poker__resultado", {}, filhos);
  }

  /** Comemoração do consenso: algumas dezenas de pedacinhos em CSS, e somem. */
  #confete() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const camada = el("div.confete", { "aria-hidden": "true" });
    const cores = ["var(--brand-pink)", "var(--brand-orange)", "var(--ok)", "var(--accent-2)"];
    for (let i = 0; i < 36; i += 1) {
      camada.append(
        el("i", {
          style: {
            left: `${Math.random() * 100}%`,
            background: cores[i % cores.length],
            "--atraso": `${Math.random() * 300}ms`,
            "--giro": `${Math.random() * 720 - 360}deg`,
            "--x": `${Math.random() * 80 - 40}px`,
          },
        }),
      );
    }
    this.#raiz.append(camada);
    setTimeout(() => camada.remove(), 2200);
    this.o.avisar("Consenso! 🎉", "ok");
  }

  /* ---------------------------------------------------------------- *
   * Retrospectiva
   * ---------------------------------------------------------------- */

  #montarRetro() {
    const { estado, retro: rt } = this.o;
    const p = this.#partes;
    const modelo = el("select.input.jogos__select", { "aria-label": "Modelo" });
    for (const [id, m] of Object.entries(MODELOS_RETRO)) modelo.append(el("option", { value: id, text: m.nome }));
    modelo.addEventListener("change", () => rt.modelo(modelo.value));
    const fases = el("div.retro__fases", { role: "tablist", "aria-label": "Fase" });
    const botoesFase = {};
    FASES_RETRO.forEach((f, i) => {
      botoesFase[f] = el("button.retro__fase", { type: "button", role: "tab", onClick: () => rt.fase(f) }, [el("b", { text: String(i + 1) }), el("span", { text: FASE_NOME[f] })]);
      fases.append(botoesFase[f]);
    });
    const pontos = el("span.retro__pontos", { "aria-live": "polite" });
    const exportar = el("button.btn.btn--ghost.jogos__chip", { type: "button", onClick: () => this.o.copiar(this.#retroMd(), "Retrospectiva copiada (Markdown)") }, [icon("copy", { size: "sm" }), el("span", { text: "Copiar" })]);
    const baixar = el("button.btn.btn--ghost.jogos__chip", { type: "button", onClick: () => this.o.baixar(this.#retroMd(), "retrospectiva.md", "text/markdown") }, [icon("download", { size: "sm" }), el("span", { text: ".md" })]);
    p.extra.append(modelo, fases, exportar, baixar);

    const colunas = el("div.retro__colunas");
    const acoesLista = el("ul.retro__acoes");
    const acaoTxt = el("input.input", { type: "text", placeholder: "Nova ação (quem faz o quê)", "aria-label": "Nova ação", maxLength: 300 });
    const addAcao = () => {
      if (!acaoTxt.value.trim()) return;
      rt.adicionarAcao(acaoTxt.value);
      acaoTxt.value = "";
    };
    acaoTxt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addAcao();
      e.stopPropagation();
    });
    const acoes = el("section.retro__plano", { "aria-label": "Plano de ação" }, [
      el("h3.jogos__titulo", {}, [icon("list-checks", { size: "sm" }), el("span", { text: "Plano de ação" })]),
      acoesLista,
      el("div.poker__add", {}, [acaoTxt, el("button.btn.btn--primary", { type: "button", onClick: addAcao }, [icon("plus", { size: "sm" })])]),
    ]);
    const quem = el("div.retro__quem");
    this.#corpo.append(el("div.retro", {}, [quem, colunas, acoes]));
    Object.assign(p, { modelo, botoesFase, pontos, colunas, acoesLista, acoes, quem, colunasDe: "", entradas: [] });
  }

  #retroMd() {
    const v = retro(this.o.estado);
    const linhas = [`# Retrospectiva — ${v.modelo.nome}`, ""];
    for (const c of v.colunas) {
      linhas.push(`## ${c.titulo}`, "");
      const notas = [...c.notas].sort((a, b) => b.votos - a.votos);
      for (const n of notas) linhas.push(`- ${n.texto ?? "(oculta)"}${n.votos ? ` — ${n.votos} voto(s)` : ""}`);
      if (!notas.length) linhas.push("- (nada)");
      linhas.push("");
    }
    linhas.push("## Ações", "");
    for (const a of v.acoes) linhas.push(`- [${a.feita ? "x" : " "}] ${a.texto}${a.dono ? ` (${a.dono})` : ""}`);
    if (!v.acoes.length) linhas.push("- (nenhuma)");
    return linhas.join("\n");
  }

  #desenharRetro() {
    const { estado, retro: rt } = this.o;
    const p = this.#partes;
    if (!p.colunas) return;
    const pessoas = this.#pessoas();
    const v = retro(estado, { pessoas });
    p.modelo.value = v.modeloId;
    p.modelo.disabled = v.fase !== "escrever";
    for (const [f, b] of Object.entries(p.botoesFase)) {
      b.setAttribute("aria-selected", String(f === v.fase));
      b.classList.toggle("is-feita", FASES_RETRO.indexOf(f) < FASES_RETRO.indexOf(v.fase));
    }
    const sobra = v.votosPorPessoa - v.meusVotosUsados;
    p.pontos.textContent = `${"●".repeat(sobra)}${"○".repeat(v.meusVotosUsados)}`;
    p.pontos.setAttribute("aria-label", `${sobra} de ${v.votosPorPessoa} pontos sobrando`);

    // Escrita: quem já escreveu (os textos estão escondidos). Votação: seus pontos.
    p.quem.replaceChildren(
      ...(v.fase === "escrever"
        ? [
            el("span.jogos__rotulo", { text: "Escrevendo (as notas aparecem para todos na fase de votar):" }),
            ...v.escreveram.map((x) => el("span.retro__pessoa", { class: x.notas ? "is-escreveu" : "" }, [el("span", { text: x.nome }), el("b", { text: String(x.notas) })])),
          ]
        : v.fase === "votar"
          ? [el("span.jogos__rotulo", { text: "Dê seus pontos às notas que mais importam:" }), p.pontos]
          : []),
    );

    // Colunas: o esqueleto (e os campos de texto) só muda com o modelo
    if (p.colunasDe !== v.modeloId) {
      p.colunasDe = v.modeloId;
      p.entradas = [];
      p.colunas.replaceChildren(
        ...v.colunas.map((c, i) => {
          const lista = el("div.coluna__notas");
          const txt = el("textarea.input.coluna__txt", { rows: 2, placeholder: "Escreva e tecle Enter", "aria-label": `Nova nota em ${c.titulo}`, maxLength: 500 });
          const add = () => {
            if (!txt.value.trim()) return;
            rt.adicionarNota(i, txt.value);
            txt.value = "";
          };
          txt.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add();
            }
            e.stopPropagation();
          });
          p.entradas.push({ lista, titulo: el("h3.coluna__titulo", { text: c.titulo }) });
          return el("section.coluna", { dataset: { col: i } }, [p.entradas[i].titulo, lista, el("div.coluna__add", {}, [txt, el("button.btn.btn--icon.btn--primary", { type: "button", "aria-label": `Adicionar em ${c.titulo}`, onClick: add }, [icon("plus", { size: "sm" })])])]);
        }),
      );
    }
    v.colunas.forEach((c, i) => {
      const alvo = p.entradas[i];
      if (!alvo) return;
      alvo.titulo.textContent = `${c.titulo} · ${c.notas.length}`;
      sincronizar(alvo.lista, c.notas.map((n) => this.#nota(n, v)));
    });
    // Acabaram os pontos: os "+" apagam sem refazer as notas.
    const semPontos = v.meusVotosUsados >= v.votosPorPessoa;
    for (const b of p.colunas.querySelectorAll(".nota__mais")) b.disabled = semPontos;

    p.acoes.hidden = v.fase === "escrever";
    sincronizar(
      p.acoesLista,
      v.acoes.length
        ? v.acoes.map((a) => ({
            chave: a.id,
            sig: JSON.stringify([a.texto, a.feita]),
            criar: () =>
              el("li.retro__acao", { class: a.feita ? "is-feita" : "" }, [
                el("label", {}, [
                  el("input", { type: "checkbox", checked: a.feita, onChange: (e) => rt.marcarAcao(a.id, e.target.checked) }),
                  el("span", { text: a.texto }),
                ]),
                el("button.btn.btn--icon.btn--ghost", { type: "button", "aria-label": `Apagar ação: ${a.texto}`, onClick: () => rt.apagarAcao(a.id) }, [icon("trash-2", { size: "sm" })]),
              ]),
          }))
        : [{ chave: "vazio", sig: "", criar: () => el("li.poker__vazio", { text: "Nenhuma ação combinada ainda." }) }],
    );
  }

  /** Uma nota da retrospectiva, como item de `sincronizar`. */
  #nota(n, v) {
    const { estado, retro: rt } = this.o;
    const minha = n.autor === estado.eu;
    const texto = n.texto ?? (minha ? rt.meus.get(n.id) : null);
    const meus = Number(estado.ler(`r/vt/${n.id}/${estado.eu}`, 0)) || 0;
    return {
      chave: n.id,
      sig: JSON.stringify([texto, n.nome, minha, v.fase, v.fase === "votar" ? meus : 0, v.fase === "discutir" ? n.votos : 0]),
      criar: () => this.#criarNota(n, v, minha, texto, meus),
    };
  }

  #criarNota(n, v, minha, texto, meus) {
    const { retro: rt } = this.o;
    const filhos = [texto != null ? el("p.nota__texto", { text: texto }) : el("p.nota__texto.is-oculta", { text: "Nota escondida até a votação", "aria-label": `Nota de ${n.nome || "alguém"}, escondida até a votação` })];
    const pe = el("div.nota__pe");
    if (minha) pe.append(el("span.jogos__rotulo", { text: "sua" }));
    if (v.fase === "votar") {
      pe.append(
        el("div.nota__votos", {}, [
          el("button.btn.btn--icon.btn--ghost", { type: "button", "aria-label": "Tirar um ponto", disabled: !meus, onClick: () => rt.votar(n.id, -1) }, [el("span", { text: "−" })]),
          el("span.nota__meus", { text: "●".repeat(meus) || "·", "aria-label": `${meus} ponto(s) seu(s)` }),
          el("button.btn.btn--icon.btn--ghost.nota__mais", { type: "button", "aria-label": "Dar um ponto", disabled: v.meusVotosUsados >= v.votosPorPessoa, onClick: () => rt.votar(n.id, +1) }, [el("span", { text: "+" })]),
        ]),
      );
    } else if (v.fase === "discutir" && n.votos) {
      pe.append(el("span.nota__total", { text: `${n.votos} ${n.votos === 1 ? "ponto" : "pontos"}` }));
    }
    if (minha) pe.append(el("button.btn.btn--icon.btn--ghost", { type: "button", "aria-label": "Apagar nota", onClick: () => rt.apagarNota(n.id) }, [icon("trash-2", { size: "sm" })]));
    return el("article.nota", { class: `${minha ? "is-minha" : ""}` }, [...filhos, pe]);
  }

  /* ---------------------------------------------------------------- *
   * Daily
   * ---------------------------------------------------------------- */

  #montarDaily() {
    const { daily: dl } = this.o;
    const p = this.#partes;
    const tempo = el("select.input.jogos__select", { "aria-label": "Tempo por pessoa" });
    for (const s of [60, 90, 120, 180]) tempo.append(el("option", { value: s, text: `${mmss(s)} por pessoa` }));
    tempo.addEventListener("change", () => dl.tempo(Number(tempo.value)));
    const sortear = el("button.btn.btn--ghost.jogos__chip", { type: "button", onClick: () => dl.sortear(this.#pessoas()) }, [icon("shuffle", { size: "sm" }), el("span", { text: "Sortear ordem" })]);
    const reiniciar = el("button.btn.btn--ghost.jogos__chip", { type: "button", onClick: () => dl.reiniciar() }, [icon("rotate-ccw", { size: "sm" }), el("span", { text: "Recomeçar" })]);
    p.extra.append(tempo, sortear, reiniciar);
    const lista = el("ol.daily__lista", { "aria-label": "Ordem de fala" });
    const palco = el("div.daily__palco", { "aria-live": "polite" });
    this.#corpo.append(el("div.daily", {}, [lista, palco]));
    Object.assign(p, { tempo, lista, palco, dailyChave: "" });
  }

  #desenharDaily() {
    const { estado, daily: dl } = this.o;
    const p = this.#partes;
    if (!p.palco) return;
    const v = daily(estado);
    p.tempo.value = String(v.tempo);
    const pessoas = this.#pessoas();

    // A lista só é refeita quando muda quem fala (o relógio não mexe nela).
    const chave = `${JSON.stringify(v.ordem.map((o) => [o.id, o.segundos]))}|${v.i}|${v.tempo}`;
    if (chave !== p.dailyChave) {
      p.dailyChave = chave;
      p.lista.replaceChildren(
        ...v.ordem.map((o) =>
          el("li.daily__item", { class: `${o.atual ? "is-atual" : ""} ${o.feito ? "is-feito" : ""}` }, [
            el("span.daily__n", { text: String(o.k + 1) }),
            el("span.truncate", { text: o.nome }),
            o.segundos != null ? el("span.daily__seg", { class: o.segundos > v.tempo ? "is-estourou" : "", text: mmss(o.segundos) }) : o.atual ? el("span.jogos__rotulo", { text: "falando" }) : null,
          ].filter(Boolean)),
        ),
      );
      if (!v.ordem.length) p.lista.append(el("li.poker__vazio", { text: "Sorteie a ordem para começar." }));
    }

    if (!v.ordem.length) {
      p.palco.replaceChildren(
        el("div.daily__vazio", {}, [
          icon("shuffle", { size: "lg" }),
          el("p", { text: "Sorteie quem fala primeiro. Cada um tem o mesmo tempo, e o cronômetro aparece para todos." }),
          el("button.btn.btn--primary.btn--lg", { type: "button", onClick: () => dl.sortear(pessoas) }, [el("span", { text: "Sortear ordem" })]),
        ]),
      );
      return;
    }
    if (v.fim) {
      const estouraram = v.ordem.filter((o) => (o.segundos || 0) > v.tempo);
      p.palco.replaceChildren(
        el("div.daily__vazio", {}, [
          icon("party-popper", { size: "lg" }),
          el("h3", { text: `Daily encerrada em ${mmss(v.total)}` }),
          el("p", { text: estouraram.length ? `Passaram do tempo: ${estouraram.map((o) => o.nome).join(", ")}.` : "Todo mundo dentro do tempo. 👏" }),
          el("button.btn", { type: "button", onClick: () => dl.reiniciar() }, [icon("rotate-ccw", { size: "sm" }), el("span", { text: "Recomeçar" })]),
        ]),
      );
      return;
    }
    if (!v.atual) {
      p.palco.replaceChildren(
        el("div.daily__vazio", {}, [
          el("p", { text: `Primeiro: ${v.ordem[0].nome}. ${v.ordem.length} pessoas, ${mmss(v.tempo)} para cada.` }),
          el("button.btn.btn--primary.btn--lg", { type: "button", onClick: () => dl.proximo() }, [icon("play", { size: "sm" }), el("span", { text: "Começar a daily" })]),
        ]),
      );
      return;
    }
    // Quem fala agora: o anel esvazia com o tempo e fica vermelho ao estourar.
    const pessoa = pessoas.find((x) => x.id === v.atual.id);
    const fracao = Math.max(0, Math.min(1, v.restante / v.tempo));
    if (!p.dailyFala || !p.dailyFala.isConnected || p.dailyFala.dataset.id !== v.atual.id) {
      p.dailyTempo = el("strong.daily__tempo");
      p.dailyAnel = el("div.daily__anel", {}, [pessoa?.avatar ? avatarEl(pessoa.avatar, { title: v.atual.nome }) : el("span.daily__inicial", { text: (v.atual.nome || "?").slice(0, 1).toUpperCase() })]);
      const proximo = v.ordem[v.i + 1];
      p.dailyFala = el("div.daily__fala", { dataset: { id: v.atual.id } }, [
        p.dailyAnel,
        el("h3", { text: v.atual.nome }),
        p.dailyTempo,
        el("p.muted", { text: proximo ? `Depois: ${proximo.nome}` : "Última pessoa" }),
        el("button.btn.btn--primary.btn--lg", { type: "button", onClick: () => dl.proximo() }, [icon("skip-forward", { size: "sm" }), el("span", { text: proximo ? "Próximo" : "Encerrar" })]),
      ]);
      p.palco.replaceChildren(p.dailyFala);
    }
    p.dailyAnel.style.setProperty("--p", String(fracao));
    p.dailyAnel.classList.toggle("is-acabando", v.restante <= 15 && !v.estourou);
    p.dailyAnel.classList.toggle("is-estourou", v.estourou);
    p.dailyTempo.textContent = v.estourou ? `${mmss(-(v.decorrido - v.tempo))} passou` : mmss(v.restante);
  }
}

/** Para a nota de quem abriu o jogo: "Ana abriu o Planning Poker". */
export function nomeDoJogo(id) {
  return JOGOS[id]?.nome || "um jogo";
}

/** Usado pelo topo: a história em votação (para avisos). */
export function historiaEmVotacao(estado) {
  const hid = historiaAtual(estado);
  return historias(estado).find((h) => h.id === hid) || null;
}
