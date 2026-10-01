/**
 * ui/ilustracao.js — põe a ilustração DENTRO da página, para o tema alcançá-la.
 *
 * Um SVG carregado por `<img src="...">` é um documento isolado: o CSS da
 * página não entra, `currentColor` não vale, nenhuma variável atravessa. Era
 * por isso que as ilustrações continuavam claras no tema escuro, com um painel
 * branco no meio de uma tela preta.
 *
 * Trazendo o SVG para dentro do documento, os `var(--ilu-*)` que
 * scripts/ilustracoes.mjs gravou passam a ser resolvidos pelo tema vigente — e
 * trocar de tema ou de paleta repinta o desenho na hora, sem recarregar nada.
 *
 * O custo é uma requisição a mais na primeira vez. O cache abaixo garante que
 * seja uma só por arquivo, mesmo que a mesma ilustração apareça duas vezes.
 */
import { el } from "../lib/dom.js";

/** nome -> Promise<string> com o conteúdo do SVG. */
const cache = new Map();

function buscar(nome) {
  if (!cache.has(nome)) {
    cache.set(
      nome,
      /*
       * Sem `force-cache`: ele entrega a cópia guardada mesmo vencida, e uma
       * ilustração editada continuava aparecendo na versão antiga até alguém
       * limpar o cache à mão. O cache normal do navegador já revalida e é o
       * suficiente — o arquivo é pequeno e vem do servidor local.
       */
      fetch(`/assets/illustrations/${nome}.svg`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .catch(() => null),
    );
  }
  return cache.get(nome);
}

/**
 * Devolve um contêiner que recebe a ilustração assim que ela chega.
 *
 * Síncrono de propósito: quem chama monta a árvore inteira de uma vez, e a
 * imagem entra depois sem mexer no layout — por isso a proporção já vai no
 * contêiner, e não há salto quando o desenho aparece.
 *
 * @param {string} nome    hero | empty | calling
 * @param {object} opcoes  { largura, altura, classe }
 */
export function ilustracao(nome, { largura, altura, classe = "" } = {}) {
  const caixa = el(`div.ilu${classe ? `.${classe}` : ""}`, {
    "aria-hidden": "true",
    style: {
      // Reserva o espaço antes de o SVG chegar: sem isto a página salta.
      aspectRatio: largura && altura ? `${largura} / ${altura}` : "auto",
      width: largura ? `${largura}px` : "100%",
      maxWidth: "100%",
    },
  });

  buscar(nome).then((texto) => {
    if (!texto) {
      /*
       * Falhou a busca: volta para a imagem comum. Ela não acompanha o tema,
       * mas uma ilustração clara é melhor que um buraco no meio da tela.
       */
      caixa.append(
        el("img", { src: `/assets/illustrations/${nome}.svg`, alt: "", width: largura, height: altura }),
      );
      return;
    }
    caixa.innerHTML = texto;
    const svg = caixa.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");
    }
  });

  return caixa;
}
