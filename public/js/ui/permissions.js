/**
 * ui/permissions.js — a tela que pede as permissões, uma vez só.
 *
 * O problema que ela resolve: o navegador pergunta pela câmera e pelo
 * microfone no instante em que o código os usa — ou seja, no meio da entrada
 * na sala, num balãozinho cinza colado na barra de endereço, sem contexto
 * nenhum. Quem nunca viu aquilo clica em "Bloquear" por reflexo, e aí a
 * chamada entra muda e escura sem explicação.
 *
 * Aqui o pedido vira uma tela: diz o que cada permissão serve, deixa recusar
 * de propósito antes mesmo de o navegador perguntar, e só aparece uma vez.
 *
 * Duas coisas que esta tela NÃO faz, porque nenhuma página pode:
 *
 *   1. Conceder permissão. Ela só decide QUANDO pedir. A janela do navegador
 *      continua sendo quem decide, e é ela que manda.
 *   2. Revogar. Desligar um interruptor aqui depois de já ter concedido não
 *      tira o acesso — isso só nas configurações do navegador. Por isso um
 *      item já concedido aparece como concedido, e não como um interruptor
 *      que mentiria sobre o próprio efeito.
 */
import { el, icon, $ } from "../lib/dom.js";
import { prefs } from "../lib/util.js";

const FEITO = "perms:v1";

const ITENS = [
  {
    id: "mic",
    icon: "mic",
    titulo: "Microfone",
    texto: "Para as pessoas ouvirem você. Dá para entrar sem, e ligar depois.",
    padrao: true,
    nome: "microphone",
  },
  {
    id: "cam",
    icon: "video",
    titulo: "Câmera",
    texto: "Para aparecer na chamada. Também dá para entrar com ela desligada.",
    padrao: true,
    nome: "camera",
  },
  {
    id: "notif",
    icon: "bell",
    titulo: "Avisos do sistema",
    texto: "Mensagens novas e quem entra na sala, quando a janela estiver atrás.",
    padrao: false,
    nome: "notifications",
  },
];

/** O que o navegador já decidiu antes de perguntarmos qualquer coisa. */
async function estadoAtual(nome) {
  if (nome === "notifications") {
    if (!("Notification" in window)) return "indisponivel";
    return Notification.permission === "default" ? "perguntar" : Notification.permission;
  }
  if (!navigator.permissions?.query) return "perguntar";
  try {
    const st = await navigator.permissions.query({ name: nome });
    return st.state === "prompt" ? "perguntar" : st.state;
  } catch {
    // Firefox não aceita consultar câmera/microfone; perguntar é o certo.
    return "perguntar";
  }
}

