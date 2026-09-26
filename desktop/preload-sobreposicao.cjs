/**
 * desktop/preload-sobreposicao.cjs — a ponte da janela de sobreposição.
 *
 * Só recebe: quem está na chamada, quem fala e em que canto ficar. Não manda
 * nada de volta — a sobreposição não tem controle nenhum, é só um espelho.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vcallSobreposicao", {
  aoEstado: (fn) => ipcRenderer.on("vcall:estado", (_e, estado) => fn(estado)),
  aoCanto: (fn) => ipcRenderer.on("vcall:canto", (_e, canto) => fn(String(canto))),
});
