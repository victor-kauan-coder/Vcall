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
  { id: "transcript", icon: "captions", label: "Transcrição" },
  { id: "stats", icon: "activity", label: "Qualidade" },
];

export class Panel {
  open = false;
  tab = "chat";
  unread = 0;

  constructor({ onSend, onClose, onChange, onFiles, onPerson }) {
    this.onSend = onSend;
    this.onPerson = onPerson || null;
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
        dataset: { tip: t.label, "tip-placement": "bottom" },
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

    /* -- transcrição: o que foi dito, ao vivo, com busca -- */
    this.transcriptItems = [];
    this.transcriptList = el("div.panel__scroll.transcricao", { role: "log", "aria-live": "off" });
    this.transcriptSearch = el("input.input.transcricao__busca", {
      type: "search",
      placeholder: "Buscar no que foi dito…",
      "aria-label": "Buscar na transcrição",
    });
    this.transcriptSearch.addEventListener("input", () => this.#drawTranscript());
    this.transcriptActions = el("div.transcricao__acoes");
    this.transcriptHead = el("div.transcricao__topo", {}, [
      el("div.transcricao__campo", {}, [icon("search", { size: "sm" }), this.transcriptSearch]),
      this.transcriptActions,
    ]);

    this.bodies = {
      chat: el("div.panel__body", {}, [this.chatList, this.chatFoot]),
      people: el("div.panel__body", {}, [this.peopleList]),
      transcript: el("div.panel__body", {}, [this.transcriptHead, this.transcriptList]),
      stats: el("div.panel__body", {}, [this.statsList]),
    };

    node.append(tabs, this.bodies.chat, this.bodies.people, this.bodies.transcript, this.bodies.stats);
    this.#drawTranscript();
    this.#emptyChat();
    this.show("chat", { silent: true });
    return node;
  }

  /* ---------------------------------------------------------------- *
   * Transcrição
   * ---------------------------------------------------------------- */

  /** Botões do topo (copiar, baixar): quem sabe o que fazer é o app. */
  setTranscriptActions(acoes) {
    this.transcriptActions.replaceChildren(
      ...acoes.map(({ iconName, label, onClick }) =>
        el(
          "button.btn.btn--icon.btn--ghost",
          { type: "button", "aria-label": label, dataset: { tip: label, "tip-placement": "bottom" }, onClick },
          [icon(iconName, { size: "sm" })],
        ),
      ),
    );
  }

  addTranscript(item) {
    this.transcriptItems.push(item);
    if (this.transcriptItems.length > 5000) this.transcriptItems.splice(0, this.transcriptItems.length - 5000);
    const busca = this.transcriptSearch.value.trim();
    if (this.transcriptItems.length === 1 || busca) {
      this.#drawTranscript();
      return;
    }
    const perto = this.transcriptList.scrollHeight - this.transcriptList.scrollTop - this.transcriptList.clientHeight < 80;
    this.#appendTranscript(item);
    if (perto) this.transcriptList.scrollTop = this.transcriptList.scrollHeight;
  }

  #drawTranscript() {
    const busca = this.transcriptSearch.value.trim().toLocaleLowerCase("pt-BR");
    const itens = busca
      ? this.transcriptItems.filter((t) => `${t.name} ${t.text}`.toLocaleLowerCase("pt-BR").includes(busca))
      : this.transcriptItems;
    this.transcriptList.replaceChildren();
    if (!itens.length) {
      this.transcriptList.append(
        el("div.transcricao__vazio", {}, [
          icon("captions", { size: "lg" }),
          el("p", {
            text: busca
              ? "Nada encontrado com esse termo."
              : "Quando alguém ligar a legenda (tecla T), o que for dito aparece aqui, com nome e horário.",
          }),
        ]),
      );
      return;
    }
    for (const t of itens) this.#appendTranscript(t, busca);
    this.transcriptList.scrollTop = this.transcriptList.scrollHeight;
  }

