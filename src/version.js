/**
 * src/version.js — identidade desta compilação.
 *
 * Existe por um motivo prático: quando algo não funciona, a primeira pergunta
 * é "você está rodando a versão nova?". Sem uma resposta objetiva, perde-se
 * muito tempo corrigindo um problema que já foi corrigido. O selo abaixo
 * aparece no arranque do servidor, em /healthz e nas configurações do app.
 *
 * A impressão digital cobre os arquivos que realmente mudam o comportamento,
 * então ela muda a cada alteração de código — mesmo sem trocar o número da
 * versão.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Dentro do executável não há árvore de código para varrer: os arquivos foram
 * embutidos no binário. O build calcula a identidade na hora de empacotar e a
 * deixa aqui. Também é o que evita tocar em `import.meta`, que não existe no
 * formato CommonJS gerado pelo empacotador.
 */
const ASSADA = process.env.VCALL_BUILD_INFO || "";

/** Resolvido só quando preciso: em tempo de execução embutido, nunca. */
function rootDir() {
  try {
    const url = import.meta?.url;
    if (url) return path.resolve(path.dirname(fileURLToPath(url)), "..");
  } catch {
    /* formato sem import.meta */
  }
  return path.dirname(process.execPath);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|css|html)$/.test(e.name)) out.push(full);
  }
  return out;
}

function compute() {
  const root = rootDir();
  let version = "0.0.0";
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  } catch {
    /* sem package.json legível */
  }

  const hash = createHash("sha256");
  let newest = 0;
  let files = 0;
  for (const file of [
    ...walk(path.join(root, "public", "js")),
    ...walk(path.join(root, "public", "css")),
    ...walk(path.join(root, "src")),
    path.join(root, "server.js"),
    path.join(root, "public", "index.html"),
  ]) {
    try {
      const st = fs.statSync(file);
      hash.update(path.relative(root, file));
      hash.update(String(st.size));
      newest = Math.max(newest, st.mtimeMs);
      files += 1;
    } catch {
      /* arquivo sumiu no meio da varredura */
    }
  }

  return {
    version,
    build: hash.digest("hex").slice(0, 8),
    files,
    builtAt: newest ? new Date(newest).toISOString() : null,
  };
}

function lerAssada() {
  try {
    const v = JSON.parse(ASSADA);
    if (v && typeof v.version === "string") return v;
  } catch {
    /* formato inesperado: cai na varredura */
  }
  return null;
}

export const VERSION = lerAssada() || compute();

/** Uma linha só, para o log e para a interface. */
export const versionLabel = () =>
  `v${VERSION.version} (${VERSION.build}${VERSION.builtAt ? `, ${VERSION.builtAt.slice(0, 10)}` : ""})`;
