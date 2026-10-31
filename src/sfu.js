/**
 * src/sfu.js — a ponte entre o servidor da sala e o SFU do app de mesa.
 *
 * Na malha, quem transmite codifica uma cópia da tela para cada pessoa: com
 * 5 assistindo, o processador não passa de ~20 qps. Com um SFU (LiveKit) no
 * PC de quem transmite, a tela é codificada UMA vez e o SFU repassa os
 * pacotes. Medido na fase 0: 8 pessoas recebendo ~59 qps (handoff-vcall/
 * PLANO-SFU.md).
 *
 * O SFU só existe no app de mesa (desktop/sfu.js), que entrega aqui um
 * fornecedor. No servidor puro (`npm start`) não há fornecedor e a sala fica
 * na malha.
 *
 * Duas coisas passam por aqui:
 *
 *   FICHA   quem está na sala pede, pela sinalização, a entrada no SFU. Só
 *           quem está na própria máquina (a janela do app) pode publicar;
 *           quem chega pelo túnel ou pelo Tailscale só assiste.
 *   PROXY   a sinalização do LiveKit vai pelo mesmo endereço da sala, em
 *           /sfu/. Assim ela atravessa o túnel do Cloudflare e o Tailscale
 *           sem porta nova. A mídia vai direto, por UDP (ICE).
 */
import http from "node:http";
import net from "node:net";

export const CAMINHO = "/sfu";

/** @type {{ porta: () => number|null, ligar: () => Promise<number>, ficha: (id: string, nome: string, sala: string, publica: boolean) => string } | null} */
let fornecedor = null;

export function definirSfu(f) {
  fornecedor = f;
}

/**
 * A entrada no SFU para uma pessoa da sala, ou null sem SFU.
 * Quem publica liga o SFU se ele ainda estiver parado; quem só assiste
 * entra no que já está ligado.
 */
export async function entradaNoSfu({ id, nome, sala, local }) {
  if (!fornecedor) return null;
  if (!fornecedor.porta()) {
    if (!local) return null;
    await fornecedor.ligar();
  }
  return { url: CAMINHO, token: fornecedor.ficha(id, nome, sala, local) };
}

const doSfu = (url) => url === CAMINHO || url?.startsWith(`${CAMINHO}/`) || url?.startsWith(`${CAMINHO}?`);
const semPrefixo = (url) => url.slice(CAMINHO.length) || "/";

/** HTTP em /sfu/ (o LiveKit usa GET /rtc/validate quando a conexão falha). */
export function proxySfuHttp(req, res) {
  if (!doSfu(req.url)) return false;
  const porta = fornecedor?.porta();
  if (!porta) {
    res.writeHead(503).end();
    return true;
  }
  const ida = http.request({ host: "127.0.0.1", port: porta, method: req.method, path: semPrefixo(req.url), headers: req.headers }, (volta) => {
    res.writeHead(volta.statusCode || 502, volta.headers);
    volta.pipe(res);
  });
  ida.on("error", () => res.headersSent ? res.destroy() : res.writeHead(502).end());
  req.pipe(ida);
  return true;
}

/** WebSocket em /sfu/rtc: liga o socket direto no LiveKit local. */
export function proxySfuUpgrade(req, socket, head) {
  if (!doSfu(req.url)) return false;
  const porta = fornecedor?.porta();
  if (!porta) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return true;
  }
  const destino = net.connect(porta, "127.0.0.1", () => {
    const linhas = [`${req.method} ${semPrefixo(req.url)} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) linhas.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    destino.write(linhas.join("\r\n") + "\r\n\r\n");
    if (head?.length) destino.write(head);
    destino.pipe(socket);
    socket.pipe(destino);
  });
  const fechar = () => (destino.destroy(), socket.destroy());
  destino.on("error", fechar);
  socket.on("error", fechar);
  return true;
}
