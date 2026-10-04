#!/usr/bin/env node
/**
 * scripts/assinar-atualizacao.mjs — assina os instaladores da release.
 *
 * Roda no CI (job "publicar" do .github/workflows/release.yml), depois de os
 * pacotes ficarem prontos. Para cada instalador grava `<arquivo>.sig`, que o
 * app baixa e confere antes de instalar sozinho (desktop/assinatura.js).
 *
 *   VCALL_UPDATE_KEY="$(cat chave-privada.pem)" node scripts/assinar-atualizacao.mjs pacotes 3.7.0
 *
 * Sem a chave, falha: uma release sem assinatura faria o atualizador recusar
 * a versão nova em todas as máquinas, em silêncio.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assinar, confere, sha512DoArquivo } from "../desktop/assinatura.js";

const [pasta, versao] = process.argv.slice(2);
const chavePrivada = process.env.VCALL_UPDATE_KEY;
if (!pasta || !versao) {
  console.error("uso: node scripts/assinar-atualizacao.mjs <pasta> <versão>");
  process.exit(2);
}
if (!chavePrivada || !chavePrivada.includes("PRIVATE KEY")) {
  console.error("Falta o segredo VCALL_UPDATE_KEY (a chave privada de atualização, em PEM).");
  process.exit(1);
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chavePublica = readFileSync(path.join(raiz, "desktop", "chave-atualizacao.pem"), "utf8");
const INSTALADORES = /\.(exe|AppImage|deb|rpm|pacman)$/;

const arquivos = readdirSync(pasta).filter((n) => INSTALADORES.test(n));
if (!arquivos.length) {
  console.error(`Nenhum instalador em ${pasta}.`);
  process.exit(1);
}
for (const nome of arquivos) {
  const sha512 = await sha512DoArquivo(path.join(pasta, nome));
  const assinatura = assinar({ versao, sha512, chavePrivada });
  // A chave do segredo tem de ser o par da que vai no app: confere aqui.
  if (!confere({ versao, sha512, assinatura, chavePublica })) {
    console.error("A chave privada não corresponde a desktop/chave-atualizacao.pem.");
    process.exit(1);
  }
  writeFileSync(path.join(pasta, `${nome}.sig`), `${assinatura}\n`);
  console.log(`assinado: ${nome}`);
}
