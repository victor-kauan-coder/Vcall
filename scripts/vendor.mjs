#!/usr/bin/env node
/**
 * scripts/vendor.mjs
 *
 * Gera os artefatos "vendorizados" que o navegador consome diretamente:
 *
 *   public/vendor/icons.svg    — sprite SVG com o subconjunto de ícones do Lucide (ISC)
 *   public/vendor/icons.json   — manifesto (id -> viewBox) para checagem em build
 *   public/vendor/avatars.js   — bundle ESM do DiceBear (MIT) com os estilos escolhidos
 *
 * Nenhum ícone é desenhado à mão neste projeto: todos vêm de bibliotecas abertas.
 * Rode com:  npm run vendor
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "node_modules", "lucide-static", "icons");
const outDir = path.join(root, "public", "vendor");

/* ------------------------------------------------------------------ *
 * 1. Sprite de ícones (Lucide)
 * ------------------------------------------------------------------ */

/** Nome do arquivo no lucide-static -> id usado no app. */
const ICONS = [
  "mic",
  "picture-in-picture-2",
  "headphones",
  "bluetooth",
  "mic-off",
  "video",
  "video-off",
  "screen-share",
  "screen-share-off",
  "phone",
  "phone-off",
  "message-square",
  "message-square-text",
  "users",
  "user",
  "user-plus",
  "settings",
  "maximize",
  "minimize",
  "maximize-2",
  "copy",
  "check",
  "check-check",
  "link",
  "sun",
  "moon",
  "monitor",
  "pencil",
  "eraser",
  "square",
  "circle",
  "type",
  "trash-2",
  "undo-2",
  "redo-2",
  "download",
  "x",
  "chevron-down",
  "chevron-right",
  "chevron-left",
  "pin",
  "pin-off",
  "signal",
  "signal-low",
  "signal-medium",
  "signal-high",
  "signal-zero",
  "wifi",
  "wifi-off",
  "activity",
  "hand",
  "volume-2",
  "volume-x",
  "camera",
  "image",
  "presentation",
  "layout-grid",
  "more-vertical",
  "refresh-cw",
  "alert-triangle",
  "loader-2",
  "shield",
  "shield-check",
  "lock",
  "palette",
  "highlighter",
  "move",
  "mouse-pointer-2",
  "minus",
  "plus",
  "send",
  "gauge",
  "cpu",
  "clock",
  "log-out",
  "smile",
  "sparkles",
  "rotate-ccw",
  "save",
  "laptop",
  "arrow-up-right",
  "arrow-right",
  "eye",
  "eye-off",
  "bell",
  "bell-off",
  "zap",
  "hard-drive",
  "radio",
  "dices",
  "shuffle",
  "info",
  "circle-help",
  "clipboard-check",
  "square-dashed-mouse-pointer",
  "spline",
  "slash",
  "brush",
  "grip-vertical",
  "panel-right-close",
  "panel-right-open",
  "scan",
  "crown",
  "flip-horizontal",
];

/** Aliases semânticos: id no app -> nome do arquivo Lucide. */
const ALIASES = {
  "network-0": "signal-zero",
  "network-1": "signal-low",
  "network-2": "signal-medium",
  "network-3": "signal-high",
  "network-4": "signal",
  spinner: "loader-2",
  mirror: "flip-horizontal",
  pointer: "mouse-pointer-2",
  arrow: "arrow-up-right",
  line: "slash",
  host: "crown",
};

async function buildSprite() {
  const symbols = [];
  const manifest = {};
  const seen = new Map();

  for (const name of ICONS) {
    const file = path.join(iconsDir, `${name}.svg`);
    if (!existsSync(file)) {
      console.warn(`  ! ícone ausente no lucide-static: ${name}`);
      continue;
    }
    const raw = await readFile(file, "utf8");
    const viewBox = (raw.match(/viewBox="([^"]+)"/) || [, "0 0 24 24"])[1];
    // Conteúdo interno do <svg>, sem a tag externa.
    const body = raw
      .replace(/<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    symbols.push(
      `<symbol id="i-${name}" viewBox="${viewBox}">${body}</symbol>`,
    );
    manifest[name] = viewBox;
    seen.set(name, true);
  }

  for (const [alias, target] of Object.entries(ALIASES)) {
    if (!seen.has(target)) {
      console.warn(`  ! alias ${alias} aponta para ícone ausente: ${target}`);
      continue;
    }
    symbols.push(`<use id="i-${alias}" href="#i-${target}"/>`);
    manifest[alias] = manifest[target];
  }

  const sprite =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- Lucide Icons (ISC License) — https://lucide.dev — subconjunto gerado por scripts/vendor.mjs -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">\n${symbols.join("\n")}\n</svg>\n`;

  await writeFile(path.join(outDir, "icons.svg"), sprite);
  await writeFile(
    path.join(outDir, "icons.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`  ✓ icons.svg  (${Object.keys(manifest).length} símbolos)`);
}

/* ------------------------------------------------------------------ *
 * 2. Bundle de avatares (DiceBear)
 * ------------------------------------------------------------------ */

/** Estilos oferecidos na escolha de avatar. Todos SVG, determinísticos por semente. */
const AVATAR_STYLES = [
  "notionistsNeutral",
  "loreleiNeutral",
  "adventurerNeutral",
  "botttsNeutral",
  "personas",
  "miniavs",
  "thumbs",
  "shapes",
  "identicon",
  "initials",
];

const AVATAR_ENTRY = `
// Gerado por scripts/vendor.mjs — não edite à mão.
// DiceBear (MIT) — https://dicebear.com
import { createAvatar } from "@dicebear/core";
import { ${AVATAR_STYLES.join(", ")} } from "@dicebear/collection";

export const styles = { ${AVATAR_STYLES.join(", ")} };
export const styleIds = ${JSON.stringify(AVATAR_STYLES)};
export { createAvatar };
`;

async function buildAvatars() {
  const entry = path.join(root, "scripts", ".avatars-entry.mjs");
  await writeFile(entry, AVATAR_ENTRY);
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    minify: true,
    target: ["es2022"],
    outfile: path.join(outDir, "avatars.js"),
    banner: {
      js: "/* DiceBear (MIT) — https://dicebear.com — bundle gerado por scripts/vendor.mjs */",
    },
    logLevel: "error",
  });
  if (result.errors.length) throw new Error("falha no bundle de avatares");
  const { size } = await import("node:fs").then((fs) =>
    fs.promises.stat(path.join(outDir, "avatars.js")),
  );
  console.log(`  ✓ avatars.js (${(size / 1024).toFixed(0)} kB, ${AVATAR_STYLES.length} estilos)`);
  await import("node:fs").then((fs) => fs.promises.unlink(entry));
}

/* ------------------------------------------------------------------ */

await mkdir(outDir, { recursive: true });
console.log("Vendorizando dependências de UI...");
await buildSprite();
await buildAvatars();
console.log("Pronto.");
