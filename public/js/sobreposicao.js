/**
 * sobreposicao.js — a janelinha por cima do jogo (app de mesa, modo jogo).
 *
 * Só desenha o que a janela da chamada manda (desktop/main.js repassa):
 * quem está na sala, quem está falando agora e quem está mudo. Calado fica
 * apagadinho; falando, acende com o anel da marca.
 */
import { avatarEl } from "./ui/avatars.js";
import { icon } from "./lib/dom.js";

const lista = document.getElementById("lista");
const ponte = window.vcallSobreposicao;
/** id -> nó, para atualizar no lugar em vez de redesenhar tudo. */
const nos = new Map();

function linha(p) {
  let no = nos.get(p.id);
  if (!no) {
    no = document.createElement("div");
    no.className = "p";
    const av = document.createElement("span");
    av.className = "av";
    av.append(avatarEl(p.avatar, { title: p.nome }));
    const nome = document.createElement("span");
    nome.className = "nome";
    no.append(av, nome);
    no.__nome = nome;
    no.__avatar = JSON.stringify(p.avatar || null);
    nos.set(p.id, no);
  }
  const spec = JSON.stringify(p.avatar || null);
  if (spec !== no.__avatar) {
    no.querySelector(".av").replaceChildren(avatarEl(p.avatar, { title: p.nome }));
    no.__avatar = spec;
  }
  no.__nome.textContent = p.nome || "Convidado";
  no.classList.toggle("fala", !!p.falando);
  no.classList.toggle("eu", !!p.eu);
  const mudo = no.querySelector(".mudo");
  if (p.mudo && !mudo) no.append(icon("mic-off", { className: "mudo" }));
  if (!p.mudo && mudo) mudo.remove();
  return no;
}

ponte?.aoEstado((estado) => {
  const pessoas = Array.isArray(estado?.pessoas) ? estado.pessoas.slice(0, 16) : [];
  const vivos = new Set(pessoas.map((p) => p.id));
  for (const [id, no] of nos) {
    if (!vivos.has(id)) {
      no.remove();
      nos.delete(id);
    }
  }
  lista.replaceChildren(...pessoas.map(linha));
});

ponte?.aoCanto((canto) => (document.body.dataset.canto = canto));
document.body.dataset.canto = "tl";
