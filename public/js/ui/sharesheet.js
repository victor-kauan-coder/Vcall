/**
 * ui/sharesheet.js — a tela de compartilhar, antes da do navegador.
 *
 * O QUE ESTA TELA PODE E O QUE NÃO PODE, sem rodeios:
 *
 * A janela final do navegador — aquela com a lista de telas e janelas — é
 * OBRIGATÓRIA e não pode ser substituída. Nenhuma página consegue enumerar as
 * suas janelas, ver miniaturas delas ou escolher uma por conta própria. Se
 * conseguisse, qualquer site leria a sua tela sem você saber. É a mesma regra
 * que vale para câmera e microfone, e aqui ela é ainda mais rígida.
 *
 * O que dá para fazer, e é o que esta tela faz, é tudo o que vem ANTES:
 *
 *   1. PERGUNTAR O QUE VOCÊ QUER MOSTRAR. Tela inteira, uma janela, ou uma aba.
 *      A escolha vira uma preferência (`displaySurface`) que faz o seletor do
 *      navegador ABRIR JÁ NA ABA CERTA, em vez de você ter que procurar.
 *
 *   2. AJUSTAR A QUALIDADE ANTES, e não depois de já estar compartilhando
 *      ruim. Nitidez para texto e código; fluidez para vídeo.
 *
 *   3. DECIDIR SOBRE O SOM. A caixa de "compartilhar áudio" do navegador passa
 *      despercebida por quase todo mundo; aqui ela é uma pergunta explícita.
 *
 * É o mesmo desenho que Meet e Teams usam: painel próprio, depois a janela do
 * sistema. A diferença entre parecer um aplicativo e parecer uma página é
 * justamente este passo.
 */
import { el, icon, $ } from "../lib/dom.js";
import { prefs } from "../lib/util.js";
import { SCREEN_QUALITY } from "../core/screen.js";

const SUPERFICIES = [
  {
    id: "monitor",
    icon: "monitor",
    titulo: "Tela inteira",
    texto: "Tudo o que aparece no seu monitor, inclusive o que você abrir depois.",
  },
  {
    id: "window",
    icon: "layout-grid",
    titulo: "Uma janela",
    texto: "Só um programa. O resto da sua tela continua privado.",
  },
  {
    id: "browser",
    icon: "panel-right-open",
    titulo: "Uma aba do navegador",
    texto: "A mais nítida para slides e sites, e a que menos pesa na rede.",
  },
];

const MODOS = [
  {
    id: "text",
    icon: "type",
    titulo: "Nitidez",
    texto: "Texto, código, planilhas. A imagem para de perder detalhe quando a rede aperta.",
  },
  {
    id: "motion",
    icon: "zap",
    titulo: "Fluidez",
    texto: "Vídeo e animação. A imagem fica menor antes de engasgar.",
  },
];

/**
 * Abre o painel. Resolve com as escolhas, ou `null` se a pessoa desistir.
 *
 * @returns {Promise<{surface:string, quality:string, mode:string, withAudio:boolean}|null>}
 */
