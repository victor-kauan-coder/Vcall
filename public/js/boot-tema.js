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