/** Pede de verdade. Devolve o estado final. */
async function pedir(item) {
  if (item.nome === "notifications") {
    if (!("Notification" in window)) return "indisponivel";
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  const restricao = item.id === "cam" ? { video: true } : { audio: true };
  try {
    const s = await navigator.mediaDevices.getUserMedia(restricao);
    // A permissão fica com a origem; a trilha aberta aqui não serve para nada
    // e precisa ser fechada, senão a luz da câmera fica acesa à toa.
    for (const t of s.getTracks()) t.stop();
    return "granted";
  } catch (err) {
    return err?.name === "NotAllowedError" ? "denied" : "indisponivel";
  }
}

const ROTULO = {
  granted: "Liberado",
  denied: "Bloqueado no navegador",
  indisponivel: "Não disponível neste aparelho",
};

/**
 * Mostra a tela, se for a primeira vez. Resolve quando a pessoa continuar.
 * Nas vezes seguintes resolve na hora, sem desenhar nada.
 *
 * @param {object} opts
 * @param {boolean} opts.forcar mostra mesmo já tendo sido feita (menu de configurações)
 */
export async function pedirPermissoes({ forcar = false } = {}) {
  if (!forcar && prefs.get(FEITO, false)) return null;

  const estados = new Map();
  for (const item of ITENS) estados.set(item.id, await estadoAtual(item.nome));

  // Nada a pedir: todas já decididas. Não vale mostrar uma tela sem função.
  const pendentes = ITENS.filter((i) => estados.get(i.id) === "perguntar");
  if (!forcar && !pendentes.length) {
    prefs.set(FEITO, true);
    return null;
  }

  return new Promise((resolve) => {
    const escolhas = new Map(ITENS.map((i) => [i.id, i.padrao]));
    const linhas = new Map();

    const card = el("div.perms__card", { role: "dialog", "aria-labelledby": "permsTitulo" });

    card.append(
      el("div.perms__head", {}, [
        el("img.perms__logo", { src: "/assets/logo-mark.png", alt: "", width: 52, height: 52 }),
        el("div", {}, [
          el("h2.perms__titulo", { id: "permsTitulo", text: "Antes de começar" }),
          el("p.perms__sub", {
            text: "Escolha o que o Vcall pode usar. Dá para mudar depois nas configurações.",
          }),
        ]),
      ]),
    );

    const lista = el("div.perms__lista");
    for (const item of ITENS) {
      const estado = estados.get(item.id);
      const decidido = estado !== "perguntar";

      const selo = el("span.perms__selo", {
        dataset: { estado },
        text: decidido ? ROTULO[estado] || estado : "",
      });

      // Já decidido pelo navegador: interruptor não teria efeito nenhum, e um
      // controle que não controla é pior do que controle nenhum.
      const controle = decidido
        ? selo
        : el("button.perms__switch", {
            type: "button",
            role: "switch",
            "aria-checked": String(item.padrao),
            "aria-label": item.titulo,
            onClick: (e) => {
              const novo = !escolhas.get(item.id);
              escolhas.set(item.id, novo);
              e.currentTarget.setAttribute("aria-checked", String(novo));
            },
          });

      const linha = el("div.perms__item", { dataset: { id: item.id } }, [
        el("span.perms__icone", {}, [icon(item.icon, { size: "sm" })]),
        el("div.perms__texto", {}, [
          el("div.perms__nome", { text: item.titulo }),
          el("div.perms__desc", { text: item.texto }),
        ]),
        controle,
      ]);
      linhas.set(item.id, linha);
      lista.append(linha);
    }
    card.append(lista);

    const aviso = el("p.perms__aviso", {
      text: "Nada é enviado para servidor nenhum: áudio e vídeo vão direto de um navegador ao outro, criptografados.",
    });

    const botao = el("button.btn.btn--primary.btn--lg.btn--block", {
      type: "button",
      text: "Continuar",
    });

    const pular = el("button.btn.btn--ghost", {
      type: "button",
      text: "Decidir depois",
      onClick: () => fechar(),
    });

    card.append(aviso, el("div.perms__acoes", {}, [pular, botao]));

    const fundo = el("div.perms", {}, [card]);
    document.body.append(fundo);

    function fechar(resultado = null) {
      fundo.remove();
      prefs.set(FEITO, true);
      resolve(resultado);
    }

    botao.addEventListener("click", async () => {
      botao.disabled = true;
      pular.disabled = true;
      const resultado = {};

      for (const item of ITENS) {
        if (estados.get(item.id) !== "perguntar") {
          resultado[item.id] = estados.get(item.id);
          continue;
        }
        if (!escolhas.get(item.id)) {
          resultado[item.id] = "recusado-aqui";
          continue;
        }
        const linha = linhas.get(item.id);
        linha?.classList.add("is-perguntando");
        botao.textContent = `Pedindo acesso — ${item.titulo.toLowerCase()}…`;
        // Um de cada vez: dois pedidos simultâneos empilham duas janelas do
        // navegador, e a segunda costuma ser recusada sem a pessoa ver.
        const fim = await pedir(item);
        resultado[item.id] = fim;
        linha?.classList.remove("is-perguntando");
        if (linha) {
          const ctrl = linha.querySelector(".perms__switch");
          if (ctrl) {
            ctrl.replaceWith(
              el("span.perms__selo", { dataset: { estado: fim }, text: ROTULO[fim] || fim }),
            );
          }
        }
      }

      botao.textContent = "Pronto";
      // Uma pausa curta para a pessoa ver o resultado antes da tela sair.
      setTimeout(() => fechar(resultado), 450);
    });

    requestAnimationFrame(() => botao.focus());
  });
}

/** Reabre a tela a partir das configurações. */
export function revisarPermissoes() {
  return pedirPermissoes({ forcar: true });
}
