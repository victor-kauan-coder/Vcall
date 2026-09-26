/**
 * ui/lightbox.js — ver o anexo sem baixar.
 *
 * Antes, um arquivo que chegava na conversa só tinha um caminho: baixar,
 * procurar na pasta de downloads, abrir em outro programa, voltar para a
 * chamada. Para uma captura de tela que a pessoa mandou "olha esse erro
 * aqui", isso é trabalho demais para um olhar de dois segundos.
 *
 * O arquivo já está na memória do navegador — chegou pelo DataChannel e virou
 * um endereço `blob:`. Mostrá-lo não custa rede nenhuma: é só desenhar o que
 * já está aqui.
 *
 * Imagem, vídeo, som, PDF e texto abrem aqui dentro. O que o navegador não
 * sabe desenhar continua tendo o botão de baixar, que é a resposta honesta
 * para um `.zip`.
 */
import { el, icon, on } from "../lib/dom.js";

/** O que o navegador desenha sem ajuda de nada. */
export function podeVisualizar(mime = "") {
  const t = String(mime).toLowerCase();
  return (
    t.startsWith("image/") ||
    t.startsWith("video/") ||
    t.startsWith("audio/") ||
    t === "application/pdf" ||
    t.startsWith("text/")
  );
}

function conteudo(arquivo) {
  const t = String(arquivo.mime || "").toLowerCase();

  if (t.startsWith("image/")) {
    return el("img.lightbox__img", { src: arquivo.url, alt: arquivo.name });
  }
  if (t.startsWith("video/")) {
    return el("video.lightbox__video", {
      src: arquivo.url,
      controls: true,
      autoplay: true,
      playsInline: true,
    });
  }
  if (t.startsWith("audio/")) {
    return el("div.lightbox__audio", {}, [
      el("span.lightbox__audioIcone", {}, [icon("volume-2", { size: "xl" })]),
      el("audio", { src: arquivo.url, controls: true, autoplay: true }),
    ]);
  }
  if (t === "application/pdf") {
    /*
     * <embed> e não <iframe>: a política de segurança desta página proíbe
     * enquadrar documentos, e o leitor de PDF do navegador entra por aqui sem
     * esbarrar nela.
     */
    return el("embed.lightbox__pdf", { src: arquivo.url, type: "application/pdf" });
  }
  // Texto: buscado do próprio blob, que já está em memória.
  const pre = el("pre.lightbox__texto", { text: "carregando…" });
  fetch(arquivo.url)
    .then((r) => r.text())
    .then((t2) => (pre.textContent = t2.slice(0, 200_000)))
    .catch(() => (pre.textContent = "não consegui ler este arquivo"));
  return pre;
}

/**
 * Abre o visualizador.
 *
 * @param {{url:string, name:string, mime:string, size?:number}} arquivo
 */
export function abrirVisualizador(arquivo) {
  if (!arquivo?.url) return null;

  const fundo = el("div.lightbox", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `Visualizando ${arquivo.name}`,
  });

  const baixar = el("a.btn.btn--ghost", {
    href: arquivo.url,
    download: arquivo.name,
    title: "Baixar",
  });
  baixar.append(icon("download", { size: "sm" }), el("span", { text: "Baixar" }));

  const fechar = el("button.btn.btn--icon.btn--ghost", {
    type: "button",
    "aria-label": "Fechar",
  });
  fechar.append(icon("x", { size: "sm" }));

  const barra = el("div.lightbox__barra", {}, [
    el("span.lightbox__nome.truncate", { text: arquivo.name }),
    el("span.spacer"),
    baixar,
    fechar,
  ]);

  const palco = el("div.lightbox__palco", {}, [conteudo(arquivo)]);
  fundo.append(barra, palco);
  document.body.append(fundo);

  let aberto = true;
  const sair = () => {
    if (!aberto) return;
    aberto = false;
    // Um vídeo ou som que continua tocando depois de fechado é o defeito mais
    // irritante que um visualizador pode ter.
    for (const m of fundo.querySelectorAll("video, audio")) {
      try {
        m.pause();
        m.src = "";
      } catch {
        /* já descartado */
      }
    }
    fundo.remove();
    limpar();
  };

  const limpar = on(document, "keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      sair();
    }
  });

  fechar.addEventListener("click", sair);
  // Clique no fundo fecha; clique no conteúdo, não — senão dar zoom numa
  // imagem grande fecharia a janela sem querer.
  fundo.addEventListener("click", (e) => {
    if (e.target === fundo || e.target === palco) sair();
  });

  return sair;
}
