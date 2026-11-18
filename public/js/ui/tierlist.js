/**
 * ui/tierlist.js — a tela da Tier List. A lógica está em features/tierlist.js.
 *
 * Três telas, uma por fase:
 *
 *   - MONTAR: o título grande e editável, as faixas como ficarão (nome, cor,
 *     subir, descer, tirar), e ao lado o painel de personalizar: estilo dos
 *     nomes, paleta e os itens, com emoji. Tudo o que um muda aparece para
 *     todos na hora.
 *   - RANQUEAR: a SUA lista. Arrasta o item do banco para a faixa (mouse ou
 *     dedo), ou toca no item e depois na faixa, ou usa as teclas 1 a 8. Em
 *     cima, quem já terminou.
 *   - REVELADA: a tier list da galera entrando de baixo para cima, cada item
 *     com a barrinha de como a turma votou, e os destaques: o mais polêmico,
 *     as unanimidades, as almas gêmeas e quem é do contra. Dá para ver a
 *     lista de cada um, baixar a imagem e copiar como texto.
 *
 * Os campos de texto nunca são refeitos enquanto têm o foco, e o arrasto não
 * é interrompido quando outra pessoa joga: cada parte tem a sua assinatura e
 * só é redesenhada quando ela muda (sincronizar, de ui/jogos-comum.js).
 */
import { el, emoji, icon } from "../lib/dom.js";
import {
  EMOJI_TIER,
  ESCALAS,
  ESTILOS,
  MAX_ITENS,
  MAX_PEDACOS_IMG,
  MAX_PERGUNTAS,
  MAX_TIERS,
  MIN_TIERS,
  MODOS,
  PALETAS,
  PEDACO_IMG,
  PERGUNTAS_PRONTAS,
  TEMAS,
  completo,
  faixaPorNota,
  matiz,
  notaDoItem,
  tintaPara,
} from "../features/tierlist.js";
import { Vista, botao, porChave, rosto, selo, sincronizar, trocar } from "./jogos-comum.js";

/** "Pão de queijo" -> "PQ": o ladrilho de quem não tem emoji. */
function sigla(t) {
  const palavras = String(t).replace(/["“”]/g, "").split(/\s+/).filter((p) => p.length > 2 || /^\d/.test(p));
  const base = palavras.length ? palavras : String(t).split(/\s+/);
  return base
    .slice(0, 2)
    .map((p) => [...p][0] || "")
    .join("")
    .toUpperCase();
}

/** A arte do ladrilho: a foto, o emoji ou a sigla. */
function arte(it, tamEmoji = 34) {
  if (it.img) return el("img.tl-item__foto", { src: it.img, alt: "", draggable: false, decoding: "async" });
  return it.e ? emoji(it.e, { size: tamEmoji, className: "tl-item__emoji" }) : el("span.tl-item__sigla", { text: sigla(it.t) });
}

/** O ladrilho de um item: a foto (ou emoji, ou a sigla) num degradê da cor do item, e o nome embaixo. */
function ladrilho(it, { tag = "button", classe = "", extra = null, attrs = {}, nota = null } = {}) {
  return el(`${tag}.tl-item${classe ? `.${classe}` : ""}`, { type: tag === "button" ? "button" : null, title: it.t, "aria-label": nota == null ? it.t : `${it.t}, nota ${fmt(nota)}`, style: { "--h": it.h }, dataset: { item: it.id }, class: it.img ? "tem-foto" : "", ...attrs }, [
    el("span.tl-item__arte", { "aria-hidden": "true" }, [arte(it)]),
    el("span.tl-item__nome", { text: it.t }),
    nota == null ? null : el("span.tl-item__nota", { text: fmt(nota), "aria-hidden": "true" }),
    extra,
  ]);
}

/** 8.333 -> "8,3" (vírgula, como se escreve no Brasil). */
const fmt = (n) => (n == null ? "–" : (Math.round(n * 10) / 10).toFixed(1).replace(".", ",").replace(",0", ""));

/** A cor de uma nota: do vermelho (a menor) ao verde (a maior). */
const corDaNota = (n, escala) => {
  const { min, max } = ESCALAS[escala] || ESCALAS[10];
  return `hsl(${Math.round(((n - min) / (max - min)) * 125)} 72% 46%)`;
};

/*
 * A foto vira uma miniatura quadrada (corte no centro) de 128 px, em WebP
 * (ou JPEG, onde o navegador não grava WebP), com a qualidade baixando até
 * caber no limite. É ela que viaja para todos: alguns KB, não a foto inteira.
 */
const LIMITE_IMG = PEDACO_IMG * MAX_PEDACOS_IMG;
export async function miniatura(arquivo, lado = 128) {
  if (!arquivo || !/^image\//.test(arquivo.type || "") || arquivo.size > 40 * 1024 * 1024) return null;
  let bmp;
  try {
    bmp = await createImageBitmap(arquivo);
  } catch {
    return null;
  }
  const cv = document.createElement("canvas");
  cv.width = cv.height = lado;
  const ctx = cv.getContext("2d");
  const q = Math.min(bmp.width, bmp.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - q) / 2, (bmp.height - q) / 2, q, q, 0, 0, lado, lado);
  bmp.close?.();
  for (const tipo of ["image/webp", "image/jpeg"]) {
    for (const qualidade of [0.85, 0.72, 0.6, 0.45]) {
      const url = cv.toDataURL(tipo, qualidade);
      if (url.startsWith(`data:${tipo};`) && url.length <= LIMITE_IMG) return url;
    }
  }
  return lado > 72 ? miniatura(arquivo, 72) : null;
}

/** "foto_do-gato.final.JPG" -> "foto do gato.final" (o nome do item quando vem só a foto). */
const nomeDoArquivo = (n) =>
  String(n || "Imagem")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "Imagem";

/** O rótulo colorido de uma faixa (só leitura). */
function rotulo(t, i) {
  const n = t.n || "";
  return el("div.tl-faixa__rotulo", { style: { "--cor": t.c, "--tinta": tintaPara(t.c) }, dataset: { tam: n.length > 6 ? "p" : n.length > 2 ? "m" : "g" } }, [el("span.tl-faixa__nome", { text: n || `${i + 1}` })]);
}

/** As faixas a partir de um mapa item -> faixa. */
function agrupar(itens, nTiers, p) {
  const faixas = Array.from({ length: nTiers }, () => []);
  const banco = [];
  for (const it of itens) {
    const t = p?.[it.id];
    if (Number.isInteger(t) && t >= 0 && t < nTiers) faixas[t].push(it);
    else banco.push(it);
  }
  return { faixas, banco };
}

/* ------------------------------------------------------------------ *
 * A imagem para baixar (canvas)
 * ------------------------------------------------------------------ */

let spriteEmoji = null;
/** Os emoji do sprite como imagens, para desenhar no canvas. */
async function imagensDosEmoji(nomes) {
  const mapa = new Map();
  try {
    spriteEmoji ??= fetch("/vendor/emoji.svg").then((r) => r.text());
    const doc = new DOMParser().parseFromString(await spriteEmoji, "image/svg+xml");
    await Promise.all(
      [...new Set(nomes)].map(async (nome) => {
        const s = doc.getElementById(`e-${nome}`);
        if (!s) return;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.getAttribute("viewBox") || "0 0 32 32"}" width="96" height="96">${s.innerHTML}</svg>`;
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        URL.revokeObjectURL(url);
        if (img.naturalWidth) mapa.set(nome, img);
      }),
    );
  } catch {
    /* sem emoji, a imagem sai com as siglas */
  }
  return mapa;
}

function retangulo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

/** Desenha a tier list numa imagem PNG (sempre no tema escuro, para ficar bonita no WhatsApp). */
export async function imagemDaLista({ titulo, subtitulo, tiers, faixas, notas = false }) {
  const LARG = 1200;
  const ROT = 150;
  const LAD = 104;
  const VAO = 10;
  const MARGEM = 40;
  const porLinha = Math.max(1, Math.floor((LARG - MARGEM * 2 - ROT - VAO) / (LAD + VAO)));
  const alturas = faixas.map((f) => Math.max(1, Math.ceil(f.length / porLinha)) * (LAD + VAO) + VAO);
  const TOPO = 150;
  const altura = TOPO + alturas.reduce((a, b) => a + b + 6, 0) + 70;
  const cv = document.createElement("canvas");
  cv.width = LARG;
  cv.height = altura;
  const ctx = cv.getContext("2d");
  const fonte = (peso, px) => `${peso} ${px}px "Bricolage Grotesque", system-ui, sans-serif`;
  const imgs = await imagensDosEmoji(faixas.flat().map((x) => x.e).filter(Boolean));
  // As fotos dos itens (já são data URL; só precisam carregar).
  const fotos = new Map();
  await Promise.all(
    faixas.flat().filter((x) => x.img).map(async (x) => {
      const im = new Image();
      im.src = x.img;
      await im.decode().catch(() => {});
      if (im.naturalWidth) fotos.set(x.id, im);
    }),
  );

  ctx.fillStyle = "#0c0e13";
  ctx.fillRect(0, 0, LARG, altura);
  const brilho = ctx.createRadialGradient(LARG * 0.85, 0, 10, LARG * 0.85, 0, 520);
  brilho.addColorStop(0, "rgba(253,77,135,0.35)");
  brilho.addColorStop(1, "rgba(253,77,135,0)");
  ctx.fillStyle = brilho;
  ctx.fillRect(0, 0, LARG, altura);

  ctx.fillStyle = "#e9edf5";
  ctx.font = fonte(800, 52);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(titulo, MARGEM, 92, LARG - MARGEM * 2);
  ctx.fillStyle = "#a8b1c2";
  ctx.font = fonte(500, 22);
  ctx.fillText(subtitulo, MARGEM, 128, LARG - MARGEM * 2);

  let y = TOPO;
  faixas.forEach((lista, i) => {
    const h = alturas[i];
    const t = tiers[i];
    ctx.fillStyle = "#181c24";
    retangulo(ctx, MARGEM, y, LARG - MARGEM * 2, h, 14);
    ctx.fill();
    ctx.fillStyle = t.c;
    retangulo(ctx, MARGEM, y, ROT, h, 14);
    ctx.fill();
    ctx.fillStyle = tintaPara(t.c);
    const n = t.n || String(i + 1);
    ctx.font = fonte(800, n.length > 6 ? 24 : n.length > 2 ? 32 : 56);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n, MARGEM + ROT / 2, y + h / 2, ROT - 16);
    ctx.textAlign = "left";
    lista.forEach((it, k) => {
      const x = MARGEM + ROT + VAO + (k % porLinha) * (LAD + VAO);
      const yy = y + VAO + Math.floor(k / porLinha) * (LAD + VAO);
      const g = ctx.createLinearGradient(x, yy, x + LAD, yy + LAD);
      g.addColorStop(0, `hsl(${it.h} 78% 62%)`);
      g.addColorStop(1, `hsl(${(it.h + 40) % 360} 82% 48%)`);
      ctx.fillStyle = g;
      retangulo(ctx, x, yy, LAD, LAD, 16);
      ctx.fill();
      const foto = fotos.get(it.id);
      const img = it.e && imgs.get(it.e);
      if (foto) {
        ctx.save();
        retangulo(ctx, x, yy, LAD, LAD, 16);
        ctx.clip();
        ctx.drawImage(foto, x, yy, LAD, LAD);
        ctx.restore();
      } else if (img) ctx.drawImage(img, x + LAD / 2 - 24, yy + 12, 48, 48);
      else {
        ctx.fillStyle = "#ffffff";
        ctx.font = fonte(800, 34);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sigla(it.t), x + LAD / 2, yy + 38);
        ctx.textAlign = "left";
      }
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      retangulo(ctx, x + 4, yy + LAD - 32, LAD - 8, 28, 10);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = fonte(700, 14);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const nome = it.t.length > 14 ? `${it.t.slice(0, 13)}…` : it.t;
      ctx.fillText(nome, x + LAD / 2, yy + LAD - 18, LAD - 12);
      if (notas && it.vista != null) {
        ctx.fillStyle = "rgba(12,14,19,0.82)";
        retangulo(ctx, x + LAD - 46, yy + 6, 40, 24, 12);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = fonte(800, 14);
        ctx.fillText(fmt(it.vista), x + LAD - 26, yy + 18);
      }
      ctx.textAlign = "left";
    });
    y += h + 6;
  });
  ctx.fillStyle = "#8b97ac";
  ctx.font = fonte(600, 18);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Feito numa chamada do Vcall", MARGEM, altura - 28);
  return new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
}

