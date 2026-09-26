/**
 * desktop/vida.js — quando o aplicativo deve morrer, e como.
 *
 * O problema, medido: fechar a janela deixava o servidor rodando para sempre.
 * Com o túnel ligado, isso é uma falha de segurança de verdade — o endereço
 * público continuava no ar, aceitando quem tivesse o link, com a pessoa achando
 * que tinha fechado o programa. Do lado do consumo, cada abertura deixava mais
 * um processo de 60 MB para trás.
 *
 * A dificuldade é saber que a janela fechou. O navegador não avisa ninguém, e
 * o processo que abrimos nem sempre é o que fica vivo — o Chromium costuma
 * repassar a janela para outro processo e sair. Duas pistas resolvem:
 *
 * 1. BATIMENTO DA PÁGINA. A janela avisa "estou aqui" a cada poucos segundos.
 *    Parou de avisar, fechou. Funciona em qualquer navegador e não depende de
 *    como ele organiza os processos dele.
 *
 * 2. AVISO DE SAÍDA. Ao fechar, a página manda um último recado. Quando chega,
 *    o desligamento é imediato em vez de esperar o batimento falhar.
 *
 * O período de carência existe porque recarregar a página também interrompe o
 * batimento por um instante, e derrubar o servidor nesse instante fecharia a
 * chamada de quem só apertou F5.
 */
import { EventEmitter } from "node:events";

/** Intervalo entre batimentos, combinado com o cliente. */
export const BATIMENTO_MS = 4000;

/**
 * Silêncio tolerado antes de considerar a janela fechada.
 *
 * Três batimentos. Menos que isso e um recarregar de página, ou um segundo de
 * travamento do navegador, derrubaria a chamada.
 */
const SILENCIO_MS = BATIMENTO_MS * 3;

/**
 * Tempo esperando a primeira janela aparecer.
 *
 * Se o navegador não abrir de jeito nenhum — não está instalado, foi bloqueado
 * por antivírus — o programa não pode ficar de pé para sempre servindo uma
 * página que ninguém vai ver.
 */
const ESPERA_INICIAL_MS = 90_000;

/**
 * Espera depois do aviso de saída, antes de desligar de fato.
 *
 * Tem de ser maior que o tempo de um recarregamento voltar e bater de novo, e
 * curto o bastante para fechar a janela não parecer que o programa ficou
 * preso. Três segundos cobrem um recarregamento normal com folga.
 */
const DESPEDIDA_MS = 3000;

export class Vida extends EventEmitter {
  #ultimo = 0;
  #viuAlguem = false;
  #timer = 0;
  #despedida = 0;
  #encerrando = false;
  #inicio = Date.now();

  /** A janela avisou que está viva. */
  bateu() {
    // Chegou batimento: se havia uma despedida pendente, era recarregamento.
    clearTimeout(this.#despedida);
    this.#despedida = 0;
    this.#ultimo = Date.now();
    if (!this.#viuAlguem) {
      this.#viuAlguem = true;
      this.emit("primeira-janela");
    }
  }

  /**
   * A janela avisou que está fechando.
   *
   * NÃO desliga na hora, e a razão é um bug que isso causou: recarregar a
   * página dispara exatamente o mesmo evento que fechar a janela. Ao apertar
   * F5 — ou ao clicar em "Nova sala", que recarrega — o programa se desligava
   * no meio do caminho, e a página voltava sem estilo nenhum porque o servidor
   * que serviria o CSS já tinha morrido.
   *
   * O aviso passa a valer como "provavelmente fechou": abre uma janela curta
   * de espera. Se um batimento chegar nela, era recarregamento, e tudo segue.
   * Se não chegar, era fechamento mesmo, e o desligamento é quase imediato —
   * bem mais rápido do que esperar o silêncio do batimento.
   */
  fechou() {
    clearTimeout(this.#despedida);
    this.#despedida = setTimeout(() => {
      this.#encerrar("janela fechada");
    }, DESPEDIDA_MS);
    this.#despedida.unref?.();
  }

  iniciar() {
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.#verificar(), 1000);
    this.#timer.unref?.();
  }

  parar() {
    clearInterval(this.#timer);
    clearTimeout(this.#despedida);
    this.#timer = 0;
    this.#despedida = 0;
  }

  #verificar() {
    if (this.#encerrando) return;

    if (!this.#viuAlguem) {
      if (Date.now() - this.#inicio > ESPERA_INICIAL_MS) {
        this.#encerrar("nenhuma janela abriu");
      }
      return;
    }

    if (Date.now() - this.#ultimo > SILENCIO_MS) {
      this.#encerrar("a janela parou de responder");
    }
  }

  #encerrar(motivo) {
    if (this.#encerrando) return;
    this.#encerrando = true;
    this.parar();
    this.emit("encerrar", motivo);
  }
}
