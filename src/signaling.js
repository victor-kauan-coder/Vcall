/**
 * src/signaling.js — servidor de sinalização WebSocket.
 *
 * Responsabilidade única: apresentar os participantes uns aos outros e
 * encaminhar SDP/ICE entre eles. Áudio, vídeo e tela nunca passam por aqui —
 * vão direto entre os navegadores, criptografados por DTLS-SRTP.
 */
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { log, redactRoom } from "./logger.js";
import { RoomRegistry, Participant } from "./rooms.js";
import { C2S, S2C, ERRORS, parseClientMessage } from "./protocol.js";

const L = config.limits;

/**
 * Janela deslizante, por conexão.
 *
 * Um excesso momentâneo NÃO derruba mais a conexão. A versão anterior fechava
 * o socket com 1008 no primeiro estouro, e o cliente trata 1008 como recusa
 * definitiva — ou seja, uma rajada de mensagens legítimas (legendas ao vivo,
 * um traço longo no canvas, o indicador de voz) expulsava a pessoa da sala sem
 * reconexão. Agora a mensagem excedente é descartada e só abuso sustentado,
 * muito acima do limite, encerra a conexão.
 */
class RateLimiter {
  constructor(burst, windowMs) {
    this.burst = burst;
    this.windowMs = windowMs;
    this.count = 0;
    this.resetAt = Date.now() + windowMs;
    /** Janelas seguidas em que o limite foi estourado. */
    this.strikes = 0;
  }

  /** @returns {"ok"|"drop"|"abuse"} */
  check() {
    const now = Date.now();
    if (now > this.resetAt) {
      // Uma janela inteira dentro do limite limpa a ficha: rajadas isoladas
      // não podem somar até virar desconexão.
      if (this.count <= this.burst) this.strikes = 0;
      this.count = 0;
      this.resetAt = now + this.windowMs;
    }
    this.count += 1;
    if (this.count <= this.burst) return "ok";
    if (this.count === this.burst + 1) this.strikes += 1;
    // Dez vezes o limite na mesma janela não é uso legítimo de nenhum recurso
    // do app; aí sim a conexão cai.
    return this.count > this.burst * 10 || this.strikes > 3 ? "abuse" : "drop";
  }
}

/**
 * Tentativas de senha por IP.
 *
 * O limitador acima é por conexão, e uma senha errada fecha a conexão — então,
 * sozinho, ele não atrapalha em nada quem reconecta para tentar outra senha.
 * Um atraso que dobra a cada erro transforma força bruta de senha curta em
 * algo que leva horas em vez de segundos.
 */
class PassGuard {
  #fails = new Map(); // ip -> { count, until }

  blocked(ip) {
    const e = this.#fails.get(ip);
    return !!e && Date.now() < e.until;
  }

  fail(ip) {
    const e = this.#fails.get(ip) || { count: 0, until: 0 };
    e.count += 1;
    // Três erros de graça (dedo trocado), depois 2s, 4s, 8s… até 5 minutos.
    const wait = e.count <= 3 ? 0 : Math.min(2000 * 2 ** (e.count - 4), 300_000);
    e.until = Date.now() + wait;
    this.#fails.set(ip, e);
    return wait;
  }

  succeed(ip) {
    this.#fails.delete(ip);
  }

  /** Esquece IPs parados, para o mapa não crescer para sempre. */
  sweep() {
    const now = Date.now();
    for (const [ip, e] of this.#fails) {
      if (now > e.until + 600_000) this.#fails.delete(ip);
    }
  }
}

/**
 * O IP do cliente. Atrás de um proxy ou de um túnel (Cloudflare, nginx), o
 * socket vem do proxy e todo mundo pareceria o mesmo endereço — o que faria o
 * limite por IP punir a sala inteira por causa de uma pessoa. Só confiamos no
 * cabeçalho quando TRUST_PROXY estiver ligado explicitamente.
 */
