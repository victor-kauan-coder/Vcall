/**
 * desktop/atualizador.js — procura, baixa e instala a versão nova sozinho.
 *
 * O ciclo: ao abrir (e a cada seis horas) procura uma release nova no GitHub;
 * se houver, baixa em segundo plano; terminado o download, CONFERE A
 * ASSINATURA do pacote com a chave pública que vem dentro do app
 * (desktop/assinatura.js). Só um pacote assinado por nós fica "pronto".
 *
 * Quando instalar, para não derrubar ninguém de uma chamada:
 *   - Windows e AppImage: ao fechar o Vcall, em silêncio; da próxima vez que a
 *     pessoa abre, já está na versão nova. Ou na hora, pelo botão
 *     "Reiniciar e atualizar" das configurações.
 *   - .deb, .rpm e pacman: só pelo botão, porque o sistema pede a senha de
 *     administrador para instalar um pacote.
 *   - .tar.gz e fora do pacote: só avisa e aponta a página de download.
 *
 * O download e a troca de arquivos ficam com o electron-updater. A instalação
 * automática dele (ao sair) fica DESLIGADA de propósito: ela é armada assim
 * que o download termina, antes de qualquer conferência. Quem instala ao
 * fechar é este módulo, e só depois da assinatura conferida.
 */
import { app, BrowserWindow, net } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";

import { confere, nomeNaRelease, sha512DoArquivo } from "./assinatura.js";
import { REPO, conferir, maisNova, modoDeInstalacao } from "./atualizacao.js";

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAVE_PUBLICA = readFileSync(path.join(__dirname, "chave-atualizacao.pem"), "utf8");

const PRIMEIRA_BUSCA_MS = 20_000;
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const PAGINA = `https://github.com/${REPO}/releases/latest`;

let registrar = () => {};
let modo = "manual";
/** Versão baixada E conferida. Só ela pode ser instalada. */
let conferida = null;
let estado = { fase: "parado", atual: app.getVersion(), versao: null, progresso: 0, erro: null, url: PAGINA, modo };

function mudar(parcial) {
  estado = { ...estado, ...parcial, modo };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("vcall:atualizacao", estado);
  }
}

function tipoDoPacote() {
  try {
    const arq = path.join(process.resourcesPath, "package-type");
    return existsSync(arq) ? readFileSync(arq, "utf8").trim() : null;
  } catch {
    return null;
  }
}

/** Sem instalar sozinho: confere a release e avisa, como nas versões antigas. */
async function procurarSoAvisando() {
  mudar({ fase: "procurando", erro: null });
  const r = await conferir({ forcar: true, atual: app.getVersion() });
  if (r.erro) return mudar({ fase: "erro", erro: r.erro, url: r.url });
  mudar(r.tem ? { fase: "aviso", versao: r.versao, url: r.url } : { fase: "atual", versao: null });
}

async function conferirDownload(ev) {
  mudar({ fase: "conferindo", versao: ev.version, progresso: 100 });
  try {
    const nome = nomeNaRelease((ev.files || []).map((f) => f.url), path.basename(ev.downloadedFile || ""));
    if (!nome) throw new Error("pacote não encontrado na release");
    const res = await net.fetch(`https://github.com/${REPO}/releases/download/v${ev.version}/${encodeURIComponent(nome)}.sig`);
    if (!res.ok) throw new Error(`assinatura indisponível (${res.status})`);
    const assinatura = await res.text();
    const sha512 = await sha512DoArquivo(ev.downloadedFile);
    if (!confere({ versao: ev.version, sha512, assinatura, chavePublica: CHAVE_PUBLICA })) {
      throw new Error("a assinatura não confere");
    }
    conferida = ev.version;
    registrar("atualizacao-pronta", { versao: ev.version, pacote: nome });
    mudar({ fase: "pronta" });
  } catch (err) {
    conferida = null;
    registrar("atualizacao-recusada", { versao: ev.version, motivo: String(err?.message || err) });
    await unlink(ev.downloadedFile).catch(() => {});
    mudar({ fase: "erro", erro: `a versão ${ev.version} não passou na conferência (${err?.message || err}); nada foi instalado` });
  }
}

