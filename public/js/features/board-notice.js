/**
 * features/board-notice.js — decide quando avisar "Fulano está desenhando".
 *
 * Um traço de caneta viaja em dezenas de pedaços (`stroke-chunk`), e cada
 * pedaço é uma operação do canvas. Avisar a cada operação fazia a mesma
 * notificação renascer sem parar para todo mundo que não estava no canvas.
 *
 * A regra agora é simples: o convite aparece UMA vez por chamada. Depois que
 * a pessoa foi avisada — ou abriu o canvas por conta própria — ela já sabe que
 * ele existe, e o resto é ruído.
 *
 * Sem DOM e sem rede: dá para testar em Node (scripts/fixes-test.mjs).
 */

/** Operações que significam "alguém começou a desenhar algo novo". */
const DESENHO = new Set(["add", "stroke-chunk"]);

export function createBoardNotice() {
  let avisado = false;

  return {
    /** `true` só na primeira operação de desenho da chamada. */
    shouldAnnounce(op) {
      if (avisado || !op || !DESENHO.has(op.type)) return false;
      avisado = true;
      return true;
    },
    /** A pessoa abriu o canvas: não há mais o que anunciar. */
    seen() {
      avisado = true;
    },
    /** Nova chamada, novo aviso. */
    reset() {
      avisado = false;
    },
    get announced() {
      return avisado;
    },
  };
}
