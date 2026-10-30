/**
 * ui/avatar-paisagem.js — avatares de paisagem, desenhados aqui mesmo.
 *
 * Para quem prefere não aparecer como um rostinho: montanhas, lago, mar,
 * floresta, dunas, colinas, neve, noite, aurora e cidade, em camadas chapadas
 * com perspectiva de ar (o que está longe é mais claro e mais próximo da cor
 * do céu). Cada cena é um estilo próprio ("paisagemMar"...) e a semente decide
 * a hora do dia e o desenho do relevo, então "Sortear" troca a vista sem
 * trocar o lugar.
 *
 * Determinístico como os outros estilos: a mesma semente dá a mesma vista em
 * qualquer computador da sala, e só o par {style, seed} trafega. Quem estiver
 * numa versão antiga recebe o estilo padrão no lugar.
 */
import { sorteador } from "./avatar-vcall.js";

export const CENAS = ["montanha", "lago", "mar", "floresta", "dunas", "colinas", "neve", "noite", "aurora", "cidade"];

export const ROTULOS_CENA = {
  montanha: "Montanhas",
  lago: "Lago",
  mar: "Mar",
  floresta: "Floresta",
  dunas: "Dunas",
  colinas: "Colinas",
  neve: "Neve",
  noite: "Noite",
  aurora: "Aurora",
  cidade: "Cidade",
};

/** O id do estilo de cada cena: só letras, como o servidor aceita. */
export const estiloDaCena = (cena) => `paisagem${cena[0].toUpperCase()}${cena.slice(1)}`;
export const cenaDoEstilo = (estilo) => {
  const cena = String(estilo || "").replace(/^paisagem/, "").toLowerCase();
  return CENAS.includes(cena) ? cena : null;
};

/*
 * As horas do dia: o céu (do alto ao horizonte), o astro e as camadas do
 * relevo, da mais distante à mais próxima. Cores contidas: é um avatar de
 * reunião, não um pôster de viagem.
 */
const HORAS = {
  amanhecer: { ceu: ["#4a5784", "#f3b7a1"], astro: "#ffe6c7", camadas: ["#a99bb6", "#7d7499", "#565377", "#363756"] },
  dia: { ceu: ["#5b93c7", "#cfe3f0"], astro: "#fff7df", camadas: ["#a7bfd2", "#7d9db6", "#587a94", "#3b5a73"] },
  entardecer: { ceu: ["#3f335e", "#ee9d6c"], astro: "#ffd58f", camadas: ["#b5808a", "#85607c", "#5a4466", "#34294a"] },
  noite: { ceu: ["#0f1a33", "#2e4169"], astro: "#eef1f7", camadas: ["#3a4c72", "#2b3a5e", "#1e2b49", "#131d35"] },
};

/* ------------------------------------------------------------------ *
 * Desenho
 * ------------------------------------------------------------------ */

const n1 = (v) => Math.round(v * 10) / 10;

/** Mistura duas cores hex (t = 0 dá a primeira). */
function misturar(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Polígono fechado embaixo a partir de uma linha de pontos [x, y]. */
const silhueta = (pts, fundo = 132) =>
  `M-4 ${fundo}` + pts.map(([x, y]) => `L${n1(x)} ${n1(y)}`).join("") + `L132 ${fundo}Z`;

/** Serra: alguns picos de lados retos, com um tremor leve na crista. */
function serra(r, { base, altura, picos = 3, largura = [26, 58] }) {
  const ps = Array.from({ length: picos }, () => ({
    c: -12 + r() * 152,
    h: altura * (0.5 + 0.5 * r()),
    w: largura[0] + r() * (largura[1] - largura[0]),
  }));
  const pts = [];
  for (let x = -4; x <= 132; x += 3) {
    let y = 0;
    for (const p of ps) y = Math.max(y, p.h * (1 - Math.abs(x - p.c) / p.w));
    pts.push([x, base - Math.max(0, y) + (r() - 0.5) * 1.4]);
  }
  return { pts, ps };
}

/** Colinas: duas ondas somadas, macias. */
function onda(r, { base, amp, freq = 1 }) {
  const f1 = (0.035 + r() * 0.03) * freq;
  const f2 = (0.08 + r() * 0.05) * freq;
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const pts = [];
  for (let x = -4; x <= 132; x += 2) {
    pts.push([x, base - amp * (0.65 * Math.sin(x * f1 + p1) + 0.35 * Math.sin(x * f2 + p2))]);
  }
  return pts;
}

function astro(r, cor, { x, y, raio }, id) {
  return (
    `<radialGradient id="${id}"><stop offset="0" stop-color="${cor}" stop-opacity=".55"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></radialGradient>` +
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(raio * 2.6)}" fill="url(#${id})"/>` +
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(raio)}" fill="${cor}"/>`
  );
}

