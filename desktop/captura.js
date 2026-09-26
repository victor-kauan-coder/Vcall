/**
 * desktop/captura.js — a parte do compartilhamento de tela que dá para testar.
 *
 * O handler do Electron (desktop/main.js) só junta as peças; as decisões
 * ficam aqui, em funções puras, sem importar o Electron. Assim o
 * scripts/fixes-test.mjs verifica em Node, em qualquer sistema, os três
 * problemas que já aconteceram:
 *
 *   - o Linux não compartilhava porque a resposta levava `audio: undefined`;
 *   - só dava para compartilhar a tela inteira;
 *   - o som do sistema ia junto sem a pessoa pedir (e trazia a própria
 *     chamada de volta, em eco).
 */

/** A sessão gráfica é Wayland? Lá quem escolhe a tela é o portal do sistema. */
export function sessaoWayland(env = process.env) {
  return String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || !!env.WAYLAND_DISPLAY;
}

/** Plataformas em que o Chromium captura o som do sistema ("loopback"). */
export function audioDoSistemaSuportado(plataforma) {
  return plataforma === "win32";
}

/**
 * Transforma a lista do desktopCapturer em algo que atravessa o IPC e que a
 * página sabe desenhar. Tira a própria janela do Vcall da lista: compartilhar
 * a chamada dentro da chamada é o efeito "sala de espelhos".
 *
 * @param {Array<{id:string,name:string,thumbnail?:any,appIcon?:any,display_id?:string}>} fontes
 * @param {{propria?: string|null}} opts id de mídia da janela do Vcall
 */
export function descreverFontes(fontes, { propria = null } = {}) {
  const imagem = (img) => {
    if (!img || typeof img.toDataURL !== "function") return null;
    if (typeof img.isEmpty === "function" && img.isEmpty()) return null;
    return img.toDataURL();
  };
  const semSufixo = (id) => String(id || "").split(":").slice(0, 2).join(":");
  const minha = propria ? semSufixo(propria) : null;

  const lista = [];
  for (const f of fontes || []) {
    if (!f?.id) continue;
    const tipo = f.id.startsWith("screen:") ? "screen" : "window";
    if (tipo === "window" && minha && semSufixo(f.id) === minha) continue;
    // Janelas sem título costumam ser camadas invisíveis do sistema.
    if (tipo === "window" && !String(f.name || "").trim()) continue;
    lista.push({
      id: f.id,
      tipo,
      nome: String(f.name || (tipo === "screen" ? "Tela" : "Janela")),
      miniatura: imagem(f.thumbnail),
      icone: imagem(f.appIcon),
    });
  }
  // Telas primeiro (a pessoa costuma começar por elas), numeradas de forma
  // legível quando o sistema só diz "Screen 1"/"Entire screen".
  const telas = lista.filter((f) => f.tipo === "screen");
  telas.forEach((t, i) => {
    if (telas.length > 1 || /^(entire screen|screen \d+)$/i.test(t.nome)) t.nome = `Tela ${i + 1}`;
  });
  return [...telas, ...lista.filter((f) => f.tipo === "window")];
}

/**
 * Monta a resposta do setDisplayMediaRequestHandler.
 *
 * Regras:
 *   - a fonte é a que a pessoa escolheu; sem escolha (ou no Wayland, em que o
 *     portal já escolheu), a primeira que o sistema devolveu;
 *   - `audio` só entra no objeto quando tem valor — a chave presente com
 *     `undefined` faz o Electron lançar erro;
 *   - som do sistema só com pedido explícito, só onde existe (Windows) e só
 *     se a página pediu áudio.
 *
 * @returns {{video?: object, audio?: "loopback"}} `{}` recusa a captura.
 */
export function montarResposta({ fontes, escolha = null, pedido = {}, plataforma = process.platform }) {
  const lista = fontes || [];
  let video = null;
  if (escolha?.id) video = lista.find((f) => f.id === escolha.id) || null;
  // A janela escolhida pode ter sido fechada entre a escolha e o pedido.
  if (!video && escolha?.id) return {};
  if (!video) video = lista[0] || null;
  if (!video) return {};

  const resposta = { video };
  if (escolha?.audio && pedido.audioRequested && audioDoSistemaSuportado(plataforma)) {
    resposta.audio = "loopback";
  }
  return resposta;
}
