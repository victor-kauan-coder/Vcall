/**
 * desktop/launcher.js — o executável do Vcall.
 *
 * O que ele é, e por que é assim:
 *
 * 1. NÃO EMBUTE NAVEGADOR. A escolha que mais pesa no consumo. Um app tipo
 *    Electron carrega um Chromium inteiro só para desenhar a janela: uns
 *    200 MB de memória antes de qualquer chamada começar. Aqui o programa é o
 *    servidor, e a tela é o navegador que a pessoa já tem aberto de qualquer
 *    jeito — o mesmo que ela usaria para entrar pelo link. Sobra o Node, que
 *    em repouso fica na casa dos 40 MB.
 *
 * 2. O CONTROLE É UMA ROTA PRIVADA. Ligar e desligar o túnel acontece pela
 *    mesma página da chamada, por rotas em `/__host/`. Elas exigem um segredo
 *    sorteado a cada execução e só respondem a quem está na própria máquina —
 *    senão qualquer convidado que entrasse pelo link público poderia derrubar
 *    o túnel de quem está hospedando.
 *
 * 3. A JANELA DE CONSOLE SOME. No Windows o executável é compilado sem
 *    console; o que sobra é o ícone na bandeja do sistema... que também não
 *    existe sem uma biblioteca nativa. Então o retorno visual é a própria
 *    página, que abre sozinha.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHttpServer } from "../src/http.js";
import { attachSignaling } from "../src/signaling.js";
import { RoomRegistry } from "../src/rooms.js";
import { config } from "../src/config.js";
import { Tunnel } from "./tunnel.js";
import { assets } from "./assets.js";
import { argumentosDaJanela, liberarPermissoes, liberarPermissoesDaOrigem } from "./perfil.js";
import { BATIMENTO_MS, Vida } from "./vida.js";
import { hostControl } from "./guard.js";
import {
  destinoDoLink,
  entregarParaInstanciaViva,
  limparInstancia,
  linkDosArgumentos,
  marcarInstancia,
  registrarEsquema,
} from "./protocol.js";

/**
 * Registro em arquivo.
 *
 * O executável é compilado sem janela de console, então `console.log` não tem
 * para onde escrever: numa falha de partida a pessoa veria o programa
 * simplesmente não abrir, sem uma linha de explicação. O arquivo fica na pasta
 * do usuário e é a única pista quando algo dá errado — inclusive o endereço
 * para abrir à mão, se o navegador não abrir sozinho.
 */
const PASTA = path.join(os.homedir(), ".vcall");
const REGISTRO = path.join(PASTA, "vcall.log");

async function anotar(texto) {
  const linha = `[${new Date().toISOString()}] ${texto}
`;
  try {
    await mkdir(PASTA, { recursive: true });
    await appendFile(REGISTRO, linha);
  } catch {
    /* sem permissão de escrita: não há mais nada a fazer */
  }
  // Em desenvolvimento (com console) continua aparecendo no terminal.
  try {
    process.stdout.write(linha);
  } catch {
    /* sem console: esperado no executável */
  }
}

/**
 * Segredo desta execução. Vai para a página no endereço de abertura e volta em
 * cada chamada de controle. Sorteado toda vez: nada fica guardado em disco.
 */
const TOKEN = randomBytes(24).toString("base64url");