function estrelas(r, quantas, ate = 70) {
  let s = "";
  for (let i = 0; i < quantas; i += 1) {
    s += `<circle cx="${n1(r() * 128)}" cy="${n1(4 + r() * ate)}" r="${n1(0.45 + r() * 0.75)}" fill="#ffffff" opacity="${n1(0.35 + r() * 0.6)}"/>`;
  }
  return s;
}

function lua(r, cor) {
  const x = 30 + r() * 68;
  const y = 22 + r() * 16;
  return (
    `<mask id="crescente"><rect width="128" height="128" fill="#fff"/><circle cx="${n1(x + 5)}" cy="${n1(y - 3)}" r="9" fill="#000"/></mask>` +
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="22" fill="${cor}" opacity=".08"/>` +
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="10" fill="${cor}" mask="url(#crescente)"/>`
  );
}

/** Pinheiro: dois triângulos empilhados, a silhueta que se lê de longe. */
function pinheiro(x, chao, h, cor) {
  const w = h * 0.42;
  return (
    `<path d="M${n1(x)} ${n1(chao - h)}L${n1(x + w * 0.62)} ${n1(chao - h * 0.42)}L${n1(x - w * 0.62)} ${n1(chao - h * 0.42)}Z` +
    `M${n1(x)} ${n1(chao - h * 0.72)}L${n1(x + w)} ${n1(chao)}L${n1(x - w)} ${n1(chao)}Z" fill="${cor}"/>`
  );
}

