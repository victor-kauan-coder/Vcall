#!/usr/bin/env node
/**
 * scripts/build-exe.mjs — monta o executável do Vcall.
 *
 * O resultado é UM arquivo. Dentro dele vão o servidor, a interface e o Node
 * que executa tudo; fora dele não fica nada para instalar. Três etapas:
 *
 *   1. A INTERFACE VIRA DADO. Tudo em public/ é lido e colado num objeto
 *      JavaScript — texto como texto, imagem como base64. O servidor passa a
 *      responder da memória em vez do disco, o que de quebra é mais rápido:
 *      não há uma leitura de arquivo por requisição.
 *
 *   2. O SERVIDOR VIRA UM ARQUIVO SÓ. O esbuild junta src/, desktop/ e a
 *      dependência `ws` num único CommonJS. Isso é o que permite a etapa 3 —
 *      e é também o que faz o código não viajar em pedaços legíveis.
 *
 *   3. O ARQUIVO VIRA EXECUTÁVEL. O recurso de "aplicação executável única"
 *      do próprio Node empacota o bundle dentro de uma cópia do node.exe.
 *
 * Sobre segredo: o que está aqui dentro fica bem menos acessível do que uma
 * pasta de arquivos .js, mas não é criptografia — quem souber mexer consegue
 * extrair. E a interface (public/) é servida para o navegador de todo mundo
 * que entra na sala: essa parte é pública por construção, em qualquer app web
 * que exista. O que o executável protege de verdade é a lógica do servidor.
 *
 *   node scripts/build-exe.mjs
 */
import { execFile } from "node:child_process";
import https from "node:https";
import zlib from "node:zlib";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { inject } from "postject";
import { VERSION } from "../src/version.js";
import { rcedit } from "rcedit";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-exe");

/** Extensões servidas como texto; o resto vai em base64. */
const TEXTO = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".webmanifest", ".txt", ".map"]);

async function listar(dir, base = dir) {
  const itens = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) itens.push(...(await listar(abs, base)));
    else itens.push({ abs, rel: path.relative(base, abs).split(path.sep).join("/") });
  }
  return itens;
}

/** Etapa 1: public/ vira um módulo JavaScript. */
async function empacotarPublic() {
  const dir = path.join(root, "public");
  const arquivos = await listar(dir);
  const partes = [];
  let bytes = 0;

  for (const { abs, rel } of arquivos) {
    const buf = await readFile(abs);
    bytes += buf.length;
    const ext = path.extname(rel).toLowerCase();
    if (TEXTO.has(ext)) {
      partes.push(`  ${JSON.stringify("/" + rel)}: { t: ${JSON.stringify(buf.toString("utf8"))} }`);
    } else {
      partes.push(`  ${JSON.stringify("/" + rel)}: { b: ${JSON.stringify(buf.toString("base64"))} }`);
    }
  }

  const modulo = `/* Gerado por scripts/build-exe.mjs — não edite à mão. */
const CRU = {
${partes.join(",\n")}
};

/**
 * Os arquivos da interface, já em memória. Texto vira Buffer uma única vez, na
 * primeira requisição; depois fica no cache.
 */
const cache = new Map();

function assetFor(rota) {
  const hit = cache.get(rota);
  if (hit) return hit;
  const bruto = CRU[rota];
  if (!bruto) return null;
  const buf = bruto.t !== undefined ? Buffer.from(bruto.t, "utf8") : Buffer.from(bruto.b, "base64");
  cache.set(rota, buf);
  return buf;
}

function hasAsset(rota) {
  return Object.prototype.hasOwnProperty.call(CRU, rota);
}

export const assets = { get: assetFor, has: hasAsset };
`;
  await mkdir(out, { recursive: true });
  const destino = path.join(out, "assets.generated.js");
  await writeFile(destino, modulo);
  console.log(`  interface: ${arquivos.length} arquivos, ${(bytes / 1024).toFixed(0)} kB`);
  return destino;
}