  #appendTranscript(t, busca = "") {
    this.transcriptList.querySelector(".transcricao__vazio")?.remove();
    const texto = el("p.transcricao__texto");
    if (busca) {
      // Destaca o termo buscado sem montar HTML com o texto de ninguém.
      const baixo = t.text.toLocaleLowerCase("pt-BR");
      let i = 0;
      for (;;) {
        const j = baixo.indexOf(busca, i);
        if (j === -1) break;
        texto.append(document.createTextNode(t.text.slice(i, j)), el("mark", { text: t.text.slice(j, j + busca.length) }));
        i = j + busca.length;
      }
      texto.append(document.createTextNode(t.text.slice(i)));
    } else {
      texto.textContent = t.text;
    }
    this.transcriptList.append(
      el("div.transcricao__linha", {}, [
        el("div.transcricao__quem", {}, [
          el("strong", { text: t.name, style: t.color ? { color: t.color } : {} }),
          el("time", { text: formatClock(t.at), dateTime: new Date(t.at).toISOString() }),
        ]),
        texto,
      ]),
    );
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

  /** Quem anima a mudança de tamanho do palco (ui/stage.js). */
  animate = (fn) => fn();

  setOpen(open, tab = null) {
    // Abrir ou fechar o painel muda a largura do palco: os ladrilhos
    // deslizam para o lugar novo em vez de pular.
    if (open !== this.open) this.animate(() => (this.node.hidden = !open));
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
  completeFile(id, url, blob = null) {
    const alvo = $(`[data-file="${CSS.escape(String(id))}"]`, this.chatList);
    if (!alvo) return false;
    if (alvo.tagName === "A") alvo.href = url;
    const img = $("img", alvo);
    if (img) img.src = url;
    // O clique guarda o objeto do arquivo por closure; atualizar o endereço
    // dele aqui é o que faz o visualizador abrir a versão já completa.
    if (alvo.__arquivo) {
      alvo.__arquivo.url = url;
      if (blob) alvo.__arquivo.blob = blob;
    }
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

  /**
   * Lista de pessoas. Com `mod` (só para o anfitrião) cada pessoa ganha os
   * botões de silenciar, desligar câmera e remover, e o topo ganha "silenciar
   * todos" e "trancar a sala". A conferência de verdade é no servidor: estes
   * botões são só o caminho até ela.
   *
   * @param {Array} roster
   * @param {null|{closed:boolean, onMute:Function, onCamOff:Function, onKick:Function, onMuteAll:Function, onLock:Function}} mod
   */
  renderPeople(roster, mod = this.mod) {
    this.mod = mod;
    clear(this.peopleList);

    if (mod) {
      const outros = roster.filter((p) => !p.self);
      const trancar = el(
        "button.btn.btn--ghost.people__acao",
        {
          type: "button",
          "aria-pressed": String(!!mod.closed),
          onClick: () => mod.onLock(!mod.closed),
        },
        [icon(mod.closed ? "lock" : "lock-open", { size: "sm" }), el("span", { text: mod.closed ? "Sala trancada" : "Trancar sala" })],
      );
      trancar.dataset.tip = mod.closed ? "Ninguém novo entra. Clique para destrancar." : "Impede que mais alguém entre";
      const todos = el(
        "button.btn.btn--ghost.people__acao",
        { type: "button", disabled: !outros.some((p) => p.state?.mic), onClick: () => mod.onMuteAll() },
        [icon("mic-off", { size: "sm" }), el("span", { text: "Silenciar todos" })],
      );
      this.peopleList.append(
        el("div.people__host", {}, [
          el("div.people__hostTitulo", {}, [icon("crown", { size: "sm" }), el("span", { text: "Você é o anfitrião" })]),
          el("div.people__hostAcoes", {}, [todos, trancar]),
        ]),
      );
    }

    // Mãos levantadas primeiro, na ordem em que subiram (a fila da reunião).
    const fila = roster
      .filter((p) => p.state?.hand)
      .sort((a, b) => (a.handAt || 0) - (b.handAt || 0))
      .map((p) => p.id);
    const ordenado = [...roster].sort((a, b) => {
      const ia = fila.indexOf(a.id);
      const ib = fila.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      return 0;
    });

    for (const p of ordenado) {
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
      if (p.state?.hand) {
        const pos = fila.indexOf(p.id) + 1;
        icons.append(
          el("span.person__mao", { title: `Mão levantada — ${pos}º da fila` }, [
            icon("hand", { size: "sm", label: "Mão levantada" }),
            el("b", { text: `${pos}º` }),
          ]),
        );
      }

      const sub = [];
      if (p.self) sub.push("Você");
      if (p.host) sub.push("Anfitrião");
      if (!p.self && p.connection !== "connected") sub.push("conectando…");
      else if (!p.self) sub.push(QUALITY_LABEL[p.quality] || "");
      // Tempo de fala: quem já falou quanto (só a partir de meio minuto).
      if (p.falaMs >= 30_000) sub.push(`falou ${formatarFala(p.falaMs)}`);

      const nome = p.name || "Convidado";
      const conteudo = [
        avatarEl(p.avatar, { title: nome }),
        el("div.person__texto", {}, [
          el("div.person__name", {}, [
            el("span.truncate", { text: nome }),
            p.host ? icon("crown", { size: "sm", label: "Anfitrião", className: "person__coroa" }) : null,
          ].filter(Boolean)),
          el("div.person__sub", { text: sub.filter(Boolean).join(" · ") }),
        ]),
      ];

      const principal = this.onPerson
        ? el(
            "button.person__main",
            {
              type: "button",
              "aria-label": p.self ? "Editar o seu perfil" : `Destacar ${nome}`,
              dataset: { tip: p.self ? "Editar perfil" : "Ver em destaque", "tip-placement": "left" },
              onClick: () => this.onPerson(p),
            },
            conteudo,
          )
        : el("div.person__main", {}, conteudo);

      const linha = el("div.person", { dataset: { id: p.id } }, [principal, icons]);

      if (mod && !p.self) {
        const acao = (nomeIcone, rotulo, fn, { perigo = false, desligado = false } = {}) =>
          el(
            `button.person__acao${perigo ? ".person__acao--perigo" : ""}`,
            {
              type: "button",
              disabled: desligado,
              "aria-label": `${rotulo}: ${nome}`,
              dataset: { tip: rotulo, "tip-placement": "top" },
              onClick: () => fn(p),
            },
            [icon(nomeIcone, { size: "sm" })],
          );
        linha.append(
          el("div.person__acoes", {}, [
            p.state?.hand ? acao("hand", "Baixar a mão", mod.onLowerHand) : null,
            acao("mic-off", "Silenciar", mod.onMute, { desligado: !p.state?.mic }),
            acao("video-off", "Desligar câmera", mod.onCamOff, { desligado: !p.state?.cam }),
            acao("user-x", "Remover da sala", mod.onKick, { perigo: true }),
          ].filter(Boolean)),
        );
      }
      this.peopleList.append(linha);
    }

    // Quem o anfitrião removeu: dá para deixar voltar (engano, ou a pessoa
    // pediu desculpas). Ela entra de novo pelo mesmo link.
    if (mod?.banned?.length) {
      const bloco = el("div.people__removidos", {}, [
        el("div.people__secao", { text: `Removidos da sala · ${mod.banned.length}` }),
      ]);
      for (const b of mod.banned) {
        const nome = b.name || "Convidado";
        bloco.append(
          el("div.person.person--removido", { dataset: { banned: b.id } }, [
            el("div.person__main", {}, [
              avatarEl(b.avatar, { title: nome }),
              el("div.person__texto", {}, [
                el("div.person__name", {}, [el("span.truncate", { text: nome })]),
                el("div.person__sub", { text: "não consegue entrar enquanto estiver removido" }),
              ]),
            ]),
            el(
              "button.btn.btn--ghost.people__readmitir",
              { type: "button", "aria-label": `Deixar ${nome} voltar`, onClick: () => mod.onUnban(b) },
              [icon("user-check", { size: "sm" }), el("span", { text: "Deixar voltar" })],
            ),
          ]),
        );
      }
      this.peopleList.append(bloco);
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

/** "2 min", "1 h 05 min" — o suficiente para comparar quem falou mais. */
export function formatarFala(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
