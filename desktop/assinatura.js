/**
 * desktop/assinatura.js — a atualização só é instalada se for nossa.
 *
 * Um atualizador que instala sozinho é um caminho de execução de código
 * remoto: quem responder no lugar do GitHub, ou entrar na conta do
 * repositório, manda um programa para todas as máquinas com o Vcall. O hash
 * que vem no `latest.yml` não protege disso — ele vem do mesmo lugar que o
 * arquivo. O que protege é uma assinatura feita com uma chave que NÃO está no
 * GitHub de forma legível: a privada fica num segredo do repositório, usado só
 * pelo CI na hora da release (scripts/assinar-atualizacao.mjs), e a pública
 * viaja dentro do app (desktop/chave-atualizacao.pem).
 *
 * A mensagem assinada liga o arquivo à VERSÃO: um instalador antigo, legítimo
 * e assinado, não serve para fingir que é uma versão nova.
 *
 * Funções puras sobre Buffer e arquivos: testáveis em Node, sem Electron
 * (scripts/fixes-test.mjs).
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream } from "node:fs";

const PREFIXO = "vcall-atualizacao-v1";

/** O que é assinado: versão e sha512 (base64) do arquivo. */
export function mensagem(versao, sha512) {
  return Buffer.from(`${PREFIXO}\n${String(versao).replace(/^v/i, "")}\n${sha512}`, "utf8");
}

/** sha512 do arquivo, em base64 (o mesmo formato do latest.yml). */
export function sha512DoArquivo(caminho) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(caminho)
      .on("error", reject)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("base64")));
  });
}

/** Assina (CI). `chavePrivada` em PEM. Devolve a assinatura em base64. */
export function assinar({ versao, sha512, chavePrivada }) {
  return sign(null, mensagem(versao, sha512), createPrivateKey(chavePrivada)).toString("base64");
}

/** Confere (app). Qualquer coisa fora do esperado é recusa, nunca exceção. */
export function confere({ versao, sha512, assinatura, chavePublica }) {
  try {
    const sig = Buffer.from(String(assinatura || "").trim(), "base64");
    if (sig.length !== 64) return false; // Ed25519 tem 64 bytes, sempre
    return verify(null, mensagem(versao, sha512), createPublicKey(chavePublica), sig);
  } catch {
    return false;
  }
}

/**
 * Qual arquivo da release foi baixado — o nome que a assinatura `.sig` segue.
 * Preferência: o mesmo nome do arquivo baixado; senão, a mesma extensão.
 *
 * @param {string[]} nomes  arquivos listados no latest*.yml
 * @param {string} baixado  nome do arquivo que o atualizador gravou
 */
export function nomeNaRelease(nomes, baixado) {
  const lista = (nomes || []).map((n) => String(n).split("/").pop());
  if (lista.includes(baixado)) return baixado;
  const ext = String(baixado || "").split(".").pop().toLowerCase();
  return lista.find((n) => n.toLowerCase().endsWith(`.${ext}`)) || null;
}
