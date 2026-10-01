/**
 * desktop/atualizacao.js — existe versão nova no GitHub?
 *
 * DECISÃO QUE VALE ENTENDER ANTES DE MEXER: este módulo AVISA, não instala.
 *
 * Um atualizador que baixa e executa sozinho é, por construção, um caminho de
 * execução remota de código: quem conseguir responder no lugar do GitHub — ou
 * entrar na conta do repositório — passa a mandar um programa qualquer para
 * todas as máquinas que têm o Vcall instalado. Para um programa de chamada de
 * vídeo, que já tem acesso a câmera e microfone, esse risco não se paga.
 *
 * Então o fluxo é: conferir a versão, avisar, e abrir a página de download no
 * navegador se a pessoa quiser. Quem instala é ela, e o sistema operacional
 * continua podendo dizer de onde veio o arquivo.
 *
 * Para passar a instalar sozinho um dia, o mínimo honesto seria assinar os
 * pacotes e conferir a assinatura aqui — não basta conferir o hash que vem no
 * mesmo lugar de onde veio o arquivo.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const REPO = process.env.VCALL_REPO || "victor-kauan-coder/vcall";
export const VERSAO = process.env.VCALL_VERSAO || "3.6.2";

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
      "user-agent": `vcall/${VERSAO}`,
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
export async function conferir({ forcar = false } = {}) {
  const paginaDeDownload = `https://github.com/${REPO}/releases/latest`;

  if (!forcar) {
    const cache = await lerCache();
    if (cache && Date.now() - cache.conferidoEm < VALIDADE_MS) return cache;
  }

  const base = {
    tem: false,
    versao: null,
    atual: VERSAO,
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
      tem: Boolean(tag) && maisNova(tag, VERSAO),
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
