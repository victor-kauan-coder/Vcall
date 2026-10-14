/**
 * abrir.js — a página do convite (/abrir#sala).
 *
 * 1. Dentro do próprio aplicativo de mesa: vai direto para a sala.
 * 2. No Android: abre o aplicativo Vcall direto na sala (intent://). Sem o
 *    aplicativo instalado, o Chrome segue sozinho para a sala no navegador;
 *    nos outros navegadores, se nada abrir em 2,5 s, vamos nós para lá.
 *    Dentro do próprio app Android (window.VcallAndroid), direto para a sala.
 * 2b. iPhone e afins: não há aplicativo; vai direto para a sala no navegador.
 * 3. No computador: tenta abrir o aplicativo (vcall://). Se a página perde o
 *    foco logo em seguida, o aplicativo abriu e esta aba pode ser fechada. Se
 *    nada acontecer, os botões continuam ali: entrar pelo navegador ou baixar.
 *
 * A tentativa automática só acontece em navegadores Chromium (Chrome, Edge,
 * Brave, Opera). No Firefox um esquema desconhecido troca a página por uma
 * tela de erro; lá, abrir o aplicativo é sempre pelo botão.
 */
import { ehAndroid, ehCelular, linkDaSala, linkDoAplicativo, linkIntentAndroid, salaDoFragmento } from "./lib/invite.js";

const $ = (s) => document.querySelector(s);
const titulo = $("#titulo");
const texto = $("#texto");
const spinner = $("#spinner");
const abrirApp = $("#abrirApp");
const noNavegador = $("#noNavegador");

// Link curto (/c/CODIGO): o servidor já pôs o id da sala numa <meta>.
const sala = salaDoFragmento(location.hash) || salaDoFragmento(document.querySelector('meta[name="vcall-sala"]')?.content || "");
const encerrado = !!document.querySelector('meta[name="vcall-convite"][content="encerrado"]');

if (!sala) {
  titulo.textContent = encerrado ? "Chamada encerrada" : "Link incompleto";
  texto.textContent = encerrado
    ? "Este convite não está mais ativo. Peça um link novo para quem te chamou."
    : "Este convite não traz o código da sala. Peça o link de novo para quem te convidou.";
  abrirApp.hidden = true;
  noNavegador.textContent = "Ir para o início";
} else {
  const destino = linkDaSala(location.origin, sala);
  const app = linkDoAplicativo(destino);
  noNavegador.href = destino;
  abrirApp.href = app;

  const celular = ehCelular(navigator.userAgent, navigator.maxTouchPoints > 1);
  const dentroDoApp = !!window.vcallDesktop || !!window.VcallAndroid;
  const intent = !dentroDoApp && ehAndroid(navigator.userAgent) ? linkIntentAndroid(destino) : null;

  if (intent) {
    abrirApp.href = intent;
    spinner.hidden = false;
    titulo.textContent = "Abrindo o Vcall…";
    texto.textContent = "A chamada abre no aplicativo. Sem ele, segue aqui pelo navegador.";
    let saiu = false;
    const marcar = () => {
      if (document.visibilityState === "hidden") saiu = true;
    };
    document.addEventListener("visibilitychange", marcar);
    window.addEventListener("pagehide", () => (saiu = true));
    // Na hora, ainda dentro da navegação que veio do toque no link: o Chrome
    // só abre aplicativo sem perguntar quando o pedido nasce de um toque.
    location.href = intent;
    setTimeout(() => {
      spinner.hidden = true;
      if (saiu) {
        titulo.textContent = "Chamada aberta no aplicativo";
        texto.textContent = "Se o Vcall não apareceu, use os botões abaixo.";
      } else {
        location.replace(destino);
      }
    }, 2500);
  } else if (dentroDoApp || celular) {
    location.replace(destino);
  } else {
    let abriu = false;
    const marcarAberto = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) abriu = true;
    };
    window.addEventListener("blur", marcarAberto);
    document.addEventListener("visibilitychange", marcarAberto);

    const tentar = () => {
      abriu = false;
      spinner.hidden = false;
      titulo.textContent = "Abrindo o Vcall…";
      texto.textContent = "Se o navegador perguntar, permita abrir o aplicativo Vcall.";
      location.href = app;
      setTimeout(() => {
        spinner.hidden = true;
        if (abriu) {
          titulo.textContent = "Chamada aberta no aplicativo";
          texto.textContent = "Pode fechar esta aba. Se o Vcall não apareceu, use os botões abaixo.";
        } else {
          titulo.textContent = "Entrar na chamada";
          texto.textContent = "Não encontramos o aplicativo? Entre pelo navegador — funciona igual — ou baixe o Vcall.";
        }
      }, 2200);
    };

    abrirApp.addEventListener("click", (e) => {
      e.preventDefault();
      tentar();
    });

    const chromium = !!navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand));
    // Depois da carga: pedir o esquema externo no meio dela deixa a aba
    // "carregando" para sempre em alguns navegadores.
    if (chromium) {
      const depois = () => setTimeout(tentar, 250);
      if (document.readyState === "complete") depois();
      else window.addEventListener("load", depois, { once: true });
    }
  }
}
