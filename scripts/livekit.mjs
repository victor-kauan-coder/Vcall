#!/usr/bin/env node
/**
 * scripts/livekit.mjs — põe o LiveKit (o SFU de quem transmite) em
 * .cache-livekit/, de onde o electron-builder o copia para o lado do
 * executável. O app instalado não baixa nada na hora de transmitir.
 *
 * Mesmo download e mesma conferência de SHA256 do app (desktop/sfu.js):
 * pacote diferente do fixado derruba o build.
 *
 *   node scripts/livekit.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { garantirBinario, VERSAO } from "../desktop/sfu.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = await garantirBinario({ pasta: path.join(raiz, ".cache-livekit") });
console.log(`LiveKit ${VERSAO} pronto: ${path.relative(raiz, bin)}`);
