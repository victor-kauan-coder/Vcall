/**
 * quizzv.js — a página do QR do Quiz (/quizzv#token).
 *
 * Quem lê o QR com o aplicativo QuizzV nem passa por aqui: o app tira o
 * endereço e o token do próprio texto do QR. Esta página é para quem apontou
 * a câmera comum do celular. Ela oferece abrir o QuizzV, ou responder ali
 * mesmo: fala o mesmo protocolo do app (src/quizzv.js) e desenha a mesma
 * "vista" que o navegador da pessoa manda (features/quizzv.js).
 *
 * O token vem no fragmento (#), que o navegador não envia a servidor nenhum.
 */
import { el } from "./lib/dom.js";
import { QUIZZV_PROTOCOLO, linkDoQuizzv } from "./features/quizzv.js";

const $ = (s) => document.querySelector(s);
const LETRAS = "ABCDE";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CHAVE = "quizzv:token";
let token = "";
try {
  token = decodeURIComponent(location.hash.slice(1));
} catch {
  /* fragmento malformado: tratado como link incompleto */
}
/*
 * O token sai da barra de endereços (não fica no histórico nem nas abas
 * sincronizadas do navegador) e passa a morar na sessão desta aba — que
 * sobrevive a um recarregar, mas morre quando a aba fecha.
 */
try {
  if (TOKEN_RE.test(token)) sessionStorage.setItem(CHAVE, token);
  else token = sessionStorage.getItem(CHAVE) || token;
} catch {
  /* sem armazenamento: vale só a memória da página */
}
const valido = TOKEN_RE.test(token);
if (location.hash) history.replaceState(null, "", location.pathname);

const MOTIVOS = {
  "pareamento-invalido": ["Código expirado", "Este QR já não vale: a pessoa saiu da chamada, ou a chamada acabou. Gere outro no Quiz, em “Pelo celular”."],
  "saiu-da-chamada": ["Você saiu da chamada", "Entre de novo na chamada e gere outro QR no Quiz."],
  "sala-encerrada": ["A chamada terminou", "Não há mais Quiz para responder aqui."],
  substituido: ["Conectado em outro aparelho", "Este código foi aberto em outro lugar, e a conexão passou para lá."],
  versao: ["Versões diferentes", "Atualize a página. Se continuar, quem hospeda a chamada precisa atualizar o Vcall."],
};

function porta(titulo, texto, { botoes = true } = {}) {
  $("#jogo").hidden = true;
  $("#porta").hidden = false;
  $("#titulo").textContent = titulo;
  $("#texto").textContent = texto;
  $("#abrirApp").hidden = !botoes;
  $("#noNavegador").hidden = !botoes;
  $("#rodape").hidden = !botoes;
}

if (!valido) {
  porta("Link incompleto", "Este QR não traz o código de pareamento. Gere outro na chamada, no Quiz.", { botoes: false });
} else {
  $("#abrirApp").href = linkDoQuizzv(location.origin, token);
  $("#noNavegador").addEventListener("click", () => conectar());
}

/* ------------------------------------------------------------------ */

let ws = null;
let tentativa = 0;
let encerrado = false;
let nome = "";
/** Última vista e o instante (performance.now) em que chegou. */
let vista = null;
let chegou = 0;
let relogio = 0;

function enviar(a) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "quiz-do-celular", a }));
}

function conectar() {
  // A reconexão e a volta à aba podem chegar juntas: uma conexão por vez.
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  $("#porta").hidden = true;
  $("#jogo").hidden = false;
  if (!vista) desenhar();
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const sock = new WebSocket(`${proto}//${location.host}`);
  ws = sock;
  let ping = 0;
  sock.addEventListener("open", () => {
    tentativa = 0;
    sock.send(JSON.stringify({ t: "quiz-ola", token, v: QUIZZV_PROTOCOLO, app: "navegador" }));
    ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ t: "ping", n: 1 })), 15_000);
  });
  sock.addEventListener("message", (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.t === "quiz-conectado") {
      nome = m.voce?.nome || "";
      document.title = nome ? `Quiz · ${nome}` : "Quiz pelo celular · Vcall";
      return;
    }
    if (m.t === "quiz-vista") {
      vista = m.v;
      chegou = performance.now();
      desenhar();
      return;
    }
    if (ws !== sock) return; // resposta de uma conexão antiga
    if (m.t === "quiz-erro" && MOTIVOS[m.erro]) {
      encerrado = true;
      try {
        sessionStorage.removeItem(CHAVE); // não vale mais: não sobra na aba
      } catch {
        /* sem armazenamento */
      }
      porta(...MOTIVOS[m.erro], { botoes: false });
    }
  });
  sock.addEventListener("close", () => {
    clearInterval(ping);
    if (encerrado || ws !== sock) return;
    // Queda de rede: tenta de novo, com espera crescente. O token continua
    // valendo enquanto a pessoa estiver na chamada.
    tentativa += 1;
    setTimeout(() => !encerrado && conectar(), Math.min(15_000, 500 * 2 ** Math.min(tentativa, 5)));
  });
}

