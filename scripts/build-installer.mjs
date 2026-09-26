#!/usr/bin/env node
/**
 * scripts/build-installer.mjs — monta o instalador do Vcall.
 *
 * O resultado é UM arquivo, `VcallSetup.exe`, que instala tudo SEM BAIXAR
 * NADA. Dentro dele viajam, comprimidos:
 *
 *   - o programa (Vcall.exe, que já traz a interface e o cloudflared)
 *   - o cloudflared solto, para ficar ao lado do programa instalado
 *   - o LEIA-ME
 *
 * Um instalador que precisa de internet para instalar é o que falha
 * justamente na máquina onde a internet é o problema — e esta é a máquina
 * onde alguém mais precisa de um app de chamada.
 *
 * O instalador é feito com o mesmo empacotador do aplicativo: nenhuma
 * ferramenta externa, nenhum Inno Setup, nenhum NSIS para instalar antes.
 *
 *   node scripts/build-installer.mjs
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import * as esbuild from "esbuild";
import { inject } from "postject";
import { rcedit } from "rcedit";
import { VERSION } from "../src/version.js";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist-exe");
const out = path.join(root, "dist-setup");

/** Comprime um arquivo e devolve o caminho do .gz. */
async function comprimir(origem, destino) {
  const dados = await readFile(origem);
  await writeFile(destino, zlib.gzipSync(dados, { level: 9 }));
  const { size } = await stat(destino);
  console.log(
    `  ${path.basename(origem)}: ${(dados.length / 1024 / 1024).toFixed(0)} MB → ${(size / 1024 / 1024).toFixed(0)} MB`,
  );
  return destino;
}

async function main() {
  console.log("Montando o instalador do Vcall…");

  const appExe = path.join(dist, "Vcall.exe");
  try {
    await stat(appExe);
  } catch {
    throw new Error("falta dist-exe/Vcall.exe — rode antes: npm run build:exe");
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  /* -- carga: tudo comprimido -- */
  const carga = {
    "app.gz": await comprimir(appExe, path.join(out, "app.gz")),
    "leiame.gz": await comprimir(path.join(root, "LEIA-ME.txt"), path.join(out, "leiame.gz")),
  };
  const cf = path.join(root, ".cache-cloudflared", "win32-cloudflared.exe.gz");
  try {
    await stat(cf);
    carga["cloudflared.gz"] = cf;
    console.log("  cloudflared: reaproveitado do cache do build");
  } catch {
    console.log("  (sem cloudflared em cache — o app vai extrair o dele próprio)");
  }

  /* -- o programa do instalador -- */
  const entrada = path.join(out, "entrada.generated.js");
  await writeFile(
    entrada,
    `import { main } from "${path.join(root, "desktop/setup.js").split(path.sep).join("/")}";
main();
`,
  );

  const bundle = path.join(out, "setup.bundle.js");
  await esbuild.build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundle,
    minify: true,
    legalComments: "none",
    define: { "process.env.VCALL_VERSAO": JSON.stringify(VERSION.version) },
  });

  const cfg = path.join(out, "sea.generated.json");
  const blob = path.join(out, "setup.blob");
  await writeFile(
    cfg,
    JSON.stringify({
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      assets: carga,
    }),
  );
  await run(process.execPath, ["--experimental-sea-config", cfg]);

  const exe = path.join(out, "VcallSetup.exe");
  await copyFile(process.execPath, exe);

  /*
   * Ícone e ficha ANTES da injeção: depois, com o arquivo grande e uma seção
   * extra no fim, o rcedit entra num laço que não termina. A mesma ordem do
   * build do aplicativo, pelo mesmo motivo.
   */
  const icone = path.join(root, "dist-exe-icon", "vcall.ico");
  try {
    await stat(icone);
    await rcedit(exe, {
      icon: icone,
      "version-string": {
        ProductName: "Vcall",
        FileDescription: "Instalador do Vcall",
        CompanyName: "Victor Kauan",
        LegalCopyright: `© ${new Date().getFullYear()} Victor Kauan`,
        OriginalFilename: "VcallSetup.exe",
        InternalName: "VcallSetup",
      },
      "file-version": `${VERSION.version}.0`,
      "product-version": VERSION.version,
    });
    console.log("  ícone e ficha aplicados");
  } catch (err) {
    console.log(`  (sem ícone: ${err.message})`);
  }

  await inject(exe, "NODE_SEA_BLOB", await readFile(blob), {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  });

  /*
   * O instalador MANTÉM o console, ao contrário do aplicativo. Um setup que
   * não mostra nada parece travado — e é onde o usuário precisa ver o que
   * está acontecendo e qual foi o erro, se houver.
   */

  for (const lixo of ["entrada.generated.js", "setup.bundle.js", "sea.generated.json", "setup.blob", "app.gz", "leiame.gz"]) {
    await rm(path.join(out, lixo), { force: true });
  }

  const { size } = await stat(exe);
  console.log(`\n  instalador: ${exe} (${(size / 1024 / 1024).toFixed(0)} MB)`);
  console.log("\nPronto. Mande só o VcallSetup.exe — ele instala tudo sem baixar nada.");
}

await main();
