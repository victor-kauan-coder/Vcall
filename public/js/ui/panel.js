/**
 * ui/panel.js — painel lateral: conversa, pessoas e qualidade da chamada.
 */
import { el, icon, clear, $ } from "../lib/dom.js";
import { avatarEl } from "./avatars.js";
import {
  formatBitrate,
  formatClock,
  formatMs,
  linkify,
} from "../lib/util.js";
import { QUALITY_LABEL } from "../core/stats.js";
import { formatSize } from "../features/transfer.js";
import { abrirVisualizador, podeVisualizar } from "./lightbox.js";

const TABS = [
  { id: "chat", icon: "message-square", label: "Conversa" },
  { id: "people", icon: "users", label: "Pessoas" },
  { id: "stats", icon: "activity", label: "Qualidade" },
];

export class Panel {
  open = false;
  tab = "chat";
  unread = 0;

  constructor({ onSend, onClose, onChange, onFiles }) {
    this.onSend = onSend;
    this.onClose = onClose || (() => {});
    this.onChange = onChange || (() => {});
    this.onFiles = onFiles || null;
    this.node = this.#build();
  }

  #build() {
    const node = el("aside.panel", { hidden: true, "aria-label": "Painel lateral" });

    const tabs = el("div.panel__tabs", { role: "tablist" });
    this.tabButtons = new Map();
    for (const t of TABS) {
      const b = el("button.panel__tab", {
        type: "button",
        role: "tab",
        "aria-selected": String(this.tab === t.id),
        onClick: () => this.show(t.id),
      });
      b.append(icon(t.icon, { size: "sm" }), el("span", { text: t.label }));
      this.tabButtons.set(t.id, b);
      tabs.append(b);
    }
    tabs.append(
      el(
        "button.btn.btn--icon.btn--ghost",
        { type: "button", "aria-label": "Fechar painel", onClick: () => this.onClose() },
        [icon("x", { size: "sm" })],
      ),
    );

    this.chatList = el("div.panel__scroll", { role: "log", "aria-live": "polite" });
    this.peopleList = el("div.panel__scroll");
    this.statsList = el("div.panel__scroll");

