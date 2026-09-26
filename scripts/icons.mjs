#!/usr/bin/env node
/**
 * scripts/icons.mjs — gera os ícones do app a partir de brand/logo-original.png.
 *
 * Por que existe, em vez de recortar a arte na mão:
 *
 * 1. O RECORTE MANUAL DEIXAVA HALO. Os ícones anteriores eram um retângulo
 *    tirado da arte, e a arte tem fundo quase branco. Os cantos arredondados
 *    do ladrilho carregavam junto uma franja clara, visível em qualquer tela
 *    escura — era o "recorte bugado".
 *
 * 2. O FUNDO AGORA É DESENHADO, NÃO REAMOSTRADO. O quadrado arredondado é
 *    pintado no tamanho final, então a borda é nítida em 64 px e em 512 px, e
 *    o lado de fora é transparente de verdade (alfa 0), não branco.
 *
 * 3. A MARCA GANHA RESPIRO. Ela ocupa 58% do lado, centrada. Um ícone sem
 *    margem parece cortado quando o sistema operacional aplica a máscara dele
 *    por cima.
 *
 * Sem dependências: o PNG é lido e escrito aqui mesmo, com o zlib do Node.
 *
 *   node scripts/icons.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ==================================================================== *
 * PNG — leitura
 * ==================================================================== */

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decodifica um PNG RGB/RGBA de 8 bits, sem entrelaçamento. */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("não é um PNG");

  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // tamanho + tipo + dados + CRC

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8) throw new Error(`profundidade ${depth} não suportada`);
      if (color === 2) channels = 3;
      else if (color === 6) channels = 4;
      else throw new Error(`tipo de cor ${color} não suportado`);
      if (data[12] !== 0) throw new Error("PNG entrelaçado não suportado");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    raw.copy(line, 0, src, src + stride);
    src += stride;
    unfilter(filter, line, prev, channels);

    for (let px = 0; px < width; px += 1) {
      const s = px * channels;
      const d = (y * width + px) * 4;
      rgba[d] = line[s];
      rgba[d + 1] = line[s + 1];
      rgba[d + 2] = line[s + 2];
      rgba[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    line.copy(prev);
  }
  return { width, height, data: rgba };
}

