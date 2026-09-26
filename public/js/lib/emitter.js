/**
 * lib/emitter.js — barramento de eventos mínimo.
 *
 * Os módulos de núcleo (mídia, pares, estatísticas) não conhecem a UI: eles
 * emitem eventos e a camada de interface escuta. É o que permite testar a
 * lógica de WebRTC sem um DOM.
 */
export class Emitter {
  #handlers = new Map();

  on(type, fn) {
    let set = this.#handlers.get(type);
    if (!set) this.#handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    const set = this.#handlers.get(type);
    if (!set) return;
    // Cópia: um handler pode se desinscrever durante a emissão.
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[emitter] handler de "${type}" falhou`, err);
      }
    }
  }

  clear() {
    this.#handlers.clear();
  }
}
