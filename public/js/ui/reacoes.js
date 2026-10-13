/**
 * ui/reacoes.js — o desenho das reações e dos sinais.
 *
 * Uma camada fixa por cima da chamada, que não recebe clique, onde os emoji
 * sobem a partir do quadrinho de quem reagiu (onde quer que ele esteja: grade,
 * destaque, faixa lateral ou balão). Só `transform` e `opacity` animam, o que
 * o navegador faz na placa de vídeo sem repintar a chamada; e nunca há mais
 * de 48 emoji no ar.
 *
 * Com "reduzir movimento" ligado no sistema, nada voa: a reação aparece só
 * como selo no quadrinho.
 */
import { el, emoji } from "../lib/dom.js";
import { REACOES, SINAIS, reacao, sinal } from "../features/reacoes.js";

const MAX_NO_AR = 48;
const aleatorio = (a, b) => a + Math.random() * (b - a);
const reduzido = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class CamadaReacoes {
  #camada = null;
  #placar = null;
  #noAr = 0;
  #selos = new Map(); // pessoa -> timer do selo da última reação

  /**
   * @param {object} o
   * @param {(pessoa: string) => HTMLElement|null} o.quadro o quadrinho (tile) de alguém
   * @param {(pessoa: string) => string} o.nome
   * @param {() => HTMLElement|null} o.palco a área da chamada (para a chuva e o placar)
   */
  constructor(o) {
    this.o = o;
  }

  #garantir() {
    if (this.#camada?.isConnected) return;
    this.#camada = el("div.reacoes", { "aria-hidden": "true" });
    this.#placar = el("div.sinaisPlacar", { role: "status", "aria-live": "polite", hidden: true });
    document.body.append(this.#camada, this.#placar);
  }

  /** De onde a reação sai: o meio da base do quadrinho, ou o canto da tela. */
  #origem(pessoa) {
    const q = this.o.quadro(pessoa);
    const r = q?.getBoundingClientRect();
    if (r && r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height * 0.78, quadro: q };
    return { x: 72, y: innerHeight - 140, quadro: null };
  }

  /**
   * Uma reação de alguém. `n`: quantas vieram juntas (combo pela rede);
   * `combo`: o tamanho do combo, para o "×3".
   */
  voar(pessoa, id, { n = 1, combo = 1 } = {}) {
    const r = reacao(id);
    if (!r) return;
    this.#garantir();
    const { x, y, quadro } = this.#origem(pessoa);
    this.#selo(pessoa, quadro, r);
    if (reduzido()) return;

    const quantos = Math.min(n, 5);
    const tamanho = Math.min(64, 40 + (combo - 1) * 4);
    for (let i = 0; i < quantos; i++) this.#particula(r.emoji, { x, y, tamanho, atraso: i * 90 });
    if (combo > 1 || n > 1) {
      const vezes = Math.max(combo, n);
      const etiqueta = el("div.reacaoCombo", { text: `×${vezes}` });
      etiqueta.style.left = `${x + 22}px`;
      etiqueta.style.top = `${y - 46}px`;
      etiqueta.style.setProperty("--forca", String(Math.min(1.6, 1 + vezes / 12)));
      this.#camada.append(etiqueta);
      etiqueta.addEventListener("animationend", () => etiqueta.remove(), { once: true });
    }
  }

  #particula(nome, { x, y, tamanho, atraso = 0, sobe = aleatorio(200, 320), dur = aleatorio(1700, 2300) }) {
    if (this.#noAr >= MAX_NO_AR) return;
    this.#noAr += 1;
    const no = el("div.reacaoVoo", {}, [emoji(nome, { size: tamanho })]);
    no.style.left = `${x}px`;
    no.style.top = `${y}px`;
    no.style.setProperty("--dx", `${aleatorio(-70, 70).toFixed(0)}px`);
    no.style.setProperty("--sobe", `${-sobe.toFixed(0)}px`);
    no.style.setProperty("--giro", `${aleatorio(-28, 28).toFixed(0)}deg`);
    no.style.setProperty("--dur", `${dur.toFixed(0)}ms`);
    no.style.setProperty("--atraso", `${atraso}ms`);
    this.#camada.append(no);
    const fim = () => {
      if (!no.isConnected) return;
      no.remove();
      this.#noAr -= 1;
    };
    no.addEventListener("animationend", fim, { once: true });
    setTimeout(fim, dur + atraso + 400); // aba em segundo plano não dispara animationend
  }

  /** O selo no canto do quadrinho, por 2,5 s: quem reagiu, mesmo sem olhar o emoji subir. */
  #selo(pessoa, quadro, r) {
    if (!quadro) return;
    let selo = quadro.querySelector(":scope > .tile__reacao");
    if (!selo) {
      selo = el("div.tile__reacao", { "aria-hidden": "true" });
      quadro.append(selo);
    }
    selo.replaceChildren(emoji(r.emoji, { size: 30 }));
    selo.classList.remove("is-on");
    void selo.offsetWidth;
    selo.classList.add("is-on");
    clearTimeout(this.#selos.get(pessoa));
    this.#selos.set(pessoa, setTimeout(() => selo.classList.remove("is-on"), 2500));
  }

  /** A mesma reação de várias pessoas: chove na chamada inteira. */
  chover(id) {
    const r = reacao(id);
    if (!r || reduzido()) return;
    this.#garantir();
    const p = this.o.palco()?.getBoundingClientRect() || { left: 0, width: innerWidth, bottom: innerHeight, height: innerHeight };
    for (let i = 0; i < 18; i++) {
      this.#particula(r.emoji, {
        x: p.left + aleatorio(0.06, 0.94) * p.width,
        y: p.bottom - 20,
        tamanho: Math.round(aleatorio(40, 72)),
        atraso: Math.round(aleatorio(0, 1100)),
        sobe: aleatorio(0.45, 0.85) * p.height,
        dur: aleatorio(2200, 3000),
      });
    }
  }

  /** Os sinais de alguém, como etiquetas no quadrinho. */
  sinais(pessoa, ids) {
    const q = this.o.quadro(pessoa);
    if (!q) return;
    let caixa = q.querySelector(":scope > .tile__sinais");
    if (!ids.length) {
      caixa?.remove();
      q.classList.remove("is-ausente");
      return;
    }
    if (!caixa) {
      caixa = el("div.tile__sinais");
      q.append(caixa);
    }
    caixa.classList.toggle("is-compacta", q.clientWidth < 300);
    caixa.replaceChildren(
      ...ids.map((id) => {
        const s = sinal(id);
        return el(`div.sinal.sinal--${id}`, { title: s.nome }, [emoji(s.emoji, { size: 20 }), el("span", { text: s.nome })]);
      }),
    );
    // "Já volto": o quadrinho fica esmaecido, como quem saiu da mesa.
    q.classList.toggle("is-ausente", ids.includes("javolto"));
  }

  /** Votação rápida: quantos estão com Sim, Não, Mais devagar… — para todo mundo ver. */
  placar(porSinal) {
    this.#garantir();
    const itens = SINAIS.filter((s) => s.id !== "javolto" && porSinal[s.id]?.length);
    this.#placar.hidden = !itens.length;
    this.#placar.replaceChildren(
      ...itens.map((s) => {
        const nomes = porSinal[s.id].map((p) => this.o.nome(p)).join(", ");
        return el(`div.placarItem.placarItem--${s.id}`, { title: `${s.nome}: ${nomes}`, "aria-label": `${s.nome}: ${porSinal[s.id].length} (${nomes})` }, [
          emoji(s.emoji, { size: 20 }),
          el("b", { text: String(porSinal[s.id].length) }),
        ]);
      }),
    );
  }

  destruir() {
    this.#camada?.remove();
    this.#placar?.remove();
    this.#camada = this.#placar = null;
    this.#noAr = 0;
  }
}

