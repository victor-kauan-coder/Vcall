/**
 * ui/tela-erro.js — a tela de quando a sala não abre ou cai.
 *
 * Mesma família da tela "Você saiu" (.leave em call.css): cartão com a
 * ilustração, título na voz da marca, uma frase que diz o que houve e o que
 * fazer. A ilustração são as duas pessoas da logo com o cabo desencaixado, e
 * tudo segue a paleta escolhida.
 *
 * Usada em public/erro.html (o link não abriu: túnel da Cloudflare fora do ar,
 * sem internet…) e por cima da chamada quando a sala cai de vez.
 */
import { el, icon } from "../lib/dom.js";
import { ilustracao } from "./ilustracao.js";

/** O que aconteceu, em português de gente, e o que a pessoa pode fazer. */
export const TIPOS = {
  tunel: {
    titulo: "A sala saiu do ar",
    texto:
      "O Vcall de quem te convidou foi fechado, ou o computador dele perdeu a internet. Se a sala voltar, você entra sozinho; se não, peça um link novo.",
  },
  internet: {
    titulo: "Você está sem internet",
    texto: "Confira o Wi-Fi ou os dados móveis. Assim que a conexão voltar, o Vcall tenta de novo sozinho.",
  },
  demora: {
    titulo: "A sala está demorando para responder",
    texto: "A conexão até o computador de quem te convidou está lenta. O Vcall tenta de novo em instantes.",
  },
  servidor: {
    titulo: "A sala respondeu com um erro",
    texto: "Algo falhou no Vcall de quem te convidou. Tentar de novo costuma resolver.",
  },
  caiu: {
    titulo: "A conexão com a sala caiu",
    texto:
      "Você ficou sem ligação com a sala e com as outras pessoas. O Vcall está tentando voltar sozinho; se quem convidou fechou o programa, peça um link novo.",
  },
};

/** Espera entre as tentativas automáticas: logo, depois com mais calma. */
const ESPERAS_S = [8, 15, 30, 60];

/**
 * Monta a tela. Quem chama decide onde ela entra e o que cada botão faz.
 *
 * @param {object} o
 * @param {keyof TIPOS} o.tipo
 * @param {string} [o.codigo]          código técnico, para quem for pedir ajuda
 * @param {() => Promise<boolean>} [o.sondar]  a sala voltou? (sem ele, não tenta sozinho)
 * @param {() => void} o.aoTentar     entrar de novo
 * @param {() => void} o.aoVoltar     ir para o início
 * @param {string} [o.rotuloVoltar]
 */
export function montarTelaDeErro({ tipo, codigo = "", sondar = null, aoTentar, aoVoltar, rotuloVoltar = "Voltar ao início" }) {
  const t = TIPOS[tipo] || TIPOS.tunel;
  const estado = el("p.erro__estado", { role: "status", "aria-live": "polite" });
  const tentar = el("button.btn.btn--primary.btn--lg", { type: "button" }, [icon("refresh-cw"), el("span", { text: "Tentar de novo" })]);

  const tela = el("main.leave.erro", { "aria-labelledby": "erroTitulo", dataset: { tipo } }, [
    el("div.leave__art", { "aria-hidden": "true" }, [ilustracao("desconectado", { largura: 280, altura: 182 })]),
    el("div.leave__body", {}, [
      el("img.brand__mark", { src: "/assets/logo-mark.svg", alt: "", width: 48, height: 48 }),
      el("h1.leave__title", { id: "erroTitulo", text: t.titulo }),
      el("p.leave__lead", { text: t.texto }),
      estado,
      el("div.leave__actions", {}, [
        tentar,
        el("button.btn.btn--lg", { type: "button", onClick: aoVoltar }, [el("span", { text: rotuloVoltar })]),
      ]),
      codigo ? el("p.erro__codigo", { text: `Código do erro: ${codigo}` }) : null,
    ]),
  ]);

  // Tentar só abre a sala se ela respondeu; senão a pessoa veria a mesma
  // página de erro piscando a cada tentativa.
  let ocupado = false;
  async function tentarAgora() {
    if (ocupado) return;
    ocupado = true;
    tentar.disabled = true;
    estado.textContent = "Procurando a sala…";
    const voltou = sondar ? await sondar().catch(() => false) : true;
    ocupado = false;
    tentar.disabled = false;
    if (voltou) {
      estado.textContent = "A sala voltou. Entrando…";
      aoTentar();
      return true;
    }
    estado.textContent = navigator.onLine === false ? "Ainda sem internet." : "A sala ainda não respondeu.";
    return false;
  }
  tentar.addEventListener("click", () => {
    tentarAgora().then((ok) => ok || agendar());
  });

  // Tentativas sozinhas: sem internet, espera a conexão voltar; nos outros
  // casos, conta o tempo na tela para a pessoa saber que algo está andando.
  let rodada = 0;
  let relogio = 0;
  function agendar() {
    clearInterval(relogio);
    if (!sondar || !tela.isConnected) return;
    if (navigator.onLine === false) {
      estado.textContent = "Esperando a internet voltar…";
      return;
    }
    let falta = ESPERAS_S[Math.min(rodada, ESPERAS_S.length - 1)];
    rodada += 1;
    const mostrar = () => (estado.textContent = `Tentando de novo em ${falta} s…`);
    mostrar();
    relogio = setInterval(async () => {
      if (!tela.isConnected) return clearInterval(relogio);
      falta -= 1;
      if (falta > 0) return mostrar();
      clearInterval(relogio);
      if (!(await tentarAgora())) agendar();
    }, 1000);
  }
  window.addEventListener("online", () => tentarAgora().then((ok) => ok || agendar()));
  window.addEventListener("offline", () => agendar());
  queueMicrotask(agendar);
  return tela;
}

/** Classifica um código HTTP (ou de rede) no tipo de tela. */
export function tipoDoCodigo(codigo, online = true) {
  if (!online) return "internet";
  const c = Number(codigo);
  if (c === 504 || c === 524) return "demora";
  if (c === 502 || c === 503 || c === 530 || (c >= 520 && c <= 527)) return "tunel";
  if (c >= 500) return "servidor";
  return "tunel";
}
