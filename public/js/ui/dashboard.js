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

/**
 * O indicativo desta estação.
 *
 * No radioamadorismo o indicativo é a identidade do operador: dado uma vez,
 * usado a vida toda, e é o que aparece grande no cartão QSL. Aqui ele é
 * sorteado na primeira abertura e guardado — é o que faz o cartão ser DESTA
 * máquina e não um pôster igual para todo mundo.
 *
 * O prefixo PY é o real do Brasil na alocação da UIT, o que ancora a peça
 * em algo verdadeiro em vez de inventar um código decorativo.
 */
function indicativo() {
  const guardado = prefs.get("indicativo", null);
  if (guardado) return guardado;
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const sorteia = (alfabeto, n) =>
    Array.from({ length: n }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join("");
  const novo = `PY${Math.floor(Math.random() * 9) + 1}${sorteia(letras, 3)}`;
  prefs.set("indicativo", novo);
  return novo;
}

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

  constructor({ onEnter, ...opts } = {}) {
    /** onEnter({ roomId, pass, meta, isNew }) */
    this.onEnter = onEnter;
    /** { nome, theme, onSettings } — tudo opcional. */
    this.opts = opts;
  }

  mount(root) {
    // Tela cheia, sem cartão: a recepção É o app, não uma janela dentro dele.
    this.#node = el("section.estacao", { "aria-label": "Início" }, [
      this.#header(),
      el("main.estacao__mesa", {}, [
        this.#hero(),
        this.#body(),
        el("div.estacao__pe", {}, [
          el("span", { text: "Vcall · contato direto, sem intermediário · " }),
          el("a", {
            href: "https://github.com/victor-kauan-coder",
            target: "_blank",
            rel: "noopener noreferrer",
            text: "victor-kauan-coder",
          }),
        ]),
      ]),
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

  /**
   * A faixa de cima.
   *
   * SEM LOGOTIPO. Quem abriu o programa sabe que programa é; a marca já está
   * no ícone da janela, na barra de tarefas e no título. Repetir aqui gastava
   * o canto mais nobre da tela com a única informação que ninguém precisa.
   *
   * No lugar entra o que é útil: o cumprimento pelo nome, se o aparelho está
   * pronto para chamar, e o acesso às configurações — que antes só existia
   * dentro de uma chamada, ou seja, tarde demais para quem queria escolher a
   * câmera ANTES de aparecer para alguém.
   */
  /*
   * A faixa de cima da estação: só o que muda. Sem logotipo — quem abriu o
   * programa sabe que programa é, e a marca já está no ícone da janela.
   */
  #header() {
    const botao = (iconName, rotulo, aoClicar) => {
      const b = el("button.estacao__botao", {
        type: "button",
        "aria-label": rotulo,
        onClick: aoClicar,
      });
      b.append(icon(iconName, { size: "sm" }), el("span", { text: rotulo }));
      return b;
    };

    const tema = botao("laptop", "Tema", () => {});
    this.opts.theme?.bindButton?.(tema);

    return el("header.estacao__topo", {}, [
      el("span.estacao__noAr", {}, [el("i", { "aria-hidden": "true" }), el("span", { text: "Estação no ar" })]),
      el("span.spacer"),
      el("span", { text: saudacao() + (this.opts.nome ? `, ${this.opts.nome}` : "") }),
      tema,
      botao("settings", "Ajustes", () => this.opts.onSettings?.()),
    ]);
  }

  /**
   * O cartão QSL.
   *
   * No radioamadorismo o cartão é a prova impressa de um contato direto
   * entre duas estações, trocada pelo correio, sem ninguém no meio — que é
   * exatamente o que o Vcall faz. Por isso os campos do cartão são os campos
   * de verdade do produto, e não decoração: PARA é quem você chama, VIA é a
   * rota (direta, sem servidor), MODO é o que a sala faz, SINAL é a cifra.
   *
   * A ação principal mora DENTRO do cartão, como o carimbo mora no papel.
   */
  #hero() {
    const campo = (rotulo, valor) =>
      el("div.qsl__campo", {}, [el("dt", { text: rotulo }), el("dd", { text: valor })]);

    const entrada = el("input", {
      type: "text",
      placeholder: "Indicativo",
      maxLength: 8,
      "aria-label": "Entrar com o indicativo da sala",
      autocapitalize: "characters",
      spellcheck: false,
    });
    entrada.addEventListener("input", () => {
      entrada.value = entrada.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    entrada.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#enterByCode(entrada.value);
    });

    const carimbo = el("button.carimbo", { type: "button", onClick: () => this.#openCreate() });
    carimbo.append(icon("video"), el("span", { text: "Abrir estação" }));

    return el("div.qsl", {}, [
      el("div.qsl__cabeca", {}, [
        el("div", {}, [
          el("span.qsl__rotulo", { text: "Indicativo desta estação" }),
          el("strong.qsl__indicativo", { text: indicativo() }),
        ]),
        el("div.qsl__selo", {}, [
          el("span", {}, [
            el("b", { text: "QSL" }),
            el("i", { text: "contato direto" }),
            el("i", { text: "confirmado" }),
          ]),
        ]),
      ]),

      el("dl.qsl__campos", {}, [
        campo("Para", "Quem importa"),
        campo("Via", "Direto, sem servidor"),
        campo("Modo", "Voz · vídeo · tela · quadro"),
        campo("Sinal", "Ponta a ponta"),
      ]),

      el("p.qsl__frase", {
        text: "Áudio, vídeo e tela vão de um computador ao outro sem passar por lugar nenhum. Quem você chamar não precisa instalar nada nem criar conta.",
      }),

      el("div.qsl__acoes", {}, [
        carimbo,
        el("div.qsl__entrada", {}, [
          entrada,
          el("button", { type: "button", onClick: () => this.#enterByCode(entrada.value), text: "Entrar" }),
        ]),
      ]),
    ]);
  }

  /**
   * O caderno de registro.
   *
   * Um operador anota cada contato numa linha regrada: indicativo, horário,
   * sinal. É mais denso e mais rápido de varrer que cartões empilhados — e
   * cartões empilhados é o que qualquer aplicativo entregaria.
   */
  #body() {
    this.#count = el("span", { text: "…" });
    this.#list = el("div.registro__lista", { role: "list" });
    this.#empty = el("div.registro__vazio", {}, [
      el("strong", { text: "Nenhuma estação pública no ar." }),
      el("span", {
        text: "Sala privada não aparece no caderno — o indicativo dela é o segredo. Entre pelo link ou pelo código que você recebeu.",
      }),
    ]);

    return el("div.registro", {}, [
      el("dl.registro__painel", {}, [
        el("div", {}, [el("dt", { text: "Potência" }), el("dd", { text: "16 estações" })]),
        el("div", {}, [el("dt", { text: "Modo" }), el("dd", { text: "P2P malha" })]),
        el("div", {}, [el("dt", { text: "Cifra" }), el("dd", { text: "DTLS-SRTP" })]),
      ]),
      el("div.registro__cabeca", {}, [
        el("span", { text: "Caderno de registro" }),
        el("span.spacer"),
        this.#count,
        el("button.estacao__botao", {
          type: "button",
          "aria-label": "Atualizar o caderno",
          onClick: () => this.refresh(),
        }, [icon("refresh-cw", { size: "sm" })]),
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
      if (this.#count) this.#count.textContent = "sem contato";
    }
  }

  #render() {
    if (!this.#list) return;
    clear(this.#list);
    const n = this.#rooms.length;
    const people = this.#rooms.reduce((a, r) => a + r.size, 0);
    this.#count.textContent = n ? `${n} no ar · ${people} op.` : "";
    this.#empty.hidden = n > 0;

    // A tela inicial não rola: mostra as mais cheias e resume o resto.
    const ordenadas = [...this.#rooms].sort((a, b) => b.size - a.size);
    for (const room of ordenadas.slice(0, MAX_VISIVEIS)) this.#list.append(this.#card(room));
    if (ordenadas.length > MAX_VISIVEIS) {
      this.#list.append(
        el("p.registro__vazio", { text: `+ ${ordenadas.length - MAX_VISIVEIS} no ar — entre pelo indicativo` }),
      );
    }
  }

  /** Uma sala é uma linha do caderno, não um cartão. */
  #card(room) {
    const estado = room.full
      ? "CHEIA"
      : room.sharing
        ? "TELA"
        : room.size > 1
          ? "EM CONTATO"
          : "CHAMANDO";

    const linha = el("button.registro__linha", {
      type: "button",
      role: "listitem",
      disabled: room.full,
      dataset: { key: room.code || room.name },
      "aria-label": `Entrar na sala ${room.name}`,
      onClick: () => this.#enter(room),
    }, [
      el("span.registro__nome", { text: `${room.locked ? "· " : ""}${room.name}` }),
      el("span.registro__dado", {}, [
        el("span.registro__sinal", { text: estado }),
        el("span", { text: `  ${room.size}/${room.max}  ${room.code}` }),
      ]),
    ]);
    return linha;
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
