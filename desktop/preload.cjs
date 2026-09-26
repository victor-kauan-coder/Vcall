/**
 * desktop/preload.cjs — a ponte entre a janela e o sistema.
 *
 * Deliberadamente mínima: a página é a mesma do navegador e não ganha poderes
 * por estar no app. O que existe aqui é cosmético — marcar o documento como
 * "desktop" (o CSS abre espaço para os botões da janela e cria a área de
 * arrastar) e manter a cor desses botões de acordo com o tema.
 *
 * .cjs porque o preload roda em CommonJS mesmo num pacote "type": "module".
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vcallDesktop", {
  isDesktop: true,
  info: () => ipcRenderer.invoke("vcall:info"),
  /** Liga/desliga o modo mini-janela (compacta, sempre por cima). */
  mini: (ligar) => ipcRenderer.invoke("vcall:mini", !!ligar),
});

window.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  root.classList.add("is-desktop", `is-${process.platform}`);

  // Faixa invisível no topo para arrastar a janela nas telas sem barra própria.
  const faixa = document.createElement("div");
  faixa.className = "win-drag";
  faixa.setAttribute("aria-hidden", "true");
  document.body.prepend(faixa);

  // O tema da página vale para os botões nativos da janela.
  let ultimo = null;
  const sincronizar = () => {
    const tema = root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const escuro = tema !== "light";
    if (escuro !== ultimo) ipcRenderer.send("vcall:tema", (ultimo = escuro));
  };
  new MutationObserver(sincronizar).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", sincronizar);
  sincronizar();
});
