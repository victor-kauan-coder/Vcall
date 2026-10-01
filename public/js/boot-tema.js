/**
 * js/boot-tema.js — tema e paleta antes da primeira pintura.
 *
 * ARQUIVO SEPARADO, E NÃO UM <script> NO HTML, por causa da política de
 * segurança de conteúdo: o servidor manda `script-src 'self'`, que recusa
 * script embutido. Enfraquecer a política com 'unsafe-inline' para economizar
 * um arquivo seria trocar uma defesa real contra injeção por conveniência.
 *
 * Carregado sem `defer` de propósito: ele PRECISA rodar antes de o navegador
 * pintar, senão a tela aparece com o padrão e repinta quando o app carrega —
 * o lampejo branco que se vê ao abrir um programa de tema escuro.
 */
try {
  // prefs grava em JSON, então "dark" chega como '"dark"'.
  const ler = (k) => JSON.parse(localStorage.getItem("vcall:" + k) || "null");
  const r = document.documentElement;
  const t = ler("theme");
  if (t === "dark" || t === "light") r.setAttribute("data-theme", t);
  r.setAttribute("data-paleta", ler("paleta") || "tinta");
} catch {
  document.documentElement.setAttribute("data-paleta", "tinta");
}

/*
 * A janela sem barra de título.
 *
 * Dois ambientes ligam a sobreposição de controles por caminhos diferentes, e
 * só um deles anuncia o `display-mode`:
 *
 *   - PWA instalado: `(display-mode: window-controls-overlay)` casa.
 *   - Electron (`titleBarStyle: "hidden"`): a API liga e `env(titlebar-area-*)`
 *     funciona, mas o display-mode continua sendo outro. Medido, não suposto.
 *
 * Então quem decide é o JavaScript, e o CSS pende de um atributo só. Sem isto
 * as regras da faixa arrastável nunca valeriam no aplicativo de mesa — que é
 * justamente onde a barra de título precisava sumir.
 */
try {
  const raiz = document.documentElement;
  const marcar = () => {
    const ligada =
      Boolean(navigator.windowControlsOverlay?.visible) ||
      matchMedia("(display-mode: window-controls-overlay)").matches;
    raiz.toggleAttribute("data-sem-barra", ligada);
  };
  marcar();
  // A sobreposição some ao entrar em tela cheia e volta ao sair.
  navigator.windowControlsOverlay?.addEventListener?.("geometrychange", marcar);
  matchMedia("(display-mode: window-controls-overlay)").addEventListener?.("change", marcar);
} catch {
  /* navegador comum: a barra do navegador fica, que é o esperado */
}
