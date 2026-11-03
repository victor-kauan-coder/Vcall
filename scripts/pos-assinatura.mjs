#!/usr/bin/env node
/**
 * scripts/pos-assinatura.mjs — refaz o latest.yml e o .blockmap do instalador
 * do Windows depois de a SignPath assiná-lo.
 *
 * A assinatura Authenticode muda os bytes do .exe. O electron-updater confere
 * o sha512 e o tamanho do latest.yml antes de instalar, e baixa só os pedaços
 * que mudaram pelo .blockmap: com os valores de antes, toda atualização
 * falharia. Usa o mesmo app-builder com que o electron-builder gerou os dois.
 *
 *   node scripts/pos-assinatura.mjs dist
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import appBuilder from "app-builder-bin";

const pasta = process.argv[2];
if (!pasta) {
  console.error("uso: node scripts/pos-assinatura.mjs <pasta com o latest.yml>");
  process.exit(2);
}

const yml = path.join(pasta, "latest.yml");
let texto = readFileSync(yml, "utf8");
const nome = /^path: (.+)$/m.exec(texto)?.[1].trim();
if (!nome) {
  console.error(`Sem "path:" em ${yml}.`);
  process.exit(1);
}

const exe = path.join(pasta, nome);
const { sha512, size } = JSON.parse(
  execFileSync(appBuilder.appBuilderPath, ["blockmap", "--input", exe, "--output", `${exe}.blockmap`], { encoding: "utf8" }),
);
texto = texto.replace(/^(\s*sha512: ).+$/gm, `$1${sha512}`).replace(/^(\s*size: ).+$/gm, `$1${size}`);
writeFileSync(yml, texto);
console.log(`${nome}: ${size} bytes, sha512 ${sha512}`);
