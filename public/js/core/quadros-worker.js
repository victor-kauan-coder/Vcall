/**
 * core/quadros-worker.js — o relé da tela (screen.js, manterQuadros), fora da
 * thread da página.
 *
 * A 60 qps sobram 16 ms por quadro. Na thread da página, qualquer engasgo da
 * interface (lousa, ladrilhos, coleta de lixo) atrasava a leitura, e a
 * captura descartava o quadro que não foi lido a tempo: medido, com a página
 * ocupada, saíam 1 a 5 qps de 55 capturados. Aqui só existe este laço. Os dois
 * streams chegam transferidos, e o Chrome entrega os quadros direto a este
 * worker, sem passar pela página.
 */
self.onmessage = ({ data }) => {
  if (data === "parar") {
    parar?.();
    return;
  }
  rele(data);
};

let parar = null;

function rele({ entrada, saida, intervaloMs = 1000 }) {
  const leitor = entrada.getReader();
  const escritor = saida.getWriter();
  let ultimo = null;
  let ultimoEm = 0;
  let parado = false;
  let escrevendo = false;
  const t0 = performance.now();
  // Os carimbos de tempo são refeitos num relógio só nosso, sempre crescente:
  // misturar os da captura com os dos quadros repetidos faria o encoder
  // descartar quadros "do passado".
  const agora = () => Math.round((performance.now() - t0) * 1000);

  const escrever = async (quadro) => {
    if (parado) {
      quadro.close();
      return;
    }
    escrevendo = true;
    try {
      await escritor.write(quadro);
    } catch {
      quadro.close();
    } finally {
      escrevendo = false;
    }
  };

  parar = () => {
    if (parado) return;
    parado = true;
    clearInterval(timer);
    try {
      ultimo?.close();
    } catch {
      /* já fechado */
    }
    ultimo = null;
    leitor.cancel().catch(() => {});
    escritor.close().catch(() => {});
    self.close();
  };

  (async () => {
    for (;;) {
      let r;
      try {
        r = await leitor.read();
      } catch {
        break;
      }
      if (r.done || parado) {
        r.value?.close?.();
        break;
      }
      const original = r.value;
      let quadro;
      try {
        quadro = new VideoFrame(original, { timestamp: agora() });
      } catch {
        quadro = null;
      }
      original.close();
      if (!quadro) continue;
      try {
        ultimo?.close();
        ultimo = quadro.clone();
      } catch {
        ultimo = null;
      }
      ultimoEm = performance.now();
      await escrever(quadro);
    }
    parar();
  })();

  // Tela parada: repete o último quadro, para o fluxo não morrer (screen.js).
  const timer = setInterval(() => {
    if (parado || escrevendo || !ultimo) return;
    if (performance.now() - ultimoEm < intervaloMs) return;
    ultimoEm = performance.now();
    let copia;
    try {
      copia = new VideoFrame(ultimo, { timestamp: agora() });
    } catch {
      return;
    }
    escrever(copia);
  }, Math.max(100, intervaloMs / 2));
}