/** Sombra do lado direito de cada pico, recortada pela própria serra. */
function sombraDosPicos(ps, base, cor, id, d) {
  const tri = ps
    .map((p) => `M${n1(p.c)} ${n1(base - p.h)}L${n1(p.c + p.w)} ${n1(base)}L${n1(p.c + p.w * 0.18)} ${n1(base)}Z`)
    .join("");
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${tri}" fill="${cor}" opacity=".32" clip-path="url(#${id})"/>`;
}

/* ------------------------------------------------------------------ *
 * As cenas
 * ------------------------------------------------------------------ */

const CENA = {
  montanha(r, h) {
    const [c0, c1, c2, c3] = h.camadas;
    const longe = serra(r, { base: 84, altura: 46, picos: 3 });
    const meio = serra(r, { base: 98, altura: 38, picos: 3 });
    const d1 = silhueta(longe.pts);
    const d2 = silhueta(meio.pts);
    return (
      astro(r, h.astro, { x: 24 + r() * 80, y: 30 + r() * 14, raio: 8 }, "brilho") +
      `<path d="${d1}" fill="${c0}"/>` +
      sombraDosPicos(longe.ps, 84, c2, "recorte1", d1) +
      `<path d="${d2}" fill="${c1}"/>` +
      sombraDosPicos(meio.ps, 98, c3, "recorte2", d2) +
      `<path d="${silhueta(onda(r, { base: 112, amp: 5 }))}" fill="${c2}"/>` +
      `<path d="${silhueta(onda(r, { base: 122, amp: 4 }))}" fill="${c3}"/>`
    );
  },

  lago(r, h) {
    const [c0, c1, , c3] = h.camadas;
    const horizonte = 80;
    const longe = serra(r, { base: horizonte, altura: 40, picos: 3 });
    const perto = serra(r, { base: horizonte, altura: 24, picos: 2, largura: [30, 50] });
    const relevo = `<path d="${silhueta(longe.pts, horizonte)}" fill="${c0}"/><path d="${silhueta(perto.pts, horizonte)}" fill="${c1}"/>`;
    const agua = misturar(h.ceu[1], c3, 0.45);
    let brilhos = "";
    for (let i = 0; i < 7; i += 1) {
      const y = horizonte + 8 + i * 6;
      const w = 10 + r() * 26;
      brilhos += `<rect x="${n1(10 + r() * (100 - w))}" y="${y}" width="${n1(w)}" height="1.2" rx=".6" fill="#ffffff" opacity="${n1(0.12 + r() * 0.16)}"/>`;
    }
    return (
      astro(r, h.astro, { x: 30 + r() * 68, y: 32 + r() * 12, raio: 7 }, "brilho") +
      relevo +
      `<linearGradient id="agua" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${misturar(agua, h.ceu[1], 0.35)}"/><stop offset="1" stop-color="${misturar(agua, c3, 0.5)}"/></linearGradient>` +
      `<rect y="${horizonte}" width="128" height="${128 - horizonte}" fill="url(#agua)"/>` +
      `<g opacity=".28" transform="translate(0 ${horizonte * 2}) scale(1 -1)">${relevo}</g>` +
      brilhos
    );
  },

  mar(r, h) {
    const horizonte = 74 + r() * 8;
    const sx = 34 + r() * 60;
    const fundoMar = misturar(h.camadas[3], h.ceu[0], 0.3);
    let reflexo = "";
    for (let i = 0; i < 8; i += 1) {
      const w = 22 - i * 2.2 + r() * 4;
      reflexo += `<rect x="${n1(sx - w / 2 + (r() - 0.5) * 3)}" y="${n1(horizonte + 4 + i * 5)}" width="${n1(w)}" height="1.6" rx=".8" fill="${h.astro}" opacity="${n1(0.55 - i * 0.05)}"/>`;
    }
    const ilha = r() < 0.55
      ? `<path d="${silhueta(serra(r, { base: horizonte, altura: 9, picos: 2, largura: [14, 24] }).pts, horizonte)}" fill="${misturar(h.camadas[1], h.ceu[1], 0.3)}"/>`
      : "";
    return (
      astro(r, h.astro, { x: sx, y: horizonte - 10 - r() * 18, raio: 9 }, "brilho") +
      ilha +
      `<linearGradient id="agua" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${misturar(h.ceu[1], fundoMar, 0.55)}"/><stop offset="1" stop-color="${fundoMar}"/></linearGradient>` +
      `<rect y="${n1(horizonte)}" width="128" height="${n1(128 - horizonte)}" fill="url(#agua)"/>` +
      reflexo
    );
  },

  floresta(r, h) {
    const verde = ["#5f7a6a", "#3f5c4c", "#2a4436", "#1b2f25"].map((v, i) => misturar(v, h.camadas[i], 0.35));
    let fileira1 = "";
    let fileira2 = "";
    for (let x = -6; x < 136; x += 9 + r() * 5) fileira1 += pinheiro(x, 104, 24 + r() * 16, verde[1]);
    for (let x = -4; x < 136; x += 12 + r() * 6) fileira2 += pinheiro(x, 126, 34 + r() * 18, verde[3]);
    return (
      astro(r, h.astro, { x: 28 + r() * 72, y: 30 + r() * 12, raio: 8 }, "brilho") +
      `<path d="${silhueta(serra(r, { base: 92, altura: 32, picos: 3 }).pts)}" fill="${h.camadas[0]}"/>` +
      fileira1 +
      `<rect y="102" width="128" height="26" fill="${verde[2]}"/>` +
      fileira2
    );
  },

  dunas(r, h) {
    const areia = ["#e9c99b", "#d9aa77", "#c08a5a", "#9c6a43"].map((v) => misturar(v, h.camadas[1], 0.18));
    const camada = (base, amp, cor, crista) => {
      const pts = onda(r, { base, amp, freq: 0.7 });
      return (
        `<path d="${silhueta(pts)}" fill="${cor}"/>` +
        `<path d="M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join("L")}" fill="none" stroke="${crista}" stroke-width="1.2" opacity=".5"/>`
      );
    };
    return (
      astro(r, h.astro, { x: 30 + r() * 68, y: 34 + r() * 12, raio: 12 }, "brilho") +
      camada(86, 7, areia[0], "#fff3dc") +
      camada(100, 8, areia[1], "#f6dcb6") +
      camada(114, 7, areia[2], "#e8c194") +
      camada(124, 4, areia[3], "#d2a374")
    );
  },

  colinas(r, h) {
    const verde = ["#b8c99a", "#8fae76", "#6a9259", "#4b7343"].map((v, i) => misturar(v, h.camadas[i], 0.25));
    const arvore = r() < 0.7;
    const ax = 28 + r() * 72;
    return (
      astro(r, h.astro, { x: 26 + r() * 76, y: 30 + r() * 12, raio: 8 }, "brilho") +
      `<path d="${silhueta(onda(r, { base: 82, amp: 8 }))}" fill="${verde[0]}"/>` +
      `<path d="${silhueta(onda(r, { base: 96, amp: 9 }))}" fill="${verde[1]}"/>` +
      (arvore ? `<rect x="${n1(ax - 0.9)}" y="94" width="1.8" height="9" fill="${verde[3]}"/><circle cx="${n1(ax)}" cy="92" r="5.5" fill="${verde[3]}"/>` : "") +
      `<path d="${silhueta(onda(r, { base: 108, amp: 8 }))}" fill="${verde[2]}"/>` +
      `<path d="${silhueta(onda(r, { base: 121, amp: 6 }))}" fill="${verde[3]}"/>`
    );
  },

  neve(r, h) {
    const rocha = [misturar("#9aa9bd", h.camadas[0], 0.3), misturar("#6f7f96", h.camadas[1], 0.3)];
    const longe = serra(r, { base: 92, altura: 54, picos: 3 });
    const perto = serra(r, { base: 104, altura: 40, picos: 2, largura: [32, 56] });
    const d1 = silhueta(longe.pts);
    const d2 = silhueta(perto.pts);
    // A neve é a própria serra recortada acima de uma linha em zigue-zague.
    const zigue = (y) => {
      let p = `M-4 0H132V${n1(y)}`;
      for (let x = 132; x >= -4; x -= 6) p += `L${n1(x)} ${n1(y + (x % 12 === 0 ? 4 : -2) + (r() - 0.5) * 2)}`;
      return p + "Z";
    };
    return (
      astro(r, h.astro, { x: 24 + r() * 80, y: 26 + r() * 10, raio: 7 }, "brilho") +
      `<path d="${d1}" fill="${rocha[0]}"/>` +
      `<clipPath id="neve1"><path d="${zigue(62)}"/></clipPath><path d="${d1}" fill="#f4f7fb" clip-path="url(#neve1)"/>` +
      sombraDosPicos(longe.ps, 92, "#3b4b63", "recorte1", d1) +
      `<path d="${d2}" fill="${rocha[1]}"/>` +
      `<clipPath id="neve2"><path d="${zigue(80)}"/></clipPath><path d="${d2}" fill="#e8eef6" clip-path="url(#neve2)"/>` +
      sombraDosPicos(perto.ps, 104, "#2c3a50", "recorte2", d2) +
      `<path d="${silhueta(onda(r, { base: 116, amp: 4 }))}" fill="#eef3f9"/>` +
      `<path d="${silhueta(onda(r, { base: 124, amp: 3 }))}" fill="#dfe7f1"/>`
    );
  },

  noite(r, h) {
    const [c0, c1, c2, c3] = h.camadas;
    let pinheiros = "";
    for (let x = -4; x < 136; x += 10 + r() * 8) if (r() < 0.6) pinheiros += pinheiro(x, 112, 16 + r() * 12, c3);
    return (
      estrelas(r, 34) +
      lua(r, h.astro) +
      `<path d="${silhueta(onda(r, { base: 88, amp: 9 }))}" fill="${c0}"/>` +
      `<path d="${silhueta(onda(r, { base: 102, amp: 8 }))}" fill="${c1}"/>` +
      `<path d="${silhueta(onda(r, { base: 114, amp: 5 }))}" fill="${c2}"/>` +
      pinheiros +
      `<rect y="112" width="128" height="16" fill="${c3}"/>`
    );
  },

  aurora(r, h) {
    const [, c1, , c3] = h.camadas;
    const fita = (y, amp, cor, id) => {
      const p = r() * 6.28;
      let topo = "";
      let base = "";
      for (let x = -8; x <= 136; x += 8) {
        const yy = y + amp * Math.sin(x * 0.05 + p);
        topo += `${x === -8 ? "M" : "L"}${x} ${n1(yy - 16)}`;
        base = `L${x} ${n1(yy + 6)}` + base;
      }
      return (
        `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity="0"/><stop offset=".7" stop-color="${cor}" stop-opacity=".55"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient>` +
        `<path d="${topo}${base}Z" fill="url(#${id})" filter="url(#veu)"/>`
      );
    };
    return (
      `<filter id="veu" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>` +
      estrelas(r, 26, 60) +
      fita(38 + r() * 8, 8, "#6ff0c0", "fita1") +
      fita(52 + r() * 8, 6, "#5ccfe6", "fita2") +
      `<path d="${silhueta(serra(r, { base: 98, altura: 34, picos: 3 }).pts)}" fill="${c1}"/>` +
      `<path d="${silhueta(onda(r, { base: 114, amp: 5 }))}" fill="${c3}"/>` +
      `<rect y="114" width="128" height="14" fill="${c3}"/>`
    );
  },

  cidade(r, h) {
    const noite = h === HORAS.noite || h === HORAS.entardecer;
    const predios = (chao, alt, cor, janelas) => {
      let s = "";
      for (let x = -2; x < 130; ) {
        const w = 9 + r() * 10;
        const a = alt * (0.45 + r() * 0.55);
        s += `<rect x="${n1(x)}" y="${n1(chao - a)}" width="${n1(w)}" height="${n1(a + 2)}" fill="${cor}"/>`;
        if (janelas) {
          for (let jy = chao - a + 4; jy < chao - 3; jy += 5) {
            for (let jx = x + 2; jx < x + w - 2.5; jx += 3.5) {
              if (r() < (noite ? 0.42 : 0.18)) s += `<rect x="${n1(jx)}" y="${n1(jy)}" width="1.6" height="2" fill="${noite ? "#ffd98a" : "#e7eef6"}" opacity="${noite ? 0.9 : 0.5}"/>`;
            }
          }
        }
        x += w + 1 + r() * 2;
      }
      return s;
    };
    return (
      (noite ? estrelas(r, 14, 40) : "") +
      astro(r, h.astro, { x: 22 + r() * 84, y: 28 + r() * 12, raio: 7 }, "brilho") +
      predios(98, 52, h.camadas[1], false) +
      predios(116, 58, h.camadas[3], true) +
      `<rect y="114" width="128" height="14" fill="${misturar(h.camadas[3], "#000000", 0.25)}"/>`
    );
  },
};

/** Que horas do dia cada cena aceita. */
const HORAS_DA_CENA = {
  montanha: ["amanhecer", "dia", "entardecer"],
  lago: ["amanhecer", "dia", "entardecer", "noite"],
  mar: ["amanhecer", "dia", "entardecer"],
  floresta: ["amanhecer", "dia", "entardecer"],
  dunas: ["amanhecer", "dia", "entardecer"],
  colinas: ["amanhecer", "dia"],
  neve: ["amanhecer", "dia"],
  noite: ["noite"],
  aurora: ["noite"],
  cidade: ["dia", "entardecer", "noite"],
};

/** Markup SVG (128 x 128, redondo) da paisagem desta cena e semente. */
export function avatarPaisagem(cena, semente) {
  const r = sorteador(`${cena}|${semente || "vcall"}`);
  const opcoes = HORAS_DA_CENA[cena] || HORAS_DA_CENA.montanha;
  const hora = HORAS[opcoes[Math.floor(r() * opcoes.length)]];
  const corpo = (CENA[cena] || CENA.montanha)(r, hora);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">` +
    `<clipPath id="moldura"><circle cx="64" cy="64" r="64"/></clipPath>` +
    `<linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hora.ceu[0]}"/><stop offset="1" stop-color="${hora.ceu[1]}"/></linearGradient>` +
    `<g clip-path="url(#moldura)"><rect width="128" height="128" fill="url(#ceu)"/>${corpo}</g></svg>`
  );
}
