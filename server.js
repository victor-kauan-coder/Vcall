/**
 * Vcall — servidor.
 *
 * Duas responsabilidades e nada mais:
 *   1. servir o app (src/http.js)
 *   2. apresentar os participantes uns aos outros (src/signaling.js)
 *
 * Mídia nunca passa por aqui. Áudio, vídeo e tela vão direto entre os
 * navegadores, criptografados fim a fim por DTLS-SRTP.
 */
import { config, envFile } from "./src/config.js";
import { log } from "./src/logger.js";
import { createHttpServer } from "./src/http.js";
import { attachSignaling } from "./src/signaling.js";
import { RoomRegistry } from "./src/rooms.js";
import { turnMode, describeTurn } from "./src/ice.js";
import { VERSION, versionLabel } from "./src/version.js";

// Versão mínima do Node. Sem esta checagem, um Node antigo falha lá dentro
// com um erro de sintaxe obscuro e o usuário só vê "localhost não funciona".
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(
    `\nEste servidor precisa do Node 18 ou mais novo. Você está no ${process.version}.\n` +
      `Baixe em https://nodejs.org e rode "npm start" de novo.\n`,
  );
  process.exit(1);
}

// O registro é criado aqui e compartilhado: a sinalização o alimenta, e o
// HTTP o lê para o painel de salas ativas.
const registry = new RoomRegistry();
const server = createHttpServer({ registry });
const { wss } = attachSignaling(server, { registry });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nA porta ${config.port} já está em uso — provavelmente o Vcall já está rodando noutra janela.\n` +
        `Feche a outra, ou use outra porta:  PORT=3001 npm start\n`,
    );
  } else if (err.code === "EACCES") {
    console.error(`\nSem permissão para usar a porta ${config.port}. Use uma acima de 1024.\n`);
  } else {
    console.error(`\nNão foi possível iniciar o servidor: ${err.message}\n`);
  }
  process.exit(1);
});

const listenArgs = config.host ? [config.port, config.host] : [config.port];
server.listen(...listenArgs, () => {
  const addr = server.address();
  log.info(`Vcall ${versionLabel()} no ar`, {
    maxPeers: config.maxPeersPerRoom,
    turn: describeTurn(),
    env: envFile.loaded ? `.env (${envFile.count} variáveis)` : "sem .env",
    bind: typeof addr === "object" ? `${addr.address} (${addr.family})` : String(addr),
  });

  // Os dois endereços, sempre. Em algumas máquinas (Windows, sobretudo)
  // "localhost" resolve para IPv6 e o outro não funciona — ter os dois à mão
  // poupa um diagnóstico inteiro.
  const p = config.port;
  console.log(
    `\n  \x1b[90mVersão ${versionLabel()} · ${VERSION.files} arquivos\x1b[0m\n` +
      `\n  Abra no navegador:\n` +
      `    \x1b[1mhttp://localhost:${p}\x1b[0m\n` +
      `    \x1b[90mhttp://127.0.0.1:${p}\x1b[0m  (se o de cima não abrir)\n`,
  );
  if (turnMode === "none") {
    log.warn(
      "sem TURN: chamadas atrás de NAT restritivo (rede corporativa, CGNAT de operadora) podem não conectar. Veja TURN.md — o modo recomendado é TURN_URLS + TURN_SECRET.",
    );
  }
});

if (config.dev) {
  const t = setInterval(() => {
    const s = registry.stats();
    if (s.rooms) log.debug("salas ativas", s);
  }, 60_000);
  t.unref();
}

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  log.info("encerrando", { signal });
  for (const socket of wss.clients) socket.close(1001, "servidor encerrando");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log.error("promessa não tratada", { err: String(err) }));
process.on("uncaughtException", (err) => {
  log.error("exceção não tratada", { err: err?.stack || String(err) });
  shutdown("uncaughtException");
});
