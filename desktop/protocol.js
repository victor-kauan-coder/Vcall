/**
 * desktop/protocol.js — links `vcall://` abrem no aplicativo.
 *
 * Duas metades que precisam existir juntas para o recurso funcionar:
 *
 * 1. REGISTRO NO SISTEMA. Dizer ao Windows ou ao Linux que este executável
 *    responde por endereços que começam com `vcall:`. Sem isso, clicar no link
 *    não faz nada — o sistema não sabe a quem entregar.
 *
 * 2. INSTÂNCIA ÚNICA. Clicar num link com o app já aberto não pode subir um
 *    SEGUNDO servidor: seriam duas salas, dois túneis e duas janelas, e a
 *    pessoa ficaria sozinha na sala errada. A segunda execução descobre a
 *    primeira, entrega o endereço e encerra.
 *
 * O registro é feito na pasta do usuário, não do sistema: não pede permissão
 * de administrador e não deixa sujeira para outras contas da máquina.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ESQUEMA = "vcall";

const PASTA = path.join(os.homedir(), ".vcall");
/** Onde a instância em execução se anuncia para as próximas. */
const MARCA = path.join(PASTA, "instancia.json");

/** Ids de sala: o mesmo formato que o servidor aceita. */
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Extrai o id da sala de um endereço `vcall://`.
 *
 * Aceita as três formas que circulam por aí, porque um link colado à mão pode
 * vir de qualquer uma delas:
 *   vcall://ID          vcall://join/ID          vcall://call?room=ID
 */
export function roomFromUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== `${ESQUEMA}:`) return null;
    const daQuery = url.searchParams.get("room");
    if (daQuery && ID_RE.test(daQuery)) return daQuery;
    const partes = `${url.hostname}/${url.pathname}`.split("/").filter(Boolean);
    const ultimo = partes[partes.length - 1];
    return ultimo && ID_RE.test(ultimo) ? ultimo : null;
  } catch {
    return null;
  }
}

/**
 * Para onde um link `vcall://` aponta.
 *
 * Duas formas, e a diferença entre elas importa:
 *
 *   vcall://join?u=<endereço>   sala de OUTRA pessoa, no servidor dela
 *   vcall://ID                  sala no servidor deste próprio aplicativo
 *
 * A primeira é a que faz o convite funcionar de verdade: a sala existe na
 * máquina de quem hospeda, e sem o endereço do servidor o aplicativo de quem
 * recebe abriria o servidor local dele — uma sala vazia de mesmo nome.
 *
 * VALIDAÇÃO RIGOROSA, e não por formalidade. A janela do aplicativo não tem
 * barra de endereço: quem a vê não consegue conferir onde está. Abrir nela
 * qualquer endereço que chegue por um link seria entregar uma tela sem
 * identificação para quem mandasse o link. Por isso só passa https (ou http
 * na própria máquina e na rede local, onde não há o que falsificar) e só com
 * um id de sala válido no fim.
 *
 * @returns {{tipo:"remoto",url:string}|{tipo:"local",room:string}|null}
 */
export function destinoDoLink(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== `${ESQUEMA}:`) return null;

  const endereco = url.searchParams.get("u");
  if (endereco) {
    let alvo;
    try {
      alvo = new URL(endereco);
    } catch {
      return null;
    }
    const host = alvo.hostname;
    const naPropriaMaquina = host === "127.0.0.1" || host === "localhost" || host === "::1";
    const naRedeLocal =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);

    const protocoloOk =
      alvo.protocol === "https:" || (alvo.protocol === "http:" && (naPropriaMaquina || naRedeLocal));
    if (!protocoloOk) return null;

    // O id da sala vive no fragmento. Sem ele, não é um convite — é só um
    // endereço qualquer pedindo para ser aberto numa janela sem identificação.
    const sala = alvo.hash.replace(/^#/, "");
    if (!ID_RE.test(sala)) return null;

    return { tipo: "remoto", url: alvo.toString() };
  }

  const room = roomFromUrl(raw);
  return room ? { tipo: "local", room } : null;
}

/** O link `vcall://` recebido na linha de comando, se houver. */
export function linkDosArgumentos(argv = process.argv) {
  return argv.find((a) => typeof a === "string" && a.startsWith(`${ESQUEMA}://`)) || null;
}

/* ==================================================================== *
 * Registro no sistema
 * ==================================================================== */

function rodar(cmd, args) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
      p.on("error", () => resolve(false));
      p.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Windows: quatro chaves em HKCU\Software\Classes.
 *
 * `URL Protocol` (mesmo vazio) é o que marca a chave como um esquema de
 * endereço; sem ele o Windows ignora o registro inteiro. O `%1` no comando é
 * onde o endereço clicado entra, e as aspas em volta importam: sem elas, um
 * caminho com espaço quebra a chamada.
 */