// Voltou à aba depois de o celular dormir: reconecta na hora.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || encerrado || $("#jogo").hidden) return;
  if (!ws || ws.readyState === WebSocket.CLOSED) conectar();
});

/* ------------------------------------------------------------------ *
 * Desenho
 * ------------------------------------------------------------------ */

function centro(...filhos) {
  return el("div.qvp__centro", {}, filhos);
}

function placar(v) {
  if (!v.placar?.length) return null;
  return el("ol.qvp__placar", { "aria-label": "Placar" }, v.placar.map((x, i) =>
    el("li", { class: x.eu ? "is-eu" : "" }, [el("span", { text: `${i + 1}º` }), el("span", { text: x.eu ? `${x.nome} (você)` : x.nome }), el("b", { text: String(x.total) })])));
}

function desenhar() {
  const raiz = $("#jogo");
  clearInterval(relogio);
  const v = vista;
  if (!v) {
    raiz.replaceChildren(centro(el("strong", { text: "Conectando à chamada…" })));
    return;
  }
  if (v.fase === "lobby") {
    raiz.replaceChildren(
      centro(
        el("strong", { text: v.quizzv ? `“${v.quizzv.titulo}” está pronto` : "Conectado ao Quiz" }),
        el("span", { text: "Quando o Quiz começar na chamada, as perguntas aparecem aqui." }),
      ),
    );
    return;
  }
  if (v.fase === "fim") {
    raiz.replaceChildren(
      centro(el("strong", { text: v.titulo ? `Fim de “${v.titulo}”!` : "Fim do quiz!" }), v.eu ? el("span", { text: `Você ficou em ${v.eu.pos}º, com ${v.eu.total} pontos.` }) : null),
      placar(v) || el("span"),
    );
    return;
  }
  if (v.fase === "preparar") {
    const n = el("span.qvp__grande");
    const pinta = () => (n.textContent = String(Math.max(1, Math.ceil((v.contagemMs - (performance.now() - chegou)) / 1000))));
    pinta();
    relogio = setInterval(pinta, 200);
    raiz.replaceChildren(centro(el("strong", { text: v.k === 0 ? "Preparem-se!" : `Pergunta ${v.k + 1}` }), n));
    return;
  }

  const revelada = v.fase === "revelada";
  const tempo = el("b.qvp__tempo");
  const barra = el("div.qvp__barra", { "aria-hidden": "true" }, [el("i")]);
  const pinta = () => {
    const resta = Math.max(0, v.restanteMs - (performance.now() - chegou)) / 1000;
    tempo.textContent = revelada ? "" : String(Math.ceil(resta));
    tempo.classList.toggle("is-acabando", resta <= 5);
    barra.firstChild.style.setProperty("--p", String(revelada ? 0 : resta / (v.limite || 20)));
  };
  pinta();
  if (!revelada) relogio = setInterval(pinta, 250);

  const minha = v.minha?.e;
  const opcoes = v.pergunta.opcoes.map((texto, i) => {
    const classes = [`qvp__opcao--${i}`];
    if (minha === i) classes.push("is-minha");
    if (revelada && i === v.pergunta.certa) classes.push("is-certa");
    else if (revelada || (minha != null && minha !== i)) classes.push("is-apagada");
    return el("button.qvp__opcao", {
      type: "button",
      class: classes.join(" "),
      disabled: revelada || minha != null,
      onClick: () => {
        // Otimista: trava na hora; a vista seguinte confirma.
        vista = { ...v, minha: { e: i } };
        enviar({ tipo: "responder", k: v.k, e: i });
        desenhar();
      },
    }, [
      el("span.qvp__letra", { text: LETRAS[i] }),
      el("span.qvp__texto", { text: texto }),
      revelada && v.porOpcao ? el("span.qvp__conta", { text: String(v.porOpcao[i] || 0) }) : null,
    ]);
  });

  let status;
  let classe = "";
  if (revelada) {
    const m = v.minha;
    status = m ? (m.certo ? `Certo! +${m.pontos}${m.seq > 1 ? ` · ${m.seq} seguidas` : ""}` : "Errou! A certa está em destaque.") : "Tempo esgotado.";
    classe = m?.certo ? ".is-certo" : ".is-errou";
  } else {
    status = minha != null ? `Resposta enviada! ${v.responderam} responderam` : `${v.responderam} responderam`;
  }

  raiz.replaceChildren(
    el("div.qvp__topo", {}, [el("span", { text: `Pergunta ${v.k + 1} de ${v.total}${v.titulo ? ` · ${v.titulo}` : ""}` }), tempo]),
    barra,
    el("h1.qvp__pergunta", { text: v.pergunta.texto }),
    el("div.qvp__opcoes", { role: "group", "aria-label": "Alternativas" }, opcoes),
    el(`p.qvp__status${classe}`, { text: status }),
    revelada && v.pergunta.explicacao ? el("p.qvp__explicacao", { text: v.pergunta.explicacao }) : null,
    revelada ? el("button.btn.btn--primary", { type: "button", onClick: () => enviar({ tipo: "proxima" }) }, [el("span", { text: v.k + 1 >= v.total ? "Ver o resultado" : "Próxima pergunta" })]) : null,
    revelada ? placar(v) : null,
  );
}
