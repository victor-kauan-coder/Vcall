/**
 * ui/dashboard.js — painel inicial de chamadas ativas.
 *
 * O que este painel pode e não pode mostrar decorre de uma decisão do
 * sistema: o id de uma sala É o segredo dela. Listar todas as salas seria
 * publicar todas as chaves. Por isso o diretório mostra apenas salas que
 * alguém marcou como PÚBLICAS ao criá-las; as privadas — o padrão — não
 * aparecem aqui nem por engano, e só são alcançadas por link ou código.
 *
 * A atualização é por sondagem a cada poucos segundos, e não por WebSocket.
 * Assinar o diretório exigiria uma conexão de sinalização antes de entrar em
 * qualquer sala, aberta o tempo todo em cada aba parada nesta tela; uma
 * requisição curta a cada cinco segundos entrega a mesma sensação de tempo
 * real por muito menos.
 */
import { el, icon, clear, on } from "../lib/dom.js";
import { avatarEl } from "./avatars.js";
import { toast } from "./toast.js";
import { newRoomId, prefs } from "../lib/util.js";

const POLL_MS = 5000;
/** Quantas salas cabem na tela inicial sem rolagem; o resto vira "+N". */
const MAX_VISIVEIS = 3;

function saudacao() {
  const h = new Date().getHours();
  const greet = h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const name = String(prefs.get("name", "") || "").split(" ")[0];
  return name ? `${greet}, ${name}` : greet;
}

export class Dashboard {
  #timer = 0;
  #rooms = [];
  #list = null;
  #empty = null;
  #count = null;
  #node = null;

  constructor({ onEnter }) {
    /** onEnter({ roomId, pass, meta, isNew }) */
    this.onEnter = onEnter;
  }