async function registrarWindows(exe) {
  const base = `HKCU\\Software\\Classes\\${ESQUEMA}`;
  const ok = [
    await rodar("reg", ["add", base, "/ve", "/d", "URL:Vcall", "/f"]),
    await rodar("reg", ["add", base, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]),
    await rodar("reg", ["add", `${base}\\DefaultIcon`, "/ve", "/d", `"${exe}",0`, "/f"]),
    await rodar("reg", ["add", `${base}\\shell\\open\\command`, "/ve", "/d", `"${exe}" "%1"`, "/f"]),
  ];
  return ok.every(Boolean);
}

/**
 * Linux: um arquivo .desktop e o banco de dados de MIME.
 *
 * `MimeType=x-scheme-handler/vcall` é a linha que faz o navegador oferecer o
 * aplicativo ao clicar no link. `update-desktop-database` avisa o sistema; sem
 * ele o registro só passa a valer no próximo login.
 */
async function registrarLinux(exe, icone) {
  const dir = path.join(os.homedir(), ".local", "share", "applications");
  const arquivo = path.join(dir, "vcall.desktop");
  const conteudo = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Vcall",
    "Comment=Chamadas de vídeo diretas, sem intermediário",
    `Exec="${exe}" %u`,
    `Icon=${icone}`,
    "Terminal=false",
    "Categories=Network;VideoConference;",
    `MimeType=x-scheme-handler/${ESQUEMA};`,
    "StartupNotify=true",
    "StartupWMClass=Vcall",
    "",
  ].join("\n");

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(arquivo, conteudo);
  } catch {
    return false;
  }
  await rodar("update-desktop-database", [dir]);
  await rodar("xdg-mime", ["default", "vcall.desktop", `x-scheme-handler/${ESQUEMA}`]);
  return true;
}

/**
 * Registra o esquema, se ainda não estiver registrado para este executável.
 *
 * Roda a cada abertura porque é barato e porque o caminho do executável muda
 * quando a pessoa move o arquivo de pasta — um registro apontando para onde o
 * programa não está mais é pior do que nenhum.
 */
export async function registrarEsquema(exe = process.execPath, { icone = null } = {}) {
  try {
    if (process.platform === "win32") return await registrarWindows(exe);
    if (process.platform === "linux") return await registrarLinux(exe, await gravarIcone(icone));
    return false; // no macOS o esquema vem do Info.plist de um pacote .app
  } catch {
    return false;
  }
}

/**
 * Grava o ícone do aplicativo em disco, para o .desktop poder apontar para ele.
 *
 * No Windows o ícone vive dentro do próprio executável; no Linux o padrão é um
 * arquivo à parte, e sem ele o lançador de aplicativos mostra um quadrado
 * cinza. A imagem vem embutida no binário, junto com o resto da interface.
 */
async function gravarIcone(png) {
  const destino = path.join(PASTA, "vcall.png");
  if (!png) return destino; // sem a imagem à mão: o caminho fica declarado
  try {
    await mkdir(PASTA, { recursive: true });
    await writeFile(destino, png);
  } catch {
    /* sem permissão: o .desktop aponta para um arquivo que não existe, e o
       sistema usa o ícone genérico — o aplicativo continua funcionando */
  }
  return destino;
}

/* ==================================================================== *
 * Instância única
 * ==================================================================== */

/** Anuncia esta instância para as próximas execuções. */
export async function marcarInstancia({ porta, token }) {
  try {
    await mkdir(PASTA, { recursive: true });
    await writeFile(MARCA, JSON.stringify({ porta, token, pid: process.pid }));
  } catch {
    /* sem marca: a próxima execução sobe outro servidor, e paciência */
  }
}

export async function limparInstancia() {
  await unlink(MARCA).catch(() => {});
}

/**
 * Há um Vcall já rodando? Se houver, entrega o endereço a ele.
 *
 * A marca em disco pode estar velha — o programa pode ter sido encerrado à
 * força, sem apagar nada. Por isso não basta ler o arquivo: é preciso bater na
 * porta e confirmar que quem responde é mesmo um Vcall, com o token daquela
 * execução. Só então esta segunda execução se cala e sai.
 *
 * @returns {Promise<boolean>} true se outra instância assumiu
 */
export async function entregarParaInstanciaViva(destino) {
  let marca;
  try {
    marca = JSON.parse(await readFile(MARCA, "utf8"));
  } catch {
    return false;
  }
  if (!marca?.porta || !marca?.token) return false;

  const params = new URLSearchParams({ t: marca.token });
  if (destino?.tipo === "remoto") params.set("url", destino.url);
  else if (destino?.room) params.set("sala", destino.room);

  const alvo = `http://127.0.0.1:${marca.porta}/__host/abrir?${params}`;

  try {
    const controle = AbortSignal.timeout(1500);
    const res = await fetch(alvo, { signal: controle });
    if (!res.ok) return false;
    const corpo = await res.json().catch(() => ({}));
    return corpo?.ok === true;
  } catch {
    // Ninguém atendeu: a marca era de um processo morto.
    await limparInstancia();
    return false;
  }
}