/** Etapa 2: tudo num CommonJS só. */
async function bundle() {
  const entrada = path.join(root, "desktop/launcher.js");
  const gerado = path.join(out, "assets.generated.js");
  const stub = path.join(root, "desktop", "assets.js");

  const arquivo = path.join(out, "vcall.bundle.js");
  await esbuild.build({
    entryPoints: [entrada],
    /*
     * A troca que embute a interface: onde o launcher pede desktop/assets.js
     * (que em desenvolvimento não devolve nada), entra o módulo gerado com
     * todos os arquivos dentro.
     */
    plugins: [
      {
        name: "vcall-assets",
        setup(build) {
          build.onResolve({ filter: /assets\.js$/ }, (args) => {
            const alvo = path.resolve(path.dirname(args.importer || ""), args.path);
            return alvo === stub ? { path: gerado } : null;
          });
        },
      },
    ],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: arquivo,
    minify: true,
    // Sem mapa de origem: ele reconstruiria o código legível dentro do binário,
    // que é o oposto do que este build serve para fazer.
    sourcemap: false,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
      // A identidade da compilação é calculada agora, com a árvore de código
      // à mão, e vai assada para dentro do binário.
      "process.env.VCALL_BUILD_INFO": JSON.stringify(JSON.stringify(VERSION)),
    },
  });

  const { size } = await stat(arquivo);
  console.log(`  bundle:    ${(size / 1024).toFixed(0)} kB`);
  return arquivo;
}

/** Etapa 3: o bundle entra numa cópia do node. */
async function empacotarExe(bundlePath, assets = {}) {
  const cfg = path.join(out, "sea.generated.json");
  const blob = path.join(out, "vcall.blob");
  await writeFile(
    cfg,
    JSON.stringify(
      {
        main: bundlePath,
        output: blob,
        disableExperimentalSEAWarning: true,
        assets,
        // O snapshot aceleraria a partida, mas não aceita `import()` dinâmico
        // no topo — que é como o launcher começa. Fica desligado.
        useSnapshot: false,
        useCodeCache: true,
      },
      null,
      2,
    ),
  );

  await run(process.execPath, ["--experimental-sea-config", cfg]);

  const exe = path.join(out, process.platform === "win32" ? "Vcall.exe" : "vcall");
  await copyFile(process.execPath, exe);

  /*
   * O ícone entra ANTES do programa.
   *
   * A ordem não é detalhe: o rcedit reescreve a tabela de recursos do
   * executável, e depois da injeção o arquivo tem 83 MB com uma seção extra
   * no fim — nessa forma ele entra num laço que consome minutos de CPU sem
   * terminar. No node.exe limpo, a mesma operação leva 2 segundos. A injeção
   * seguinte só acrescenta a seção do programa e não mexe nos recursos.
   */
  await identidadeWindows(exe);

  await inject(exe, "NODE_SEA_BLOB", await readFile(blob), {
    machoSegmentName: process.platform === "darwin" ? "NODE_SEA" : undefined,
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  });

  await semJanelaDeConsole(exe);

  const { size } = await stat(exe);
  console.log(`  executável: ${exe} (${(size / 1024 / 1024).toFixed(0)} MB)`);
  return exe;
}

/**
 * Ícone e ficha do executável no Windows.
 *
 * Sem isto o arquivo sai com o ícone e o nome do Node — afinal ele É uma cópia
 * do node.exe com o programa embutido. Quem recebe vê um arquivo genérico do
 * "Node.js JavaScript Runtime", que não passa confiança nenhuma e nem parece o
 * Vcall. Os campos abaixo são os que o Explorador mostra nas propriedades.
 */
async function identidadeWindows(exe) {
  if (process.platform !== "win32") return;
  const icone = path.join(root, "dist-exe-icon", "vcall.ico");
  try {
    await stat(icone);
  } catch {
    throw new Error("falta dist-exe-icon/vcall.ico — rode antes: npm run icons");
  }

  const campos = {
    icon: icone,
    "version-string": {
      ProductName: "Vcall",
      FileDescription: "Vcall — chamadas de vídeo diretas",
      CompanyName: "Victor Kauan",
      LegalCopyright: `© ${new Date().getFullYear()} Victor Kauan`,
      OriginalFilename: "Vcall.exe",
      InternalName: "Vcall",
    },
    "file-version": `${VERSION.version}.0`,
    "product-version": VERSION.version,
  };

  /*
   * Até três tentativas. O rcedit falha com "Unable to commit changes" quando
   * o arquivo ainda está preso — o antivírus do Windows costuma abrir um
   * executável recém-criado para inspecionar, e nesse instante a gravação de
   * recursos não passa. Esperar um pouco e repetir resolve; desistir em
   * silêncio entregaria um programa com a cara do Node.
   */
  let ultimo;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      await rcedit(exe, campos);
      console.log("  ícone e ficha do Windows aplicados");
      return;
    } catch (err) {
      ultimo = err;
      await new Promise((r) => setTimeout(r, 400 * tentativa));
    }
  }
  throw new Error(`não consegui aplicar o ícone: ${ultimo?.message || ultimo}`);
}