function json(res, headers, code, body) {
  const texto = JSON.stringify(body);
  res.writeHead(code, { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(texto);
}

/**
 * Onde procurar um navegador que abra em modo aplicativo.
 *
 * `--app=` é o que transforma a janela do Chromium numa janela de programa:
 * sem abas, sem barra de endereço, com ícone próprio na barra de tarefas. É a
 * diferença entre "abriu uma aba" e "abriu o Vcall", e não custa nada — o
 * motor é o mesmo que renderizaria a chamada de qualquer jeito.
 */
function navegadores() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (process.platform !== "win32") {
    return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  }
  // Montado com path.join: escrever a barra invertida à mão dentro de uma
  // string JavaScript é pedir para que "\M" e "\A" virem outra coisa.
  const bases = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  const alvos = [
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
  ];
  const saida = [];
  for (const alvo of alvos) {
    for (const base of bases) saida.push(path.join(base, ...alvo));
  }
  return saida;
}

/**
 * Abre a interface. Tenta primeiro uma janela de aplicativo; se não houver
 * navegador baseado em Chromium instalado, cai para o navegador padrão — a
 * chamada funciona igual, só com a moldura do navegador em volta.
 */
async function abrirJanela(url) {
  for (const bin of navegadores()) {
    if (!bin || !(await existeArquivo(bin))) continue;
    try {
      const p = spawn(bin, argumentosDaJanela(url), {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      p.unref();
      return "janela";
    } catch {
      /* tenta o próximo */
    }
  }

  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return "navegador";
  } catch {
    return "nenhum";
  }
}

async function existeArquivo(p) {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Porta preferida do aplicativo.
 *
 * ISTO NÃO É DETALHE DE CONFIGURAÇÃO — é o que decide se a pessoa vê a janela
 * de permissão do navegador uma vez na vida ou uma vez por dia.
 *
 * O navegador guarda "pode usar a câmera" por ORIGEM, e a origem inclui a
 * porta: `http://127.0.0.1:3012` e `http://127.0.0.1:3020` são dois sites
 * diferentes para ele. Enquanto a porta mudava a cada execução, a permissão
 * concedida ontem não valia hoje, e o balãozinho cinza voltava sempre.
 *
 * Com porta fixa, a origem é sempre a mesma e a concessão fica guardada. Um
 * número alto e incomum reduz a chance de topar com outro programa.
 */
const PORTA_PADRAO = 7717;
const ARQUIVO_PORTA = path.join(PASTA, "porta.json");

async function portaLembrada() {
  try {
    const { porta } = JSON.parse(await readFile(ARQUIVO_PORTA, "utf8"));
    return Number.isInteger(porta) && porta > 0 ? porta : null;
  } catch {
    return null;
  }
}

async function lembrarPorta(porta) {
  try {
    await mkdir(PASTA, { recursive: true });
    await writeFile(ARQUIVO_PORTA, JSON.stringify({ porta }));
  } catch {
    /* sem gravação: na próxima vez tenta a padrão de novo */
  }
}

function tentarPorta(server, porta, host) {
  return new Promise((resolve) => {
    const falhou = () => {
      server.removeListener("error", falhou);
      resolve(null);
    };
    server.once("error", falhou);
    server.listen(porta, host, () => {
      server.removeListener("error", falhou);
      resolve(server.address().port);
    });
  });
}

/**
 * Sobe o servidor tentando manter SEMPRE a mesma porta.
 *
 * A ordem é: a que funcionou da última vez, depois a padrão, depois o que o
 * sistema der. A última opção existe porque a faixa de portas excluídas do
 * Windows (reservada pelo Hyper-V) e outros programas podem tomar qualquer
 * número — e um aplicativo que não abre é pior do que um que pergunta de novo.
 */
async function escutar(server, host) {
  const candidatas = [];
  // PORT no ambiente manda mais que tudo: é escolha explícita de quem rodou.
  const doAmbiente = Number(process.env.PORT);
  if (Number.isInteger(doAmbiente) && doAmbiente > 0) candidatas.push(doAmbiente);
  const lembrada = await portaLembrada();
  if (lembrada && !candidatas.includes(lembrada)) candidatas.push(lembrada);
  if (!candidatas.includes(PORTA_PADRAO)) candidatas.push(PORTA_PADRAO);

  for (const p of candidatas) {
    const obtida = await tentarPorta(server, p, host);
    if (obtida) {
      await lembrarPorta(obtida);
      return obtida;
    }
  }

  const sorteada = await tentarPorta(server, 0, host);
  if (!sorteada) throw new Error("nenhuma porta disponível");
  // Guardada mesmo sendo sorteada: na próxima abertura ela é a primeira
  // tentativa, e a origem tende a se manter estável a partir daqui.
  await lembrarPorta(sorteada);
  return sorteada;
}

/**
 * Desligamento em ordem, e uma vez só.
 *
 * A ordem importa: o túnel primeiro. É ele que está exposto na internet, e
 * qualquer segundo a mais de vida dele é um segundo em que alguém com o link
 * ainda entra numa sala que a pessoa acha que fechou.
 */
function desligar({ tunnel, server, motivo }) {
  let feito = false;
  return async () => {
    if (feito) return;
    feito = true;
    await anotar(`encerrando: ${motivo() || "pedido do sistema"}`);
    try {
      tunnel()?.stop();
    } catch {
      /* segue o desligamento */
    }
    try {
      server?.close();
    } catch {
      /* segue */
    }
    await limparInstancia().catch(() => {});
    // Uma folga curta para o taskkill do túnel sair, e encerra.
    setTimeout(() => process.exit(0), 300).unref?.();
  };
}

export async function main() {
  /*
   * "Aplicativos instalados" do Windows aponta a desinstalação para ESTE
   * executável, e não para o instalador — que a pessoa provavelmente já
   * apagou da pasta de downloads. Por isso o programa também sabe se remover.
   */
  if (process.argv.some((a) => a === "--desinstalar" || a === "/uninstall")) {
    const { desinstalar } = await import("./instalador.js");
    await anotar("desinstalando a pedido do sistema");
    await desinstalar((t) => anotar(t));
    process.exit(0);
  }

  const vida = new Vida();
  /*
   * Antes de tudo: já existe um Vcall aberto?
   *
   * Clicar num link com o app rodando não pode subir um segundo servidor —
   * seriam duas salas e duas janelas, e a pessoa acabaria sozinha na errada.
   * Se houver instância viva, ela recebe o endereço, traz a própria janela
   * para a frente, e esta execução encerra sem aparecer.
   */
  const destino = destinoDoLink(linkDosArgumentos());
  if (await entregarParaInstanciaViva(destino)) {
    await anotar(`link entregue à instância já aberta (${destino?.tipo || "sem destino"})`);
    process.exit(0);
  }

  const registry = new RoomRegistry();
  let tunnel = null;
  let porta = config.port;

  const control = hostControl({
    token: TOKEN,

    /*
     * Aperto de mão sem token. A página pergunta "estou dentro do aplicativo?"
     * e recebe o token para as ações seguintes. Só responde a quem está nesta
     * máquina — quem vem pelo túnel nem chega aqui.
     */
    abertas: {
      hello: async () => ({ app: true, token: TOKEN, porta, batimento: BATIMENTO_MS }),

      /*
       * A janela avisando que está viva. Sem token de propósito: é o sinal
       * mais importante do programa — se ele pudesse falhar por um detalhe de
       * autenticação, o aplicativo se desligaria com a chamada em andamento.
       * Continua valendo a regra de cima: só a própria máquina chega aqui.
       */
      vivo: async () => {
        vida.bateu();
        return { ok: true };
      },

      /** A janela avisando que está fechando. Desliga na hora. */
      tchau: async () => {
        vida.fechou();
        return { ok: true };
      },
    },

    acoes: {
      status: async () => ({ estado: tunnel?.state || "parado", url: tunnel?.url || null, porta }),

      "tunnel/abrir": async () => {
        if (tunnel?.url) return { estado: "pronto", url: tunnel.url };
        tunnel = tunnel || new Tunnel(porta);
        const publico = await tunnel.start();
        return { estado: "pronto", url: publico };
      },

      "tunnel/fechar": async () => {
        tunnel?.stop();
        return { estado: "parado", url: null };
      },

      /*
       * Chamada por uma segunda execução do programa, quando alguém clica num
       * link `vcall://` com o app já aberto. Abrir outra janela apontando para
       * a sala é o que o sistema operacional não consegue fazer sozinho: ele
       * só sabe executar o programa de novo.
       */
      abrir: async (url) => {
        const remoto = url.searchParams.get("url");
        const sala = url.searchParams.get("sala");
        await abrirDestino(remoto ? { tipo: "remoto", url: remoto } : sala ? { tipo: "local", room: sala } : null);
        return { ok: true };
      },
    },
  });

  /**
   * Abre a janela no lugar certo.
   *
   * Sala de outra pessoa: a janela vai para o servidor DELA — é lá que a sala
   * existe. A permissão de câmera é liberada também para aquela origem, senão
   * entrar pelo convite de um amigo voltaria a mostrar a janela do navegador
   * que este aplicativo existe para evitar.
   *
   * Sala nossa (ou nenhuma): servidor local, com o token, para o painel do
   * túnel continuar disponível.
   */
  async function abrirDestino(alvo) {
    if (alvo?.tipo === "remoto") {
      try {
        const { port, hostname, protocol } = new URL(alvo.url);
        await liberarPermissoesDaOrigem(
          `${protocol}//${hostname}${port ? `:${port}` : ""}`,
        );
      } catch {
        /* endereço estranho: abre assim mesmo, o navegador pergunta */
      }
      await anotar(`abrindo sala de outro servidor: ${alvo.url}`);
      return abrirJanela(alvo.url);
    }
    const local = `http://127.0.0.1:${porta}/?host=${TOKEN}${alvo?.room ? `#${alvo.room}` : ""}`;
    await anotar(`abrindo sala local${alvo?.room ? ` ${alvo.room}` : ""}`);
    return abrirJanela(local);
  }

  const server = createHttpServer({ registry, control, assets });
  attachSignaling(server, { registry });

  /*
   * A porta preferida pode estar ocupada — por outra cópia do Vcall, por outro
   * programa, ou reservada pelo próprio Windows (a faixa de portas excluídas
   * pelo Hyper-V pega justamente valores comuns como 3000). Cair para uma
   * porta sorteada pelo sistema é a diferença entre abrir e mostrar um erro
   * que a pessoa não tem como resolver.
   */
  porta = await escutar(server, process.env.HOST || "127.0.0.1");

  const local = `http://127.0.0.1:${porta}/?host=${TOKEN}`;
  /*
   * O endereço vai para o registro completo, com o segredo. Ele não é a senha
   * da sala — é a chave do painel que liga o túnel, vale só para esta execução
   * e só responde a quem está nesta máquina. Registrá-lo é o que permite abrir
   * à mão quando o navegador não abre sozinho, que é a primeira coisa a dar
   * errado e, sem console, seria impossível de diagnosticar.
   */
  await marcarInstancia({ porta, token: TOKEN });
  // Registrado a cada abertura: é barato, e o caminho do executável muda
  // quando a pessoa arrasta o arquivo para outra pasta.
  const registrou = await registrarEsquema(process.execPath, {
    // O ícone sai da própria interface embutida: é o mesmo arquivo que a
    // página usa, e não precisa viajar duas vezes dentro do binário.
    icone: assets?.get?.("/assets/icon-192.png") || null,
  });

  /*
   * A permissão é gravada ANTES de a janela abrir. Depois não adianta: o
   * Chromium lê as preferências do perfil no arranque, e uma alteração feita
   * com ele já rodando é ignorada — ou sobrescrita quando ele fecha.
   */
  const liberou = await liberarPermissoes(porta);

  const como =
    destino?.tipo === "remoto"
      ? await abrirDestino(destino)
      : await abrirJanela(destino?.room ? `${local}#${destino.room}` : local);
  await anotar(
    `Vcall rodando na porta ${porta} (abertura: ${como}, esquema vcall://: ${
      registrou ? "registrado" : "não registrado"
    }, permissões: ${liberou ? "liberadas no perfil" : "o navegador vai perguntar"}). Endereço: ${local}`,
  );

  let motivo = "";
  const encerrar = desligar({
    tunnel: () => tunnel,
    server,
    motivo: () => motivo,
  });

  /*
   * A janela fechou — ou parou de dar sinal de vida. É aqui que o túnel cai
   * junto: deixar o endereço público no ar depois de a pessoa fechar o
   * programa é justamente o risco que este acompanhamento existe para evitar.
   */
  vida.on("encerrar", (porque) => {
    motivo = porque;
    encerrar();
  });
  vida.iniciar();

  for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sinal, () => {
      motivo = `sinal ${sinal}`;
      encerrar();
    });
  }

  /*
   * Rede de segurança: mesmo saindo por um caminho que não passou pelo
   * desligamento — uma exceção não tratada, um `process.exit` de outro lugar —
   * o túnel não pode sobreviver ao processo que o criou.
   */
  process.on("exit", () => {
    try {
      tunnel?.stop();
    } catch {
      /* último instante: não há mais o que fazer */
    }
  });
  process.on("uncaughtException", (err) => {
    motivo = `erro não tratado: ${err?.message || err}`;
    encerrar();
  });
  process.on("unhandledRejection", (err) => {
    motivo = `promessa rejeitada: ${err?.message || err}`;
    encerrar();
  });
}

// Executado tanto como módulo quanto embutido no executável.
main().catch(async (err) => {
  await anotar(`FALHA AO INICIAR: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
