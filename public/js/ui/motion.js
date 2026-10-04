/**
 * ui/motion.js — o movimento do app, num lugar só.
 *
 * Tudo aqui é Web Animations API, nativa do navegador: a política de
 * segurança do app proíbe script de terceiros, e uma biblioteca de animação
 * não faria nada que `element.animate()` não faça.
 *
 * Três regras valem para o arquivo inteiro:
 *
 * 1. SÓ `transform`, `opacity` e `filter`. São as propriedades que o
 *    navegador anima na GPU, sem refazer layout — a chamada de vídeo já
 *    disputa CPU com a codificação, e animação que trava é pior que nenhuma.
 * 2. `scale` e `translate` INDIVIDUAIS, não `transform`. Eles se somam ao
 *    `transform` que o CSS já usa (centralizar um menu, espelhar um vídeo)
 *    em vez de substituí-lo durante a animação.
 * 3. `prefers-reduced-motion` desliga tudo. Movimento é enfeite; enjoo não.
 */

const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
export const calm = () => !!reduce?.matches;

/* ------------------------------------------------------------------ *
 * Molas
 *
 * Uma mola amortecida resolvida analiticamente e amostrada numa curva
 * `linear()` do CSS. O resultado é uma animação comum — cancelável,
 * composta pelo navegador, fora da thread principal — com o balanço de uma
 * física de verdade, e sem um laço de requestAnimationFrame por elemento.
 * ------------------------------------------------------------------ */

const LINEAR_OK = globalThis.CSS?.supports?.("transition-timing-function", "linear(0, 1)");

