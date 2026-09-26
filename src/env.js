/**
 * src/env.js — leitura do arquivo .env.
 *
 * Feito em JavaScript, e não com a flag `--env-file` do Node, de propósito:
 * essa flag só existe a partir do Node 20.6 (e `--env-file-if-exists` a partir
 * do 20.12). Em versões anteriores o processo morre com "bad option" antes de
 * executar uma linha sequer — o servidor nunca sobe, e o sintoma que chega ao
 * usuário é só "localhost não funciona". Ler o arquivo aqui funciona em
 * qualquer Node.
 *
 * Regras: variáveis já presentes no ambiente têm precedência (é o que permite
 * configurar por painel em Docker, Railway, Render), e o arquivo é opcional.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raiz do projeto.
 *
 * `import.meta.url` só existe em módulos ESM. Dentro do executável o código foi
 * convertido para CommonJS e ele vira `undefined`, o que fazia o programa
 * morrer antes de imprimir qualquer coisa. Ali não há árvore de arquivos para
 * apontar mesmo — a interface está embutida e as variáveis vêm do ambiente —,
 * então cair para o diretório do executável é a resposta certa.
 */
function projectRoot() {
  try {
    const url = import.meta?.url;
    if (url) return path.resolve(path.dirname(fileURLToPath(url)), "..");
  } catch {
    /* formato sem import.meta */
  }
  return path.dirname(process.execPath);
}

const root = projectRoot();

/** Remove aspas em volta do valor, se houver, e resolve \n em texto entre aspas duplas. */
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") return v.slice(1, -1);
  // Sem aspas: um # inicia comentário.
  const hash = v.indexOf(" #");
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

export function loadEnv(file = ".env") {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return { loaded: false, count: 0 };
  }

  let count = 0;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // O ambiente ganha do arquivo.
    if (process.env[key] !== undefined) continue;

    process.env[key] = unquote(line.slice(eq + 1));
    count += 1;
  }
  return { loaded: true, count };
}