function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    const first = String(Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
    if (first) return first;
  }
  const direto = req.socket.remoteAddress || "desconhecido";
  /*
   * Túnel do Cloudflare (link público do app de mesa): o cloudflared roda NA
   * PRÓPRIA MÁQUINA e toda conexão chega de 127.0.0.1. Sem olhar o endereço
   * real, todos os convidados contavam como uma pessoa só — um único
   * curioso errando a senha bloqueava a entrada de todo mundo, e o limite de
   * conexões por endereço valia para a sala inteira. O cabeçalho só é aceito
   * quando a conexão vem da própria máquina: de fora ninguém consegue forjá-lo.
   */
  if (/^(127\.|::1$|::ffff:127\.)/.test(direto)) {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && /^[0-9a-fA-F:.]{2,45}$/.test(cf)) return cf;
  }
  return direto;
}

/**
 * Origens aceitas no aperto de mão do WebSocket.
 *
 * Sem Origin (aplicativo desktop, cliente nativo, teste automatizado) passa:
 * o cabeçalho é posto pelo navegador, e é justamente o navegador que precisa
 * ser contido. Com Origin, ela tem de bater com o host que serviu a página —
 * assim o túnel e o localhost funcionam sem configuração, e um site de
 * terceiros não.
 */
function allowedOrigin(origin, req) {
  if (!origin) return true;
  if (config.allowedOrigins.length) return config.allowedOrigins.includes(origin);
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === req.headers.host;
}

export function attachSignaling(httpServer, { registry = new RoomRegistry() } = {}) {
  const passGuard = new PassGuard();
  /** Conexões abertas por IP, para um cliente só não esgotar o servidor. */
  const perIp = new Map();

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: L.wsPayload,
    // Compressão ajuda no fallback de quadro branco pelo servidor; o custo é
    // irrelevante no volume de sinalização.
    perMessageDeflate: { threshold: 2048 },
    /*
     * Só aceita o aperto de mão vindo da própria origem.
     *
     * A política de mesma origem do navegador NÃO vale para WebSocket: sem
     * esta checagem, qualquer site que a pessoa visitasse poderia abrir um
     * socket neste servidor com o navegador dela e entrar nas salas cujo id
     * conhecesse. É o "cross-site WebSocket hijacking", e a única defesa é
     * conferir o Origin no servidor.
     */
    verifyClient: ({ origin, req }, done) => {
      const ip = clientIp(req);
      if ((perIp.get(ip) || 0) >= config.limits.maxSocketsPerIp) {
        done(false, 429, "conexões demais deste endereço");
        return;
      }
      done(allowedOrigin(origin, req), 403, "origem não permitida");
    },
  });

  wss.on("connection", (socket, req) => {
    const ip = clientIp(req);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    socket.once("close", () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    });

    const ctx = {
      participant: null,
      room: null,
      limiter: new RateLimiter(L.rateBurst, L.rateWindowMs),
      ip,
      passGuard,
    };

    const fail = (error, close = false) => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ t: S2C.ERROR, error }));
      if (close) socket.close(1008, error);
    };

    socket.__dead = false;
    socket.on("pong", () => {
      socket.__dead = false;
    });

    socket.on("message", (raw) => {
      const verdict = ctx.limiter.check();
      // "drop" descarta só esta mensagem e mantém a chamada de pé; a pessoa
      // perde uma legenda ou um pedaço de traço, não a sala inteira.
      if (verdict === "drop") return;
      if (verdict === "abuse") return fail(ERRORS.RATE_LIMITED, true);

      const parsed = parseClientMessage(raw);
      if (!parsed.ok) return fail(parsed.error);
      const msg = parsed.msg;

      if (msg.t === C2S.JOIN) return handleJoin(ctx, socket, registry, msg, fail);
      if (!ctx.participant) return fail(ERRORS.NOT_JOINED);

      const me = ctx.participant;
      const room = ctx.room;

      switch (msg.t) {
        case C2S.SIGNAL: {
          const target = room.get(msg.to);
          // Encaminhar silenciosamente falha se o par já saiu: normal em corrida.
          if (target) target.send({ t: S2C.SIGNAL, from: me.id, d: msg.d });
          break;
        }

        case C2S.PROFILE: {
          me.profile = msg.profile;
          room.broadcast(
            { t: S2C.PROFILE, id: me.id, name: me.profile.name, avatar: me.profile.avatar },
            me.id,
          );
          break;
        }

        case C2S.STATE: {
          me.state = msg.state;
          room.broadcast({ t: S2C.STATE, id: me.id, state: me.state }, me.id);
          break;
        }

        case C2S.CHAT: {
          room.broadcast(
            { t: S2C.CHAT, id: me.id, name: me.profile.name, text: msg.text, at: Date.now() },
            me.id,
          );
          break;
        }

        case C2S.REACTION: {
          room.broadcast({ t: S2C.REACTION, id: me.id, kind: msg.kind }, me.id);
          break;
        }

        case C2S.BOARD: {
          room.broadcast({ t: S2C.BOARD, id: me.id, op: msg.op }, me.id);
          break;
        }

        case C2S.AUDIO: {
          // Só a transição fala/cala. O nível contínuo vai pelo DataChannel.
          me.speaking = msg.speaking;
          room.broadcast(
            { t: S2C.AUDIO, id: me.id, speaking: msg.speaking, level: msg.level },
            me.id,
          );
          break;
        }

        case C2S.LIST_ROOMS: {
          me.send({ t: S2C.ROOMS, rooms: registry.directory() });
          break;
        }

        case C2S.MODERATE: {
          handleModerate(me, room, msg, fail);
          break;
        }

        case C2S.PING: {
          me.send({ t: S2C.PONG, n: msg.n, at: Date.now() });
          break;
        }

        case C2S.LEAVE: {
          socket.close(1000, "leave");
          break;
        }
      }
    });

    socket.on("close", () => teardown(ctx, registry));
    socket.on("error", () => teardown(ctx, registry));
  });

  // Derruba conexões que pararam de responder (celular que dormiu, rede caiu).
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.__dead) {
        socket.terminate();
        continue;
      }
      socket.__dead = true;
      socket.ping();
    }
    passGuard.sweep();
  }, config.heartbeatMs);
  heartbeat.unref?.();

  wss.on("close", () => clearInterval(heartbeat));

  return { wss, registry };
}