  mount(root) {
    // Tela cheia, sem cartão: a recepção É o app, não uma janela dentro dele.
    this.#node = el("section.dash", { "aria-label": "Início" }, [
      this.#header(),
      el("main.dash__main", {}, [this.#hero()]),
    ]);
    root.append(this.#node);
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), POLL_MS);
    // Uma aba em segundo plano não precisa sondar nada.
    on(document, "visibilitychange", () => {
      if (!document.hidden) this.refresh();
    });
    return this.#node;
  }

  hide() {
    clearInterval(this.#timer);
    this.#timer = 0;
    this.#node?.remove();
    this.#node = null;
  }

  /* ---------------------------------------------------------------- */

  #header() {
    return el("header.dash__head", {}, [
      el("img.brand__mark", { src: "/assets/logo-mark.png", alt: "", width: 36, height: 36 }),
      el("div.brand__name", { text: "Vcall" }),
      el("span.spacer"),
      el("span.dash__greet", { text: saudacao() }),
      el("span.dash__status", {}, [el("i"), el("span", { text: "Pronto para chamar" })]),
    ]);
  }

  /**
   * A recepção: quem abre o app é cumprimentado pelo nome (se já entrou
   * antes), entende em uma frase o que dá para fazer, e tem a ação principal
   * ao alcance do polegar. A ilustração ocupa o outro lado e dá rosto à tela.
   */
  #hero() {
    const chip = (iconName, text) => el("li", {}, [icon(iconName, { size: "sm" }), el("span", { text })]);
    const bubble = (cls, iconName, text) =>
      el(`div.dash__bubble.${cls}`, { "aria-hidden": "true" }, [icon(iconName, { size: "sm" }), el("span", { text })]);

    return el("div.dash__hero", {}, [
      el("div.dash__intro", {}, [
        el("h1.dash__headline", {}, ["Chame quem importa, ", this.#scribble("direto"), " de um computador para o outro."]),
        el("p.dash__lead", {
          text: "Vídeo, voz, tela e um quadro infinito para desenhar junto. Criptografado de ponta a ponta — quem você convida não precisa de conta.",
        }),
        this.#actions(),
        el("ul.dash__trust", {}, [
          chip("shield-check", "Ponta a ponta"),
          chip("users", "Até 16 pessoas"),
          chip("pencil", "Quadro colaborativo"),
        ]),
        this.#body(),
      ]),
      el("div.dash__art", {}, [
        el("div.dash__stage", {}, [
          el("img", { src: "/assets/illustrations/hero.svg", alt: "", width: 466, height: 379, decoding: "async" }),
        ]),
        bubble("dash__bubble--a", "mic", "Oi! Tá me ouvindo?"),
        bubble("dash__bubble--b", "sparkles", "Bora desenhar?"),
        bubble("dash__bubble--c", "shield-check", "Só entre nós"),
      ]),
    ]);
  }

  /** Palavra com um traço feito à mão embaixo — ui/motion.js desenha o traço. */
  #scribble(word) {
    const span = el("em.dash__scribble", { text: word });
    span.insertAdjacentHTML(
      "beforeend",
      '<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M3 14 C 40 5, 80 4, 120 9 S 180 15, 197 6"/></svg>',
    );
    return span;
  }

  #actions() {
    const codeInput = el("input.input.mono", {
      type: "text",
      placeholder: "Código da sala",
      maxLength: 8,
      "aria-label": "Entrar com um código",
      autocapitalize: "characters",
      spellcheck: false,
    });
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#enterByCode(codeInput.value);
    });

    return el("div.dash__actions", {}, [
      el("button.btn.btn--primary.btn--lg", {
        type: "button",
        onClick: () => this.#openCreate(),
      }, [icon("video"), el("span", { text: "Criar nova call" })]),
      el("div.dash__code", {}, [
        codeInput,
        el("button.btn", { type: "button", onClick: () => this.#enterByCode(codeInput.value) }, [
          icon("arrow-right", { size: "sm" }),
          el("span", { text: "Entrar" }),
        ]),
      ]),
    ]);
  }

  #body() {
    this.#count = el("span.dash__count", { text: "…" });
    this.#list = el("div.dash__list", { role: "list" });
    this.#empty = el("div.dash__empty", {}, [
      el("img.dash__emptyArt", { src: "/assets/illustrations/empty.svg", alt: "", width: 72, height: 48, decoding: "async" }),
      el("p.dash__emptyTitle", { text: "Nenhuma call pública no ar agora." }),
      el("p.field__hint", {
        text: "Salas privadas não aparecem aqui — o endereço delas é o segredo. Entre pelo link ou pelo código que você recebeu.",
      }),
    ]);
    return el("div.dash__body", {}, [
      el("div.row", {}, [
        el("h2.dash__title", {}, [el("i.dash__live", { "aria-hidden": "true" }), "Ao vivo agora"]),
        this.#count,
        el("span.spacer"),
        el("button.btn.btn--icon.btn--ghost", {
          type: "button",
          "aria-label": "Atualizar lista",
          dataset: { tip: "Atualizar", "tip-placement": "bottom" },
          onClick: () => this.refresh(),
        }, [icon("refresh-cw")]),
      ]),
      this.#list,
      this.#empty,
    ]);
  }

  /* ---------------------------------------------------------------- *
   * Diretório
   * ---------------------------------------------------------------- */

  async refresh() {
    if (!this.#node) return;
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this.#rooms = Array.isArray(data.rooms) ? data.rooms : [];
      this.#render();
    } catch {
      if (this.#count) this.#count.textContent = "sem contato com o servidor";
    }
  }

  #render() {
    if (!this.#list) return;
    clear(this.#list);
    const n = this.#rooms.length;
    const people = this.#rooms.reduce((a, r) => a + r.size, 0);
    this.#count.textContent = n
      ? `${n} ${n === 1 ? "sala" : "salas"} · ${people} ${people === 1 ? "pessoa" : "pessoas"}`
      : "";
    this.#empty.hidden = n > 0;

    // A tela inicial não rola: mostra as mais cheias e resume o resto.
    const ordenadas = [...this.#rooms].sort((a, b) => b.size - a.size);
    for (const room of ordenadas.slice(0, MAX_VISIVEIS)) this.#list.append(this.#card(room));
    if (ordenadas.length > MAX_VISIVEIS) {
      this.#list.append(el("p.dash__more", { text: `+ ${ordenadas.length - MAX_VISIVEIS} salas públicas no ar — entre pelo código` }));
    }
  }

  #card(room) {
    const status = room.full
      ? { tone: "danger", text: "Sala cheia" }
      : room.sharing
        ? { tone: "ok", text: "Compartilhando tela" }
        : room.size > 1
          ? { tone: "ok", text: "Em conversa" }
          : { tone: "warn", text: "Aguardando alguém" };

    const enter = el("button.btn.btn--primary", {
      type: "button",
      disabled: room.full,
      onClick: () => this.#enter(room),
    }, [icon("arrow-right", { size: "sm" }), el("span", { text: room.full ? "Cheia" : "Entrar" })]);

    return el("div.dashRoom", { role: "listitem", dataset: { key: room.code || room.name } }, [
      el("div.dashRoom__avatar", {}, [
        room.host?.avatar
          ? avatarEl(room.host.avatar, { size: 44, title: `Avatar de ${room.host.name}` })
          : el("div.avatar", { style: { width: "44px", height: "44px" } }),
      ]),
      el("div.dashRoom__info", {}, [
        el("div.dashRoom__name", {}, [
          el("span", { text: room.name }),
          room.locked ? icon("lock", { size: "sm", label: "Sala com senha" }) : null,
        ]),
        el("div.dashRoom__meta", {}, [
          el("span", { text: room.host?.name ? `por ${room.host.name}` : "sem anfitrião" }),
          el("span.dot-sep", { text: `${room.size}/${room.max} ${room.size === 1 ? "pessoa" : "pessoas"}` }),
          el("span.dot-sep.mono", { text: room.code }),
        ]),
      ]),
      el("span.spacer"),
      el(`span.badge.badge--${status.tone}`, { text: status.text }),
      el("button.btn.btn--icon.btn--ghost", {
        type: "button",
        "aria-label": "Copiar link de convite",
        dataset: { tip: "Copiar link", "tip-placement": "left" },
        onClick: () => copy(linkFor(room.id), "Link copiado"),
      }, [icon("link")]),
      el("button.btn.btn--icon.btn--ghost", {
        type: "button",
        "aria-label": "Copiar código P2P",
        dataset: { tip: "Copiar código", "tip-placement": "left" },
        onClick: () => copy(room.code, `Código ${room.code} copiado`),
      }, [icon("copy")]),
      enter,
    ]);
  }

  /* ---------------------------------------------------------------- *
   * Entrada
   * ---------------------------------------------------------------- */

  #enter(room) {
    if (!room.locked) {
      this.onEnter({ roomId: room.id, pass: "", isNew: false, roomName: room.name });
      return;
    }
    this.#askPassword(room);
  }

  async #enterByCode(raw) {
    const code = String(raw || "").trim().toUpperCase();
    if (code.length < 4) {
      toast("Digite o código de 6 caracteres da sala.", { tone: "info" });
      return;
    }
    try {
      const res = await fetch(`/api/code/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!res.ok) {
        toast("Não achei nenhuma sala com esse código. Ele expira quando a sala esvazia.", {
          tone: "warn",
        });
        return;
      }
      const data = await res.json();
      this.#enter({ id: data.id, name: data.name, locked: data.locked, code });
    } catch {
      toast("Não foi possível falar com o servidor.", { tone: "warn" });
    }
  }

  #askPassword(room) {
    const input = el("input.input", { type: "password", placeholder: "Senha da sala", autofocus: true });
    const dlg = modal({
      title: `Entrar em “${room.name || "sala privada"}”`,
      body: [
        el("p.muted", { text: "Esta sala pede senha. Peça a quem te convidou." }),
        input,
      ],
      confirm: "Entrar",
      onConfirm: () => {
        const pass = input.value;
        if (!pass) return false;
        this.onEnter({ roomId: room.id, pass, isNew: false, roomName: room.name });
        return true;
      },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") dlg.confirm();
    });
  }

  #openCreate() {
    const nameInput = el("input.input", {
      type: "text",
      maxLength: 48,
      placeholder: "Ex.: Revisão de arquitetura",
      value: prefs.get("room:lastName", ""),
    });

    const passInput = el("input.input", { type: "password", placeholder: "Senha (opcional)" });
    const passField = el("label.field", { hidden: true }, [
      el("span.field__label", { text: "Senha" }),
      passInput,
    ]);

    const options = el("div.dash__privacy", { role: "radiogroup", "aria-label": "Privacidade" });
    let visibility = prefs.get("room:lastVisibility", "private");

    const mk = (value, iconName, title, hint) => {
      const b = el("button.privacy", {
        type: "button",
        role: "radio",
        "aria-checked": String(visibility === value),
        onClick: () => {
          visibility = value;
          for (const other of options.children) {
            other.setAttribute("aria-checked", String(other === b));
          }
        },
      }, [
        icon(iconName),
        el("div", {}, [el("strong", { text: title }), el("div.field__hint", { text: hint })]),
      ]);
      options.append(b);
    };
    mk(
      "private",
      "lock",
      "Privada",
      "Não aparece no painel. Só entra quem tem o link ou o código.",
    );
    mk(
      "public",
      "users",
      "Pública",
      "Listada aqui para qualquer pessoa neste servidor entrar.",
    );

    const passToggle = el("input", { type: "checkbox" });
    passToggle.addEventListener("change", () => {
      passField.hidden = !passToggle.checked;
      if (passToggle.checked) passInput.focus();
    });

    modal({
      title: "Criar nova call",
      body: [
        el("label.field", {}, [
          el("span.field__label", { text: "Nome da sala" }),
          nameInput,
          el("div.field__hint", {
            text: "Aparece no painel se a sala for pública, e no topo da chamada para todo mundo.",
          }),
        ]),
        options,
        el("label.row", {}, [
          passToggle,
          el("div", {}, [
            el("div", { text: "Proteger com senha" }),
            el("div.field__hint", { text: "A senha é conferida no servidor e nunca é guardada em claro." }),
          ]),
        ]),
        passField,
      ],
      confirm: "Criar e entrar",
      onConfirm: () => {
        const name = nameInput.value.trim().slice(0, 48);
        prefs.set("room:lastName", name);
        prefs.set("room:lastVisibility", visibility);
        this.onEnter({
          roomId: newRoomId(),
          pass: passToggle.checked ? passInput.value : "",
          isNew: true,
          roomName: name,
          meta: {
            name,
            visibility,
            pass: passToggle.checked ? passInput.value : "",
          },
        });
        return true;
      },
    });
  }
}

/* ==================================================================== *
 * Auxiliares
 * ==================================================================== */

export function linkFor(roomId) {
  return `${location.origin}${location.pathname}#${roomId}`;
}

export async function copy(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage, { tone: "ok", ms: 2000 });
  } catch {
    toast(`Copie manualmente: ${text}`, { tone: "info", ms: 8000 });
  }
}

/** Diálogo simples em cima de <dialog>, para não reinventar foco e Escape. */
function modal({ title, body, confirm: confirmLabel, onConfirm }) {
  const dlg = el("dialog.modal");
  const ok = el("button.btn.btn--primary", { type: "button", text: confirmLabel });
  const card = el("div.modal__card", {}, [
    el("div.modal__head", {}, [
      el("h2.modal__title", { text: title }),
      el("button.btn.btn--icon.btn--ghost", {
        type: "button",
        "aria-label": "Fechar",
        onClick: () => dlg.close(),
      }, [icon("x")]),
    ]),
    el("div.modal__body", {}, body),
    el("div.modal__foot", {}, [
      el("span.spacer"),
      el("button.btn", { type: "button", text: "Cancelar", onClick: () => dlg.close() }),
      ok,
    ]),
  ]);
  dlg.append(card);
  document.body.append(dlg);

  const run = () => {
    if (onConfirm() !== false) dlg.close();
  };
  ok.addEventListener("click", run);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
  return { el: dlg, confirm: run };
}