/** Desfaz o filtro por linha do PNG, no lugar. */
function unfilter(type, line, prev, bpp) {
  const n = line.length;
  if (type === 0) return;
  for (let i = 0; i < n; i += 1) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let add = 0;
    if (type === 1) add = a;
    else if (type === 2) add = b;
    else if (type === 3) add = (a + b) >> 1;
    else if (type === 4) add = paeth(a, b, c);
    else throw new Error(`filtro ${type} desconhecido`);
    line[i] = (line[i] + add) & 0xff;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ==================================================================== *
 * PNG — escrita
 * ==================================================================== */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  // Filtro 0 em todas as linhas: o conteúdo é pequeno e o zlib no nível máximo
  // já deixa o arquivo menor que os anteriores.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ==================================================================== *
 * Composição
 * ==================================================================== */

const px = (img, x, y) => ((y * img.width + x) << 2);

/** Recorta uma região e torna transparente tudo que for fundo claro. */
function extractMark(src, box) {
  const out = { width: box.w, height: box.h, data: Buffer.alloc(box.w * box.h * 4) };
  for (let y = 0; y < box.h; y += 1) {
    for (let x = 0; x < box.w; x += 1) {
      const s = px(src, box.x + x, box.y + y);
      const d = px(out, x, y);
      const r = src.data[s];
      const g = src.data[s + 1];
      const b = src.data[s + 2];
      const max = Math.max(r, g, b);
      const sat = max - Math.min(r, g, b);

      out.data[d] = r;
      out.data[d + 1] = g;
      out.data[d + 2] = b;
      // O fundo da arte é quase branco e sem saturação; a marca é saturada.
      // A faixa intermediária vira alfa proporcional, senão a borda serrilha.
      if (sat < 28 && max > 200) out.data[d + 3] = 0;
      else if (sat < 60 && max > 205) out.data[d + 3] = Math.round(255 * (sat / 60));
      else out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

/** Reamostragem bilinear — nítida o bastante para os fatores usados aqui. */
function resize(src, w, h) {
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  const fx = src.width / w;
  const fy = src.height / h;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(src.height - 1, (y + 0.5) * fy - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(src.width - 1, (x + 0.5) * fx - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = sx - x0;
      const d = px(out, x, y);
      for (let ch = 0; ch < 4; ch += 1) {
        const a = src.data[px(src, x0, y0) + ch] * (1 - wx) + src.data[px(src, x1, y0) + ch] * wx;
        const b = src.data[px(src, x0, y1) + ch] * (1 - wx) + src.data[px(src, x1, y1) + ch] * wx;
        out.data[d + ch] = Math.round(a * (1 - wy) + b * wy);
      }
    }
  }
  return out;
}

/** Cobertura do pixel (x,y) por um retângulo de cantos arredondados, 0..1. */
function roundedCoverage(x, y, size, radius) {
  // Quatro amostras por pixel: suficiente para a borda não serrilhar e muito
  // mais barato do que uma máscara em resolução dobrada.
  let hits = 0;
  for (const oy of [0.25, 0.75]) {
    for (const ox of [0.25, 0.75]) {
      const cx = x + ox;
      const cy = y + oy;
      const dx = Math.max(radius - cx, cx - (size - radius), 0);
      const dy = Math.max(radius - cy, cy - (size - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) hits += 1;
    }
  }
  return hits / 4;
}

const BG = [0x12, 0x10, 0x3b]; // o azul-noite do ladrilho original

function compose(mark, size, { round = true } = {}) {
  const out = { width: size, height: size, data: Buffer.alloc(size * size * 4) };
  const radius = round ? size * 0.2237 : 0; // proporção de canto do iOS

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cov = round ? roundedCoverage(x, y, size, radius) : 1;
      const d = px(out, x, y);
      out.data[d] = BG[0];
      out.data[d + 1] = BG[1];
      out.data[d + 2] = BG[2];
      out.data[d + 3] = Math.round(255 * cov);
    }
  }

  // A marca ocupa 58% do lado. O resto é respiro: sem ele o ícone parece
  // cortado quando o sistema aplica a própria máscara por cima.
  const target = size * 0.58;
  const k = Math.min(target / mark.width, target / mark.height);
  const mw = Math.max(1, Math.round(mark.width * k));
  const mh = Math.max(1, Math.round(mark.height * k));
  const small = resize(mark, mw, mh);
  const ox = Math.round((size - mw) / 2);
  const oy = Math.round((size - mh) / 2);

  for (let y = 0; y < mh; y += 1) {
    for (let x = 0; x < mw; x += 1) {
      const s = px(small, x, y);
      const a = small.data[s + 3] / 255;
      if (a <= 0) continue;
      const d = px(out, ox + x, oy + y);
      for (let ch = 0; ch < 3; ch += 1) {
        out.data[d + ch] = Math.round(small.data[s + ch] * a + out.data[d + ch] * (1 - a));
      }
      out.data[d + 3] = Math.max(out.data[d + 3], Math.round(a * 255));
    }
  }
  return out;
}

/* ==================================================================== *
 * Execução
 * ==================================================================== */

/**
 * Um .ico do Windows, com vários tamanhos dentro.
 *
 * O formato é simples: um cabeçalho, um índice com uma entrada por imagem, e
 * as imagens em seguida. Desde o Windows Vista cada imagem pode ser um PNG
 * inteiro — não é preciso gerar o formato DIB antigo. Os tamanhos existem
 * porque o Windows escolhe um diferente em cada lugar: 16 na barra de título,
 * 32 na barra de tarefas, 256 na visualização grande do Explorador.
 */
function encodeIco(pngs) {
  const n = pngs.length;
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(n, 4);

  const indice = Buffer.alloc(16 * n);
  let offset = 6 + 16 * n;
  pngs.forEach(({ size, data }, i) => {
    const b = i * 16;
    // 256 não cabe num byte e é escrito como 0 — é assim que o formato manda.
    indice[b] = size >= 256 ? 0 : size;
    indice[b + 1] = size >= 256 ? 0 : size;
    indice[b + 2] = 0; // cores da paleta
    indice[b + 3] = 0; // reservado
    indice.writeUInt16LE(1, b + 4); // planos
    indice.writeUInt16LE(32, b + 6); // bits por pixel
    indice.writeUInt32LE(data.length, b + 8);
    indice.writeUInt32LE(offset, b + 12);
    offset += data.length;
  });

  return Buffer.concat([cabecalho, indice, ...pngs.map((p) => p.data)]);
}

/** Onde a marca "V" grande vive na arte original (medido, não chutado). */
const MARK_BOX = { x: 373, y: 284, w: 253, h: 239 };

const SAIDAS = [
  ["public/assets/icon-512.png", 512, true],
  ["public/assets/logo-mark.png", 512, true],
  ["public/assets/icon-192.png", 192, true],
  ["public/assets/icon-180.png", 180, true],
  ["public/assets/favicon-64.png", 64, true],
  ["dist/.icon-src/icon-1024.png", 1024, true],
];

async function main() {
  const src = decodePng(await readFile(path.join(root, "brand/logo-original.png")));
  const mark = extractMark(src, MARK_BOX);

  const paraIco = [];
  for (const [rel, size] of SAIDAS) {
    const png = encodePng(compose(mark, size));
    const abs = path.join(root, rel);
    await writeFile(abs, png).catch(async (err) => {
      if (err.code !== "ENOENT") throw err;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, png);
    });
    console.log(`  ✓ ${rel} (${size}px, ${(png.length / 1024).toFixed(0)} kB)`);
  }

  // O ícone do executável. Cantos quadrados aqui: o Windows aplica a própria
  // máscara e arredondar duas vezes deixa a borda serrilhada.
  for (const size of [16, 32, 48, 64, 128, 256]) {
    paraIco.push({ size, data: encodePng(compose(mark, size)) });
  }
  const ico = encodeIco(paraIco);
  const destinoIco = path.join(root, "dist-exe-icon", "vcall.ico");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(destinoIco), { recursive: true });
  await writeFile(destinoIco, ico);
  console.log(`  ✓ dist-exe-icon/vcall.ico (6 tamanhos, ${(ico.length / 1024).toFixed(0)} kB)`);
}

await main();