/**
 * O erro do electron-updater vem em inglês e com a resposta HTTP inteira. Na
 * tela vai uma frase; o original fica no registro.
 *
 * Release sem `latest.yml` (publicada antes da 3.7, ou à mão) não é falha:
 * se ela for mais nova, volta ao aviso com o link de download; se não, o app
 * já está na mais recente.
 */
function tratarErro(err) {
  const m = String(err?.message || err || "");
  registrar("atualizador-erro", { m: m.slice(0, 600) });
  if (estado.fase === "pronta") return; // erro tardio não desfaz uma versão conferida
  if (/latest(-linux)?\.yml/.test(m) && /404/.test(m)) {
    const tag = m.match(/releases\/download\/v?([\w.-]+)\//)?.[1];
    if (tag && maisNova(tag, app.getVersion())) return mudar({ fase: "aviso", versao: tag, url: PAGINA, erro: null });
    return mudar({ fase: "atual", versao: null, erro: null });
  }
  let erro = "não deu para procurar agora (detalhes no registro do app)";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NAME|ERR_NETWORK|net::/i.test(m)) erro = "sem conexão com o GitHub";
  else if (/rate limit|\b403\b/i.test(m)) erro = "o GitHub limitou as consultas; o Vcall tenta de novo mais tarde";
  mudar({ fase: "erro", erro });
}

/** Procura agora (o botão "Verificar agora" e as buscas periódicas). */
export async function verificar() {
  if (["procurando", "baixando", "conferindo"].includes(estado.fase)) return estado;
  if (estado.fase === "pronta") return estado; // já baixada e conferida
  try {
    if (modo === "manual") await procurarSoAvisando();
    else await autoUpdater.checkForUpdates();
  } catch (err) {
    tratarErro(err);
  }
  return estado;
}

export const estadoAtual = () => estado;

/** "Reiniciar e atualizar": só com uma versão conferida. */
export function instalar() {
  if (!conferida || modo === "manual") return false;
  registrar("atualizacao-instalando", { versao: conferida, quando: "agora" });
  // isSilent: sem as telas do instalador; isForceRunAfter: abre o Vcall de novo.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

/**
 * Chamado quando a última janela fecha. Instala em silêncio, sem reabrir, se
 * houver versão conferida e este modo permitir. `true` quando já cuidou de
 * encerrar o app.
 */
export function aoFechar() {
  if (!conferida || modo !== "sozinho") return false;
  registrar("atualizacao-instalando", { versao: conferida, quando: "ao fechar" });
  autoUpdater.quitAndInstall(true, false);
  return true;
}

export function iniciar(opcoes = {}) {
  registrar = opcoes.registrar || registrar;
  modo = modoDeInstalacao({
    plataforma: process.platform,
    empacotado: app.isPackaged,
    appImage: !!process.env.APPIMAGE,
    tipoPacote: process.platform === "linux" && app.isPackaged ? tipoDoPacote() : null,
  });
  mudar({ fase: "parado", atual: app.getVersion() });

  if (modo !== "manual") {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: () => {},
      debug: () => {},
      warn: (m) => registrar("atualizador-aviso", { m: String(m).slice(0, 600) }),
      error: () => {}, // os erros chegam pelo evento "error" e vão para tratarErro
    };
    autoUpdater.on("checking-for-update", () => mudar({ fase: "procurando", erro: null }));
    autoUpdater.on("update-not-available", () => mudar({ fase: "atual", versao: null }));
    autoUpdater.on("update-available", (info) => mudar({ fase: "baixando", versao: info.version, progresso: 0 }));
    autoUpdater.on("download-progress", (p) => mudar({ fase: "baixando", progresso: Math.floor(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (ev) => conferirDownload(ev));
    autoUpdater.on("error", (err) => tratarErro(err));
  }

  setTimeout(() => verificar(), PRIMEIRA_BUSCA_MS).unref?.();
  setInterval(() => verificar(), INTERVALO_MS).unref?.();
}