/**
 * Tira a janela de console do executável.
 *
 * O binário é uma cópia do node.exe, que é um programa de CONSOLE: ao abrir
 * com dois cliques, o Windows cria a janela preta antes mesmo de o programa
 * rodar. Não há opção de linha de comando para isso — o subsistema é um campo
 * no cabeçalho do arquivo, e trocá-lo de 3 (console) para 2 (janela) é o que
 * faz o programa abrir calado.
 *
 * O preço: nada mais aparece no console, nem erros. Por isso o launcher grava
 * um arquivo de registro — sem ele, uma falha na partida seria invisível.
 */
async function semJanelaDeConsole(exe) {
  if (process.platform !== "win32") return;
  const buf = await readFile(exe);

  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", pe, pe + 2) !== "PE") {
    throw new Error("cabeçalho PE não encontrado");
  }
  // Campo Subsystem: 24 bytes de cabeçalho COFF + 68 dentro do opcional.
  // A posição é a mesma em PE32 e PE32+.
  const off = pe + 24 + 68;
  const atual = buf.readUInt16LE(off);
  if (atual === 2) return;
  if (atual !== 3) throw new Error(`subsistema inesperado: ${atual}`);

  buf.writeUInt16LE(2, off);
  await writeFile(exe, buf);
  console.log("  janela de console removida");
}

/** Baixa um arquivo, seguindo os redirecionamentos do GitHub. */
function baixarArquivo(url, destino) {
  return new Promise((resolve, reject) => {
    const puxar = (endereco) => {
      https
        .get(endereco, { headers: { "user-agent": "vcall-build" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            puxar(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`resposta ${res.statusCode} em ${endereco}`));
            return;
          }
          const out = createWriteStream(destino);
          res.pipe(out);
          out.on("finish", () => out.close(resolve));
          out.on("error", reject);
        })
        .on("error", reject);
    };
    puxar(url);
  });
}

/**
 * O cloudflared que vai DENTRO do executável.
 *
 * Baixado uma vez aqui, na hora de montar o programa, e guardado em cache. Vai
 * embutido comprimido para que o aplicativo pronto não precise buscar nada na
 * internet — era a única coisa que ele ainda ia buscar fora.
 *
 * Comprimido porque o binário tem ~35 MB e o gzip o deixa perto de 15 MB; num
 * arquivo que as pessoas vão baixar e mandar umas para as outras, 20 MB fazem
 * diferença.
 */
const CLOUDFLARED = {
  win32: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe",
  },
  linux: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
  },
};

async function cloudflaredComprimido(plataforma = process.platform) {
  const cache = path.join(root, ".cache-cloudflared");
  const nome = plataforma === "win32" ? "cloudflared.exe" : "cloudflared";
  const bruto = path.join(cache, `${plataforma}-${nome}`);
  const gz = `${bruto}.gz`;

  try {
    await stat(gz);
    return gz;
  } catch {
    /* baixa abaixo */
  }

  const url = CLOUDFLARED[plataforma]?.[process.arch] || CLOUDFLARED[plataforma]?.x64;
  if (!url) throw new Error(`sem cloudflared para ${plataforma}/${process.arch}`);

  await mkdir(cache, { recursive: true });
  console.log(`  baixando cloudflared de ${plataforma} (~35 MB, uma vez só)…`);
  await baixarArquivo(url, bruto);

  const dados = await readFile(bruto);
  await writeFile(gz, zlib.gzipSync(dados, { level: 9 }));
  console.log(`  cloudflared: ${(dados.length / 1024 / 1024).toFixed(0)} MB → ${((await stat(gz)).size / 1024 / 1024).toFixed(0)} MB comprimido`);
  return gz;
}

