/**
 * abrir.js — a página do convite (/abrir#sala).
 *
 * 1. Dentro do próprio aplicativo de mesa: vai direto para a sala.
 * 2. No celular: não existe app de mesa; vai direto para a sala no navegador.
 * 3. No computador: tenta abrir o aplicativo (vcall://). Se a página perde o
 *    foco logo em seguida, o aplicativo abriu e esta aba pode ser fechada. Se
 *    nada acontecer, os botões continuam ali: entrar pelo navegador ou baixar.
 *
 * A tentativa automática só acontece em navegadores Chromium (Chrome, Edge,
 * Brave, Opera). No Firefox um esquema desconhecido troca a página por uma
 * tela de erro; lá, abrir o aplicativo é sempre pelo botão.
 */
import { ehCelular, linkDaSala, linkDoAplicativo, salaDoFragmento } from "./lib/invite.js";

const $ = (s) => document.querySelector(s);
const titulo = $("#titulo");
const texto = $("#texto");
const spinner = $("#spinner");
const abrirApp = $("#abrirApp");
const noNavegador = $("#noNavegador");

const sala = salaDoFragmento(location.hash);

if (!sala) {
  titulo.textContent = "Link incompleto";
  texto.textContent = "Este convite não traz o código da sala. Peça o link de novo para quem te convidou.";
  abrirApp.hidden = true;
  noNavegador.textContent = "Ir para o início";
} else {
  const destino = linkDaSala(location.origin, sala);
  const app = linkDoAplicativo(destino);
  noNavegador.href = destino;
  abrirApp.href = app;

  const celular = ehCelular(navigator.userAgent, navigator.maxTouchPoints > 1);
  const dentroDoApp = !!window.vcallDesktop;

  if (dentroDoApp || celular) {
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
