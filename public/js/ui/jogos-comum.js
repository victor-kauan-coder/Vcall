/**
 * ui/jogos-comum.js — peças de interface que todos os jogos usam: a
 * reconciliação por chave (`sincronizar`), a tela de abertura, o placar, o
 * pódio, o anel de tempo e os botões.
 *
 * A regra de ouro, herdada da mesa do Planning Poker: redesenhar só o que
 * mudou. Cada item tem uma chave e uma assinatura; o nó só é refeito quando
 * a assinatura muda. Assim nada pisca, nada "entra" de novo e o foco do
 * teclado fica onde estava quando outra pessoa joga.
 */
import { el, icon } from "../lib/dom.js";
import { avatarEl } from "./avatars.js";

/** Os nós com `data-chave` de um ou mais contêineres, por chave. */
export function porChave(...pais) {
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
export function sincronizar(pai, itens, antigos = porChave(pai)) {
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

/** Troca o conteúdo de `pai` só quando `sig` muda (um item só). */
export function trocar(pai, sig, criar) {
  sincronizar(pai, [{ chave: "x", sig: String(sig), criar }]);
}

export const mmss = (s) => {
  const neg = s < 0;
  const t = Math.abs(Math.round(s));
  return `${neg ? "+" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Um botão com ícone (Lucide) e texto. */
export function botao(texto, { icone = null, tipo = "", onClick, tip = null, rotulo = null, desligado = false, classe = "" } = {}) {
  const b = el(`button.btn${tipo ? `.btn--${tipo}` : ""}`, { type: "button", class: classe, disabled: desligado, "aria-label": rotulo || null, dataset: tip ? { tip, "tip-placement": "top" } : {} }, [
    icone ? icon(icone, { size: "sm" }) : null,
    texto ? el("span", { text: texto }) : null,
  ]);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

/** Um seletor com rótulo escondido para leitor de tela. */
export function seletor(rotulo, opcoes, valor, aoMudar) {
  const s = el("select.input.jogos__select", { "aria-label": rotulo });
  for (const [v, t] of opcoes) s.append(el("option", { value: String(v), text: t }));
  s.value = String(valor);
  s.addEventListener("change", () => aoMudar(s.value));
  return s;
}

/**
 * Um campo de texto que entrega o valor no Enter e limpa. As teclas ficam
 * nele (os atalhos da chamada não pegam letra digitada aqui).
 */
export function campo({ placeholder = "", rotulo = "", max = 60, aoEnviar, classe = "", limpar = true } = {}) {
  const i = el("input.input", { type: "text", placeholder, "aria-label": rotulo || placeholder, maxLength: max, autocomplete: "off", spellcheck: false, class: classe });
  i.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && i.value.trim()) {
      e.preventDefault();
      aoEnviar?.(i.value);
      if (limpar) i.value = "";
    }
  });
  return i;
}

/** O rosto de alguém: o avatar, ou a inicial num círculo. */
export function rosto(pessoa, tamanho = 32) {
  if (pessoa?.avatar) return avatarEl(pessoa.avatar, { size: tamanho, title: pessoa.nome || "" });
  const n = el("span.jg-inicial", { text: (pessoa?.nome || "?").slice(0, 1).toUpperCase(), "aria-hidden": "true" });
  n.style.width = n.style.height = `${tamanho}px`;
  return n;
}

/** O ícone do jogo num ladrilho com o degradê da marca (menu, abertura). */
export function selo(nome, classe = "") {
  return el(`span.jg-selo${classe ? `.${classe}` : ""}`, { "aria-hidden": "true" }, [icon(nome)]);
}

/**
 * A tela de abertura de um jogo: o ícone do jogo, como se joga em poucas
 * linhas, os ajustes e o botão de começar.
 */
export function abertura({ icone, titulo, regras = [], ajustes = [], acoes = [], rodape = null }) {
  return el("div.jg-abertura", {}, [
    selo(icone, "jg-selo--grande"),
    el("h2.jg-abertura__titulo", { text: titulo }),
    regras.length ? el("ul.jg-abertura__regras", {}, regras.map((r) => el("li", { text: r }))) : null,
    ajustes.length ? el("div.jg-abertura__ajustes", {}, ajustes) : null,
    acoes.length ? el("div.jg-abertura__acoes", {}, acoes) : null,
    rodape,
  ]);
}

/** Um ajuste da abertura: rótulo em cima, controle embaixo. */
export function ajuste(rotulo, controle) {
  return el("label.jg-ajuste", {}, [el("span.jogos__rotulo", { text: rotulo }), controle]);
}

/** A posição no placar: número num círculo; os três primeiros ganham cor. */
function selosDePosicao(n, comPonto) {
  return el(`span.jg-pos${comPonto && n < 3 ? `.jg-pos--${n + 1}` : ""}`, { text: comPonto ? `${n + 1}` : "–", "aria-label": comPonto ? `${n + 1}º lugar` : "sem pontos" });
}

/**
 * Placar em lista: posição (medalha para os três primeiros), rosto, nome e
 * pontos. `itens`: [{ id, nome, pontos, eu, extra? }] já em ordem.
 */
export function placar(pai, itens, { pessoas = [], unidade = "pts", vazio = "Ninguém pontuou ainda." } = {}) {
  if (!itens.length) {
    trocar(pai, "vazio", () => el("p.jg-vazio", { text: vazio }));
    return;
  }
  let posicao = 0;
  let anterior = null;
  sincronizar(
    pai,
    itens.map((r, i) => {
      if (r.pontos !== anterior) posicao = i;
      anterior = r.pontos;
      const pos = posicao;
      const pessoa = pessoas.find((p) => p.id === r.id);
      return {
        chave: r.id,
        sig: JSON.stringify([pos, r.nome, r.pontos, r.eu, r.extra || "", r.marca || "", pessoa?.avatar || null]),
        criar: () =>
          el("li.jg-placar__item", { class: `${r.eu ? "is-eu" : ""} ${r.marca ? `is-${r.marca}` : ""}` }, [
            selosDePosicao(pos, r.pontos > 0),
            rosto(pessoa || r, 28),
            el("span.jg-placar__nome.truncate", { text: r.eu ? `${r.nome} (você)` : r.nome }),
            r.extra ? el("span.jg-placar__extra", { text: r.extra }) : null,
            el("b.jg-placar__pts", { text: `${r.pontos} ${unidade}` }),
          ]),
      };
    }),
  );
}

/** O pódio do fim de jogo (os três primeiros), com o resto embaixo. */
export function podio(itens, { pessoas = [], unidade = "pts", titulo = "Fim de jogo!", acoes = [] } = {}) {
  const top = itens.slice(0, 3);
  const ordem = [1, 0, 2].filter((i) => top[i]);
  const resto = el("ol.jg-placar.jg-placar--resto");
  placar(resto, itens.slice(3), { pessoas, unidade, vazio: "" });
  return el("div.jg-podio", {}, [
    el("h2.jg-podio__titulo", {}, [selo("trophy"), el("span", { text: titulo })]),
    el(
      "div.jg-podio__degraus",
      {},
      ordem.map((i) => {
        const r = top[i];
        const pessoa = pessoas.find((p) => p.id === r.id);
        return el(`div.jg-podio__lugar.jg-podio__lugar--${i + 1}`, {}, [
          el("div.jg-podio__rosto", {}, [rosto(pessoa || r, i === 0 ? 64 : 52)]),
          el("strong.truncate", { text: r.nome }),
          el("span", { text: `${r.pontos} ${unidade}` }),
          el("div.jg-podio__degrau", {}, [el("b.jg-podio__n", { text: String(i + 1) })]),
        ]);
      }),
    ),
    itens.length > 3 ? resto : null,
    acoes.length ? el("div.jg-abertura__acoes", {}, acoes) : null,
  ]);
}

/** O anel que esvazia com o tempo. `definir(restante, total)`. */
export function anelTempo(tamanho = 56) {
  const valor = el("b.jg-anel__n");
  const no = el("div.jg-anel", { role: "timer", "aria-live": "off" }, [valor]);
  no.style.width = no.style.height = `${tamanho}px`;
  let ultimo = "";
  return {
    no,
    definir(restante, total) {
      const s = Math.max(0, Math.ceil(restante));
      const fr = total > 0 ? Math.max(0, Math.min(1, restante / total)) : 0;
      no.style.setProperty("--p", fr.toFixed(3));
      no.classList.toggle("is-acabando", s <= 10 && s > 0);
      no.classList.toggle("is-zerado", s === 0);
      const t = String(s);
      if (t !== ultimo) {
        ultimo = t;
        valor.textContent = t;
        no.setAttribute("aria-label", `${t} segundos`);
      }
    },
  };
}

/** Uma faixa de aviso no alto de um jogo ("Vez de Ana", "Bia gritou STOP!"). */
export function faixa(pai, sig, filhos, tom = "") {
  trocar(pai, sig, () => el(`div.jg-faixa${tom ? `.jg-faixa--${tom}` : ""}`, { role: "status" }, filhos));
}

/** Confete leve, em CSS (a mesma da mesa de Poker). */
export function confete(onde) {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const camada = el("div.confete", { "aria-hidden": "true" });
  const cores = ["var(--brand-pink)", "var(--brand-orange)", "var(--ok)", "var(--accent-2)"];
  for (let i = 0; i < 40; i += 1) {
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
  onde.append(camada);
  setTimeout(() => camada.remove(), 2200);
}

/**
 * A base da tela de cada jogo de festa e de tabuleiro. A mesa (ui/jogos.js)
 * chama `montar()` uma vez, `desenhar()` quando o estado muda (no máximo
 * uma vez por quadro), `tique()` a cada 250 ms enquanto `relogio()` for
 * verdade, e `destruir()` ao trocar de jogo.
 *
 * `c` (contexto): { logica, estado, corpo, extra, raiz, pessoas(), avisar(),
 * confete(), videoDe(id), pedir() }.
 */
export class Vista {
  #limpezas = [];

  constructor(c) {
    this.c = c;
    this.l = c.logica;
  }
  get eu() {
    return this.c.estado.eu;
  }
  pessoas() {
    return this.c.pessoas();
  }
  /** Ouve um evento até a tela ser destruída. */
  ouvir(alvo, evento, fn) {
    const off = alvo.on ? alvo.on(evento, fn) : (alvo.addEventListener(evento, fn), () => alvo.removeEventListener(evento, fn));
    this.#limpezas.push(typeof off === "function" ? off : () => alvo.off?.(evento, fn));
  }
  aoDestruir(fn) {
    this.#limpezas.push(fn);
  }
  montar() {}
  desenhar() {}
  relogio() {
    return false;
  }
  tique() {
    this.l?.manter?.(this.pessoas());
    this.desenhar();
  }
  destruir() {
    while (this.#limpezas.length) {
      try {
        this.#limpezas.pop()();
      } catch {
        /* limpeza nunca quebra a troca de jogo */
      }
    }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Um elemento SVG com atributos. */
export function svg(tag, attrs = {}, filhos = []) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const f of filhos) n.append(f);
  return n;
}