export function escolherCompartilhamento({ podeAudio = true } = {}) {
  return new Promise((resolve) => {
    const escolha = {
      surface: prefs.get("share:surface", "window"),
      quality: prefs.get("screen:quality", "auto"),
      mode: prefs.get("share:mode", "text"),
      withAudio: prefs.get("share:audio", true),
    };

    const fundo = el("div.share", { role: "dialog", "aria-modal": "true", "aria-labelledby": "shareTitulo" });
    const card = el("div.share__card");

    card.append(
      el("div.share__head", {}, [
        el("span.share__icone", {}, [icon("screen-share", { size: "lg" })]),
        el("div", {}, [
          el("h2.share__titulo", { id: "shareTitulo", text: "Compartilhar sua tela" }),
          el("p.share__sub", { text: "Escolha o que mostrar e como. Nada é gravado nem sai daqui." }),
        ]),
      ]),
    );

    /* -- o que mostrar -- */
    const grade = el("div.share__grade", { role: "radiogroup", "aria-label": "O que mostrar" });
    const cartoes = new Map();
    for (const s of SUPERFICIES) {
      const b = el("button.share__opcao", {
        type: "button",
        role: "radio",
        "aria-checked": String(escolha.surface === s.id),
        onClick: () => {
          escolha.surface = s.id;
          for (const [k, n] of cartoes) n.setAttribute("aria-checked", String(k === s.id));
        },
      });
      b.append(
        el("span.share__opcaoIcone", {}, [icon(s.icon, { size: "lg" })]),
        el("span.share__opcaoNome", { text: s.titulo }),
        el("span.share__opcaoTexto", { text: s.texto }),
      );
      cartoes.set(s.id, b);
      grade.append(b);
    }
    card.append(grade);

    /* -- prioridade da imagem -- */
    const linhaModo = el("div.share__linha", { role: "radiogroup", "aria-label": "Prioridade da imagem" });
    const modos = new Map();
    for (const m of MODOS) {
      const b = el("button.share__pilula", {
        type: "button",
        role: "radio",
        "aria-checked": String(escolha.mode === m.id),
        dataset: { tip: m.texto, "tip-placement": "top" },
        onClick: () => {
          escolha.mode = m.id;
          for (const [k, n] of modos) n.setAttribute("aria-checked", String(k === m.id));
        },
      });
      b.append(icon(m.icon, { size: "sm" }), el("span", { text: m.titulo }));
      modos.set(m.id, b);
      linhaModo.append(b);
    }

    /* -- resolução -- */
    const seletorQ = el("select.input.share__select", { "aria-label": "Qualidade" });
    for (const [id, q] of Object.entries(SCREEN_QUALITY)) {
      seletorQ.append(el("option", { value: id, text: q.label, selected: escolha.quality === id }));
    }
    seletorQ.addEventListener("change", () => (escolha.quality = seletorQ.value));

    card.append(
      el("div.share__campo", {}, [
        el("span.share__rotulo", { text: "Prioridade da imagem" }),
        linhaModo,
      ]),
      el("div.share__campo", {}, [el("span.share__rotulo", { text: "Resolução" }), seletorQ]),
    );

    /* -- som -- */
    if (podeAudio) {
      const toggle = el("button.share__switch", {
        type: "button",
        role: "switch",
        "aria-checked": String(escolha.withAudio),
        "aria-label": "Compartilhar o som",
        onClick: (e) => {
          escolha.withAudio = !escolha.withAudio;
          e.currentTarget.setAttribute("aria-checked", String(escolha.withAudio));
        },
      });
      card.append(
        el("div.share__som", {}, [
          el("span.share__opcaoIcone", {}, [icon("volume-2", { size: "sm" })]),
          el("div.share__texto", {}, [
            el("div.share__nome", { text: "Compartilhar o som" }),
            el("div.share__desc", {
              text: "Para vídeo e música. No Chrome ainda é preciso marcar a caixinha na janela seguinte.",
            }),
          ]),
          toggle,
        ]),
      );
    }

    card.append(
      el("p.share__aviso", {
        text: "A seguir o navegador vai mostrar a lista de telas e janelas — esse passo é dele e não pode ser pulado. Ele já abre na aba que você escolheu aqui.",
      }),
    );

    const cancelar = el("button.btn.btn--ghost", { type: "button", text: "Cancelar" });
    const confirmar = el("button.btn.btn--primary.btn--lg", { type: "button" });
    confirmar.append(icon("screen-share", { size: "sm" }), el("span", { text: "Escolher o que mostrar" }));

    card.append(el("div.share__acoes", {}, [cancelar, confirmar]));
    fundo.append(card);
    document.body.append(fundo);

    let resolvido = false;
    const fechar = (valor) => {
      if (resolvido) return;
      resolvido = true;
      fundo.remove();
      document.removeEventListener("keydown", aoTeclar);
      resolve(valor);
    };

    const aoTeclar = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fechar(null);
      }
    };
    document.addEventListener("keydown", aoTeclar);

    cancelar.addEventListener("click", () => fechar(null));
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo) fechar(null);
    });

    confirmar.addEventListener("click", () => {
      prefs.set("share:surface", escolha.surface);
      prefs.set("screen:quality", escolha.quality);
      prefs.set("share:mode", escolha.mode);
      prefs.set("share:audio", escolha.withAudio);
      /*
       * Fecha ANTES de resolver. A captura precisa ser pedida ainda dentro do
       * clique — o navegador exige "ativação transitória" e recusa o pedido se
       * ele vier depois de outra espera. Remover o painel aqui deixa o caminho
       * livre para `getDisplayMedia` ser chamado no mesmo gesto.
       */
      fechar(escolha);
    });

    requestAnimationFrame(() => confirmar.focus());
  });
}