/**
 * O conteúdo do menu de reagir: a grade de emoji (fica aberto para combos) e
 * os sinais, que ligam e desligam.
 */
export function montarMenu(pop, { aoReagir, aoSinal, meusSinais }) {
  const grade = el("div.reagirGrade", { role: "group", "aria-label": "Reações" });
  for (const r of REACOES) {
    const b = el("button.reagirBotao", { type: "button", "aria-label": r.nome, dataset: { tip: r.nome, "tip-placement": "top" } }, [emoji(r.emoji, { size: 30 })]);
    b.addEventListener("click", () => {
      aoReagir(r.id);
      b.classList.remove("is-pulo");
      void b.offsetWidth;
      b.classList.add("is-pulo");
    });
    grade.append(b);
  }
  const lista = el("div.reagirSinais", { role: "group", "aria-label": "Sinais que ficam no seu quadrinho" });
  const botoes = new Map();
  for (const s of SINAIS) {
    const b = el("button.reagirSinal", { type: "button", "aria-pressed": "false" }, [emoji(s.emoji, { size: 22 }), el("span", { text: s.nome })]);
    b.addEventListener("click", () => aoSinal(s.id));
    botoes.set(s.id, b);
    lista.append(b);
  }
  const pintar = (ids) => {
    for (const [id, b] of botoes) b.setAttribute("aria-pressed", String(ids.includes(id)));
  };
  pintar(meusSinais());
  pop.append(
    el("div.popover__label", { text: "Reagir" }),
    grade,
    el("div.popover__label", { text: "Sinais · ficam no seu quadrinho" }),
    lista,
  );
  return { pintar };
}