    this.composerInput = el("textarea.composer__input", {
      rows: 1,
      placeholder: "Escreva uma mensagem…",
      maxLength: 2000,
      "aria-label": "Mensagem",
    });
    this.composerInput.addEventListener("input", () => {
      this.composerInput.style.height = "auto";
      this.composerInput.style.height = `${Math.min(140, this.composerInput.scrollHeight)}px`;
    });
    this.composerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.#send();
      }
    });

    const sendBtn = el(
      "button.btn.btn--primary.btn--icon",
      { type: "button", "aria-label": "Enviar", onClick: () => this.#send() },
      [icon("send", { size: "sm" })],
    );

    const composer = el("div.composer", {}, [this.composerInput, sendBtn]);

    if (this.onFiles) {
      this.filePicker = el("input.sr-only", { type: "file", multiple: true, tabIndex: -1 });
      this.filePicker.addEventListener("change", () => {
        if (this.filePicker.files?.length) this.onFiles([...this.filePicker.files]);
        this.filePicker.value = "";
      });
      composer.prepend(
        el(
          "button.btn.btn--icon.btn--ghost",
          {
            type: "button",
            "aria-label": "Anexar arquivo",
            dataset: { tip: "Anexar arquivo", "tip-placement": "top" },
            onClick: () => this.filePicker.click(),
          },
          [icon("hard-drive", { size: "sm" })],
        ),
        this.filePicker,
      );

      // Arrastar para dentro da conversa é o gesto que a maioria tenta antes
      // de procurar o clipe.
      const stop = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        this.chatList.classList.add("is-dropping");
      };
      this.chatList.addEventListener("dragover", stop);
      this.chatList.addEventListener("dragenter", stop);
      this.chatList.addEventListener("dragleave", () => this.chatList.classList.remove("is-dropping"));
      this.chatList.addEventListener("drop", (e) => {
        e.preventDefault();
        this.chatList.classList.remove("is-dropping");
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) this.onFiles(files);
      });

      /*
       * Colar uma captura de tela direto no campo de mensagem.
       *
       * É o gesto mais natural que existe para "olha esse erro aqui": Print
       * Screen e Ctrl+V. Sem isto, a pessoa precisaria salvar a imagem em
       * arquivo antes, só para anexá-la em seguida.
       */
      this.composerInput.addEventListener("paste", (e) => {
        const itens = [...(e.clipboardData?.items || [])];
        const arquivos = itens
          .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
          .map((i) => i.getAsFile())
          .filter(Boolean);
        if (!arquivos.length) return;
        e.preventDefault();
        // Nome legível: o navegador entrega tudo como "image.png".
        const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        this.onFiles(
          arquivos.map((f, i) =>
            new File([f], `captura-${carimbo}${arquivos.length > 1 ? `-${i + 1}` : ""}.png`, {
              type: f.type || "image/png",
            }),
          ),
        );
      });
    }

    this.chatFoot = el("div.panel__foot", {}, [composer]);

    this.bodies = {
      chat: el("div.panel__body", {}, [this.chatList, this.chatFoot]),
      people: el("div.panel__body", {}, [this.peopleList]),
      stats: el("div.panel__body", {}, [this.statsList]),
    };

    node.append(tabs, this.bodies.chat, this.bodies.people, this.bodies.stats);
    this.#emptyChat();
    this.show("chat", { silent: true });
    return node;
  }

  #send() {
    const text = this.composerInput.value.trim();
    if (!text) return;
    this.composerInput.value = "";
    this.composerInput.style.height = "auto";
    this.onSend(text);
  }

  /* ---------------------------------------------------------------- */

  show(tab, { silent = false } = {}) {
    this.tab = tab;
    for (const [id, b] of this.tabButtons) b.setAttribute("aria-selected", String(id === tab));
    for (const [id, body] of Object.entries(this.bodies)) body.hidden = id !== tab;
    if (tab === "chat") {
      this.unread = 0;
      this.#scrollChat();
      if (!silent) this.composerInput.focus();
    }
    this.onChange({ open: this.open, tab, unread: this.unread });
    return tab;
  }

  setOpen(open, tab = null) {
    this.open = open;
    this.node.hidden = !open;
    if (open && tab) this.show(tab);
    else if (open) this.show(this.tab);
    this.onChange({ open, tab: this.tab, unread: this.unread });
    return open;
  }

  toggle(tab = null) {
    if (this.open && (!tab || tab === this.tab)) return this.setOpen(false);
    return this.setOpen(true, tab);
  }

  /* ---------------------------------------------------------------- *
   * Conversa
   * ---------------------------------------------------------------- */

  #emptyChat() {
    if (this.chatList.childElementCount) return;
    this.chatList.append(
      el("div.panel__empty", {}, [
        icon("message-square-text", { size: "xl" }),
        el("p", { text: "Nenhuma mensagem ainda." }),
        el("p.muted", { text: "As mensagens ficam só nesta sala e somem quando ela acaba." }),
      ]),
    );
  }

  addMessage({ id, name, avatar, text, at = Date.now(), self = false }) {
    $(".panel__empty", this.chatList)?.remove();

    const last = this.chatList.lastElementChild;
    const sameAuthor = last?.dataset?.author === id && at - Number(last.dataset.at || 0) < 120_000;

    if (sameAuthor) {
      const body = $(".msg__body", last);
      body.append(el("div.msg__text", {}, [linkify(text)]));
      last.dataset.at = String(at);
    } else {
      const node = el(
        "div.msg",
        { dataset: { author: id, at: String(at) } },
        [
          avatarEl(avatar, { title: name }),
          el("div.msg__body", {}, [
            el("div.msg__head", {}, [
              el("span.msg__name", { text: self ? "Você" : name }),
              el("span.msg__time", { text: formatClock(at) }),
            ]),
            el("div.msg__text", {}, [linkify(text)]),
          ]),
        ],
      );
      this.chatList.append(node);
    }

    if (!self && !(this.open && this.tab === "chat")) this.unread += 1;
    this.onChange({ open: this.open, tab: this.tab, unread: this.unread });
    this.#scrollChat();
  }

  /**
   * Bolha de arquivo. Imagem vira miniatura clicável; o resto vira um cartão
   * com nome, tamanho e um botão de baixar — o nome do arquivo entra como
   * texto, nunca como HTML, porque quem o escolheu foi outra pessoa.
   */
  addFile({ id, name, avatar, file, self = false, at = Date.now() }) {
    $(".panel__empty", this.chatList)?.remove();

    const body = el("div.msg__body", {}, [
      el("div.msg__head", {}, [
        el("span.msg__name", { text: self ? "Você" : name }),
        el("span.msg__time", { text: formatClock(at) }),
      ]),
    ]);

    const visualizavel = podeVisualizar(file.mime);
    const ehImagem = String(file.mime || "").startsWith("image/");

    /*
     * Imagem aparece como imagem, e não como um cartão de arquivo.
     *
     * Uma captura de tela mandada no meio da conversa é para ser olhada na
     * hora; obrigar a baixar, procurar na pasta e abrir noutro programa é
     * trabalho demais para dois segundos de atenção. O arquivo já está na
     * memória do navegador, então mostrá-lo não custa rede nenhuma.
     */
    if (ehImagem) {
      const fig = el("button.msgImg", {
        type: "button",
        dataset: { file: String(file.id) },
        "aria-label": `Ver ${file.name}`,
        title: file.name,
        onClick: () => abrirVisualizador(fig.__arquivo || file),
      });
      fig.__arquivo = file;
      fig.append(
        el("img.msgImg__thumb", { src: file.url || "", alt: file.name, loading: "lazy" }),
        el("span.msgImg__lupa", {}, [icon("maximize-2", { size: "sm" })]),
      );
      body.append(fig);
      const barraImg = el("div.fileCard__bar", { dataset: { id: String(file.id) } }, [el("i")]);
      body.append(barraImg);
      this.chatList.append(
        el("div.msg", { dataset: { author: id, at: String(at) } }, [
          avatarEl(avatar, { title: name }),
          body,
        ]),
      );
      if (!self && !(this.open && this.tab === "chat")) this.unread += 1;
      this.onChange({ open: this.open, tab: this.tab, unread: this.unread });
      this.#scrollChat();
      return barraImg;
    }

    // O resto vira cartão. Clicar abre o visualizador quando o navegador sabe
    // desenhar o formato; senão, baixa — que é a resposta honesta para um .zip.
    const card = el(visualizavel ? "button.fileCard" : "a.fileCard", {
      ...(visualizavel
        ? { type: "button", onClick: () => abrirVisualizador(card.__arquivo || file) }
        : { href: file.url || "#", download: file.name }),
      title: visualizavel ? `Ver ${file.name}` : `Baixar ${file.name}`,
      dataset: { file: String(file.id) },
    });

    card.__arquivo = file;
    card.append(el("span.fileCard__icon", {}, [icon(iconePara(file.mime), { size: "sm" })]));
    card.append(
      el("span.fileCard__meta", {}, [
        el("span.fileCard__name.truncate", { text: file.name }),
        el("span.fileCard__size", { text: formatSize(file.size) }),
      ]),
      el("span.fileCard__go", {}, [icon(visualizavel ? "eye" : "download", { size: "sm" })]),
    );

    // A barra some sozinha quando a transferência acaba; até lá ela é a única
    // pista de que um arquivo de 20 MB está mesmo a caminho.
    // A barra é identificada pelo arquivo, não por quem mandou: a mesma pessoa
    // pode estar enviando dois anexos ao mesmo tempo, e o progresso de um não
    // pode mexer no outro.
    const bar = el("div.fileCard__bar", { dataset: { id: String(file.id) } }, [el("i")]);
    body.append(card, bar);

    this.chatList.append(
      el("div.msg", { dataset: { author: id, at: String(at) } }, [
        avatarEl(avatar, { title: name }),
        body,
      ]),
    );

    if (!self && !(this.open && this.tab === "chat")) this.unread += 1;
    this.onChange({ open: this.open, tab: this.tab, unread: this.unread });
    this.#scrollChat();
    return bar;
  }

  /** Move a barra de progresso de um arquivo; 1 remove a barra. */
  setFileProgress(id, ratio) {
    const bar = $(`.fileCard__bar[data-id="${CSS.escape(String(id))}"]`, this.chatList);
    if (!bar) return;
    if (ratio >= 1) {
      bar.remove();
      return;
    }
    bar.firstElementChild.style.width = `${Math.round(ratio * 100)}%`;
  }

  /**
   * O cartão entra na conversa assim que o primeiro pedaço chega, sem endereço
   * ainda; quando o arquivo termina de montar, é aqui que ele ganha o link e a
   * miniatura. Mostrar o cartão desde o começo é o que dá a sensação de que
   * algo está acontecendo durante uma transferência longa.
   */
  completeFile(id, url) {
    const alvo = $(`[data-file="${CSS.escape(String(id))}"]`, this.chatList);
    if (!alvo) return false;
    if (alvo.tagName === "A") alvo.href = url;
    const img = $("img", alvo);
    if (img) img.src = url;
    // O clique guarda o objeto do arquivo por closure; atualizar o endereço
    // dele aqui é o que faz o visualizador abrir a versão já completa.
    if (alvo.__arquivo) alvo.__arquivo.url = url;
    this.setFileProgress(id, 1);
    return true;
  }

  addSystem(text) {
    $(".panel__empty", this.chatList)?.remove();
    this.chatList.append(el("div.msg.msg--system", { text }));
    this.#scrollChat();
  }

  #scrollChat() {
    // Só acompanha o fim se o usuário já estava lá — não sequestra a rolagem
    // de quem está lendo mensagens antigas.
    const near = this.chatList.scrollHeight - this.chatList.scrollTop - this.chatList.clientHeight < 120;
    if (near || this.tab !== "chat") {
      requestAnimationFrame(() => {
        this.chatList.scrollTop = this.chatList.scrollHeight;
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Pessoas
   * ---------------------------------------------------------------- */

  renderPeople(roster) {
    clear(this.peopleList);
    for (const p of roster) {
      const icons = el("div.person__icons");
      icons.append(
        icon(p.state?.mic ? "mic" : "mic-off", {
          size: "sm",
          label: p.state?.mic ? "Microfone ligado" : "Microfone mudo",
          className: p.state?.mic ? "" : "is-off",
        }),
        icon(p.state?.cam ? "video" : "video-off", {
          size: "sm",
          label: p.state?.cam ? "Câmera ligada" : "Câmera desligada",
          className: p.state?.cam ? "" : "is-off",
        }),
      );
      if (p.state?.screen) icons.append(icon("screen-share", { size: "sm", label: "Compartilhando a tela" }));
      if (p.state?.hand) icons.append(icon("hand", { size: "sm", label: "Mão levantada" }));

      const sub = [];
      if (p.self) sub.push("Você");
      if (p.host) sub.push("Anfitrião");
      if (!p.self && p.connection !== "connected") sub.push("conectando…");
      else if (!p.self) sub.push(QUALITY_LABEL[p.quality] || "");

      this.peopleList.append(
        el("div.person", {}, [
          avatarEl(p.avatar, { title: p.name }),
          el("div", {}, [
            el("div.person__name", { text: p.name || "Convidado" }),
            el("div.person__sub", { text: sub.filter(Boolean).join(" · ") }),
          ]),
          icons,
        ]),
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * Qualidade
   * ---------------------------------------------------------------- */

  renderStats(samples, roster, { history } = {}) {
    if (this.tab !== "stats") return; // não gasta quadro com painel invisível
    clear(this.statsList);

    if (!samples || samples.size === 0) {
      this.statsList.append(
        el("div.panel__empty", {}, [
          icon("activity", { size: "xl" }),
          el("p", { text: "Nenhuma conexão para medir ainda." }),
        ]),
      );
      return;
    }

    for (const [id, s] of samples) {
      const person = roster.find((p) => p.id === id);
      const group = el("div.statGroup");
      group.append(
        el("div.statGroup__head", {}, [
          avatarEl(person?.avatar, { title: person?.name || "" }),
          el("span", { text: person?.name || "Participante" }),
          el("span.spacer"),
          el("span.badge", {
            class:
              s.quality === "good"
                ? "badge--ok"
                : s.quality === "fair"
                  ? "badge--warn"
                  : s.quality === "poor"
                    ? "badge--danger"
                    : "",
            text: QUALITY_LABEL[s.quality] || "—",
          }),
        ]),
      );

      const row = (k, v, tone = null) =>
        group.append(
          el("div.statRow", {}, [
            el("span.statRow__k", { text: k }),
            el("span.statRow__v", { text: v, dataset: tone ? { tone } : {} }),
          ]),
        );

      row("Latência", formatMs(Math.round(s.rttSmoothed ?? NaN)), toneFor(s.rttSmoothed, 150, 300));
      row("Perda de pacotes", s.lossSmoothed != null ? `${s.lossSmoothed.toFixed(1)} %` : "—", toneFor(s.lossSmoothed, 1.5, 4));
      row("Banda disponível", formatBitrate(s.transport.availableOutgoing));
      row("Rota", s.relay ? "via servidor TURN" : "direta (P2P)", s.relay ? "warn" : "ok");

      const out = s.outbound.screen || s.outbound.cam;
      if (out) {
        const kind = s.outbound.screen ? "tela" : "câmera";
        row(`Enviando ${kind}`, formatBitrate(out.bitrate));
        if (out.width) row("Resolução enviada", `${out.width}×${out.height} @ ${Math.round(out.fps ?? 0)} fps`);
        if (out.codec) row("Codec", out.codec);
        if (out.limitedBy && out.limitedBy !== "none") {
          row(
            "Limitado por",
            out.limitedBy === "cpu" ? "processador" : out.limitedBy === "bandwidth" ? "banda" : out.limitedBy,
            "warn",
          );
        }
        if (out.encodeMs != null) row("Custo de codificação", `${out.encodeMs.toFixed(1)} ms/quadro`, toneFor(out.encodeMs, 15, 25));
      }

      const inb = s.inbound.screen || s.inbound.cam;
      if (inb) {
        const kind = s.inbound.screen ? "tela" : "câmera";
        row(`Recebendo ${kind}`, formatBitrate(inb.bitrate));
        if (inb.width) row("Resolução recebida", `${inb.width}×${inb.height} @ ${Math.round(inb.fps ?? 0)} fps`);
        if (inb.freezeCount) row("Congelamentos", String(inb.freezeCount), inb.freezeCount > 3 ? "warn" : null);
      }

      const hist = history?.(id);
      if (hist?.length > 2) group.append(sparkline(hist));

      this.statsList.append(group);
    }
  }
}

/** Um ícone que diga de que tipo de arquivo se trata, de relance. */
function iconePara(mime = "") {
  const t = String(mime).toLowerCase();
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "volume-2";
  if (t === "application/pdf") return "clipboard-check";
  if (t.startsWith("text/")) return "type";
  return "hard-drive";
}

function toneFor(value, warn, danger) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= danger) return "danger";
  if (value >= warn) return "warn";
  return "ok";
}

/**
 * Minigráfico da taxa de envio. Desenhado em SVG para acompanhar o tema sem
 * redesenho manual.
 */
function sparkline(values) {
  const w = 100;
  const h = 28;
  const max = Math.max(...values, 1);
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  const area = document.createElementNS(ns, "polygon");
  area.setAttribute("points", `0,${h} ${points.join(" ")} ${w},${h}`);
  area.setAttribute("fill", "var(--accent-soft)");

  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--accent)");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("vector-effect", "non-scaling-stroke");

  svg.append(area, line);
  return svg;
}
