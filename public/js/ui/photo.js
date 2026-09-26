/**
 * ui/photo.js — foto de perfil enviada pelo usuário.
 *
 * A foto trafega pela sinalização como data URL, então o tamanho importa de
 * verdade: uma imagem de celular tem vários megabytes e travaria a sala. Aqui
 * ela é recortada em quadrado pelo centro, reduzida a 256×256 e comprimida até
 * caber no orçamento — reduzindo a qualidade em degraus, e só então o formato.
 *
 * WebP é tentado primeiro (bem menor para o mesmo resultado) com queda para
 * JPEG nos navegadores que não codificam WebP.
 */

const SIZE = 256;
const BUDGET = 48 * 1024; // bytes de imagem, antes do base64
const QUALITIES = [0.82, 0.7, 0.6, 0.5, 0.4];

export const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic";

function blobSupported(type) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.toDataURL(type).startsWith(`data:${type}`);
}

const canWebp = blobSupported("image/webp");

async function decode(file) {
  // createImageBitmap respeita a orientação EXIF, o que evita foto deitada.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* alguns formatos exóticos falham aqui; tenta pelo <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("formato de imagem não suportado"));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toDataUrl(canvas, type, quality) {
  return canvas.toDataURL(type, quality);
}

/** Bytes reais representados por uma data URL em base64. */
function byteSize(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{photo: string, bytes: number, type: string}>}
 */
export async function preparePhoto(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem.");
  }
  // 25 MB é foto de câmera profissional; acima disso é engano ou ataque.
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("Imagem grande demais. Use uma foto de até 25 MB.");
  }

  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error("Não foi possível ler a imagem.");

  // Recorte quadrado pelo centro — é o que a máscara redonda vai mostrar.
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  img.close?.();

  const types = canWebp ? ["image/webp", "image/jpeg"] : ["image/jpeg"];
  let best = null;

  for (const type of types) {
    for (const q of QUALITIES) {
      const url = toDataUrl(canvas, type, q);
      const bytes = byteSize(url);
      if (!best || bytes < best.bytes) best = { photo: url, bytes, type };
      if (bytes <= BUDGET) return { photo: url, bytes, type };
    }
  }

  // Nem na menor qualidade coube: reduz a resolução e tenta de novo.
  const small = document.createElement("canvas");
  small.width = small.height = 160;
  small.getContext("2d").drawImage(canvas, 0, 0, 160, 160);
  const url = toDataUrl(small, types[0], 0.6);
  const bytes = byteSize(url);
  if (bytes <= BUDGET * 1.5) return { photo: url, bytes, type: types[0] };

  return best;
}
