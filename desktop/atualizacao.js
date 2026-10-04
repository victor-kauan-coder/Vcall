/**
 * desktop/atualizacao.js — existe versão nova no GitHub?
 *
 * A parte pura da atualização: comparar versões, consultar a última release e
 * decidir, pelo jeito como o Vcall foi instalado, se dá para atualizar
 * sozinho. Quem baixa e instala é desktop/atualizador.js, e só depois de
 * conferir a assinatura do pacote (desktop/assinatura.js) — o hash que vem no
 * mesmo lugar do arquivo não basta, e por isso este módulo, antes, só avisava.
 *
 * Onde não dá para instalar sozinho (.tar.gz, ou o app rodando fora do
 * pacote), o fluxo continua o de antes: conferir, avisar e abrir a página de
 * download.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const REPO = process.env.VCALL_REPO || "victor-kauan-coder/vcall";
/**
 * Reserva para o executável antigo (Node SEA, scripts/build-installer.mjs). O
 * app Electron passa a própria versão (`app.getVersion()`) em `conferir`: com
 * o número escrito à mão aqui, uma release em que ele não fosse trocado faria
 * o app se achar mais velho do que é — e avisar de "atualização" para sempre.
 */
export const VERSAO = process.env.VCALL_VERSAO || "3.7.0";

const CACHE = path.join(os.homedir(), ".vcall", "atualizacao.json");

/** Quanto tempo uma resposta vale. Conferir a cada abertura é demais. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

/** O GitHub não responde sem User-Agent, e corta quem demora. */
const PRAZO_MS = 8000;

/**
 * Compara duas versões no formato `1.2.3`.
 *
 * Comparar como texto diria que "3.10.0" é menor que "3.9.0" — e a pessoa
 * ficaria sem a atualização justamente quando o número de versão cresce.
 */
export function maisNova(candidata, atual) {
  const partes = (v) =>
    String(v || "")
      .replace(/^v/i, "")
      .split(/[.\-+]/)
      .map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
  const a = partes(candidata);
  const b = partes(atual);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function pegarJson(url) {
  const corte = AbortSignal.timeout(PRAZO_MS);
  const res = await fetch(url, {
    signal: corte,
    headers: {
      "user-agent": "vcall",
      accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  return res.json();
}

async function lerCache() {
  try {
    return JSON.parse(await readFile(CACHE, "utf8"));
  } catch {
    return null;
  }
}

async function gravarCache(dados) {
  try {
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(dados));
  } catch {
    /* sem disco: só perde o cache, a conferência continua valendo */
  }
}

/**
 * Confere se há versão nova.
 *
 * @param {object} opts
 * @param {boolean} opts.forcar  Ignora o cache (o botão "verificar agora").
 * @returns {Promise<{tem: boolean, versao: string|null, atual: string,
 *   url: string, notas: string|null, erro: string|null, conferidoEm: number}>}
 */
export async function conferir({ forcar = false, atual = VERSAO } = {}) {
  const paginaDeDownload = `https://github.com/${REPO}/releases/latest`;

  if (!forcar) {
    const cache = await lerCache();
    // O cache de outra versão não vale: quem acabou de atualizar não pode ver
    // o aviso da versão que já tem.
    if (cache && cache.atual === atual && Date.now() - cache.conferidoEm < VALIDADE_MS) return cache;
  }

  const base = {
    tem: false,
    versao: null,
    atual,
    url: paginaDeDownload,
    notas: null,
    erro: null,
    conferidoEm: Date.now(),
  };

  try {
    const solto = await pegarJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const tag = solto.tag_name || solto.name;
    const resposta = {
      ...base,
      versao: tag || null,
      notas: solto.body ? String(solto.body).slice(0, 2000) : null,
      url: solto.html_url || paginaDeDownload,
      tem: Boolean(tag) && maisNova(tag, atual),
    };
    await gravarCache(resposta);
    return resposta;
  } catch (err) {
    /*
     * Sem internet, repositório privado ou ainda sem nenhuma versão publicada
     * caem todos aqui. Nenhum deles é problema do usuário no meio de uma
     * chamada: o programa segue funcionando igual, e o erro fica guardado
     * para a tela de configurações mostrar a quem for procurar.
     */
    const resposta = { ...base, erro: err.message || "falha ao consultar" };
    await gravarCache({ ...resposta, conferidoEm: Date.now() - VALIDADE_MS + 15 * 60 * 1000 });
    return resposta;
  }
}

/**
 * Dá para atualizar sozinho, do jeito que este Vcall foi instalado?
 *
 *   "sozinho"  Windows (instalador) e AppImage: baixa, confere e instala ao fechar.
 *   "senha"    .deb e .rpm: baixa e confere; instalar pede a senha do sistema
 *              (é o gerenciador de pacotes que instala), então só quando a
 *              pessoa clica — nunca de surpresa ao fechar.
 *   "manual"   pacman, .tar.gz, macOS ou fora do pacote: só avisa. O pacman
 *              fica aqui porque o electron-builder 25 não o lista no
 *              latest-linux.yml, e sem isso o atualizador não acha o pacote.
 */
export function modoDeInstalacao({ plataforma = process.platform, empacotado = false, appImage = false, tipoPacote = null } = {}) {
  if (!empacotado) return "manual";
  if (plataforma === "win32") return "sozinho";
  if (plataforma !== "linux") return "manual";
  if (appImage) return "sozinho";
  if (["deb", "rpm"].includes(String(tipoPacote || "").trim())) return "senha";
  return "manual";
}