export function spring({ stiffness = 260, damping = 22, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const x = (t) =>
    zeta < 1
      ? 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
      : 1 - Math.exp(-w0 * t) * (1 + w0 * t);

  // Duração = último instante em que a mola ainda está a mais de 0,1% do fim.
  let end = 0;
  for (let t = 0; t < 3; t += 1 / 120) if (Math.abs(1 - x(t)) > 0.001) end = t;
  end = Math.max(end, 0.12);

  if (!LINEAR_OK) return { duration: Math.round(end * 1000), easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
  const pts = [];
  for (let i = 0; i <= 48; i++) pts.push(+x((end * i) / 48).toFixed(4));
  return { duration: Math.round(end * 1000), easing: `linear(${pts.join(", ")})` };
}

export const SPRING = {
  /** Botões, menus: rápido, quase sem balanço. */
  snappy: spring({ stiffness: 520, damping: 34 }),
  /** Cartões e janelas entrando: um balanço visível e curto. */
  bouncy: spring({ stiffness: 300, damping: 17 }),
  /** Reorganização da grade: macio, sem chamar atenção. */
  soft: spring({ stiffness: 190, damping: 25 }),
};

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

/** `el.animate` que respeita a preferência de movimento reduzido. */
export function animate(el, frames, opts = {}) {
  if (!el?.animate) return null;
  return el.animate(frames, calm() ? { ...opts, duration: 0, delay: 0 } : opts);
}

/**
 * Entrada padrão: sobe, cresce e ganha foco. Opacidade e desfoque vão numa
 * curva sem balanço — uma mola passaria de 100% e o desfoque ficaria
 * negativo —, e só a geometria vai na mola.
 */
export function rise(el, { delay = 0, y = 14, scale = 0.97, blur = 6, spring: s = SPRING.bouncy } = {}) {
  animate(
    el,
    [
      { opacity: 0, filter: `blur(${blur}px)` },
      { opacity: 1, filter: "blur(0px)" },
    ],
    { duration: 380, delay, easing: EASE_OUT, fill: "backwards" },
  );
  return animate(
    el,
    [
      { translate: `0 ${y}px`, scale: String(scale) },
      { translate: "0 0", scale: "1" },
    ],
    { ...s, delay, fill: "backwards" },
  );
}

/** A mesma entrada, em cascata. */
export function stagger(els, { gap = 45, delay = 0, ...opts } = {}) {
  [...els].forEach((el, i) => rise(el, { ...opts, delay: delay + i * gap }));
}

/**
 * FLIP: mede, muda, e anima cada nó da posição antiga para a nova.
 *
 * É o que faz a grade de vídeos se reorganizar deslizando quando alguém
 * entra ou sai, em vez de pular. Quem não existia antes entra crescendo.
 */
/*
 * SÓ ESCALA UNIFORME. A versão anterior escalava largura e altura por fatores
 * diferentes (`scale: sx sy`): quando o ladrilho mudava de proporção — alguém
 * entra, sai, começa a falar, a janela muda de tamanho — o conteúdo inteiro
 * esticava durante a mola, e o avatar virava uma elipse achatada. Como a
 * reorganização também acontece quando muda quem fala, as animações se
 * sobrepunham e o ladrilho passava boa parte do tempo deformado. Agora, se a
 * proporção muda, o ladrilho só desliza do centro antigo para o novo; a escala
 * entra apenas quando ela é a mesma nos dois eixos.
 */
const flipsAtivos = new WeakMap();

export function flip(getNodes, mutate) {
  if (calm()) return mutate();
  const before = new Map(getNodes().map((n) => [n, n.getBoundingClientRect()]));
  const result = mutate();
  for (const n of getNodes()) {
    const b = n.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const a = before.get(n);
    if (!a || !a.width) {
      animate(n, [{ opacity: 0, scale: "0.86" }, { opacity: 1, scale: "1" }], { ...SPRING.bouncy, fill: "backwards" });
      continue;
    }
    const sx = a.width / b.width;
    const sy = a.height / b.height;
    const uniforme = Math.abs(sx - sy) < 0.04;
    const s = uniforme ? (sx + sy) / 2 : 1;
    // Sem escala, o ponto que acompanha é o centro: o ladrilho sai de onde estava.
    const dx = uniforme ? a.left - b.left : a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = uniforme ? a.top - b.top : a.top + a.height / 2 - (b.top + b.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) continue;
    // A medida de antes já inclui o que a animação anterior estava mostrando:
    // a nova parte dali, e a anterior sai de cena em vez de se somar a ela.
    flipsAtivos.get(n)?.cancel();
    const origem = uniforme ? "0 0" : "50% 50%";
    flipsAtivos.set(
      n,
      n.animate(
        [
          { transformOrigin: origem, translate: `${dx}px ${dy}px`, scale: String(s) },
          { transformOrigin: origem, translate: "0 0", scale: "1" },
        ],
        SPRING.soft,
      ),
    );
  }
  return result;
}

/**
 * Troca de tela com a View Transitions API: o navegador fotografa o antes,
 * aplica a mudança e funde as duas imagens. A logo tem `view-transition-name`
 * (ver motion.css) e voa de um lugar para o outro entre as telas.
 */
export function swap(update) {
  if (calm() || !document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  const t = document.startViewTransition(update);
  // Uma troca que chega no meio de outra pula a animação da anterior; isso é
  // esperado, não erro — só a atualização em si precisa ser confiável.
  t.ready.catch(() => {});
  t.finished.catch(() => {});
  return t.updateCallbackDone;
}

/* ------------------------------------------------------------------ *
 * Intro com a logo
 *
 * A marca redesenhada em vetor, peça por peça: o fundo gira e assenta, os dois
 * corpos do "V" se desenham de cima para baixo, as cabeças caem com um
 * quique, e o nome sobe letra por letra. No fim, a logo voa até o lugar dela
 * na tela que ficou por baixo — a intro vira a própria interface.
 *
 * O overlay já está no HTML, então não existe o quadro em que a tela aparece
 * crua antes de o script carregar. Uma vez por sessão: é boas-vindas, não
 * pedágio. Clique ou tecla pulam.
 * ------------------------------------------------------------------ */

const INTRO_KEY = "vcall:intro";

export async function playIntro() {
  const root = document.getElementById("intro");
  if (!root) return;

  let seen = false;
  try {
    seen = sessionStorage.getItem(INTRO_KEY) === "1";
    sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* sem armazenamento: mostra */
  }
  if (seen || calm()) {
    root.remove();
    document.dispatchEvent(new CustomEvent("vcall:intro-done"));
    return;
  }

  const $ = (s) => root.querySelector(s);
  const mark = $(".intro__mark");
  const bodies = root.querySelectorAll(".intro__body");
  const heads = root.querySelectorAll(".intro__head");
  const letters = root.querySelectorAll(".intro__word span");
  const tag = $(".intro__tag");
  const halo = $(".intro__halo");

  let skipped = false;
  const skip = () => (skipped = true);
  root.addEventListener("pointerdown", skip, { once: true });
  addEventListener("keydown", skip, { once: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (ms) => {
    const t0 = performance.now();
    while (!skipped && performance.now() - t0 < ms) await wait(30);
  };

  root.classList.add("is-playing");

  // 1. O fundo arredondado gira e assenta.
  animate($(".intro__bg"), [
    { opacity: 0, scale: "0.4", rotate: "-24deg" },
    { opacity: 1, scale: "1", rotate: "0deg" },
  ], { ...SPRING.bouncy, fill: "backwards" });
  animate(halo, [{ opacity: 0, scale: "0.6" }, { opacity: 1, scale: "1" }], {
    duration: 900,
    easing: EASE_OUT,
    fill: "backwards",
  });
  await step(220);

  // 2. Os corpos se desenham, o da direita um instante depois.
  bodies.forEach((b, i) =>
    animate(b, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: 460,
      delay: i * 90,
      easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      fill: "backwards",
    }),
  );
  await step(360);

  // 3. As cabeças caem e quicam.
  heads.forEach((h, i) =>
    animate(h, [
      { opacity: 0, translate: "0 -120px", scale: "0.5" },
      { opacity: 1, translate: "0 0", scale: "1" },
    ], { ...spring({ stiffness: 340, damping: 13 }), delay: i * 80, fill: "backwards" }),
  );
  await step(260);

  // 4. Um pulso de luz e o nome, letra por letra.
  animate(halo, [{ scale: "1", opacity: 1 }, { scale: "1.35", opacity: 0.25 }, { scale: "1", opacity: 1 }], {
    duration: 900,
    easing: "ease-in-out",
  });
  letters.forEach((l, i) =>
    animate(l, [
      { opacity: 0, translate: "0 0.6em", rotate: "8deg" },
      { opacity: 1, translate: "0 0", rotate: "0deg" },
    ], { ...SPRING.bouncy, delay: i * 55, fill: "backwards" }),
  );
  animate(tag, [{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], {
    duration: 500,
    delay: 380,
    easing: EASE_OUT,
    fill: "backwards",
  });
  await step(1100);

  await outro(root, mark);
}

/** A logo voa até a marca da tela de baixo, e o véu some. */
async function outro(root, mark) {
  const target = [...document.querySelectorAll(".brand__mark, .topbar__brand img")].find(
    (n) => n.offsetParent && n.getBoundingClientRect().width,
  );
  const b = target?.getBoundingClientRect();
  root.removeAttribute("id");
  document.dispatchEvent(new CustomEvent("vcall:intro-reveal"));
  const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 420,
    delay: 120,
    easing: "ease-out",
    fill: "forwards",
    pseudoElement: "::before",
  });
  root.querySelectorAll(".intro__word, .intro__tag").forEach((n) =>
    n.animate([{ opacity: 1 }, { opacity: 0, translate: "0 -6px" }], { duration: 200, fill: "forwards" }),
  );

  if (target && mark) {
    const a = mark.getBoundingClientRect();
    target.style.opacity = "0";
    const fly = mark.animate(
      [
        { translate: "0 0", scale: "1" },
        {
          translate: `${b.left + b.width / 2 - (a.left + a.width / 2)}px ${b.top + b.height / 2 - (a.top + a.height / 2)}px`,
          scale: String(b.width / a.width),
        },
      ],
      { duration: 620, easing: "cubic-bezier(0.7, 0, 0.2, 1)", fill: "forwards" },
    );
    root.querySelector(".intro__halo")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
    await fly.finished.catch(() => {});
    target.style.opacity = "";
    animate(target, [{ scale: "1.18" }, { scale: "1" }], SPRING.bouncy);
  } else {
    mark?.animate([{ opacity: 1, scale: "1" }, { opacity: 0, scale: "1.2" }], { duration: 400, fill: "forwards" });
  }
  await fade.finished.catch(() => {});
  root.remove();
  document.dispatchEvent(new CustomEvent("vcall:intro-done"));
}

/* ------------------------------------------------------------------ *
 * Diálogos
 *
 * `<dialog>` abre e fecha instantaneamente. Aqui ele ganha entrada em mola e
 * saída curta, sem mudar como o resto do código o usa: `showModal()`,
 * `close()`, Escape e `form[method=dialog]` continuam valendo.
 * ------------------------------------------------------------------ */

function wireDialogs() {
  const proto = HTMLDialogElement.prototype;
  const show = proto.showModal;
  const close = proto.close;
  const card = (d) => d.querySelector(".modal__card, .perms__card, .share__card") || d.firstElementChild;

  proto.showModal = function () {
    this._closing?.finish();
    show.call(this);
    animate(this, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    const c = card(this);
    animate(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    animate(c, [
      { translate: "0 18px", scale: "0.94" },
      { translate: "0 0", scale: "1" },
    ], SPRING.bouncy);
  };

  proto.close = function (value) {
    if (!this.open || this._closing || calm()) return close.call(this, value);
    const a = this.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" });
    card(this)?.animate([{ scale: "1" }, { scale: "0.96", translate: "0 6px" }], { duration: 150, easing: "ease-in", fill: "forwards" });
    this._closing = a;
    /*
     * O fechamento de verdade vem no fim da animação — e também num prazo
     * fixo. Se a animação não rodar (máquina lenta, janela em segundo plano,
     * aba sem foco), `finished` pode demorar ou nunca chegar, e o diálogo
     * ficava aberto e invisível (opacidade 0) na frente de tudo, engolindo
     * os cliques. Quem chegar primeiro fecha; o outro não faz nada.
     */
    const concluir = () => {
      if (this._closing !== a) return;
      this._closing = null;
      close.call(this, value);
      this.getAnimations().forEach((x) => x.cancel());
      card(this)?.getAnimations().forEach((x) => x.cancel());
    };
    a.finished.catch(() => {}).then(concluir);
    setTimeout(concluir, 320);
  };

  // Escape e botões de formulário fecham pelo caminho nativo, que não passa
  // por `close()`; aqui eles são desviados para a saída animada.
  document.addEventListener(
    "cancel",
    (e) => {
      if (e.target instanceof HTMLDialogElement && !calm()) {
        e.preventDefault();
        e.target.close();
      }
    },
    true,
  );
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (form.method !== "dialog" || calm()) return;
      const dlg = form.closest("dialog");
      if (!dlg) return;
      e.preventDefault();
      dlg.close(e.submitter?.value ?? "");
    },
    true,
  );
}

/* ------------------------------------------------------------------ *
 * O que aparece sozinho: avisos, menus, cartões de sala
 * ------------------------------------------------------------------ */

const seenRooms = new Set();

function onAdded(node) {
  if (!(node instanceof HTMLElement)) return;
  const cls = node.classList;
  if (cls.contains("toast")) {
    animate(node, [
      { opacity: 0, translate: "0 16px", scale: "0.9" },
      { opacity: 1, translate: "0 0", scale: "1" },
    ], SPRING.bouncy);
  } else if (cls.contains("popover")) {
    node.style.transformOrigin = "50% 100%";
    animate(node, [
      { opacity: 0, scale: "0.9", translate: "0 8px" },
      { opacity: 1, scale: "1", translate: "0 0" },
    ], SPRING.snappy);
    stagger(node.children, { gap: 18, y: 6, blur: 0, scale: 1, spring: SPRING.snappy });
  } else if (cls.contains("dashRoom")) {
    // A lista é redesenhada a cada sondagem; só a sala nova chega animada.
    const key = node.dataset.key;
    if (key && !seenRooms.has(key)) {
      seenRooms.add(key);
      rise(node, { delay: [...node.parentElement.children].indexOf(node) * 50 });
    }
  } else if (cls.contains("dash")) {
    liven(node);
  }
}

/**
 * A recepção ganha vida: conteúdo em cascata, balões de conversa que surgem
 * e flutuam, a mão do "Bom dia" acenando, e o palco da ilustração inclinando
 * de leve com o mouse. Os laços infinitos são animações compostas — custam
 * nada de CPU — e somem junto com a tela.
 */
function liven(dash) {
  // Debaixo da intro ninguém veria a entrada: ela espera o véu começar a sair.
  if (document.getElementById("intro")) {
    document.addEventListener("vcall:intro-reveal", () => liven(dash), { once: true });
    return;
  }
  animate(dash.querySelector(".dash__head"), [{ opacity: 0, translate: "0 -12px" }, { opacity: 1, translate: "0 0" }], {
    duration: 420,
    easing: EASE_OUT,
    fill: "backwards",
  });
  const scribble = dash.querySelector(".dash__scribble path");
  animate(scribble, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 700,
    delay: 700,
    easing: "cubic-bezier(0.65, 0, 0.35, 1)",
    fill: "backwards",
  });
  stagger(dash.querySelectorAll(".dash__intro > *, .dash__stage"), {
    delay: 90,
    gap: 55,
  });

  dash.querySelectorAll(".dash__bubble").forEach((b, i) => {
    const delay = 650 + i * 260;
    animate(b, [
      { opacity: 0, scale: "0.4", translate: "0 16px" },
      { opacity: 1, scale: "1", translate: "0 0" },
    ], { ...spring({ stiffness: 360, damping: 15 }), delay, fill: "backwards" });
    if (!calm()) {
      b.animate([{ translate: "0 0" }, { translate: `0 ${i % 2 ? 7 : -7}px` }, { translate: "0 0" }], {
        duration: 3400 + i * 600,
        delay: delay + 700,
        iterations: Infinity,
        easing: "ease-in-out",
        composite: "add",
      });
    }
  });

  magnetic(dash.querySelector(".dash__actions .btn--primary"));

  const art = dash.querySelector(".dash__art");
  const stage = dash.querySelector(".dash__stage");
  if (art && stage && !calm() && matchMedia("(hover: hover)").matches) {
    art.addEventListener("pointermove", (e) => {
      const r = art.getBoundingClientRect();
      stage.style.setProperty("--ty", `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
      stage.style.setProperty("--tx", `${-((e.clientY - r.top) / r.height - 0.5) * 8}deg`);
    });
    art.addEventListener("pointerleave", () => {
      stage.style.setProperty("--tx", "0deg");
      stage.style.setProperty("--ty", "0deg");
    });
  }
}

function watchDom() {
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) onAdded(n);
  }).observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ *
 * Toque: mola ao apertar e uma onda saindo do ponto do clique
 * ------------------------------------------------------------------ */

const PRESSABLE = ".btn, .ctrl, .privacy, .avatarPicker__grid > *, .pip__btn";

function wirePointer() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || calm()) return;
      const el = e.target.closest?.(PRESSABLE);
      if (!el || el.disabled) return;

      // `composite: "add"` multiplica sobre a escala que o botão já tem (a
      // ampliação da barra de controles), em vez de pular para 0,93 absoluto.
      const down = el.animate([{ scale: "1" }, { scale: "0.93" }], {
        duration: 110,
        easing: "ease-out",
        fill: "forwards",
        composite: "add",
      });
      const up = () => {
        removeEventListener("pointerup", up);
        removeEventListener("pointercancel", up);
        down.cancel();
        el.animate([{ scale: "0.93" }, { scale: "1" }], { ...spring({ stiffness: 500, damping: 14 }), composite: "add" });
      };
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);

      if (el.matches(".btn--primary, .ctrl")) ripple(el, e);
    },
    true,
  );
}

function ripple(el, e) {
  const r = el.getBoundingClientRect();
  const size = Math.hypot(r.width, r.height) * 2;
  let ink = el.querySelector(":scope > .fx-ink");
  if (!ink) {
    ink = document.createElement("span");
    ink.className = "fx-ink";
    ink.setAttribute("aria-hidden", "true");
    el.append(ink);
  }
  const dot = document.createElement("i");
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  ink.append(dot);
  dot
    .animate([{ scale: "0", opacity: 0.35 }, { scale: "1", opacity: 0 }], { duration: 650, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" })
    .finished.then(() => dot.remove(), () => dot.remove());
}

/* ------------------------------------------------------------------ *
 * O fundo acompanha o ponteiro, devagar
 *
 * Só enquanto o ponteiro se move: o laço para sozinho quando assenta, para
 * não gastar um quadro por segundo à toa durante a chamada.
 * ------------------------------------------------------------------ */

function wireAmbient() {
  const amb = document.querySelector(".ambient");
  if (!amb || calm()) return;
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const tick = () => {
    x += (tx - x) * 0.06;
    y += (ty - y) * 0.06;
    amb.style.setProperty("--mx", x.toFixed(3));
    amb.style.setProperty("--my", y.toFixed(3));
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
  };
  addEventListener(
    "pointermove",
    (e) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(tick);
    },
    { passive: true },
  );
}

export function installMotion() {
  wireDialogs();
  watchDom();
  wirePointer();
  wireAmbient();
}

/* ------------------------------------------------------------------ *
 * Reação: faíscas nas cores da marca
 *
 * Doze pontos saem do pé do ladrilho em leque, cada um com trajetória,
 * giro e tempo próprios, e caem com gravidade. É o que faz um "aplauso" ser
 * visto de relance por todo mundo na grade.
 * ------------------------------------------------------------------ */

const SPARK_COLORS = ["#fd4d87", "#fe9c5f", "#ffd1e1", "#ffffff", "#ff7aa8"];

export function burst(host, { count = 14 } = {}) {
  if (!host || calm()) return;
  const layer = document.createElement("div");
  layer.className = "fx-burst";
  layer.setAttribute("aria-hidden", "true");
  host.append(layer);
  const anims = [];
  for (let i = 0; i < count; i++) {
    const s = document.createElement("i");
    const size = 5 + Math.random() * 7;
    s.style.cssText = `width:${size}px;height:${size}px;background:${SPARK_COLORS[i % SPARK_COLORS.length]};border-radius:${i % 3 ? "50%" : "2px"}`;
    layer.append(s);
    const angle = (-90 + (Math.random() - 0.5) * 120) * (Math.PI / 180);
    const dist = 70 + Math.random() * 110;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    anims.push(
      s.animate(
        [
          { translate: "0 0", scale: "0.2", rotate: "0deg", opacity: 1 },
          { translate: `${dx}px ${dy}px`, scale: "1", rotate: `${(Math.random() - 0.5) * 360}deg`, opacity: 1, offset: 0.55 },
          { translate: `${dx * 1.15}px ${dy + 90}px`, scale: "0.6", rotate: `${(Math.random() - 0.5) * 540}deg`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
      ).finished,
    );
  }
  Promise.allSettled(anims).then(() => layer.remove());
}

/* ------------------------------------------------------------------ *
 * Barra de controles com ampliação
 *
 * Os botões perto do ponteiro crescem e sobem, como no dock do macOS, em
 * proporção à distância. Diz "é aqui que você está mirando" antes do clique,
 * e deixa alvos de 48px maiores exatamente onde o mouse está. Escrito em
 * `scale`/`translate` individuais, que a mola do clique também usa sem brigar.
 * ------------------------------------------------------------------ */

export function magnifyDock(dock) {
  if (!dock || calm() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const RANGE = 120;
  const GROW = 0.26;
  let raf = 0;
  let px = null;

  const paint = () => {
    raf = 0;
    for (const b of dock.querySelectorAll(".ctrl")) {
      if (px === null || !b.offsetParent) {
        b.style.scale = "";
        b.style.translate = "";
        continue;
      }
      const r = b.getBoundingClientRect();
      const d = Math.abs(px - (r.left + r.width / 2));
      const k = Math.max(0, 1 - d / RANGE);
      const eased = k * k * (3 - 2 * k); // suaviza a borda da influência
      b.style.scale = String(1 + GROW * eased);
      b.style.translate = `0 ${(-10 * eased).toFixed(1)}px`;
    }
  };
  const schedule = () => (raf ||= requestAnimationFrame(paint));
  dock.addEventListener("pointermove", (e) => {
    px = e.clientX;
    schedule();
  });
  dock.addEventListener("pointerleave", () => {
    px = null;
    schedule();
  });
}

/* ------------------------------------------------------------------ *
 * Sinal de chamada
 *
 * Três ondas saindo da logo, defasadas, enquanto a sala espera alguém. É o
 * único laço infinito da chamada — e só existe enquanto a tela de espera está
 * à vista: `stop()` cancela tudo quando a primeira pessoa entra.
 * ------------------------------------------------------------------ */

export function signal(rings) {
  if (calm()) return { stop() {} };
  const anims = [...rings].map((r, i) =>
    r.animate(
      [
        { scale: "0.6", opacity: 0.7 },
        { scale: "2.4", opacity: 0 },
      ],
      { duration: 2400, delay: i * 800, iterations: Infinity, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    ),
  );
  return { stop: () => anims.forEach((a) => a.cancel()) };
}

/**
 * Botão magnético: acompanha o ponteiro alguns pixels antes do clique. Só no
 * botão principal de cada tela — em todos viraria ruído.
 */
export function magnetic(el, strength = 0.22) {
  if (!el || calm() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * strength;
    const y = (e.clientY - r.top - r.height / 2) * strength;
    el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  });
  el.addEventListener("pointerleave", () => {
    el.animate([{ translate: el.style.translate || "0 0" }, { translate: "0 0" }], SPRING.bouncy);
    el.style.translate = "";
  });
}
