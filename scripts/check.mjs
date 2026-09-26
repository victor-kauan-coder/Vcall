#!/usr/bin/env node
/**
 * scripts/check.mjs — verificação estática sem dependências pesadas.
 *
 *   1. todo arquivo .js compila;
 *   2. todo import relativo aponta para um arquivo existente;
 *   3. todo ícone referenciado no código e no HTML existe no sprite;
 *   4. toda variável CSS usada está definida em tokens.css;
 *   5. a resolução de caminhos funciona no Linux E no Windows.
 *
 * Roda com: npm run check
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

async function walk(dir, ext) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, ext)));
    else if (ext.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/* 1 + 2 — sintaxe e imports ---------------------------------------- */

const jsFiles = [
  ...(await walk(path.join(root, "public", "js"), [".js"])),
  ...(await walk(path.join(root, "src"), [".js"])),
  path.join(root, "server.js"),
];

for (const file of jsFiles) {
  const src = await readFile(file, "utf8");
  const rel = path.relative(root, file);

  // Faz o parse como módulo ES, sem executar nem resolver imports.
  const parsed = await esbuild.transform(src, {
    loader: "js",
    format: "esm",
    sourcefile: file,
  }).catch((err) => {
    fail(`${rel}: ${err.errors?.[0]?.text || err.message}`);
    return null;
  });
  if (!parsed) continue;

  for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!existsSync(target)) fail(`${rel}: import inexistente → ${m[1]}`);
  }
}
console.log(`  ✓ ${jsFiles.length} arquivos JS verificados`);

/* 3 — ícones -------------------------------------------------------- */

const manifest = JSON.parse(await readFile(path.join(root, "public", "vendor", "icons.json"), "utf8"));
const known = new Set(Object.keys(manifest));
const used = new Set();

for (const file of [...jsFiles, path.join(root, "public", "index.html")]) {
  const src = await readFile(file, "utf8");
  for (const m of src.matchAll(/icons\.svg#i-([a-z0-9-]+)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bicon\(\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bsetIcon\([^,]+,\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bicon:\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
  for (const m of src.matchAll(/\biconName:\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
}

for (const name of [...used].sort()) {
  if (!known.has(name)) fail(`ícone ausente no sprite: "${name}" (adicione em scripts/vendor.mjs)`);
}
console.log(`  ✓ ${used.size} ícones referenciados, todos presentes no sprite`);

/* 4 — variáveis CSS ------------------------------------------------- */

const cssFiles = await walk(path.join(root, "public", "css"), [".css"]);
const defined = new Set();
const referenced = new Map();

for (const file of cssFiles) {
  const src = await readFile(file, "utf8");
  for (const m of src.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) defined.add(m[1]);
  for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], path.relative(root, file));
  }
}
// Variáveis definidas em linha pelo JS (via style) não precisam estar no CSS.
const inlineDefined = new Set(["--swatch", "--dot", "--laser-color", "--level", "--cols", "--lv", "--tx", "--ty", "--mx", "--my", "--spin", "--acesas", "--i"]);

for (const [name, where] of referenced) {
  if (!defined.has(name) && !inlineDefined.has(name)) fail(`variável CSS indefinida: ${name} (${where})`);
}
console.log(`  ✓ ${defined.size} variáveis CSS definidas, ${referenced.size} referenciadas`);

/* 5 — resolução de caminho com semântica de Windows ------------------ */

/**
 * O servidor roda em Linux nos testes, mas os usuários rodam no Windows. Um
 * bug real já passou por aqui: `path.normalize("/")` devolve "\" no Windows,
 * e a raiz deixava de ser reconhecida — o servidor tentava entregar a pasta
 * `public` como arquivo e a conexão caía. Este bloco executa a mesma lógica
 * com os dois conjuntos de regras.
 */
{
  const httpSrc = await readFile(path.join(root, "src", "http.js"), "utf8");

  const makeResolver = (p, publicDir) => (pathname) => {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const segments = [];
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        segments.pop();
        continue;
      }
      if (part.includes("\\")) return null;
      segments.push(part);
    }
    const abs = segments.length ? p.join(publicDir, ...segments) : p.join(publicDir, "index.html");
    const rel = p.relative(publicDir, abs);
    if (rel.startsWith("..") || p.isAbsolute(rel)) return null;
    return abs;
  };

  // A lógica do teste tem de ser a mesma do servidor.
  if (!httpSrc.includes('segments.length ? path.join(publicDir, ...segments)')) {
    fail("src/http.js: resolveSafe mudou — atualize o espelho em scripts/check.mjs");
  }

  const cases = [
    ["/", "index.html"],
    ["", "index.html"],
    ["/index.html", "index.html"],
    ["/css/app.css", "css/app.css"],
    ["/vendor/icons.svg", "vendor/icons.svg"],
    ["/./css/app.css", "css/app.css"],
    ["/css/../css/app.css", "css/app.css"],
  ];
  const blocked = ["/../../etc/passwd", "/..\\..\\windows", "/a/..%2f..%2fsecret\0"];

  for (const [platform, p, base] of [
    ["posix", path.posix, "/app/public"],
    ["win32", path.win32, "C:\\app\\public"],
  ]) {
    const resolve = makeResolver(p, base);
    const sep = platform === "win32" ? "\\" : "/";

    for (const [url, expectRel] of cases) {
      const got = resolve(url);
      const want = base + sep + expectRel.split("/").join(sep);
      if (got !== want) fail(`resolveSafe[${platform}] ${JSON.stringify(url)}: esperado ${want}, veio ${got}`);
    }
    // A raiz nunca pode resolver para a própria pasta — foi exatamente o bug.
    if (resolve("/") === base || resolve("/") === base + sep) {
      fail(`resolveSafe[${platform}]: "/" resolveu para a pasta, não para index.html`);
    }
    for (const url of blocked) {
      const got = resolve(url);
      if (got && !got.startsWith(base + sep)) fail(`resolveSafe[${platform}]: travessia passou em ${url}`);
    }
  }
  console.log("  ✓ resolução de caminhos correta no Linux e no Windows");
}

/* ------------------------------------------------------------------ */

if (failures) {
  console.error(`\n${failures} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