/**
 * O binário do Node para Linux.
 *
 * O empacotador do Node constrói para a plataforma em que está rodando, porque
 * ele copia o próprio executável e injeta o programa dentro. Para gerar o
 * arquivo de Linux a partir do Windows, o que falta é só o `node` de Linux —
 * baixado da distribuição oficial, na mesma versão que está aqui, para que o
 * programa embutido encontre exatamente as APIs que espera.
 */
async function nodeDeLinux() {
  const versao = process.versions.node;
  const cache = path.join(root, ".cache-node-linux");
  const destino = path.join(cache, `node-v${versao}-linux-x64`);
  const bin = path.join(destino, "bin", "node");

  try {
    await stat(bin);
    console.log(`  node de Linux: já em cache (v${versao})`);
    return bin;
  } catch {
    /* baixa abaixo */
  }

  await mkdir(cache, { recursive: true });
  const nome = `node-v${versao}-linux-x64.tar.xz`;
  const url = `https://nodejs.org/dist/v${versao}/${nome}`;
  const pacote = path.join(cache, nome);

  console.log(`  baixando ${nome} (~25 MB)…`);
  await new Promise((resolve, reject) => {
    const puxar = (endereco) => {
      https
        .get(endereco, { headers: { "user-agent": "vcall-build" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            puxar(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`resposta ${res.statusCode} ao baixar o node de Linux`));
            return;
          }
          const out = createWriteStream(pacote);
          res.pipe(out);
          out.on("finish", () => out.close(resolve));
          out.on("error", reject);
        })
        .on("error", reject);
    };
    puxar(url);
  });

  /*
   * Extraído com o nome relativo e a pasta como diretório de trabalho.
   * Passar o caminho absoluto do Windows faz o tar do GNU ler "C:" como nome
   * de máquina remota e tentar abrir uma conexão de rede — o erro que aparece
   * é "Cannot connect to C: resolve failed", que não diz nada sobre a causa.
   */
  await run("tar", ["-xf", nome], { cwd: cache });
  await stat(bin);
  return bin;
}

/** Etapa 3, versão Linux: mesmo blob, outro binário hospedeiro. */
async function empacotarLinux(blob) {
  const base = await nodeDeLinux();
  const exe = path.join(out, "vcall");
  await copyFile(base, exe);

  await inject(exe, "NODE_SEA_BLOB", await readFile(blob), {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  });

  // O bit de execução não sobrevive ao sistema de arquivos do Windows; quem
  // receber vai precisar de `chmod +x`, e o LEIA-ME avisa.
  const { size } = await stat(exe);
  console.log(`  executável Linux: ${exe} (${(size / 1024 / 1024).toFixed(0)} MB)`);
  return exe;
}

async function main() {
  const comLinux = process.argv.includes("--linux");
  console.log("Montando o executável do Vcall…");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await empacotarPublic();
  const bundlePath = await bundle();

  // O cloudflared entra junto, comprimido: é o que faz o aplicativo pronto não
  // precisar baixar nada da internet.
  let assets = {};
  try {
    assets = { "cloudflared.gz": await cloudflaredComprimido(process.platform) };
  } catch (err) {
    console.log(`  (sem cloudflared embutido: ${err.message} — o app vai baixá-lo na primeira vez)`);
  }

  const exe = await empacotarExe(bundlePath, assets);

  if (comLinux) {
    try {
      await empacotarLinux(path.join(out, "vcall.blob"));
    } catch (err) {
      console.log(`  (executável Linux não gerado: ${err.message})`);
    }
  }

  // Os intermediários carregam o código em texto puro; não podem ficar ao lado
  // do executável que vai ser distribuído.
  for (const lixo of ["assets.generated.js", "entry.generated.js", "vcall.bundle.js", "sea.generated.json", "vcall.blob"]) {
    await rm(path.join(out, lixo), { force: true });
  }

  await copyFile(path.join(root, "LEIA-ME.txt"), path.join(out, "LEIA-ME.txt")).catch(() => {});
  console.log(`\nPronto. Mande apenas o conteúdo de dist-exe/ para quem for usar.`);
  return exe;
}

await main();