function handleJoin(ctx, socket, registry, msg, fail) {
  if (ctx.participant) return fail(ERRORS.ALREADY_JOINED);

  // Os metadados só valem para quem cria a sala. Para quem entra depois, eles
  // são ignorados: ninguém renomeia nem abre ao público a sala dos outros.
  const nova = !registry.get(msg.room);
  const room = registry.ensure(msg.room, msg.meta);
  // Quem cria a sala deixa registrada a chave de anfitrião.
  if (nova) room.setHostKey(msg.hostKey);
  const ehDono = room.isHostKey(msg.hostKey);

  // Removido pelo anfitrião: não volta, nem recarregando a página.
  if (room.isBanned(msg.device) && !ehDono) return fail(ERRORS.KICKED, true);

  // Mesma aba reconectando: a conexão antiga ainda pode estar pendurada (o
  // servidor só percebe uma queda no próximo batimento, até ~50 s depois).
  // Ela é substituída agora, e por isso não conta como "vaga ocupada".
  const anterior = room.bySession(msg.session);

  // Sala trancada: só entra quem já estava (reconexão) ou o dono.
  if (room.closed && !anterior && !ehDono) return fail(ERRORS.ROOM_LOCKED, true);
  if (room.isFull && !anterior) return fail(ERRORS.ROOM_FULL, true);

  /*
   * ANTES ISTO ERA `room.hasPass` — uma propriedade que não existe. A
   * condição nunca era verdadeira e a senha da sala NUNCA era conferida:
   * qualquer pessoa com o link entrava numa sala "protegida". A propriedade
   * certa é `locked`; scripts/fixes-test.mjs garante que continue assim.
   * Vale também para reconexões: o cliente reenvia a senha que já tinha.
   */
  if (room.locked) {
    // De castigo por erros anteriores: nem chega a conferir a senha, para que
    // tentar de novo não fique mais barato do que esperar.
    if (ctx.passGuard.blocked(ctx.ip)) return fail(ERRORS.BAD_PASSWORD, true);
    if (!room.checkPass(msg.pass)) {
      ctx.passGuard.fail(ctx.ip);
      return fail(ERRORS.BAD_PASSWORD, true);
    }
    ctx.passGuard.succeed(ctx.ip);
  }

  const me = new Participant(socket, msg);
  ctx.participant = me;
  ctx.room = room;

  // Substitui a conexão anterior desta mesma aba: os outros veem a saída do
  // id velho ANTES da entrada do novo — nunca os dois ao mesmo tempo.
  let herdaAnfitriao = false;
  if (anterior) {
    herdaAnfitriao = anterior.host;
    room.remove(anterior.id);
    anterior.replaced = true;
    room.broadcast({ t: S2C.PEER_LEAVE, id: anterior.id, newHost: null, replacedBy: me.id });
    try {
      anterior.socket.terminate();
    } catch {
      /* já fechado */
    }
  }

  // Ordem importa: o recém-chegado recebe o elenco atual antes de ser anunciado,
  // para que nenhum par apareça duas vezes.
  const peers = room.roster();
  room.add(me);
  if (ehDono || herdaAnfitriao) room.claimHost(me);

  me.send({
    t: S2C.WELCOME,
    you: me.publicView(),
    peers,
    room: {
      size: room.size,
      max: config.maxPeersPerRoom,
      name: room.name,
      code: room.code,
      visibility: room.visibility,
      locked: room.locked,
      closed: room.closed,
    },
  });

  room.broadcast({ t: S2C.PEER_JOIN, peer: me.publicView(), replaces: anterior?.id || null }, me.id);
  // O anfitrião mudou (o dono voltou): todos atualizam a marca.
  if (me.host) room.broadcast({ t: S2C.HOST, id: me.id }, me.id);

  log.info("participante entrou", {
    room: redactRoom(room.id),
    id: me.id,
    size: room.size,
  });
}

