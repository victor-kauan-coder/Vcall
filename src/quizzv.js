/**
 * src/quizzv.js — o celular com o QuizzV como controle do Quiz da chamada.
 *
 * O Quiz continua sendo um jogo da chamada (features/festa.js): vive no
 * estado compartilhado dos jogos, que vai de navegador a navegador pelo canal
 * direto. O celular não é um par WebRTC e não entra nesse estado. Ele fala com
 * o NAVEGADOR DA PRÓPRIA PESSOA, e o servidor só leva os recados de um ao
 * outro:
 *
 *   celular ── quiz-do-celular ──▶ servidor ──▶ navegador de quem pareou
 *   celular ◀── quiz-vista ─────── servidor ◀── quiz-para-celular ── navegador
 *
 * É o mesmo papel de sempre do servidor, um roteador burro: ele não conhece
 * as regras do jogo, não guarda nada, e só confere forma e tamanho. Quem
 * responde pelo celular responde COMO a pessoa — o navegador dela grava a
 * resposta no estado do jogo, igual a um clique.
 */
import { randomBytes } from "node:crypto";

/** Versão do protocolo celular ↔ chamada. O QuizzV recusa conversar com outra. */
export const QUIZZV_PROTOCOLO = 1;

export const QUIZZV_LIMITES = Object.freeze({
  perguntas: 100,
  titulo: 80,
  // Questão de concurso traz o texto-base no enunciado: cabe, sem cortar a pergunta.
  enunciado: 1500,
  opcao: 300,
  explicacao: 1000,
  opcoesMin: 2,
  opcoesMax: 5,
  /** A "vista" que o navegador manda ao celular é um resumo, não o estado inteiro. */
  vista: 24 * 1024,
});

export const TEMPOS_QUIZZV = Object.freeze([10, 15, 20, 30, 45, 60]);

/** O que o celular pode pedir ao navegador da pessoa. */
export const ACOES_DO_CELULAR = new Set(["carregar", "comecar", "responder", "proxima", "encerrar", "vista"]);

const limpar = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max).trim() : "";

/**
 * Valida e normaliza o quiz enviado pelo QuizzV. Devolve o quiz ou null.
 *
 *   { titulo, perguntas: [{ texto, opcoes: [..], correta: índice, explicacao? }] }
 */
export function normalizarQuizzv(q) {
  if (!q || typeof q !== "object" || !Array.isArray(q.perguntas)) return null;
  const L = QUIZZV_LIMITES;
  if (!q.perguntas.length || q.perguntas.length > L.perguntas) return null;
  const perguntas = [];
  for (const p of q.perguntas) {
    if (!p || typeof p !== "object" || !Array.isArray(p.opcoes)) return null;
    const texto = limpar(p.texto, L.enunciado);
    const opcoes = p.opcoes.map((o) => limpar(o, L.opcao));
    if (!texto || opcoes.length < L.opcoesMin || opcoes.length > L.opcoesMax || opcoes.some((o) => !o)) return null;
    const correta = Number(p.correta);
    if (!Number.isInteger(correta) || correta < 0 || correta >= opcoes.length) return null;
    perguntas.push({ texto, opcoes, correta, explicacao: limpar(p.explicacao, L.explicacao) });
  }
  return { titulo: limpar(q.titulo, L.titulo) || "Quiz do QuizzV", perguntas };
}

/** Confere uma ação do celular. Devolve a ação normalizada ou null. */
export function normalizarAcao(a) {
  if (!a || typeof a !== "object" || !ACOES_DO_CELULAR.has(a.tipo)) return null;
  switch (a.tipo) {
    case "carregar": {
      const quiz = normalizarQuizzv(a.quiz);
      if (!quiz) return null;
      const tempo = TEMPOS_QUIZZV.includes(Number(a.tempo)) ? Number(a.tempo) : 20;
      const qtd = Number(a.qtd);
      return {
        tipo: "carregar",
        quiz,
        tempo,
        // 0 = todas as perguntas do quiz.
        qtd: Number.isInteger(qtd) && qtd > 0 ? Math.min(qtd, quiz.perguntas.length) : 0,
        embaralhar: !!a.embaralhar,
      };
    }
    case "responder": {
      const k = Number(a.k);
      const e = Number(a.e);
      if (!Number.isInteger(k) || k < 0 || k >= QUIZZV_LIMITES.perguntas) return null;
      if (!Number.isInteger(e) || e < 0 || e >= QUIZZV_LIMITES.opcoesMax) return null;
      return { tipo: "responder", k, e };
    }
    default:
      return { tipo: a.tipo };
  }
}

/** Token de pareamento: 24 caracteres base64url (144 bits). */
export function novoTokenDePareamento() {
  return randomBytes(18).toString("base64url");
}