/* ------------------------------------------------------------------ *
 * A tela
 * ------------------------------------------------------------------ */

export class VistaTierList extends Vista {
  /** O item escolhido para colocar com um toque (ou o detalhe, na revelada). */
  #sel = null;
  /** De quem é a lista que estou vendo na revelada: "galera" ou o id. */
  #ver = "galera";
  /** A rodada cuja revelação já animou (e festejou). */
  #animada = "";
  #emojiNovo = null;
  #arrasto = null;

  montar() {
    this.raiz = el("div.tl-raiz");
    this.c.corpo.append(this.raiz);
    this.ouvir(document, "keydown", (e) => {
      if (e.key === "Escape" && this.#sel) {
        this.#sel = null;
        this.desenhar();
      }
    });
    // O seletor de emoji fecha ao tocar fora dele.
    this.ouvir(document, "pointerdown", (e) => {
      if (this.p?.emojiGrade && !this.p.emojiGrade.hidden && !e.target.closest(".tl-novo")) this.#alternarEmoji(false);
    });
    this.aoDestruir(() => this.#arrasto?.cancelar());
  }

  relogio() {
    return this.l.fase()?.f === "ranquear" && !this.l.revelada();
  }

  tique() {
    this.l.manter(this.pessoas());
  }

  desenhar() {
    const pessoas = this.pessoas();
    const v = this.l.vista(pessoas);
    if (v.fase === "lobby") {
      this.p = null;
      trocar(this.raiz, "lobby", () => this.#lobby());
      return;
    }
    const sig = `${v.fase}|${v.l}|${v.r}`;
    if (!this.p || this.p.sig !== sig || !this.p.no.isConnected) {
      if (this.#arrasto) return; // termina o arrasto antes de trocar de tela
      this.#sel = null;
      this.#ver = "galera";
      this.p = { sig };
      trocar(this.raiz, sig, () => {
        this.p.no = v.fase === "montar" ? this.#montarMontagem(v) : v.fase === "ranquear" ? (v.modo === "notas" ? this.#montarEnquete(v) : this.#montarRanquear(v)) : this.#montarRevelada(v);
        return this.p.no;
      });
    }
    if (v.fase === "montar") this.#desenharMontagem(v);
    else if (v.fase === "ranquear") (v.modo === "notas" ? this.#desenharEnquete(v, pessoas) : this.#desenharRanquear(v, pessoas));
    else this.#desenharRevelada(v, pessoas);
  }

  /* ------------------------------ abertura ------------------------------ */

  #lobby() {
    const temas = Object.entries(TEMAS).map(([id, t]) =>
      el("button.tl-tema", { type: "button", style: { "--h": matiz(t.nome) }, onClick: () => this.l.nova(id) }, [
        el("span.tl-tema__arte", { "aria-hidden": "true" }, [emoji(t.e, { size: 44 })]),
        el("span.tl-tema__texto", {}, [el("strong", { text: t.nome }), el("span.tl-tema__mini", {}, t.itens.filter((x) => x[1]).slice(0, 5).map((x) => emoji(x[1], { size: 18 })))]),
      ]),
    );
    const zero = el("button.tl-tema.tl-tema--zero", { type: "button", onClick: () => this.l.nova(null) }, [
      el("span.tl-tema__arte", { "aria-hidden": "true" }, [icon("wand-sparkles")]),
      el("span.tl-tema__texto", {}, [el("strong", { text: "Começar do zero" }), el("span.muted", { text: "Vocês escolhem tudo" })]),
    ]);
    const passo = (n, titulo, texto) => el("li.tl-passo", {}, [el("b.tl-passo__n", { text: String(n) }), el("span", {}, [el("strong", { text: titulo }), el("span.muted", { text: texto })])]);
    return el("div.tl.tl--lobby", {}, [
      el("header.tl-heroi", {}, [
        el("div.tl-heroi__marca", { "aria-hidden": "true" }, ["S", "A", "B", "C"].map((x, i) => el("span", { text: x, style: { "--cor": PALETAS.classica.cores[i], "--tinta": "#14121f" } }))),
        el("div", {}, [
          el("h2.tl-heroi__titulo", { text: "Tier List" }),
          el("p.tl-heroi__sub", { text: "Com fotos ou emoji. Montem juntos, ranqueiem escondido (ou numa enquete com notas) e descubram o que a galera pensa de verdade." }),
        ]),
      ]),
      el("ol.tl-passos", {}, [passo(1, "Montar", "tema, faixas, cores e itens, todo mundo junto"), passo(2, "Votar", "cada um arrasta na sua lista, ou dá notas numa enquete, sem espiar"), passo(3, "Revelar", "a média da galera, o polêmico e as almas gêmeas")]),
      el("h3.tl-secao", { text: "Escolha um tema" }),
      el("div.tl-temas", {}, [zero, ...temas]),
    ]);
  }

  /* ------------------------------- montar ------------------------------- */

  #montarMontagem(v) {
    const p = this.p;
    p.titulo = el("input.tl-titulo", { type: "text", maxLength: 60, "aria-label": "Título da tier list", spellcheck: false, autocomplete: "off" });
    p.titulo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") p.titulo.blur();
    });
    p.titulo.addEventListener("change", () => this.l.titulo(p.titulo.value) || (p.titulo.value = this.l.cfg()?.titulo || ""));

    p.faixas = el("div.tl-quadro.tl-quadro--edita");
    p.maisFaixa = botao("Faixa", { icone: "plus", tipo: "ghost", onClick: () => this.l.novaFaixa() });
    p.dicaFaixas = el("span.muted");
    p.dividir = botao("Dividir as notas por igual", { tipo: "ghost", icone: "shuffle", onClick: () => this.l.cortesAuto() });

    // Como votar: arrastar ou enquete com notas.
    p.modos = el(
      "div.jogos__abas.tl-modos",
      { role: "tablist", "aria-label": "Como votar" },
      Object.entries(MODOS).map(([id, nome]) =>
        el("button.jogos__aba", { type: "button", role: "tab", dataset: { id }, title: nome, onClick: () => this.l.modo(id) }, [icon(id === "notas" ? "vote" : "grip-vertical", { size: "sm" }), el("span", { text: id === "notas" ? "Enquete" : nome })]),
      ),
    );
    p.modoDica = el("p.tl-painel__dica");

    // Enquete: perguntas, peso, escala.
    p.perguntas = el("ol.tl-perguntas");
    p.novaPergunta = el("input.input", { type: "text", placeholder: "Nova pergunta (ex.: Sabor)", "aria-label": "Nova pergunta", maxLength: 60, autocomplete: "off", spellcheck: false });
    const porPergunta = () => {
      const t = p.novaPergunta.value.trim();
      if (!t) return;
      if (this.l.novaPergunta(t)) p.novaPergunta.value = "";
      else this.c.avisar(this.l.cfg()?.perguntas.length >= MAX_PERGUNTAS ? `No máximo ${MAX_PERGUNTAS} perguntas.` : "Essa pergunta já está na enquete.", "warn");
    };
    p.novaPergunta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        porPergunta();
      }
    });
    p.sugestoes = el("div.tl-chips.tl-sugestoes");
    p.escalas = el(
      "div.tl-chips",
      { role: "group", "aria-label": "Escala das notas" },
      Object.entries(ESCALAS).map(([id, e]) => el("button.jg-chip.jg-chip--botao", { type: "button", dataset: { id }, onClick: () => this.l.escala(Number(id)) }, [id === "5" ? icon("star", { size: "sm" }) : null, el("span", { text: e.nome })])),
    );
    p.enquete = el("section.tl-painel__bloco.tl-painel__enquete", {}, [
      el("span.jogos__rotulo", { text: "Perguntas da enquete" }),
      p.perguntas,
      el("div.tl-novo", {}, [p.novaPergunta, botao("", { icone: "plus", tipo: "primary", rotulo: "Pôr a pergunta", classe: "btn--icon", onClick: porPergunta })]),
      p.sugestoes,
      el("span.jogos__rotulo", { text: "Notas" }),
      p.escalas,
    ]);

    p.estilos = el(
      "div.tl-chips",
      { role: "group", "aria-label": "Nomes das faixas" },
      Object.entries(ESTILOS).map(([id, e]) => el("button.jg-chip.jg-chip--botao", { type: "button", dataset: { id }, text: e.nome, onClick: () => this.l.estilo(id) })),
    );
    p.paletas = el(
      "div.tl-paletas",
      { role: "group", "aria-label": "Paleta de cores" },
      Object.entries(PALETAS).map(([id, pl]) =>
        el("button.tl-paleta", { type: "button", dataset: { id }, "aria-label": `Paleta ${pl.nome}`, onClick: () => this.l.paleta(id) }, [
          el("span.tl-paleta__faixas", { "aria-hidden": "true" }, pl.cores.slice(0, 5).map((c) => el("i", { style: { background: c } }))),
          el("span.tl-paleta__nome", { text: pl.nome }),
        ]),
      ),
    );

    // Novo item: foto ou emoji, e o nome.
    p.emojiBtn = el("button.tl-novo__emoji", { type: "button", "aria-label": "Escolher um emoji para o item", "aria-expanded": "false", onClick: () => this.#alternarEmoji() });
    p.emojiGrade = el("div.tl-emoji", { hidden: true, role: "listbox", "aria-label": "Emoji do item" }, [
      el("button.tl-emoji__op.tl-emoji__op--nenhum", { type: "button", role: "option", "aria-label": "Sem emoji", onClick: () => this.#escolherEmoji(null) }, [icon("x", { size: "sm" })]),
      ...EMOJI_TIER.map((e) => el("button.tl-emoji__op", { type: "button", role: "option", "aria-label": e.replace(/-/g, " "), onClick: () => this.#escolherEmoji(e) }, [emoji(e, { size: 24 })])),
    ]);
    p.arquivo = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    p.arquivo.addEventListener("change", () => {
      const fs = [...p.arquivo.files];
      p.arquivo.value = "";
      this.#comFotos(fs);
    });
    p.fotoBtn = el("button.tl-novo__emoji.tl-novo__foto", { type: "button", "aria-label": "Pôr fotos (uma ou várias)", dataset: { tip: "Fotos: uma ou várias de uma vez" }, onClick: () => p.arquivo.click() }, [icon("image-plus", { size: "sm" })]);
    p.novo = el("input.input.tl-novo__nome", { type: "text", placeholder: "Novo item", "aria-label": "Nome do novo item", maxLength: 40, autocomplete: "off", spellcheck: false });
    const adicionar = () => {
      const nome = p.novo.value.trim();
      if (!nome) return p.novo.focus();
      if (this.l.novoItem(nome, this.#emojiNovo)) {
        p.novo.value = "";
        this.#escolherEmoji(null, false);
      } else this.#avisarItem();
      p.novo.focus();
    };
    p.novo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        adicionar();
      }
    });
    // Colar uma imagem (Ctrl+V) no campo do nome também vale.
    p.novo.addEventListener("paste", (e) => {
      const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!fs.length) return;
      e.preventDefault();
      this.#comFotos(fs);
    });
    this.#escolherEmoji(null, false);
    p.itens = el("div.tl-itens-edita");
    p.contaItens = el("span.jogos__rotulo");
    p.resumo = el("span.muted");
    p.comecar = botao("Começar", { tipo: "primary", icone: "play", classe: "btn--lg", onClick: () => this.l.comecar() });
    // Uma foto por item: o botão de câmera no ladrilho abre este campo.
    p.arquivoItem = el("input", { type: "file", accept: "image/*", hidden: true });
    p.arquivoItem.addEventListener("change", async () => {
      const f = p.arquivoItem.files[0];
      const id = p.arquivoItem.dataset.item;
      p.arquivoItem.value = "";
      const url = await miniatura(f);
      if (!url) return this.c.avisar("Não deu para abrir essa imagem.", "warn");
      this.l.imagemItem(id, url);
    });

    const painelItens = el("section.tl-painel__bloco.tl-painel__itens", {}, [
      p.contaItens,
      el("div.tl-novo", {}, [p.fotoBtn, p.emojiBtn, p.novo, botao("", { icone: "plus", tipo: "primary", rotulo: "Pôr o item", classe: "btn--icon", onClick: adicionar }), p.emojiGrade, p.arquivo, p.arquivoItem]),
      p.itens,
      el("p.tl-painel__dica", { text: "Dá para arrastar fotos do computador para cá, ou colar com Ctrl+V." }),
    ]);
    // Soltar arquivos de imagem em cima do painel de itens.
    painelItens.addEventListener("dragover", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      painelItens.classList.add("is-alvo");
    });
    painelItens.addEventListener("dragleave", (e) => {
      if (!painelItens.contains(e.relatedTarget)) painelItens.classList.remove("is-alvo");
    });
    painelItens.addEventListener("drop", (e) => {
      const fs = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
      painelItens.classList.remove("is-alvo");
      if (!fs.length) return;
      e.preventDefault();
      this.#comFotos(fs);
    });

    return el("div.tl.tl--montar", {}, [
      el("header.tl-cabeca", {}, [p.titulo, el("p.tl-cabeca__sub", {}, [icon("users", { size: "sm" }), el("span", { text: "Montem juntos: o que cada um muda aparece para todos na hora." })])]),
      el("div.tl-montar", {}, [
        el("section.tl-montar__quadro", { "aria-label": "Faixas" }, [p.faixas, el("div.tl-montar__mais", {}, [p.maisFaixa, p.dividir, p.dicaFaixas])]),
        el("aside.tl-painel", { "aria-label": "Personalizar" }, [
          el("section.tl-painel__bloco", {}, [el("span.jogos__rotulo", { text: "Como votar" }), p.modos, p.modoDica]),
          p.enquete,
          painelItens,
          el("section.tl-painel__bloco", {}, [el("span.jogos__rotulo", { text: "Nomes das faixas" }), p.estilos]),
          el("section.tl-painel__bloco", {}, [el("span.jogos__rotulo", { text: "Cores" }), p.paletas]),
        ]),
      ]),
      el("footer.tl-rodape", {}, [p.resumo, el("span.tl-rodape__espaco"), botao("Trocar de tema", { tipo: "ghost", icone: "layout-grid", onClick: () => this.#trocarTema() }), p.comecar]),
    ]);
  }

  #avisarItem() {
    this.c.avisar(this.l.itens().length >= MAX_ITENS ? `No máximo ${MAX_ITENS} itens.` : "Esse item já está na lista.", "warn");
  }

  /**
   * Fotos escolhidas, soltas ou coladas. Uma foto com um nome digitado vira
   * esse item; várias viram um item cada, com o nome do arquivo (dá para
   * renomear tirando e pondo de novo).
   */
  async #comFotos(arquivos) {
    const p = this.p;
    const fotos = arquivos.filter((f) => f.type.startsWith("image/")).slice(0, MAX_ITENS);
    if (!fotos.length) return;
    const digitado = p?.novo?.value.trim();
    let postos = 0;
    let falhas = 0;
    for (const [i, f] of fotos.entries()) {
      const url = await miniatura(f);
      if (!url) {
        falhas += 1;
        continue;
      }
      const nome = fotos.length === 1 && digitado ? digitado : nomeDoArquivo(f.name);
      if (this.l.novoItem(nome, null, url)) postos += 1;
      else if (this.l.itens().length >= MAX_ITENS) {
        this.#avisarItem();
        break;
      } else if (this.l.novoItem(`${nome} ${i + 2}`, null, url)) postos += 1;
    }
    if (postos && fotos.length === 1 && digitado && p?.novo) p.novo.value = "";
    if (falhas) this.c.avisar(falhas === 1 ? "Uma imagem não abriu (formato que o navegador não lê)." : `${falhas} imagens não abriram.`, "warn");
    else if (postos > 1) this.c.avisar(`${postos} itens com foto.`, "ok");
  }

  #trocarTema() {
    this.l.estado.definir([["tl/cfg", null]]);
  }

  #alternarEmoji(abrir = this.p?.emojiGrade?.hidden) {
    const p = this.p;
    if (!p?.emojiGrade) return;
    p.emojiGrade.hidden = !abrir;
    p.emojiBtn.setAttribute("aria-expanded", String(!!abrir));
  }

  #escolherEmoji(e, focar = true) {
    this.#emojiNovo = e;
    const p = this.p;
    if (!p?.emojiBtn) return;
    p.emojiBtn.replaceChildren(e ? emoji(e, { size: 24 }) : icon("smile", { size: "sm" }));
    p.emojiBtn.classList.toggle("is-escolhido", !!e);
    this.#alternarEmoji(false);
    if (focar) p.novo.focus();
  }

  #desenharMontagem(v) {
    const p = this.p;
    const c = v.cfg;
    const notas = c.modo === "notas";
    if (document.activeElement !== p.titulo && p.titulo.value !== c.titulo) p.titulo.value = c.titulo;

    for (const b of p.modos.children) b.setAttribute("aria-selected", String(b.dataset.id === c.modo));
    p.modoDica.textContent = notas
      ? "Cada um dá notas em cada item, pergunta por pergunta. A média decide a faixa, pela nota mínima de cada uma."
      : "Cada um arrasta os itens para as faixas da sua lista. A faixa da galera é a média.";
    p.enquete.hidden = !notas;
    p.dividir.hidden = !notas || c.cortesAuto;
    p.dicaFaixas.textContent = notas ? "A nota mínima de cada faixa fica ao lado do nome." : "Toque no nome para editar. A cor muda no círculo.";

    // As faixas: a que está sendo editada (com o foco) não é refeita.
    const antigos = porChave(p.faixas);
    const comFoco = [...antigos].find(([, n]) => n.contains(document.activeElement))?.[0];
    sincronizar(
      p.faixas,
      c.tiers.map((t, i) => {
        const chave = `f${i}`;
        const corte = notas ? [c.cortes[i], c.escala] : null;
        const sig = comFoco === chave ? antigos.get(chave).dataset.sig : JSON.stringify([t, i, c.tiers.length, corte]);
        return { chave, sig, criar: () => this.#faixaEditavel(t, i, c.tiers.length, notas ? c : null) };
      }),
      antigos,
    );
    p.maisFaixa.disabled = c.tiers.length >= MAX_TIERS;
    for (const b of p.estilos.children) b.setAttribute("aria-pressed", String(b.dataset.id === c.estilo));
    for (const b of p.paletas.children) b.setAttribute("aria-pressed", String(b.dataset.id === c.paleta));

    if (notas) {
      sincronizar(
        p.perguntas,
        c.perguntas.map((q, i) => ({
          chave: q.id || `q${i}`,
          sig: JSON.stringify([q.t, q.w, i, c.perguntas.length]),
          criar: () =>
            el("li.tl-pergunta", {}, [
              el("span.tl-pergunta__n", { text: String(i + 1) }),
              el("span.tl-pergunta__t", { text: q.t }),
              el(
                "span.tl-peso",
                { role: "group", "aria-label": `Peso de ${q.t}` },
                [1, 2, 3].map((w) => el("button.tl-peso__op", { type: "button", "aria-pressed": String(q.w === w), dataset: { tip: w === 1 ? "Peso normal" : `Vale ${w === 2 ? "o dobro" : "o triplo"}` }, text: `${w}×`, onClick: () => this.l.pesoPergunta(i, w) })),
              ),
              botao("", { icone: "x", tipo: "ghost", classe: "btn--icon", rotulo: `Tirar ${q.t}`, desligado: c.perguntas.length <= 1, onClick: () => this.l.removerPergunta(i) }),
            ]),
        })),
      );
      const livres = PERGUNTAS_PRONTAS.filter((t) => !c.perguntas.some((q) => q.t.toLowerCase() === t.toLowerCase()));
      trocar(p.sugestoes, JSON.stringify([livres, c.perguntas.length >= MAX_PERGUNTAS]), () =>
        el(
          "div.tl-chips",
          {},
          c.perguntas.length >= MAX_PERGUNTAS ? [] : livres.slice(0, 6).map((t) => el("button.jg-chip.jg-chip--botao", { type: "button", onClick: () => this.l.novaPergunta(t) }, [icon("plus", { size: "sm" }), el("span", { text: t })])),
        ),
      );
      for (const b of p.escalas.children) b.setAttribute("aria-pressed", String(Number(b.dataset.id) === c.escala));
    }

    sincronizar(
      p.itens,
      v.itens.map((it) => ({
        chave: it.id,
        sig: JSON.stringify([it.t, it.e, it.h, it.img ? it.img.length : 0, it.img?.slice(-16) || ""]),
        criar: () =>
          ladrilho(it, {
            tag: "div",
            classe: "tl-item--p",
            extra: el("span.tl-item__acoes", {}, [
              el(
                "button.tl-item__mini.tl-item__mini--foto",
                {
                  type: "button",
                  "aria-label": it.img ? `Trocar a foto de ${it.t}` : `Pôr uma foto em ${it.t}`,
                  onClick: () => {
                    p.arquivoItem.dataset.item = it.id;
                    p.arquivoItem.click();
                  },
                },
                [icon("image", { size: "sm" })],
              ),
              el("button.tl-item__mini", { type: "button", "aria-label": `Tirar ${it.t}`, onClick: () => this.l.removerItem(it.id) }, [icon("x", { size: "sm" })]),
            ]),
          }),
      })),
    );
    if (!v.itens.length) trocar(p.itens, "vazio", () => el("p.jg-vazio", { text: "Nenhum item ainda. Ponha o primeiro aí em cima, com foto ou emoji." }));
    p.contaItens.textContent = `Itens · ${v.itens.length} de ${MAX_ITENS}`;
    p.resumo.textContent = `${v.itens.length} ${v.itens.length === 1 ? "item" : "itens"} · ${c.tiers.length} faixas${notas ? ` · ${c.perguntas.length} ${c.perguntas.length === 1 ? "pergunta" : "perguntas"}` : ""}${v.r ? ` · rodada ${v.r + 1}` : ""}`;
    p.comecar.disabled = v.itens.length < 2 || (notas && !c.perguntas.length);
    p.comecar.querySelector("span").textContent = notas ? "Começar a votação" : "Começar a ranquear";
  }

  #faixaEditavel(t, i, total, enquete = null) {
    const nome = el("input.tl-faixa__campo", { type: "text", value: t.n, maxLength: 18, "aria-label": `Nome da faixa ${i + 1}`, spellcheck: false, autocomplete: "off" });
    nome.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") nome.blur();
    });
    nome.addEventListener("change", () => this.l.renomearFaixa(i, nome.value));
    const cor = el("input.tl-faixa__cor-campo", { type: "color", value: t.c, "aria-label": `Cor da faixa ${i + 1}` });
    cor.addEventListener("change", () => this.l.pintarFaixa(i, cor.value));
    let meio;
    if (enquete) {
      // Enquete: a nota mínima para cair nesta faixa.
      const { min, max } = ESCALAS[enquete.escala];
      const ultima = i === total - 1;
      if (ultima) meio = el("div.tl-faixa__corte", {}, [el("span.tl-faixa__corte-txt", { text: `abaixo de ${fmt(enquete.cortes[i - 1])}` }), el("span.muted", { text: "o que sobrar cai aqui" })]);
      else {
        const campo = el("input.input.tl-faixa__corte-campo", { type: "number", min, max, step: enquete.escala === 5 ? 0.25 : 0.5, value: String(enquete.cortes[i]), "aria-label": `Nota mínima da faixa ${t.n || i + 1}` });
        campo.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") campo.blur();
        });
        campo.addEventListener("change", () => this.l.corte(i, campo.value));
        meio = el("div.tl-faixa__corte", {}, [
          el("label.tl-faixa__corte-txt", {}, [el("span", { text: "nota" }), el("b", { text: "≥" }), campo]),
          el("span.tl-faixa__regua", { "aria-hidden": "true", style: { "--pct": `${((enquete.cortes[i] - min) / (max - min)) * 100}%`, "--cor": t.c } }),
        ]);
      }
    } else {
      const linhas = Math.max(1, Math.min(3, 4 - Math.floor(total / 3)));
      meio = el("div.tl-faixa__itens.tl-faixa__itens--vazia", {}, Array.from({ length: linhas }, () => el("i.tl-fantasminha", { "aria-hidden": "true" })));
    }
    return el("div.tl-faixa", {}, [
      el("label.tl-faixa__rotulo", { style: { "--cor": t.c, "--tinta": tintaPara(t.c) }, dataset: { tam: t.n.length > 6 ? "p" : t.n.length > 2 ? "m" : "g" } }, [nome]),
      meio,
      el("div.tl-faixa__acoes", {}, [
        el("label.tl-faixa__cor", { dataset: { tip: "Cor da faixa" }, style: { "--cor": t.c } }, [cor]),
        botao("", { icone: "arrow-up", tipo: "ghost", classe: "btn--icon", rotulo: "Subir a faixa", desligado: i === 0, onClick: () => this.l.moverFaixa(i, -1) }),
        botao("", { icone: "arrow-down", tipo: "ghost", classe: "btn--icon", rotulo: "Descer a faixa", desligado: i === total - 1, onClick: () => this.l.moverFaixa(i, 1) }),
        botao("", { icone: "trash-2", tipo: "ghost", classe: "btn--icon", rotulo: "Tirar a faixa", desligado: total <= MIN_TIERS, onClick: () => this.l.removerFaixa(i) }),
      ]),
    ]);
  }

  /* ------------------------------ ranquear ------------------------------ */

  #montarRanquear(v) {
    const p = this.p;
    p.quadro = el("div.tl-quadro");
    p.banco = el("div.tl-banco__itens.tl-solta", { dataset: { faixa: "banco" } });
    p.gente = el("ul.tl-gente", { "aria-label": "Quem já terminou" });
    p.conta = el("span.tl-conta");
    p.dica = el("p.tl-dica");
    p.pronto = el("div.tl-pronto");
    p.quadro.addEventListener("click", (e) => this.#tocarFaixa(e));
    p.banco.addEventListener("click", (e) => this.#tocarFaixa(e));
    return el("div.tl.tl--ranquear", {}, [
      el("header.tl-cabeca.tl-cabeca--linha", {}, [el("div", {}, [el("span.jogos__rotulo", { text: "Sua lista (ninguém vê até revelar)" }), el("h2.tl-cabeca__titulo", { text: v.cfg.titulo })]), p.gente]),
      p.quadro,
      (p.bancoSec = el("section.tl-banco", { "aria-label": "Itens para colocar" }, [el("div.tl-banco__topo", {}, [p.conta, p.dica]), p.banco])),
      el("footer.tl-rodape", {}, [
        botao("Limpar", { tipo: "ghost", icone: "rotate-ccw", onClick: () => this.l.limpar() }),
        botao("Voltar a montar", { tipo: "ghost", icone: "pencil", onClick: () => this.l.voltarAMontar() }),
        el("span.tl-rodape__espaco"),
        botao("Revelar agora", { tipo: "ghost", icone: "eye", onClick: () => this.l.revelar() }),
        p.pronto,
      ]),
    ]);
  }

  #desenharRanquear(v, pessoas) {
    const p = this.p;
    const c = v.cfg;
    const { faixas, banco } = agrupar(v.itens, c.tiers.length, v.minha);
    if (this.#sel && !v.itens.some((x) => x.id === this.#sel)) this.#sel = null;
    const tile = (it) => ({
      chave: it.id,
      sig: JSON.stringify([it.t, it.e, it.h, this.#sel === it.id]),
      criar: () => this.#ladrilhoArrastavel(it, c.tiers.length),
    });
    sincronizar(
      p.quadro,
      c.tiers.map((t, i) => ({
        chave: `f${i}`,
        sig: JSON.stringify([t, i]),
        criar: () => el("div.tl-faixa", {}, [rotulo(t, i), el("div.tl-faixa__itens.tl-solta", { dataset: { faixa: String(i) }, "aria-label": `Faixa ${t.n}` })]),
      })),
    );
    [...p.quadro.children].forEach((linha, i) => {
      const zona = linha.querySelector(".tl-solta");
      sincronizar(zona, faixas[i].map(tile));
      linha.classList.toggle("is-escolhendo", !!this.#sel);
    });
    sincronizar(p.banco, banco.map(tile));
    p.banco.classList.toggle("is-escolhendo", !!this.#sel && v.minha[this.#sel] != null);
    p.conta.textContent = banco.length ? `${banco.length} para colocar` : "Tudo colocado!";
    // Sem nada para colocar, o banco encolhe (mas continua aceitando item de volta).
    p.bancoSec.classList.toggle("is-vazio", !banco.length);
    p.conta.classList.toggle("is-feito", !banco.length);
    p.dica.textContent = this.#sel
      ? `Agora toque na faixa (ou aperte 1 a ${c.tiers.length}). Esc cancela.`
      : banco.length
        ? "Arraste para uma faixa, ou toque no item e depois na faixa."
        : "Mudou de ideia? Arraste de uma faixa para outra (ou de volta para cá).";

    // Quem já terminou: um anel com o quanto cada um já colocou.
    const total = v.itens.length || 1;
    sincronizar(
      p.gente,
      v.progresso.map((x) => ({
        chave: x.id,
        sig: JSON.stringify([x.nome, x.k, x.ok, total, x.avatar || null]),
        criar: () =>
          el("li.tl-gente__um", { class: x.ok ? "is-ok" : "", style: { "--pct": `${Math.round((x.k / total) * 100)}%` }, title: `${x.id === this.eu ? "Você" : x.nome}: ${x.ok ? "pronto" : `${x.k} de ${total}`}` }, [
            rosto(x, 30),
            x.ok ? el("span.tl-gente__ok", { "aria-hidden": "true" }, [icon("check", { size: "sm" })]) : null,
          ]),
      })),
    );
    const prontos = v.progresso.filter((x) => x.ok).length;
    trocar(p.pronto, `${v.euPronto}|${prontos}|${pessoas.length}|${banco.length}`, () =>
      v.euPronto
        ? el("div.tl-pronto__feito", {}, [
            el("span.muted", { text: `Esperando a turma · ${prontos} de ${pessoas.length}` }),
            botao("Ainda mexendo", { tipo: "ghost", onClick: () => this.l.pronto(false) }),
          ])
        : botao(banco.length ? `Pronto! (${banco.length} de fora)` : "Pronto!", { tipo: "primary", icone: "check", classe: "btn--lg", onClick: () => this.l.pronto(true) }),
    );
  }

  #ladrilhoArrastavel(it, nTiers) {
    const t = ladrilho(it, { classe: this.#sel === it.id ? "is-sel" : "", attrs: { "aria-pressed": String(this.#sel === it.id), "aria-keyshortcuts": `1-${nTiers} 0` } });
    t.addEventListener("pointerdown", (e) => this.#comecarArrasto(e, it.id));
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      if (t.dataset.arrastou) {
        delete t.dataset.arrastou;
        return;
      }
      this.#sel = this.#sel === it.id ? null : it.id;
      this.desenhar();
    });
    t.addEventListener("keydown", (e) => {
      const n = Number(e.key);
      if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") this.#colocar(it.id, null);
      else if (Number.isInteger(n) && n >= 1 && n <= nTiers) this.#colocar(it.id, n - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    return t;
  }

  #colocar(item, faixa) {
    this.#sel = null;
    if (this.l.colocar(item, faixa)) this.desenhar();
    // O foco segue o item para a faixa nova (no teclado dá para ir colocando um atrás do outro).
    requestAnimationFrame(() => this.p?.no?.querySelector(`.tl-item[data-item="${item}"]`)?.focus({ preventScroll: true }));
  }

  /** Um toque numa faixa (ou no banco) com um item escolhido: coloca. */
  #tocarFaixa(e) {
    if (!this.#sel || e.target.closest(".tl-item")) return;
    const zona = e.target.closest(".tl-faixa")?.querySelector(".tl-solta") || e.target.closest(".tl-solta");
    if (!zona) return;
    this.#colocar(this.#sel, zona.dataset.faixa === "banco" ? null : Number(zona.dataset.faixa));
  }

  /**
   * O arrasto, por pointer events (mouse, caneta e dedo do mesmo jeito; o
   * arrastar-e-soltar do HTML não funciona no celular). O ladrilho original
   * fica no lugar, apagado; um fantasma segue o dedo; a faixa embaixo acende.
   */
  #comecarArrasto(e, item) {
    if (this.l.revelada() || (e.pointerType === "mouse" && e.button !== 0)) return;
    const tile = e.currentTarget;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let fantasma = null;
    let alvo = null;
    let dx = 0;
    let dy = 0;
    const acender = (zona) => {
      const linha = zona?.closest(".tl-faixa") || zona?.closest(".tl-banco") || null;
      if (linha === alvo) return;
      alvo?.classList.remove("is-alvo");
      alvo = linha;
      alvo?.classList.add("is-alvo");
    };
    const fim = () => {
      tile.removeEventListener("pointermove", mover);
      tile.removeEventListener("pointerup", soltar);
      tile.removeEventListener("pointercancel", cancelar);
      fantasma?.remove();
      tile.classList.remove("is-origem");
      this.raiz.classList.remove("is-arrastando");
      alvo?.classList.remove("is-alvo");
      this.#arrasto = null;
    };
    const mover = (ev) => {
      if (!fantasma) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const r = tile.getBoundingClientRect();
        dx = x0 - r.left;
        dy = y0 - r.top;
        fantasma = tile.cloneNode(true);
        fantasma.classList.add("tl-fantasma");
        fantasma.removeAttribute("data-chave");
        fantasma.style.width = `${r.width}px`;
        fantasma.style.height = `${r.height}px`;
        document.body.append(fantasma);
        tile.classList.add("is-origem");
        this.raiz.classList.add("is-arrastando");
        this.#sel = null;
      }
      ev.preventDefault();
      fantasma.style.transform = `translate(${ev.clientX - dx}px, ${ev.clientY - dy}px) rotate(-5deg) scale(1.08)`;
      acender(document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".tl-faixa, .tl-banco"));
    };
    const soltar = () => {
      const arrastou = !!fantasma;
      const zona = alvo?.querySelector(".tl-solta") || null;
      fim();
      if (!arrastou) return;
      tile.dataset.arrastou = "1";
      setTimeout(() => delete tile.dataset.arrastou, 0);
      if (zona) this.#colocar(item, zona.dataset.faixa === "banco" ? null : Number(zona.dataset.faixa));
      else this.desenhar();
    };
    const cancelar = () => {
      fim();
      this.desenhar();
    };
    try {
      tile.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura, o arrasto ainda funciona dentro do ladrilho */
    }
    tile.addEventListener("pointermove", mover);
    tile.addEventListener("pointerup", soltar);
    tile.addEventListener("pointercancel", cancelar);
    this.#arrasto = { cancelar: fim };
  }

  /* --------------------------- enquete (notas) --------------------------- */

  /** O item que estou avaliando (índice na lista). */
  #atual = 0;
  #avancar = 0;

  #montarEnquete(v) {
    const p = this.p;
    this.#atual = 0;
    p.gente = el("ul.tl-gente", { "aria-label": "Quem já terminou" });
    p.lista = el("nav.tl-enquete__lista", { "aria-label": "Itens da enquete" });
    p.cartao = el("section.tl-enquete__cartao", { "aria-live": "polite" });
    p.pronto = el("div.tl-pronto");
    p.conta = el("span.tl-conta");
    this.aoDestruir(() => clearTimeout(this.#avancar));
    return el("div.tl.tl--ranquear.tl--enquete", {}, [
      el("header.tl-cabeca.tl-cabeca--linha", {}, [el("div", {}, [el("span.jogos__rotulo", { text: "Sua enquete (ninguém vê as notas até revelar)" }), el("h2.tl-cabeca__titulo", { text: v.cfg.titulo })]), p.gente]),
      el("div.tl-enquete", {}, [el("div.tl-enquete__lado", {}, [p.conta, p.lista]), p.cartao]),
      el("footer.tl-rodape", {}, [
        botao("Voltar a montar", { tipo: "ghost", icone: "pencil", onClick: () => this.l.voltarAMontar() }),
        el("span.tl-rodape__espaco"),
        botao("Revelar agora", { tipo: "ghost", icone: "eye", onClick: () => this.l.revelar() }),
        p.pronto,
      ]),
    ]);
  }

  #desenharEnquete(v, pessoas) {
    const p = this.p;
    const c = v.cfg;
    const n = v.itens.length;
    this.#atual = Math.max(0, Math.min(this.#atual, n - 1));
    const estado = (it) => (completo(v.minha[it.id], c.perguntas) ? "ok" : v.minha[it.id] ? "meio" : "");

    sincronizar(
      p.lista,
      v.itens.map((it, i) => {
        const nota = notaDoItem(v.minha[it.id], c.perguntas, c.escala);
        return {
          chave: it.id,
          sig: JSON.stringify([it.t, it.e, it.h, !!it.img, estado(it), i === this.#atual, nota]),
          criar: () =>
            el(
              "button.tl-enquete__op",
              { type: "button", class: `${i === this.#atual ? "is-atual" : ""} ${estado(it) ? `is-${estado(it)}` : ""}`, "aria-current": i === this.#atual ? "true" : null, onClick: () => this.#irPara(i) },
              [
                el("span.tl-enquete__mini", { style: { "--h": it.h }, "aria-hidden": "true" }, [arte(it, 22)]),
                el("span.tl-enquete__nome.truncate", { text: it.t }),
                estado(it) === "ok" ? el("b.tl-enquete__nota", { text: fmt(nota), style: { color: corDaNota(nota, c.escala) } }) : estado(it) === "meio" ? el("span.tl-enquete__meio", { text: "…" }) : null,
              ],
            ),
        };
      }),
    );
    p.conta.textContent = `${v.colocados} de ${n} avaliados`;
    p.conta.classList.toggle("is-feito", v.colocados === n);

    const it = v.itens[this.#atual];
    const r = it ? v.minha[it.id] || [] : [];
    trocar(p.cartao, JSON.stringify([it?.id, it?.img?.length || 0, it?.e, r, this.#atual, n, c.cortes]), () => (it ? this.#cartaoEnquete(it, r, c, n) : el("p.jg-vazio", { text: "Nenhum item." })));

    const total = n || 1;
    sincronizar(
      p.gente,
      v.progresso.map((x) => ({
        chave: x.id,
        sig: JSON.stringify([x.nome, x.k, x.ok, total, x.avatar || null]),
        criar: () =>
          el("li.tl-gente__um", { class: x.ok ? "is-ok" : "", style: { "--pct": `${Math.round((x.k / total) * 100)}%` }, title: `${x.id === this.eu ? "Você" : x.nome}: ${x.ok ? "pronto" : `${x.k} de ${total}`}` }, [
            rosto(x, 30),
            x.ok ? el("span.tl-gente__ok", { "aria-hidden": "true" }, [icon("check", { size: "sm" })]) : null,
          ]),
      })),
    );
    const prontos = v.progresso.filter((x) => x.ok).length;
    const faltam = n - v.colocados;
    trocar(p.pronto, `${v.euPronto}|${prontos}|${pessoas.length}|${faltam}`, () =>
      v.euPronto
        ? el("div.tl-pronto__feito", {}, [el("span.muted", { text: `Esperando a turma · ${prontos} de ${pessoas.length}` }), botao("Ainda votando", { tipo: "ghost", onClick: () => this.l.pronto(false) })])
        : botao(faltam ? `Pronto! (${faltam} sem nota)` : "Pronto!", { tipo: "primary", icone: "check", classe: "btn--lg", onClick: () => this.l.pronto(true) }),
    );
  }

  #irPara(i) {
    clearTimeout(this.#avancar);
    this.#atual = i;
    this.desenhar();
    // O cartão novo começa do topo (no celular, a tela ficava lá embaixo, nos botões).
    requestAnimationFrame(() => {
      const r = this.p?.cartao?.getBoundingClientRect();
      if (r && r.top < 0) this.p.cartao.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  #cartaoEnquete(it, r, c, n) {
    const { min, max } = ESCALAS[c.escala];
    const nota = notaDoItem(r, c.perguntas, c.escala);
    const faixa = faixaPorNota(nota, c.cortes);
    const estrelas = c.escala === 5;
    const pergunta = (q, i) => {
      const valor = typeof r[i] === "number" ? r[i] : null;
      const ops = [];
      for (let x = min; x <= max; x += 1) {
        const marcado = estrelas ? valor != null && x <= valor : valor === x;
        ops.push(
          el(
            `button.tl-nota${estrelas ? ".tl-nota--estrela" : ""}`,
            {
              type: "button",
              class: marcado ? "is-cheia" : "",
              "aria-pressed": String(valor === x),
              "aria-label": estrelas ? `${x} ${x === 1 ? "estrela" : "estrelas"}` : `Nota ${x}`,
              style: !estrelas && marcado ? { background: corDaNota(x, c.escala) } : null,
              onClick: () => this.#votar(it.id, i, valor === x ? null : x, c, n),
            },
            [estrelas ? icon("star") : el("span", { text: String(x) })],
          ),
        );
      }
      return el("div.tl-q", {}, [
        el("div.tl-q__topo", {}, [el("strong", { text: q.t }), q.w > 1 ? el("span.jg-chip", { text: `vale ${q.w}×` }) : null, el("span.tl-q__valor", { text: valor == null ? "" : fmt(valor) })]),
        el(`div.tl-notas${estrelas ? ".tl-notas--estrelas" : ""}`, { role: "group", "aria-label": q.t }, ops),
      ]);
    };
    const t = c.tiers[faixa];
    return el("div.tl-enquete__corpo", {}, [
      el("div.tl-enquete__item", {}, [
        ladrilho(it, { tag: "div", classe: "tl-item--g" }),
        el("div", {}, [el("span.jogos__rotulo", { text: `Item ${this.#atual + 1} de ${n}` }), el("h3.tl-enquete__titulo", { text: it.t })]),
      ]),
      el("div.tl-qs", {}, c.perguntas.map(pergunta)),
      el("div.tl-enquete__fim", {}, [
        el("div.tl-enquete__resultado", {}, [
          el("span.jogos__rotulo", { text: "Sua nota" }),
          el("b.tl-enquete__media", { text: fmt(nota), style: nota == null ? null : { color: corDaNota(nota, c.escala) } }),
          t ? el("span.tl-detalhe__rot", { text: t.n || String(faixa + 1), style: { "--cor": t.c, "--tinta": tintaPara(t.c) } }) : el("span.muted", { text: "dê as notas" }),
        ]),
        el("span.tl-rodape__espaco"),
        botao("Anterior", { tipo: "ghost", icone: "chevron-left", desligado: this.#atual === 0, onClick: () => this.#irPara(this.#atual - 1) }),
        botao(this.#atual === n - 1 ? "Último" : "Próximo", { tipo: completo(r, c.perguntas) ? "primary" : "", icone: "chevron-right", desligado: this.#atual === n - 1, onClick: () => this.#irPara(this.#atual + 1) }),
      ]),
    ]);
  }

  /** Uma nota. Respondeu tudo deste item? Vai sozinho para o próximo que falta. */
  #votar(item, q, valor, c, n) {
    const antes = completo(this.l.minha()[item], c.perguntas);
    if (!this.l.avaliar(item, q, valor)) return;
    this.desenhar();
    const agora = this.l.minha();
    if (antes || !completo(agora[item], c.perguntas)) return;
    clearTimeout(this.#avancar);
    this.#avancar = setTimeout(() => {
      const itens = this.l.itens();
      const depois = [...itens.slice(this.#atual + 1), ...itens.slice(0, this.#atual)].find((x) => !completo(agora[x.id], c.perguntas));
      if (depois) this.#irPara(itens.indexOf(depois));
    }, 550);
  }

  /* ------------------------------ revelada ------------------------------ */

  #montarRevelada(v) {
    const p = this.p;
    p.abas = el("div.jogos__abas.tl-abas", { role: "tablist", "aria-label": "De quem é a lista" });
    p.quadro = el("div.tl-quadro.tl-quadro--revelada");
    p.destaques = el("aside.tl-destaques", { "aria-label": "Destaques" });
    p.detalhe = el("div.tl-detalhe");
    p.legenda = el("p.tl-cabeca__sub");
    p.rotulo = el("span.jogos__rotulo");
    p.quadro.addEventListener("click", (e) => {
      const it = e.target.closest(".tl-item");
      if (!it) return;
      this.#sel = this.#sel === it.dataset.item ? null : it.dataset.item;
      this.desenhar();
      if (this.#sel) requestAnimationFrame(() => p.detalhe.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });
    // A revelação anima uma vez por rodada: as faixas entram de baixo para cima.
    if (this.#animada !== p.sig) {
      this.#animada = p.sig;
      p.animar = true;
      const dura = 300 + 160 * v.cfg.tiers.length;
      setTimeout(() => this.c.confete(), dura);
      setTimeout(() => p.no?.classList.remove("is-revelando"), dura + 900);
    }
    return el("div.tl.tl--revelada", { class: p.animar ? "is-revelando" : "" }, [
      el("header.tl-cabeca.tl-cabeca--linha", {}, [el("div", {}, [p.rotulo, el("h2.tl-cabeca__titulo", { text: v.cfg.titulo }), p.legenda]), p.abas]),
      el("div.tl-revelada", {}, [el("div.tl-revelada__lista", {}, [p.quadro, p.detalhe]), p.destaques]),
      el("footer.tl-rodape", {}, [
        botao("Baixar imagem", { tipo: "ghost", icone: "image-down", onClick: () => this.#baixarImagem() }),
        botao("Copiar como texto", { tipo: "ghost", icone: "copy", onClick: () => this.#copiarTexto() }),
        el("span.tl-rodape__espaco"),
        botao("Nova tier list", { tipo: "ghost", icone: "layout-grid", onClick: () => this.#trocarTema() }),
        botao("Ranquear de novo", { tipo: "primary", icone: "repeat", onClick: () => this.l.voltarAMontar() }),
      ]),
    ]);
  }

  /** As faixas da lista que estou vendo: a da galera ou a de alguém. */
  /**
   * As faixas da lista que estou vendo: a da galera ou a de alguém. Cada item
   * vem com `vista`, a nota mostrada no ladrilho (na enquete): a média da
   * galera, ou a nota que aquela pessoa deu.
   */
  #faixasVistas(v) {
    const n = v.cfg.tiers.length;
    const notas = v.modo === "notas";
    if (this.#ver === "galera") {
      const comNota = (it) => ({ ...it, vista: notas ? it.nota : null });
      return { faixas: v.res.faixas.map((f) => f.map(comNota)), fora: v.res.semVoto.map(comNota) };
    }
    const lista = v.listas.find((x) => x.id === this.#ver);
    const { faixas, banco } = agrupar(v.itens, n, lista?.pt || {});
    const porId = new Map(v.res.porItem.map((x) => [x.id, x]));
    const deste = (it) => ({ ...(porId.get(it.id) || it), vista: notas ? (lista?.notas?.[it.id] ?? null) : null });
    return { faixas: faixas.map((f) => f.map(deste).sort((a, b) => (b.vista ?? 0) - (a.vista ?? 0))), fora: banco.map(deste) };
  }

  #desenharRevelada(v, pessoas) {
    const p = this.p;
    const c = v.cfg;
    if (this.#ver !== "galera" && !v.listas.some((x) => x.id === this.#ver)) this.#ver = "galera";
    const nomeDe = (id, nome) => (id === this.eu ? "Você" : pessoas.find((x) => x.id === id)?.nome || nome);
    p.rotulo.textContent = v.listas.length > 1 ? "A galera decidiu" : "A tier list";
    const notas = v.modo === "notas";
    p.legenda.textContent = !v.listas.length
      ? "Esperando as listas chegarem…"
      : notas
        ? `${v.listas.length > 1 ? `A média das notas de ${v.listas.length} pessoas` : "As suas notas"} em ${c.perguntas.length} ${c.perguntas.length === 1 ? "pergunta" : "perguntas"}. Toque num item para ver as notas.`
        : v.listas.length > 1
          ? `A média de ${v.listas.length} listas. Toque num item para ver quem pôs onde.`
          : "Toque num item para ver os detalhes.";

    // Abas: galera, você, os outros.
    const abas = [{ id: "galera", nome: "Galera", icone: "users" }, ...v.listas.map((x) => ({ id: x.id, nome: nomeDe(x.id, x.nome) })).sort((a, b) => (a.id === this.eu ? -1 : b.id === this.eu ? 1 : a.nome.localeCompare(b.nome)))];
    sincronizar(
      p.abas,
      abas.map((a) => ({
        chave: a.id,
        sig: JSON.stringify([a.nome, this.#ver === a.id]),
        criar: () =>
          el("button.jogos__aba", { type: "button", role: "tab", "aria-selected": String(this.#ver === a.id), onClick: () => ((this.#ver = a.id), (this.#sel = null), this.desenhar()) }, [
            a.icone ? icon(a.icone, { size: "sm" }) : null,
            el("span.truncate", { text: a.nome }),
          ]),
      })),
    );

    const { faixas, fora } = this.#faixasVistas(v);
    const n = c.tiers.length;
    const comBarra = this.#ver === "galera";
    sincronizar(
      p.quadro,
      [
        ...c.tiers.map((t, i) => ({ t, i, itens: faixas[i] })),
        ...(fora.length ? [{ t: { n: comBarra ? "Sem voto" : "Ficou de fora", c: "#5b6475" }, i: n, itens: fora, fora: true }] : []),
      ].map(({ t, i, itens, fora: deFora }) => ({
        chave: `f${i}`,
        sig: JSON.stringify([t, i, this.#ver, itens.map((x) => [x.id, x.dist, x.vista, !!x.img, this.#sel === x.id])]),
        criar: () =>
          el("div.tl-faixa", { class: deFora ? "tl-faixa--fora" : "", style: { "--i": n - i } }, [
            rotulo(t, i),
            el(
              "div.tl-faixa__itens",
              {},
              itens.map((it, k) =>
                ladrilho(it, {
                  classe: this.#sel === it.id ? "is-sel" : "",
                  attrs: { style: { "--h": it.h, "--atraso": `${k * 60}ms` }, "aria-pressed": String(this.#sel === it.id) },
                  extra: comBarra && it.dist ? this.#barra(it, c) : null,
                  nota: notas ? it.vista : null,
                }),
              ),
            ),
          ]),
      })),
    );

    // O detalhe do item escolhido: quem pôs onde.
    const item = this.#sel ? v.res.porItem.find((x) => x.id === this.#sel) : null;
    trocar(p.detalhe, item ? JSON.stringify([item.id, item.votos, item.porPergunta || null, pessoas.map((x) => [x.id, x.nome])]) : "", () => (item ? this.#detalhe(item, c, pessoas, notas) : el("div")));
    p.detalhe.hidden = !item;

    trocar(p.destaques, JSON.stringify([v.res.polemico?.id, v.res.unanimes.map((x) => x.id), v.res.almasGemeas, v.res.doContra, v.res.pessoas, v.res.campeao?.id, v.res.melhores?.map((x) => x.item.id), pessoas.map((x) => [x.id, x.nome, x.avatar || null])]), () => this.#destaques(v, pessoas));
  }

  /** A barrinha de como a turma votou num item (uma fatia por faixa, na cor dela). */
  #barra(it, c) {
    const total = it.votos.length || 1;
    return el(
      "span.tl-item__barra",
      { "aria-hidden": "true" },
      it.dist.map((q, t) => (q ? el("i", { style: { flexGrow: q, background: c.tiers[t].c }, title: `${c.tiers[t].n}: ${q} de ${total}` }) : null)).filter(Boolean),
    );
  }

  #detalhe(item, c, pessoas, notas = false) {
    const porFaixa = c.tiers.map((t, i) => ({ t, i, quem: item.votos.filter((v) => v.t === i).sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0)) })).filter((x) => x.quem.length);
    const pessoa = (id, nome) => pessoas.find((x) => x.id === id) || { id, nome };
    const { min, max } = ESCALAS[c.escala] || ESCALAS[10];
    const resumo = !item.votos.length
      ? "Ninguém votou neste item."
      : notas
        ? `Nota ${fmt(item.nota)} · ${c.tiers[item.tier]?.n || item.tier + 1} · ${item.desvio / (max - min) >= 0.25 ? "a turma brigou" : item.desvio / (max - min) >= 0.12 ? "teve discordância" : "a turma concordou"}`
        : `Na média: ${c.tiers[item.tier]?.n || item.tier + 1} · ${item.desvio >= 1 ? "a turma brigou" : item.desvio >= 0.5 ? "teve discordância" : item.desvio > 0 ? "quase todo mundo concordou" : "unanimidade"}`;
    const barras =
      notas && item.porPergunta
        ? el(
            "ul.tl-detalhe__perguntas",
            {},
            c.perguntas.map((q, i) => {
              const m = item.porPergunta[i];
              return el("li", {}, [
                el("span.tl-detalhe__q", {}, [el("span", { text: q.t }), q.w > 1 ? el("span.muted", { text: ` ${q.w}×` }) : null]),
                el("span.tl-detalhe__trilho", { "aria-hidden": "true" }, [el("i", { style: { width: m == null ? "0%" : `${((m - min) / (max - min)) * 100}%`, background: m == null ? "transparent" : corDaNota(m, c.escala) } })]),
                el("b", { text: fmt(m) }),
              ]);
            }),
          )
        : null;
    return el("div.tl-detalhe__cartao", {}, [
      el("div.tl-detalhe__topo", {}, [
        ladrilho(item, { tag: "div", classe: "tl-item--p" }),
        el("div", {}, [
          el("strong.tl-detalhe__nome", { text: item.t }),
          el("span.muted", { text: resumo }),
        ]),
        botao("", { icone: "x", tipo: "ghost", classe: "btn--icon", rotulo: "Fechar", onClick: () => ((this.#sel = null), this.desenhar()) }),
      ]),
      barras,
      el(
        "ul.tl-detalhe__faixas",
        {},
        porFaixa.map(({ t, i, quem }) =>
          el("li", {}, [
            el("span.tl-detalhe__rot", { text: t.n || String(i + 1), style: { "--cor": t.c, "--tinta": tintaPara(t.c) } }),
            el(
              "span.tl-detalhe__quem",
              {},
              quem.map((q) =>
                el("span.tl-detalhe__pessoa", {}, [
                  rosto(pessoa(q.id, q.nome), 24),
                  el("span", { text: q.id === this.eu ? "Você" : pessoa(q.id, q.nome).nome || q.nome }),
                  notas && q.nota != null ? el("b.tl-detalhe__nota", { text: fmt(q.nota) }) : null,
                ]),
              ),
            ),
          ]),
        ),
      ),
    ]);
  }

  #destaques(v, pessoas) {
    const r = v.res;
    const c = v.cfg;
    const pessoa = (x) => pessoas.find((p) => p.id === x.id) || x;
    const nome = (x) => (x.id === this.eu ? "Você" : pessoa(x).nome || x.nome);
    const cartao = (tipo, ic, titulo, corpo, abrir = null) =>
      el(`${abrir ? "button" : "div"}.tl-destaque.tl-destaque--${tipo}`, { type: abrir ? "button" : null, onClick: abrir }, [el("span.tl-destaque__icone", { "aria-hidden": "true" }, [icon(ic)]), el("div.tl-destaque__texto", {}, [el("span.jogos__rotulo", { text: titulo }), ...corpo])]);
    const abrirItem = (id) => () => {
      this.#ver = "galera";
      this.#sel = id;
      this.desenhar();
    };
    const minha = r.pessoas.find((x) => x.id === this.eu);
    const notas = v.modo === "notas";
    const blocos = [];
    if (notas && r.campeao) {
      blocos.push(cartao("campeao", "trophy", "Campeão", [el("strong", { text: r.campeao.t }), el("span.muted", { text: `Nota ${fmt(r.campeao.nota)}${r.lanterna ? ` · lanterna: ${r.lanterna.t} (${fmt(r.lanterna.nota)})` : ""}` })], abrirItem(r.campeao.id)));
    }
    if (minha && v.listas.length > 1) {
      blocos.push(
        el("div.tl-sintonia", { style: { "--pct": `${minha.concordancia}%` } }, [
          el("div.tl-sintonia__anel", {}, [el("b", { text: `${minha.concordancia}%` })]),
          el("div", {}, [el("span.jogos__rotulo", { text: "Sua sintonia com a galera" }), el("p", { text: minha.concordancia >= 85 ? "Você pensa igualzinho à turma." : minha.concordancia >= 65 ? "Bem alinhado, com umas opiniões próprias." : minha.concordancia >= 45 ? "Metade concorda, metade estranha." : "Você é a voz da discórdia. Assuma." })]),
        ]),
      );
    }
    if (r.polemico) {
      const it = r.polemico;
      const extremos = it.votos.reduce((acc, x) => ({ min: Math.min(acc.min, x.t), max: Math.max(acc.max, x.t) }), { min: Infinity, max: -Infinity });
      const faixaTxt = `De ${c.tiers[extremos.min]?.n || "?"} a ${c.tiers[extremos.max]?.n || "?"}. Discutam.`;
      const ns = it.votos.map((x) => x.nota).filter((x) => x != null);
      const notaTxt = ns.length ? `Notas de ${fmt(Math.min(...ns))} a ${fmt(Math.max(...ns))}. Discutam.` : faixaTxt;
      blocos.push(cartao("polemico", "zap", "O mais polêmico", [el("strong", { text: it.t }), el("span.muted", { text: notas ? notaTxt : faixaTxt })], abrirItem(it.id)));
    }
    if (r.unanimes.length) {
      blocos.push(cartao("unanime", "handshake", r.unanimes.length > 1 ? `${r.unanimes.length} unanimidades` : "Unanimidade", [el("strong", { text: r.unanimes.slice(0, 3).map((x) => x.t).join(", ") + (r.unanimes.length > 3 ? "…" : "") }), el("span.muted", { text: notas ? "Todo mundo deu quase a mesma nota." : "Todo mundo pôs na mesma faixa." })], abrirItem(r.unanimes[0].id)));
    }
    if (notas && r.melhores?.length > 1) {
      blocos.push(
        el("div.tl-destaque.tl-destaque--melhores", {}, [
          el("span.tl-destaque__icone", { "aria-hidden": "true" }, [icon("star")]),
          el("div.tl-destaque__texto", {}, [
            el("span.jogos__rotulo", { text: "O melhor em cada pergunta" }),
            el(
              "ul.tl-melhores",
              {},
              r.melhores.map((m) => el("li", {}, [el("button.tl-melhores__item", { type: "button", onClick: abrirItem(m.item.id) }, [el("span.muted", { text: m.pergunta }), el("strong.truncate", { text: m.item.t }), el("b", { text: fmt(m.nota) })])])),
            ),
          ]),
        ]),
      );
    }
    if (r.almasGemeas && v.listas.length >= 2) {
      const { a, b, afinidade } = r.almasGemeas;
      blocos.push(
        cartao("gemeas", "heart-handshake", "Almas gêmeas", [
          el("span.tl-destaque__rostos", {}, [rosto(pessoa(a), 28), rosto(pessoa(b), 28)]),
          el("strong", { text: `${nome(a)} e ${nome(b)}` }),
          el("span.muted", { text: `${afinidade}% de acordo` }),
        ]),
      );
    }
    if (r.doContra) {
      const x = r.doContra;
      blocos.push(cartao("contra", "flame", "Do contra", [el("span.tl-destaque__rostos", {}, [rosto(pessoa(x), 28)]), el("strong", { text: nome(x) }), el("span.muted", { text: `Só ${x.concordancia}% de acordo com a galera` })], () => ((this.#ver = x.id), (this.#sel = null), this.desenhar())));
    }
    if (!blocos.length) blocos.push(el("p.jg-vazio", { text: "Com mais gente ranqueando aparecem os destaques: o polêmico, as unanimidades e as almas gêmeas." }));
    return el("div.tl-destaques__lista", {}, blocos);
  }

  /* --------------------------- levar embora --------------------------- */

  #listaVista() {
    const v = this.l.vista(this.pessoas());
    if (v.fase !== "revelada") return null;
    const { faixas } = this.#faixasVistas(v);
    const notas = v.modo === "notas";
    const dono = this.#ver === "galera" ? null : v.listas.find((x) => x.id === this.#ver);
    const de = dono ? (dono.id === this.eu ? "A minha lista" : `A lista de ${this.pessoas().find((p) => p.id === dono.id)?.nome || dono.nome}`) : `A tier list da galera · ${v.listas.length} ${v.listas.length === 1 ? "pessoa" : "pessoas"}`;
    return { v, faixas, de, notas };
  }

  async #baixarImagem() {
    const x = this.#listaVista();
    if (!x) return;
    try {
      const blob = await imagemDaLista({ titulo: x.v.cfg.titulo, subtitulo: x.notas ? `${x.de} · notas de ${ESCALAS[x.v.cfg.escala].nome}` : x.de, tiers: x.v.cfg.tiers, faixas: x.faixas, notas: x.notas });
      if (!blob) throw new Error("sem imagem");
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `${x.v.cfg.titulo.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "tier-list"}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      this.c.avisar("Não deu para gerar a imagem.", "warn");
    }
  }

  async #copiarTexto() {
    const x = this.#listaVista();
    if (!x) return;
    const linhas = [`${x.v.cfg.titulo} — ${x.de}`, ""];
    x.v.cfg.tiers.forEach((t, i) => linhas.push(`${t.n || i + 1}: ${x.faixas[i].map((it) => (x.notas && it.vista != null ? `${it.t} (${fmt(it.vista)})` : it.t)).join(", ") || "—"}`));
    try {
      await navigator.clipboard.writeText(linhas.join("\n"));
      this.c.avisar("Tier list copiada. É só colar na conversa.", "ok");
    } catch {
      this.c.avisar("Não deu para copiar.", "warn");
    }
  }
}

export const VISTAS_TIERLIST = { tierlist: VistaTierList };