/**
 * Ações do anfitrião. A conferência de quem pode é AQUI, no servidor: o botão
 * só aparece para o anfitrião, mas um cliente modificado poderia mandar a
 * mensagem mesmo assim — e ela seria recusada.
 */
function handleModerate(me, room, msg, fail) {
  if (!me.host) return fail(ERRORS.NOT_HOST);
  const by = me.profile.name;

  switch (msg.action) {
    case "mute":
    case "cam-off": {
      const alvo = room.get(msg.target);
      if (!alvo || alvo === me) return;
      alvo.send({ t: S2C.MODERATED, action: msg.action, by });
      break;
    }
    case "mute-all": {
      room.broadcast({ t: S2C.MODERATED, action: "mute", by }, me.id);
      break;
    }
    case "kick": {
      const alvo = room.get(msg.target);
      if (!alvo || alvo === me) return;
      if (alvo.device) room.banned.add(alvo.device);
      alvo.send({ t: S2C.MODERATED, action: "kick", by });
      room.broadcast({ t: S2C.MODERATED, action: "kicked", target: alvo.id, name: alvo.profile.name, by }, alvo.id);
      // 1008 + motivo "kicked": o cliente entende como definitivo e não
      // tenta reconectar sozinho.
      alvo.socket.close(1008, ERRORS.KICKED);
      break;
    }
    case "lock":
    case "unlock": {
      room.closed = msg.action === "lock";
      room.broadcast({ t: S2C.ROOM, closed: room.closed, by });
      break;
    }
  }

  log.info("moderação", { room: redactRoom(room.id), by: me.id, action: msg.action });
}

function teardown(ctx, registry) {
  const me = ctx.participant;
  if (!me || !ctx.room) return;
  const room = ctx.room;
  ctx.participant = null;

  // Substituído por uma reconexão da mesma aba: a saída já foi anunciada.
  if (me.replaced || !room.has(me.id)) {
    registry.dropIfEmpty(room.id);
    return;
  }

  const newHost = room.remove(me.id);
  room.broadcast({ t: S2C.PEER_LEAVE, id: me.id, newHost: newHost?.id || null });

  log.info("participante saiu", {
    room: redactRoom(room.id),
    id: me.id,
    size: room.size,
  });

  registry.dropIfEmpty(room.id);
}
