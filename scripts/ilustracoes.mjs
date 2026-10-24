// scripts/ilustracoes.mjs — as cenas com gente que aparecem nas telas do app.
//
//   node scripts/ilustracoes.mjs [nome...]   →   public/assets/illustrations/<nome>.svg
//
// Traço chapado, sem contorno: cada material tem um tom e uma sombra, e o
// volume vem dessas duas camadas. Pele, roupa e objetos têm cor fixa (a mesma
// pessoa nos dois temas); só o que é "da casa" (móveis, janelas do app, chão)
// usa as variáveis do tema, com o valor do Ametista escuro de reserva.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DESTINO = fileURLToPath(new URL("../public/assets/illustrations/", import.meta.url));

// -- paleta -----------------------------------------------------------------

const TINTA = "#1d0a1f";
const ROSA = "#fd4d87";
const LARANJA = "#fe9c5f";
const BRANCO = "#ffffff";
const VERMELHO = "#ff4d6a";

const PELE = {
  clara: ["#f8d3bb", "#eab092"],
  media: ["#e6ad86", "#cf8f66"],
  morena: ["#c58658", "#a96c43"],
  parda: ["#a66b42", "#8a542f"],
  escura: ["#7b4a2c", "#62391f"],
  retinta: ["#5b3521", "#462816"],
};
const CABELO = {
  preto: ["#2b1730", "#4a2f50"],
  castanho: ["#5a3421", "#7c4c32"],
  ruivo: ["#b9552b", "#dc7a45"],
  loiro: ["#e6b65d", "#f6d58f"],
  rosa: ["#f0437f", "#ff86ae"],
  grisalho: ["#b9b4c9", "#dcd8e8"],
};
const ROUPA = {
  rosa: ["#fd4d87", "#e2346f"],
  laranja: ["#fe9c5f", "#ec7d3e"],
  lilas: ["#8b80d6", "#7266c2"],
  tinta: ["#2f2766", "#221c50"],
  creme: ["#fff4e8", "#f1dcc8"],
  amarelo: ["#ffcf6e", "#f2b64b"],
  menta: ["#45c9a9", "#2fae8e"],
  jeans: ["#4b5ea6", "#3b4c8e"],
  grafite: ["#3a3550", "#2c283f"],
};
const FOLHA = ["#3fbf94", "#2a9e78", "#6ad9b1"];

// Da casa: acompanham o tema.
const PAINEL = "var(--surface, #201b45)";
const PAINEL_2 = "var(--surface-2, #28244e)";
const MOVEL = "var(--surface-3, #33305b)";
const BORDA = "var(--border-strong, #494774)";
const APAGADO = "var(--text-muted, #a0a0bf)";
const MARCA_SUAVE = "var(--accent-soft, #fd4d8729)";

// -- utilidades -------------------------------------------------------------

const n = (v) => +v.toFixed(2);
const P = (p) => p.map(([x, y]) => `${n(x)} ${n(y)}`).join("L");
const grupo = (x, y, s, conteudo, extra = "") =>
  `<g transform="translate(${n(x)} ${n(y)})${extra}${s !== 1 ? ` scale(${s})` : ""}">${conteudo}</g>`;
const traco = (p, cor, w, op = "") =>
  `<path d="M${P(p)}" fill="none" stroke="${cor}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
/** Ponto a `d` unidades antes de `b`, no segmento a→b. */
function recua([ax, ay], [bx, by], d) {
  const L = Math.hypot(bx - ax, by - ay) || 1;
  return [bx - ((bx - ax) / L) * d, by - ((by - ay) / L) * d];
}
const meio = ([ax, ay], [bx, by], t = 0.5) => [ax + (bx - ax) * t, ay + (by - ay) * t];

// -- gente ------------------------------------------------------------------
//
// A cabeça é desenhada num quadro próprio: rosto de 17 × 19 com o centro em
// (0, 0), pescoço descendo até y = 26 (onde começam os ombros).

function cabelos(estilo, [c, brilho]) {
  const f = `fill="${c}"`;
  const luz = (d) => `<path d="${d}" fill="none" stroke="${brilho}" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`;
  const tampa = `<path ${f} d="M-18.6 4C-20.4-12.6-11.4-22.8 0-22.8 11.4-22.8 20.6-12.8 18.6 4 17.6-3 15.6-7.4 12.6-9.8 7.4-6.6-2.6-7-9.6-10.6-12.6-7.6-15.8-3.4-18.6 4Z"/>`;
  const risca = `<path ${f} d="M-18.6 7C-21.2-13.6-9-23.4 0-23.2 9-23.4 21.2-13.6 18.6 7 17-4 10.6-12.4 1.2-16.4-.8-12-11-5.4-18.6 7Z"/>`;
  const longoAtras = (fim) => `<path ${f} d="M-21.6-3C-22.6-19-11.4-25.8 0-25.8 11.4-25.8 22.6-19 21.6-3L23.4 ${fim - 6}Q23.4 ${fim} 17.4 ${fim}H-17.4Q-23.4 ${fim} -23.4 ${fim - 6}Z"/>`;
  return {
    curto: { frente: tampa + luz("M-7.6-17.6Q-1-21.4 6.4-19.6") },
    topete: {
      frente: `<path ${f} d="M-18.4 2C-20-14-12-23.4-1-24.6 6-27.6 15-25.6 18.4-19 21-13 20.6-5 18.6 2 17.4-4 15.6-8 12.6-10.4 6-9.6-3-10-9.4-12.2-12.6-8.4-15.8-4-18.4 2Z"/>` + luz("M-3-21.6Q4-25 11-22.2"),
    },
    coque: {
      atras: `<circle cx="1" cy="-25.6" r="9" ${f}/>`,
      frente: `<path ${f} d="M-18.2 3C-19.8-13-11.2-22.2 0-22.2 11.2-22.2 19.8-13 18.2 3 16.2-6.6 9.4-12 0-12.4-9.4-12-16.2-6.6-18.2 3Z"/><rect x="-5.6" y="-19.6" width="12" height="3.4" rx="1.7" fill="${brilho}" opacity=".7"/>` + luz("M-9-16Q-2-19.6 6-18.6"),
    },
    rabo: {
      atras: `<path ${f} d="M9-19.4C24-21 31-6 27 14 25.6 21 19.6 21 20 15.4 21.2 4 18.8-6.6 8.6-11Z"/>`,
      frente: `<path ${f} d="M-18.2 3C-19.8-13-11.2-22.2 0-22.2 11.2-22.2 19.8-13 18.2 3 16.2-6.6 9.4-12 0-12.4-9.4-12-16.2-6.6-18.2 3Z"/><circle cx="16.6" cy="-13.6" r="3.2" fill="${ROSA}"/>` + luz("M-9-16Q-2-19.6 6-18.6"),
    },
    longo: { atras: longoAtras(44), frente: risca + luz("M-11.6-15.6Q-6.6-20.2-1.6-20.6") },
    chanel: {
      atras: longoAtras(20),
      frente: `<path ${f} d="M-18.4 2C-19.8-14.6-10.4-23.2 0-23.2 10.4-23.2 19.8-14.6 18.4 2 15-6 11-9.6 6-11.2 1-8.6-10-8.4-13-10.6-15.6-6.6-17.4-3-18.4 2Z"/>` + luz("M-8.6-17.2Q-2-21 5.6-19.6"),
    },
    cacheado: {
      atras: [[-19, -3, 8], [19, -3, 8], [-16.4, -13.6, 9], [16.4, -13.6, 9], [-7.4, -21.4, 9.6], [7.4, -21.4, 9.6], [0, -23.6, 9], [-21, 8, 7], [21, 8, 7], [-19.6, 17, 6], [19.6, 17, 6]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${f}/>`).join(""),
      frente: [[-12, -13.4, 6.4], [-4.4, -16.6, 6.4], [3.8, -16.8, 6.4], [11.4, -13.6, 6], [16, -7, 4.6], [-16.2, -7, 4.6]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${f}/>`).join("")
        + `<g fill="none" stroke="${brilho}" stroke-width="1.8" stroke-linecap="round" opacity=".75"><path d="M-14-15.6a5 5 0 0 1 4-2.2"/><path d="M-6.4-19.2a5 5 0 0 1 4-2"/><path d="M2-19.4a5 5 0 0 1 4-1.8"/></g>`,
    },
    black: {
      atras: `<circle cx="0" cy="-8" r="29" ${f}/><g fill="${brilho}" opacity=".35"><circle cx="-16" cy="-24" r="2"/><circle cx="-6" cy="-31" r="2"/><circle cx="8" cy="-30" r="2"/><circle cx="19" cy="-22" r="2"/><circle cx="-23" cy="-10" r="2"/><circle cx="24" cy="-8" r="2"/></g>`,
      frente: `<path ${f} d="M-17.4-1C-17.6-14-9.6-19.8 0-19.8 9.6-19.8 17.6-14 17.4-1 14.6-9 8.6-12.4 0-12.4-8.6-12.4-14.6-9-17.4-1Z"/>`,
    },
    trancas: {
      atras: longoAtras(48) + `<g stroke="${brilho}" stroke-width="1.4" opacity=".45" fill="none"><path d="M-20 0V42M-15 4V44M15 4V44M20 0V42"/></g>`,
      frente: risca + `<g stroke="${brilho}" stroke-width="1.4" opacity=".55" fill="none" stroke-linecap="round"><path d="M-15-8Q-9-14-2-15.4"/><path d="M14-8Q9-13 4-15"/></g>`,
    },
    raspado: { frente: `<path fill="${c}" opacity=".55" d="M-17.8 0C-18.8-13-10.6-20.8 0-20.8 10.6-20.8 18.8-13 17.8 0 16.6-6 12-9.6 0-10.4-12-9.6-16.6-6-17.8 0Z"/>` },
    careca: { frente: luz("M-8-15.6Q-2-18.4 5-17.2").replace('opacity=".8"', 'opacity=".5"') },
  }[estilo];
}

function feicoes(rosto, o, cabelo, [tom, sombra], v = 0) {
  const olho = (x) => `<ellipse cx="${x}" cy="2.4" rx="1.9" ry="2.5" fill="${TINTA}"/><circle cx="${x + 0.6}" cy="1.5" r=".7" fill="${BRANCO}"/>`;
  const fechado = (x) => `<path d="M${x - 2.4} 3Q${x} .2 ${x + 2.4} 3" fill="none" stroke="${TINTA}" stroke-width="1.7" stroke-linecap="round"/>`;
  const sobr = (x, lado, sobe = 0) => `<path d="M${x - 2.6 * lado} ${-3.6 - sobe * (lado > 0 ? 1 : 0)}Q${x} ${-6 - sobe} ${x + 2.6 * lado} ${-4.4}" fill="none" stroke="${cabelo}" stroke-width="1.6" stroke-linecap="round"/>`;
  const olhos = {
    feliz: fechado(-6.4 + o) + fechado(6.4 + o),
    piscando: olho(-6.4 + o) + fechado(6.4 + o),
  }[rosto] || olho(-6.4 + o) + olho(6.4 + o);
  const triste = rosto === "triste";
  const sobrancelhas = triste
    ? `<path d="M${-9 + o} -4.4L${-4 + o} -5.8M${4 + o} -5.8L${9 + o} -4.4" stroke="${cabelo}" stroke-width="1.6" stroke-linecap="round"/>`
    : sobr(-6.4 + o, -1, rosto === "pensando" ? 1.6 : 0) + sobr(6.4 + o, 1, rosto === "pensando" ? 1.8 : rosto === "surpreso" ? 1 : 0);
  const nariz = `<path d="M${o - 0.2} 4.8q2.4 2.6-.6 4.2" fill="none" stroke="${sombra}" stroke-width="1.6" stroke-linecap="round"/>`;
  const bochechas = `<g fill="${ROSA}" opacity=".26"><ellipse cx="${-10.6 + o}" cy="8.2" rx="3.4" ry="2.4"/><ellipse cx="${10.6 + o}" cy="8.2" rx="3.4" ry="2.4"/></g>`;
  const boca = {
    sorriso: `<path d="M${o - 4.2} 11q4.2 4 8.4 0" fill="none" stroke="${TINTA}" stroke-width="1.8" stroke-linecap="round"/>`,
    aberto: `<path d="M${o - 5} 10.6h10q-.6 6.6-5 6.6t-5-6.6Z" fill="${TINTA}"/><path d="M${o - 3.4} 15.2q3.4-2.6 6.8 0q-3.4 2.4-6.8 0Z" fill="#ff7a98"/><rect x="${o - 4}" y="10.6" width="8" height="1.9" rx=".9" fill="${BRANCO}"/>`,
    feliz: `<path d="M${o - 5} 10.6h10q-.6 6.6-5 6.6t-5-6.6Z" fill="${TINTA}"/><path d="M${o - 3.4} 15.2q3.4-2.6 6.8 0q-3.4 2.4-6.8 0Z" fill="#ff7a98"/><rect x="${o - 4}" y="10.6" width="8" height="1.9" rx=".9" fill="${BRANCO}"/>`,
    piscando: `<path d="M${o - 4.6} 10.6q4.6 4.6 9.2 0" fill="none" stroke="${TINTA}" stroke-width="1.8" stroke-linecap="round"/>`,
    pensando: `<path d="M${o - 2.4} 12.4q3.2-1.4 6.2.4" fill="none" stroke="${TINTA}" stroke-width="1.8" stroke-linecap="round"/>`,
    triste: `<path d="M${o - 3.6} 13.4q3.6-3.4 7.2 0" fill="none" stroke="${TINTA}" stroke-width="1.8" stroke-linecap="round"/>`,
    surpreso: `<ellipse cx="${o + 0.4}" cy="12.6" rx="2.2" ry="2.8" fill="${TINTA}"/>`,
    neutro: `<path d="M${o - 3} 12h6" stroke="${TINTA}" stroke-width="1.8" stroke-linecap="round"/>`,
  }[rosto];
  return bochechas + (v ? `<g transform="translate(0 ${v})">${olhos + sobrancelhas}</g>` : olhos + sobrancelhas) + nariz + boca;
}

/**
 * Uma cabeça em (x, y). Devolve as camadas separadas, porque o cabelo
 * comprido fica atrás dos ombros e o pescoço entra por baixo da gola.
 */
function cabeca(o) {
  const {
    x, y, s = 1, inclina = 0, pele = PELE.clara, cabelo = "curto", corCabelo = CABELO.preto,
    rosto = "sorriso", olhar = 0, olharV = 0, oculos = false, brincos = false, fone = false, barba = false, costas = false,
  } = o;
  const [tom, sombra] = pele;
  const cab = cabelos(cabelo, corCabelo);
  const giro = inclina ? ` rotate(${inclina})` : "";
  const orelhas = !["longo", "chanel", "trancas"].includes(cabelo);
  const atras = cab.atras ? grupo(x, y, s, cab.atras, giro) : "";
  const pescoco = grupo(x, y, s, `<path d="M-6.4 10h12.8v15.4a6.4 6.4 0 0 1-12.8 0Z" fill="${sombra}"/>`);
  if (costas) {
    // De costas: só a nuca, as orelhas e o cabelo cobrindo a cabeça.
    const [c, luz] = corCabelo;
    const longo = !orelhas;
    let nuca = orelhas ? `<circle cx="-16.6" cy="2.4" r="4.2" fill="${tom}"/><circle cx="16.6" cy="2.4" r="4.2" fill="${tom}"/>` : "";
    nuca += `<ellipse rx="17" ry="19" fill="${tom}"/>`;
    nuca += longo
      ? `<path fill="${c}" d="M-21.6-3C-22.6-19-11.4-25.8 0-25.8 11.4-25.8 22.6-19 21.6-3L23.4 38Q23.4 44 17.4 44H-17.4Q-23.4 44-23.4 38Z"/>`
      : `<path fill="${c}" d="M-18.8 8C-21-14-10.6-23.6 0-23.6S21-14 18.8 8C17.6 15 10.6 19.6 0 19.6S-17.6 15-18.8 8Z"/>`;
    // Mechas subindo da nuca para o alto da cabeça.
    nuca += `<g fill="none" stroke="${luz}" stroke-width="1.8" stroke-linecap="round" opacity=".7"><path d="M-8 16Q-12 0-4-17"/><path d="M8 16Q12 0 4-17"/><path d="M0 18V-14"/></g>`;
    return { atras, pescoco, frente: grupo(x, y, s, nuca, giro) };
  }
  let frente = "";
  if (orelhas) frente += `<circle cx="-16.6" cy="2.4" r="4.2" fill="${tom}"/><circle cx="16.6" cy="2.4" r="4.2" fill="${tom}"/><path d="M-17.6.6q1.8 1.8 0 3.6M17.6.6q-1.8 1.8 0 3.6" fill="none" stroke="${sombra}" stroke-width="1.3" stroke-linecap="round"/>`;
  frente += `<ellipse rx="17" ry="19" fill="${tom}"/>`;
  if (barba) frente += `<path d="M-16.8 2C-17.4 18-8.6 24.6 0 24.6S17.4 18 16.8 2C15 9.6 10.6 13.4 6.4 13.6 3.4 11 -3.4 11-6.4 13.6-10.6 13.4-15 9.6-16.8 2Z" fill="${corCabelo[0]}"/>`;
  frente += feicoes(rosto, olhar, corCabelo[0], pele, olharV);
  if (barba) frente = frente.replace(/stroke="#1d0a1f" stroke-width="1.8"/g, `stroke="#f6c9c0" stroke-width="1.8"`);
  frente += cab.frente;
  if (brincos && orelhas) frente += `<circle cx="-16.8" cy="8.8" r="1.9" fill="${LARANJA}"/><circle cx="16.8" cy="8.8" r="1.9" fill="${LARANJA}"/>`;
  if (oculos) frente += `<g fill="${BRANCO}" fill-opacity=".18" stroke="${TINTA}" stroke-width="1.6"><circle cx="${-6.4 + olhar}" cy="2.4" r="5.4"/><circle cx="${6.4 + olhar}" cy="2.4" r="5.4"/></g><path d="M${-1 + olhar} 1.6h2M${-11.8 + olhar} 1.4l-4.4-1.4M${11.8 + olhar} 1.4l4.4-1.4" stroke="${TINTA}" stroke-width="1.6" stroke-linecap="round"/>`;
  if (fone) frente += `<path d="M-19.6 2C-19.6-31 19.6-31 19.6 2" fill="none" stroke="${ROUPA.tinta[0]}" stroke-width="3.6"/><rect x="-23.4" y="-5" width="8.4" height="14.4" rx="4.2" fill="${ROUPA.tinta[0]}"/><rect x="15" y="-5" width="8.4" height="14.4" rx="4.2" fill="${ROUPA.tinta[0]}"/><rect x="-22" y="-2.6" width="3" height="9" rx="1.5" fill="${ROSA}"/>`;
  return { atras, pescoco, frente: grupo(x, y, s, frente, giro) };
}

/** Tronco de ombros redondos; `y` é a linha dos ombros. */
function tronco(x, y, { L = 50, C = 42, A = 60, roupa = ROUPA.rosa, gola = "redonda", pele = PELE.clara, s = 1 }) {
  const [cor, sombra] = roupa;
  const r = 13 * s;
  const l = (L * s) / 2, c = (C * s) / 2, a = A * s;
  let out = `<path d="M${n(x - l)} ${n(y + r)}Q${n(x - l)} ${n(y)} ${n(x - l + r)} ${n(y)}H${n(x + l - r)}Q${n(x + l)} ${n(y)} ${n(x + l)} ${n(y + r)}L${n(x + c)} ${n(y + a)}H${n(x - c)}Z" fill="${cor}"/>`;
  out += `<path d="M${n(x + l - 9 * s)} ${n(y + 3 * s)}Q${n(x + l)} ${n(y + 2 * s)} ${n(x + l)} ${n(y + r)}L${n(x + c)} ${n(y + a)}H${n(x + c - 9 * s)}Z" fill="${sombra}" opacity=".8"/>`;
  if (gola === "redonda") out += `<path d="M${n(x - 8 * s)} ${n(y - 0.4)}Q${n(x)} ${n(y + 9 * s)} ${n(x + 8 * s)} ${n(y - 0.4)}" fill="${pele[1]}" stroke="${sombra}" stroke-width="${n(2.6 * s)}" stroke-linecap="round"/>`;
  if (gola === "v") out += `<path d="M${n(x - 8 * s)} ${n(y - 0.4)}L${n(x)} ${n(y + 13 * s)}L${n(x + 8 * s)} ${n(y - 0.4)}Z" fill="${pele[1]}"/><path d="M${n(x - 8 * s)} ${n(y)}L${n(x)} ${n(y + 13 * s)}L${n(x + 8 * s)} ${n(y)}" fill="none" stroke="${sombra}" stroke-width="${n(2.4 * s)}" stroke-linejoin="round"/>`;
  if (gola === "capuz") {
    out += `<path d="M${n(x - 17 * s)} ${n(y + 1)}Q${n(x)} ${n(y - 9 * s)} ${n(x + 17 * s)} ${n(y + 1)}Q${n(x + 9 * s)} ${n(y + 13 * s)} ${n(x)} ${n(y + 13 * s)}Q${n(x - 9 * s)} ${n(y + 13 * s)} ${n(x - 17 * s)} ${n(y + 1)}Z" fill="${sombra}"/>`;
    out += `<path d="M${n(x - 4 * s)} ${n(y + 11 * s)}v${n(13 * s)}M${n(x + 4 * s)} ${n(y + 11 * s)}v${n(10 * s)}" stroke="${BRANCO}" stroke-width="${n(1.6 * s)}" stroke-linecap="round" opacity=".85"/>`;
  }
  if (gola === "camisa") out += `<path d="M${n(x - 9 * s)} ${n(y - 1)}L${n(x)} ${n(y + 8 * s)}L${n(x + 9 * s)} ${n(y - 1)}L${n(x + 3 * s)} ${n(y + 12 * s)}H${n(x - 3 * s)}Z" fill="${BRANCO}"/><path d="M${n(x)} ${n(y + 8 * s)}V${n(y + a)}" stroke="${sombra}" stroke-width="${n(1.4 * s)}"/>`;
  return out;
}

const MAO = {
  punho: (tom, w) => `<circle r="${n(w * 0.6)}" fill="${tom}"/>`,
  aceno: (tom, w) => {
    const k = w / 12;
    const dedo = (x, a, h) => `<rect x="${n((x - 1.5) * k)}" y="${n(-h * k)}" width="${n(3.1 * k)}" height="${n(h * k)}" rx="${n(1.55 * k)}" transform="rotate(${a} ${n(x * k)} ${n(-3 * k)})" fill="${tom}"/>`;
    return `${dedo(-4.2, -16, 11)}${dedo(-1.4, -5, 12.6)}${dedo(1.5, 5, 12.2)}${dedo(4.2, 15, 10.4)}<rect x="${n(-11 * k)}" y="${n(-2 * k)}" width="${n(9 * k)}" height="${n(3.2 * k)}" rx="${n(1.6 * k)}" transform="rotate(-38 ${n(-4 * k)} 0)" fill="${tom}"/><rect x="${n(-6 * k)}" y="${n(-5.6 * k)}" width="${n(12 * k)}" height="${n(11 * k)}" rx="${n(5 * k)}" fill="${tom}"/>`;
  },
  segura: (tom, w, sombra) => `<circle r="${n(w * 0.58)}" fill="${tom}"/><path d="M${n(-w * 0.34)} ${n(-w * 0.3)}q${n(w * 0.36)} ${n(-w * 0.32)} ${n(w * 0.66)} 0" fill="none" stroke="${sombra}" stroke-width="${n(w * 0.16)}" stroke-linecap="round"/>`,
};

/** Braço de três pontos (ombro, cotovelo, mão), com manga comprida ou curta. */
function braco(p, { roupa = ROUPA.rosa, pele = PELE.clara, w = 12, curta = false, mao = "punho", ang = 0 }) {
  const [tom, sombra] = pele;
  const fim = p[p.length - 1];
  let out;
  if (curta) out = traco(p, tom, w) + traco([p[0], meio(p[0], p[1], 0.7)], roupa[0], w + 1.4);
  else {
    const pulso = recua(p[p.length - 2], fim, w * 0.8);
    out = traco([...p.slice(0, -1), pulso], roupa[0], w) + traco([pulso, fim], tom, w * 0.72);
  }
  return out + `<g transform="translate(${n(fim[0])} ${n(fim[1])}) rotate(${ang})">${MAO[mao](tom, w, sombra)}</g>`;
}

const perna = (p, roupa = ROUPA.jeans, w = 15) => traco(p, roupa[0], w) + traco([meio(p[0], p[1], 0.15), meio(p[0], p[1], 0.85)], roupa[1], w * 0.28, ` opacity=".7" transform="translate(${n(w * 0.22)} 0)"`);

/** Tênis visto de lado (`dir` 1 aponta para a direita) ou de frente. */
function tenis(x, y, { dir = 1, frente = false, cor = BRANCO, detalhe = ROSA, s = 1 } = {}) {
  if (frente)
    return grupo(x, y, s, `<path d="M-9.4 0Q-9.4-9 0-9T9.4 0Z" fill="${cor}"/><rect x="-10.4" y="-2.6" width="20.8" height="4.4" rx="2.2" fill="#ddd8f2"/><path d="M-4-6.4h8" stroke="${detalhe}" stroke-width="1.8" stroke-linecap="round"/>`);
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${dir * s} ${s})"><path d="M-2-1.4Q-2-11 3-11.4H10Q13.4-8 18.4-7 24-6 24-1.8V0H-2Z" fill="${cor}"/><path d="M-2.4-2.6H24.4V.4Q24.4 1.8 23 1.8H-1Q-2.4 1.8-2.4.4Z" fill="#ddd8f2"/><path d="M5-5.2Q11.6-5 16-8.2" fill="none" stroke="${detalhe}" stroke-width="1.8" stroke-linecap="round"/></g>`;
}

// -- coisas -----------------------------------------------------------------

/** O V do Vcall (duas pessoas), centrado em (x, y), com `t` de largura. */
function marca(x, y, t) {
  const k = t / 298;
  return `<g transform="translate(${n(x - t / 2)} ${n(y - (282 * k) / 2)}) scale(${n(k)}) translate(-107 -114)"><path fill="${ROSA}" d="M126.6 269.9L212.8 377.3A47.5 47.5 0 0 0 286.8 317.9L200.6 210.5A47.5 47.5 0 0 0 126.6 269.9Z"/><path fill="${LARANJA}" d="M311.4 210.5L225.2 317.9A47.5 47.5 0 0 0 299.2 377.3L385.4 269.9A47.5 47.5 0 0 0 311.4 210.5Z"/><circle cx="146.4" cy="154" r="39.3" fill="${ROSA}"/><circle cx="365.6" cy="154" r="39.3" fill="${LARANJA}"/></g>`;
}

const coracao = (x, y, s = 1, cor = ROSA) =>
  grupo(x, y, s, `<path d="M0 6.4C-8.4.4-9.6-5.8-4.8-7.6-2.2-8.6-.6-6.8 0-5.2.6-6.8 2.2-8.6 4.8-7.6 9.6-5.8 8.4.4 0 6.4Z" fill="${cor}"/>`);
const brilho = (x, y, s = 1, cor = LARANJA) =>
  grupo(x, y, s, `<path d="M0-7Q.9-.9 7 0Q.9.9 0 7Q-.9.9-7 0Q-.9-.9 0-7Z" fill="${cor}"/>`);

/** Vaso com folhas de costela-de-adão; `y` é a base do vaso. */
function planta(x, y, s = 1, vaso = ROUPA.rosa) {
  const folha = (a, L, cor) => `<g transform="rotate(${a})"><path d="M0 0C-${L * 0.34}-${L * 0.3}-${L * 0.3}-${L * 0.86} 0-${L}C${L * 0.3}-${L * 0.86} ${L * 0.34}-${L * 0.3} 0 0Z" fill="${cor}"/><path d="M0-2V-${L * 0.86}" stroke="${FOLHA[1]}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/></g>`;
  return grupo(x, y, s, `<g transform="translate(0 -30)">${folha(-44, 40, FOLHA[0])}${folha(38, 44, FOLHA[0])}${folha(-14, 52, FOLHA[2])}${folha(14, 36, FOLHA[1])}${folha(-70, 28, FOLHA[1])}${folha(66, 30, FOLHA[2])}</g><path d="M-15-32H15L11.6-2Q11.2 0 9 0H-9Q-11.2 0-11.6-2Z" fill="${vaso[0]}"/><path d="M4-32H15L11.6-2Q11.2 0 9 0H3Z" fill="${vaso[1]}" opacity=".8"/><rect x="-17" y="-36" width="34" height="7" rx="3.5" fill="${vaso[0]}"/>`);
}

/** Caneca com vapor; `y` é a base. */
const caneca = (x, y, s = 1, cor = ROUPA.laranja) =>
  grupo(x, y, s, `<path d="M6-11.6a5.4 5.4 0 1 1 0 7.6" fill="none" stroke="${cor[1]}" stroke-width="2.6"/><rect x="-8" y="-15" width="15" height="15" rx="3.4" fill="${cor[0]}"/><rect x="2" y="-15" width="5" height="15" rx="2" fill="${cor[1]}" opacity=".6"/><path d="M-3-19.4q-2.4-2.6 0-5.2t0-5.2M2.6-19.4q-2.4-2.6 0-5.2" fill="none" stroke="${APAGADO}" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>`);

const sombraChao = (x, y, rx, ry = 6) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#000" fill-opacity=".14"/>`;

/** Gato cinza dormindo enrolado; `y` é o chão. */
function gato(x, y, s = 1) {
  const [c, e] = ["#b9b0d8", "#968cc0"];
  return grupo(x, y, s, `<ellipse cx="2" cy="0" rx="30" ry="4" fill="#000" fill-opacity=".12"/><ellipse cx="4" cy="-12" rx="26" ry="13" fill="${c}"/><path d="M-2-24q6 10 0 22M8-25q6 11 0 23M18-22q5 9 0 19" fill="none" stroke="${e}" stroke-width="2.6" stroke-linecap="round"/><path d="M28-6Q30 4 10 3-10 2-20 0" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M-6 2.6Q-14 2.6-20 0" fill="none" stroke="${e}" stroke-width="7" stroke-linecap="round"/><path d="M-30-17-29-29-21-22ZM-15-23-8-29-7-17Z" fill="${c}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/><path d="M-28-19.6-27.6-25.4-24-22ZM-12.6-22-9.4-25-9-20Z" fill="#ffb3c9"/><circle cx="-18" cy="-12" r="11.4" fill="${c}"/><path d="M-25.6-12.6q2.2 2 4.4 0M-16-12.6q2.2 2 4.4 0" fill="none" stroke="${TINTA}" stroke-width="1.5" stroke-linecap="round"/><path d="M-20.2-8.6h2.6l-1.3 1.6Z" fill="#ff8fb0"/><path d="M-29-8.4l-6-1M-29-6.6l-6 1M-8-8.4l6-1M-8-6.6l6 1" stroke="${e}" stroke-width="1" stroke-linecap="round"/><g fill="none" stroke="${APAGADO}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".7"><path d="M-6-38h6l-6 6h6"/><path d="M4-48h4.4l-4.4 4.4h4.4"/></g>`);
}

/** Relógio de parede. */
const relogio = (x, y, r = 18) =>
  grupo(x, y, 1, `<circle r="${r}" fill="${PAINEL}" stroke="${BORDA}" stroke-width="3"/>${[0, 90, 180, 270].map((a) => `<path d="M0 ${-r + 4}v3" stroke="${APAGADO}" stroke-width="2" stroke-linecap="round" transform="rotate(${a})"/>`).join("")}<path d="M0 0V${-r * 0.55}M0 0L${r * 0.42} ${r * 0.18}" stroke="${APAGADO}" stroke-width="2.4" stroke-linecap="round"/><path d="M0 0L${-r * 0.3} ${r * 0.56}" stroke="${ROSA}" stroke-width="1.4" stroke-linecap="round"/><circle r="2.2" fill="${ROSA}"/>`);

/** Mesa: tampo de x1 a x2 na altura y, pernas até o chão. */
const mesa = (x1, x2, y, chao) =>
  `<rect x="${x1 + 14}" y="${y + 6}" width="7" height="${chao - y - 6}" rx="2" fill="${BORDA}"/><rect x="${x2 - 21}" y="${y + 6}" width="7" height="${chao - y - 6}" rx="2" fill="${BORDA}"/><rect x="${x1}" y="${y}" width="${x2 - x1}" height="9" rx="4.5" fill="${BORDA}"/><rect x="${x1}" y="${y}" width="${x2 - x1}" height="5" rx="2.5" fill="${MOVEL}"/>`;

/** Notebook visto por trás: a tampa com o V, apoiada em y. */
const notebook = (x, y, w = 72, h = 48) =>
  `<rect x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}" rx="7" fill="#f2effc"/><rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="8" rx="3.5" fill="#dcd6f3"/>${marca(x, y - h / 2 - 3, w * 0.24)}<rect x="${x - w / 2 - 7}" y="${y - 1}" width="${w + 14}" height="6" rx="3" fill="#cfc8ee"/>`;

/** Janela do Vcall flutuando (cartão com borda). */
const janela = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${PAINEL}"/><rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="13.25" stroke="${BORDA}" stroke-width="1.5"/>`;

const aviao = (x, y, s = 1, a = -20) =>
  grupo(x, y, s, `<path d="M-12 2 14-9 4 11 0 4Z" fill="${ROSA}"/><path d="M0 4 14-9-4 6Z" fill="#e2346f"/><path d="M-12 2 14-9 0 4Z" fill="#ff86ae"/>`, ` rotate(${a})`);

const cadeado = (x, y, cor = BRANCO) =>
  grupo(x, y, 1, `<path d="M-5-3v-4a5 5 0 0 1 10 0v4" fill="none" stroke="${cor}" stroke-width="2.4"/><rect x="-8" y="-3" width="16" height="12" rx="3" fill="${cor}"/><circle cy="2.6" r="1.8" fill="${ROSA}"/>`);

const interrogacao = (x, y, s = 1, cor = ROSA) =>
  grupo(x, y, s, `<path d="M-5-7a5.4 5.4 0 1 1 7.4 5C.6-1 0 0 0 2.6" fill="none" stroke="${cor}" stroke-width="3" stroke-linecap="round"/><circle cy="8" r="1.9" fill="${cor}"/>`);

/** Ampulheta; `y` é a base. */
const ampulheta = (x, y) =>
  grupo(x, y, 1, `<path d="M-8-30H8Q8-22 1.4-17 8-12 8-4H-8Q-8-12-1.4-17-8-22-8-30Z" fill="${PAINEL}" stroke="${BORDA}" stroke-width="1.6"/><path d="M-5-26H5Q4-21 0-18.4-4-21-5-26Z" fill="${LARANJA}"/><path d="M-6.4-4Q0-11 6.4-4Z" fill="${LARANJA}"/><path d="M0-17V-7" stroke="${LARANJA}" stroke-width="1.2" stroke-dasharray="1.5 2"/><rect x="-11" y="-4" width="22" height="4" rx="2" fill="${BORDA}"/><rect x="-11" y="-34" width="22" height="4" rx="2" fill="${BORDA}"/>`);

/** Caracol de casca rosa (a conexão lenta); `y` é o chão. */
const caracol = (x, y, s = 1) =>
  grupo(x, y, s, `<path d="M-34-10h-7M-31-3h-9" stroke="${APAGADO}" stroke-width="2" stroke-linecap="round" opacity=".6"/><path d="M-20 0Q-22-6-14-7H8Q13-7 15-13 16-20 20-21 25-22 25.4-16 25.4-10 21-4 17 0Z" fill="#ffd2a8"/><path d="M-20 0Q-21-3.4-17-3.6H15Q18-3.4 17 0Z" fill="#f2b583"/><path d="M19.6-20 17.6-29M23.6-20l3-8.4" stroke="#f2b583" stroke-width="1.8" stroke-linecap="round"/><circle cx="17.4" cy="-30.4" r="2.3" fill="${TINTA}"/><circle cx="26.8" cy="-29.4" r="2.3" fill="${TINTA}"/><path d="M19-14q2.4 1.6 4.6 0" fill="none" stroke="${TINTA}" stroke-width="1.4" stroke-linecap="round"/><circle cx="-3" cy="-17" r="13.4" fill="${ROSA}"/><path d="M-1-17a2.6 2.6 0 1 0-2.6 2.6 5.4 5.4 0 1 0 5.4-5.4 8.4 8.4 0 0 0-8.4 8.4" fill="none" stroke="#ffb3c9" stroke-width="2.2" stroke-linecap="round"/><path d="M5-27a12 12 0 0 1 4 5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".5"/>`);

const celular = (x, y, w = 15, h = 26) =>
  `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3.4" fill="${ROUPA.tinta[0]}"/><rect x="${x - w / 2 + 2}" y="${y - h / 2 + 2.4}" width="${w - 4}" height="${h - 5.6}" rx="1.8" fill="#a99ff0"/>`;

// -- cenas ------------------------------------------------------------------

const cenas = {};

/** Tela inicial: ela chama do pufe, ele atende na janela do Vcall. */
cenas.inicio = () => {
  const id = "vc-cena-inicio";
  const ela = { pele: PELE.clara, roupa: ROUPA.lilas };
  const ele = { pele: PELE.parda, roupa: ROUPA.laranja };
  // A janela da chamada
  let s = `<rect x="138" y="34" width="238" height="216" rx="20" fill="${PAINEL}"/><rect x="138.75" y="34.75" width="236.5" height="214.5" rx="19.25" fill="none" stroke="${BORDA}" stroke-width="1.5"/>`;
  s += `<circle cx="160" cy="54" r="4" fill="${ROSA}"/><circle cx="173" cy="54" r="4" fill="${LARANJA}"/><circle cx="186" cy="54" r="4" fill="${APAGADO}" opacity=".5"/><rect x="204" y="49" width="74" height="10" rx="5" fill="${MOVEL}"/>`;
  s += `<rect x="316" y="46" width="46" height="16" rx="8" fill="${ROSA}" fill-opacity=".16"/><circle cx="326" cy="54" r="3.2" fill="${ROSA}"/><rect x="333" y="52.4" width="21" height="3.2" rx="1.6" fill="${ROSA}" opacity=".7"/>`;
  // O quadro dele
  s += `<defs><clipPath id="${id}-tela"><rect x="150" y="70" width="214" height="130" rx="14"/></clipPath><linearGradient id="${id}-fundo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9d9"/><stop offset="1" stop-color="#ffd2e1"/></linearGradient><clipPath id="${id}-eu"><rect x="300" y="146" width="56" height="44" rx="9"/></clipPath></defs>`;
  s += `<g clip-path="url(#${id}-tela)"><rect x="150" y="70" width="214" height="130" fill="url(#${id}-fundo)"/>`;
  s += `<rect x="170" y="86" width="30" height="24" rx="4" fill="${BRANCO}"/><path d="M174 106l7-9 5 6 3-3 7 6Z" fill="#ffb3c9"/><circle cx="192" cy="93" r="2.6" fill="${LARANJA}"/>`;
  s += `<rect x="318" y="118" width="40" height="4" rx="2" fill="#f2b9cb"/>` + planta(338, 118, 0.42, ROUPA.laranja);
  const h = cabeca({ x: 252, y: 122, s: 1.32, pele: ele.pele, cabelo: "cacheado", corCabelo: CABELO.preto, rosto: "aberto", olhar: 1.2, oculos: true });
  s += h.atras + h.pescoco + tronco(252, 156, { L: 64, C: 70, A: 60, roupa: ele.roupa, gola: "capuz", pele: ele.pele });
  s += braco([[280, 166], [306, 176], [312, 134]], { ...ele, w: 15, mao: "aceno", ang: 8 }) + h.frente + `</g>`;
  // Eu, no cantinho
  s += `<rect x="298.5" y="144.5" width="59" height="47" rx="10.5" fill="${PAINEL}"/>`;
  s += `<g clip-path="url(#${id}-eu)"><rect x="300" y="146" width="56" height="44" fill="#e9e4ff"/>`;
  const mini = cabeca({ x: 328, y: 166, s: 0.62, pele: ela.pele, cabelo: "longo", corCabelo: CABELO.castanho, rosto: "feliz" });
  s += mini.atras + mini.pescoco + tronco(328, 182, { L: 50, C: 50, A: 30, roupa: ela.roupa, pele: ela.pele, s: 0.62 }) + mini.frente + `</g>`;
  // Controles
  s += `<g><circle cx="210" cy="225" r="11" fill="${MOVEL}"/><rect x="207" y="218" width="6" height="10" rx="3" fill="${APAGADO}"/><path d="M204.4 225a5.6 5.6 0 0 0 11.2 0M210 230.6v2.6" fill="none" stroke="${APAGADO}" stroke-width="1.6" stroke-linecap="round"/>`;
  s += `<circle cx="237" cy="225" r="11" fill="${MOVEL}"/><rect x="230.4" y="220.4" width="9.4" height="9.2" rx="2.2" fill="${APAGADO}"/><path d="M240.6 223.6l3.4-2v7l-3.4-2Z" fill="${APAGADO}"/>`;
  s += `<rect x="254" y="214" width="38" height="22" rx="11" fill="${VERMELHO}"/><path d="M264 227.4q9-6.4 18 0l-1.6 2.2-4-1.4v-2.6q-3.4-1.2-6.8 0v2.6l-4 1.4Z" fill="${BRANCO}"/>`;
  s += `<circle cx="309" cy="225" r="11" fill="${ROSA}" fill-opacity=".2"/>${coracao(309, 225.6, 0.72)}</g>`;
  // Chão, pufe e ela
  s += `<ellipse cx="196" cy="371" rx="176" ry="15" fill="${MARCA_SUAVE}"/>` + sombraChao(108, 360, 70, 6);
  s += `<path d="M44 304Q42 350 108 354Q174 350 172 304Z" fill="${LARANJA}"/><path d="M140 312Q160 312 172 304Q174 344 132 352Q152 334 140 312Z" fill="#ec7d3e" opacity=".7"/><ellipse cx="108" cy="304" rx="64" ry="15" fill="#ffb789"/><path d="M50 326q58 18 116 0" fill="none" stroke="#ec7d3e" stroke-width="1.6" stroke-dasharray="3 4" stroke-linecap="round"/>`;
  s += perna([[94, 304], [90, 330], [88, 362]], ROUPA.jeans, 17) + perna([[122, 304], [126, 330], [128, 362]], ROUPA.jeans, 17);
  s += tenis(88, 368, { frente: true }) + tenis(128, 368, { frente: true });
  const c = cabeca({ x: 106, y: 204, s: 1.24, pele: ela.pele, cabelo: "longo", corCabelo: CABELO.castanho, rosto: "feliz", brincos: true });
  s += c.atras + c.pescoco + tronco(106, 236, { L: 60, C: 50, A: 62, roupa: ela.roupa, pele: ela.pele });
  s += braco([[130, 246], [142, 280], [128, 300]], { ...ela, w: 13 });
  s += c.frente;
  // O notebook no colo, com o V na tampa
  s += `<rect x="62" y="258" width="88" height="58" rx="8" fill="#f2effc"/><rect x="62" y="306" width="88" height="10" rx="4" fill="#dcd6f3"/>${marca(106, 282, 20)}<rect x="54" y="314" width="104" height="7" rx="3.5" fill="#cfc8ee"/>`;
  s += braco([[82, 246], [54, 252], [50, 212]], { ...ela, w: 13, mao: "aceno", ang: -14 });
  // Planta e enfeites
  s += gato(248, 368, 1.05) + planta(346, 368, 1.05, ROUPA.rosa) + sombraChao(346, 370, 26, 4);
  s += coracao(156, 150, 1.1) + coracao(172, 120, 0.7, LARANJA) + brilho(40, 168, 0.9) + brilho(372, 286, 0.7, ROSA);
  return { w: 400, h: 400, titulo: "Vcall: chamando de um computador para o outro", corpo: s };
};

/** Lista vazia: alguém procurando de lupa. Fica num quadrinho pastel fixo. */
cenas["lista-vazia"] = () => {
  const p = { pele: PELE.parda, roupa: ROUPA.lilas };
  const c = cabeca({ x: 56, y: 60, s: 1.5, pele: p.pele, cabelo: "chanel", corCabelo: CABELO.preto, rosto: "surpreso", olhar: 1.4 });
  let s = c.atras + c.pescoco + tronco(56, 99, { L: 50, C: 56, A: 40, roupa: p.roupa, pele: p.pele, s: 1.5 }) + c.frente;
  s += `<path d="M76.4 72.4 92 98" stroke="${ROUPA.tinta[0]}" stroke-width="6" stroke-linecap="round"/>`;
  s += braco([[86, 110], [104, 126], [92, 98]], { ...p, w: 14 });
  s += `<circle cx="67.7" cy="63.6" r="12.4" fill="${BRANCO}" fill-opacity=".4"/><ellipse cx="68" cy="64.4" rx="4.2" ry="5.4" fill="${TINTA}"/><circle cx="69.6" cy="62.4" r="1.5" fill="${BRANCO}"/><circle cx="67.7" cy="63.6" r="12.4" stroke="${ROUPA.tinta[0]}" stroke-width="4"/><path d="M60.6 56.4a9 9 0 0 1 5-2.6" stroke="${BRANCO}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
  s += interrogacao(104, 26, 0.9);
  return { w: 120, h: 140, titulo: "Vcall: nenhuma call por aqui", corpo: s };
};

/** Sozinho na sala: ele espera de caneca na mão; o outro lugar está vazio. */
cenas["sala-vazia"] = () => {
  const id = "vc-cena-sala-vazia";
  const ele = { pele: PELE.morena, roupa: ROUPA.menta };
  let s = `<circle cx="196" cy="150" r="128" fill="${MARCA_SUAVE}"/>` + relogio(60, 70, 18);
  s += janela(214, 30, 152, 108);
  s += `<defs><clipPath id="${id}-q"><rect x="224" y="42" width="62" height="62" rx="9"/></clipPath></defs><g clip-path="url(#${id}-q)"><rect x="224" y="42" width="62" height="62" fill="#dff5ee"/>`;
  const mini = cabeca({ x: 255, y: 70, s: 0.66, pele: ele.pele, cabelo: "topete", corCabelo: CABELO.castanho, rosto: "sorriso" });
  s += mini.atras + mini.pescoco + tronco(255, 87, { L: 52, C: 56, A: 30, roupa: ele.roupa, pele: ele.pele, s: 0.66 }) + mini.frente + `</g>`;
  s += `<rect x="295" y="43" width="60" height="60" rx="9" stroke="${APAGADO}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/><path d="M325 65v16M317 73h16" stroke="${APAGADO}" stroke-width="2.6" stroke-linecap="round"/>`;
  s += `<rect x="246" y="114" width="88" height="14" rx="7" fill="${ROSA}"/><g fill="none" stroke="${BRANCO}" stroke-width="1.8" stroke-linecap="round"><rect x="253" y="118" width="8" height="6" rx="3"/><rect x="259" y="118" width="8" height="6" rx="3"/></g><rect x="274" y="119.6" width="50" height="2.8" rx="1.4" fill="${BRANCO}" opacity=".85"/>`;
  s += `<path d="M338 112C360 106 372 90 368 72" stroke="${ROSA}" stroke-width="1.8" stroke-dasharray="2 5" stroke-linecap="round" opacity=".75"/>` + aviao(370, 58, 1, -30);
  s += sombraChao(196, 266, 150, 6);
  s += `<rect x="94" y="128" width="72" height="80" rx="20" fill="${MOVEL}" stroke="${BORDA}" stroke-width="2"/>`;
  const c = cabeca({ x: 130, y: 112, s: 1.16, pele: ele.pele, cabelo: "topete", corCabelo: CABELO.castanho, rosto: "sorriso", olhar: 2.2, olharV: -1.2 });
  s += c.atras + c.pescoco + tronco(130, 142, { L: 54, C: 48, A: 62, roupa: ele.roupa, pele: ele.pele });
  s += braco([[154, 152], [166, 184], [180, 198]], { ...ele, curta: true, w: 12 });
  s += c.frente + mesa(56, 330, 200, 264) + notebook(208, 200, 74, 50) + caneca(108, 200, 1, ROUPA.laranja);
  s += braco([[106, 152], [90, 188], [100, 191]], { ...ele, curta: true, w: 12, mao: "segura" });
  s += planta(362, 264, 0.9, ROUPA.laranja);
  return { w: 400, h: 300, titulo: "Vcall: só você na sala, esperando alguém entrar", corpo: s };
};

/** Sala de espera: ela aguarda no banco, ao lado da porta trancada. */
cenas["sala-de-espera"] = () => {
  const ela = { pele: PELE.escura, roupa: ROUPA.amarelo };
  let s = `<circle cx="190" cy="150" r="128" fill="${MARCA_SUAVE}"/>` + relogio(62, 66, 17) + sombraChao(190, 266, 150, 6);
  s += `<rect x="240" y="46" width="96" height="222" rx="8" fill="${BORDA}"/><rect x="248" y="54" width="80" height="214" rx="4" fill="${MOVEL}"/>`;
  s += `<rect x="258" y="122" width="60" height="58" rx="6" stroke="${BORDA}" stroke-width="2"/><rect x="258" y="190" width="60" height="64" rx="6" stroke="${BORDA}" stroke-width="2"/>`;
  s += `<rect x="262" y="72" width="52" height="34" rx="9" fill="${ROSA}"/>` + cadeado(288, 90);
  s += `<circle cx="316" cy="160" r="5.4" fill="${LARANJA}"/><rect x="304" y="157.4" width="14" height="5.2" rx="2.6" fill="${LARANJA}"/>`;
  s += `<path d="M193 26h28a13 13 0 0 1 0 26h-4l6 8-14-8h-16a13 13 0 0 1 0-26Z" fill="${PAINEL}" stroke="${BORDA}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="195" cy="39" r="3.4" fill="${ROSA}"/><circle cx="207" cy="39" r="3.4" fill="${APAGADO}" opacity=".7"/><circle cx="219" cy="39" r="3.4" fill="${APAGADO}" opacity=".4"/>`;
  s += `<rect x="58" y="212" width="7" height="54" rx="2" fill="${BORDA}"/><rect x="194" y="212" width="7" height="54" rx="2" fill="${BORDA}"/><rect x="42" y="202" width="176" height="14" rx="7" fill="${LARANJA}"/><rect x="42" y="210" width="176" height="6" rx="3" fill="#ec7d3e"/>`;
  s += `<rect x="170" y="166" width="36" height="38" rx="11" fill="${ROUPA.lilas[0]}"/><path d="M180 168q8-11 16 0" fill="none" stroke="${ROUPA.lilas[1]}" stroke-width="3.4" stroke-linecap="round"/><rect x="176" y="182" width="24" height="17" rx="6" fill="${ROUPA.lilas[1]}"/><path d="M182 187h12" stroke="${ROUPA.lilas[0]}" stroke-width="1.6" stroke-linecap="round"/>`;
  s += perna([[113, 206], [111, 224], [109, 258]], ROUPA.jeans, 16) + perna([[135, 206], [137, 224], [139, 258]], ROUPA.jeans, 16);
  s += tenis(108, 263, { frente: true }) + tenis(140, 263, { frente: true });
  const c = cabeca({ x: 124, y: 110, s: 1.12, pele: ela.pele, cabelo: "trancas", corCabelo: CABELO.preto, rosto: "sorriso", olharV: 1.6 });
  s += c.atras + c.pescoco + tronco(124, 139, { L: 50, C: 46, A: 68, roupa: ela.roupa, pele: ela.pele }) + c.frente;
  s += celular(124, 182, 16, 26);
  s += braco([[102, 148], [96, 182], [116, 188]], { ...ela, w: 12, mao: "segura" }) + braco([[146, 148], [152, 182], [132, 188]], { ...ela, w: 12, mao: "segura" });
  s += planta(366, 266, 0.86, ROUPA.rosa);
  return { w: 400, h: 300, titulo: "Vcall: esperando o anfitrião abrir a porta", corpo: s };
};

/** Saída: ela, de costas, dá tchau para a amiga na tela. */
cenas["chamada-encerrada"] = () => {
  const id = "vc-cena-encerrada";
  const amiga = { pele: PELE.retinta, roupa: ROUPA.amarelo };
  const ela = { pele: PELE.clara, roupa: ROUPA.rosa };
  let s = `<circle cx="210" cy="140" r="128" fill="${MARCA_SUAVE}"/>`;
  s += `<rect x="198" y="172" width="24" height="28" fill="#cfc8ee"/><rect x="168" y="196" width="84" height="7" rx="3.5" fill="#bdb5e6"/><rect x="96" y="24" width="228" height="154" rx="14" fill="#241d4d"/>`;
  s += `<defs><clipPath id="${id}-tela"><rect x="104" y="32" width="212" height="138" rx="8"/></clipPath><linearGradient id="${id}-fundo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcf6ee"/><stop offset="1" stop-color="#e8e2ff"/></linearGradient></defs>`;
  s += `<g clip-path="url(#${id}-tela)"><rect x="104" y="32" width="212" height="138" fill="url(#${id}-fundo)"/>`;
  s += `<rect x="238" y="96" width="64" height="4" rx="2" fill="#c3b9ef"/><rect x="244" y="74" width="8" height="22" rx="2" fill="${ROSA}"/><rect x="254" y="78" width="7" height="18" rx="2" fill="${LARANJA}"/><rect x="263" y="72" width="9" height="24" rx="2" fill="#8b80d6"/>` + planta(288, 96, 0.36, ROUPA.rosa);
  const a = cabeca({ x: 196, y: 100, s: 1.24, pele: amiga.pele, cabelo: "black", corCabelo: CABELO.preto, rosto: "piscando", olhar: -1, brincos: true });
  s += a.atras + a.pescoco + tronco(196, 132, { L: 62, C: 66, A: 50, roupa: amiga.roupa, pele: amiga.pele, gola: "v" });
  s += braco([[170, 142], [146, 150], [142, 112]], { ...amiga, w: 14, mao: "aceno", ang: -10 }) + a.frente + `</g>`;
  s += `<rect x="270" y="40" width="38" height="18" rx="9" fill="${VERMELHO}"/><path d="M280 51.4q9-6.4 18 0l-1.6 2.2-4-1.4v-2.6q-3.4-1.2-6.8 0v2.6l-4 1.4Z" fill="${BRANCO}"/>`;
  s += `<path d="M118 42h30a9 9 0 0 1 0 18h-18l-6 6v-6h-6a9 9 0 0 1 0-18Z" fill="${BRANCO}"/>` + coracao(133, 51.6, 0.8);
  s += sombraChao(206, 292, 180, 5) + mesa(24, 388, 203, 292) + caneca(330, 203, 1, ROUPA.lilas) + planta(368, 203, 0.55, ROUPA.laranja);
  const e = cabeca({ x: 116, y: 210, s: 1.24, pele: ela.pele, cabelo: "coque", corCabelo: CABELO.ruivo, costas: true });
  s += e.atras + e.pescoco + tronco(116, 242, { L: 66, C: 70, A: 50, roupa: ela.roupa, pele: ela.pele, gola: "nenhuma" });
  s += braco([[87, 252], [60, 242], [56, 202]], { ...ela, w: 14, mao: "aceno", ang: -8 }) + e.frente;
  // O encosto da cadeira cobre as costas dela.
  s += `<rect x="76" y="258" width="80" height="34" rx="14" fill="${MOVEL}" stroke="${BORDA}" stroke-width="2"/>`;
  s += coracao(344, 150, 1.05) + coracao(362, 124, 0.7, LARANJA) + brilho(66, 60, 0.9);
  return { w: 400, h: 300, titulo: "Vcall: tchau, até a próxima", corpo: s };
};

/** Sem internet: ela ergue o celular atrás de sinal; o roteador acende vermelho. */
cenas["sem-internet"] = () => {
  const ela = { pele: PELE.media, roupa: ROUPA.laranja };
  let s = `<circle cx="196" cy="150" r="128" fill="${MARCA_SUAVE}"/>` + sombraChao(196, 266, 120, 6);
  s += mesa(40, 128, 204, 266);
  s += `<path d="M66 186 60 160M102 186 108 160" stroke="#6d63a8" stroke-width="3.4" stroke-linecap="round"/><rect x="56" y="182" width="56" height="20" rx="6" fill="#6d63a8"/><rect x="56" y="196" width="56" height="6" rx="3" fill="#574e8f"/><circle cx="70" cy="192" r="2.4" fill="#3fbf94"/><circle cx="80" cy="192" r="2.4" fill="#3fbf94"/><circle cx="90" cy="192" r="2.6" fill="${VERMELHO}"/><rect x="96" y="190.6" width="10" height="2.8" rx="1.4" fill="#a99ff0"/>`;
  s += perna([[188, 176], [187, 220], [186, 258]], ROUPA.jeans, 16) + perna([[206, 176], [207, 220], [208, 258]], ROUPA.jeans, 16);
  s += tenis(185, 263, { frente: true }) + tenis(209, 263, { frente: true });
  const c = cabeca({ x: 197, y: 86, s: 1.12, pele: ela.pele, cabelo: "rabo", corCabelo: CABELO.castanho, rosto: "surpreso", olhar: 2, olharV: -1.6 });
  s += c.atras + c.pescoco + tronco(197, 115, { L: 50, C: 44, A: 64, roupa: ela.roupa, pele: ela.pele }) + c.frente;
  s += braco([[175, 124], [150, 110], [170, 74]], { ...ela, w: 12 });
  s += celular(248, 50, 16, 28) + braco([[219, 124], [244, 104], [248, 70]], { ...ela, w: 12, mao: "segura" });
  s += `<circle cx="306" cy="64" r="28" fill="${PAINEL}" stroke="${BORDA}" stroke-width="1.5"/><g fill="none" stroke="${APAGADO}" stroke-width="3.4" stroke-linecap="round"><path d="M292 62a20 20 0 0 1 28 0"/><path d="M297.4 68a12 12 0 0 1 17.2 0"/></g><circle cx="306" cy="75" r="3" fill="${APAGADO}"/><circle cx="325" cy="43" r="9" fill="${VERMELHO}"/><path d="M325 38.4v5.4" stroke="${BRANCO}" stroke-width="2.4" stroke-linecap="round"/><circle cx="325" cy="47.6" r="1.4" fill="${BRANCO}"/>`;
  s += interrogacao(144, 48) + planta(352, 266, 0.86, ROUPA.rosa);
  return { w: 400, h: 300, titulo: "Vcall: sem internet", corpo: s };
};

/** A sala saiu do ar: ele dá de ombros; o plugue saiu da tomada. */
cenas.desconectado = () => {
  const ele = { pele: PELE.parda, roupa: ROUPA.lilas };
  let s = `<circle cx="180" cy="150" r="128" fill="${MARCA_SUAVE}"/>` + sombraChao(190, 266, 160, 6);
  s += janela(238, 28, 128, 96) + `<rect x="248" y="40" width="108" height="72" rx="9" fill="${PAINEL_2}"/>`;
  s += `<g transform="translate(302 76) rotate(-45)" fill="none" stroke="${ROSA}" stroke-width="4"><rect x="-27" y="-7" width="21" height="14" rx="7"/><rect x="6" y="-7" width="21" height="14" rx="7"/></g><g stroke="${LARANJA}" stroke-width="2.2" stroke-linecap="round"><path d="M296 62l-2-6M308 90l2 6M290 82l-6 2M314 70l6-2"/></g>`;
  s += `<rect x="342" y="210" width="26" height="34" rx="6" fill="${PAINEL_2}" stroke="${BORDA}" stroke-width="2"/><circle cx="350" cy="227" r="2.4" fill="${BORDA}"/><circle cx="360" cy="227" r="2.4" fill="${BORDA}"/>`;
  s += `<path d="M188 199H284Q296 199 296 212V250Q296 262 308 262H312" fill="none" stroke="#8a80c4" stroke-width="3.4" stroke-linecap="round"/><rect x="310" y="254" width="18" height="13" rx="4" fill="#6d63a8"/><path d="M328 257.6h6M328 263.4h6" stroke="#9a95b5" stroke-width="2.2" stroke-linecap="round"/><g stroke="${LARANJA}" stroke-width="2" stroke-linecap="round"><path d="M340 254l5-4M341 262h6M337 246l2-5"/></g>`;
  s += `<rect x="112" y="132" width="76" height="76" rx="20" fill="${MOVEL}" stroke="${BORDA}" stroke-width="2"/>`;
  const c = cabeca({ x: 150, y: 112, s: 1.16, pele: ele.pele, cabelo: "careca", corCabelo: CABELO.grisalho, rosto: "pensando", oculos: true, barba: true });
  s += c.atras + c.pescoco + tronco(150, 142, { L: 56, C: 50, A: 62, roupa: ele.roupa, pele: ele.pele, gola: "camisa" });
  s += braco([[124, 152], [96, 178], [82, 152]], { ...ele, w: 12, mao: "aceno", ang: -38 }) + braco([[176, 152], [204, 178], [218, 152]], { ...ele, w: 12, mao: "aceno", ang: 38 });
  s += c.frente + mesa(40, 290, 200, 266) + notebook(150, 200, 74, 48);
  s += interrogacao(196, 70, 0.9, LARANJA);
  return { w: 400, h: 300, titulo: "Vcall: a sala saiu do ar", corpo: s };
};

/** Demorando: ela espera de queixo na mão; a conexão vem de caracol. */
cenas.conectando = () => {
  const ela = { pele: PELE.morena, roupa: ROUPA.rosa };
  let s = `<circle cx="196" cy="150" r="128" fill="${MARCA_SUAVE}"/>` + sombraChao(200, 266, 170, 6);
  s += mesa(312, 392, 200, 266);
  s += `<rect x="344" y="188" width="16" height="12" fill="#cfc8ee"/><rect x="334" y="196" width="36" height="5" rx="2.5" fill="#bdb5e6"/><rect x="322" y="144" width="60" height="46" rx="7" fill="#241d4d"/><rect x="327" y="149" width="50" height="36" rx="4" fill="#e8e2ff"/>` + marca(352, 167, 18);
  s += `<path d="M234 202H310" stroke="${APAGADO}" stroke-width="2.6" stroke-dasharray="2 7" stroke-linecap="round"/>` + caracol(276, 200, 0.95);
  s += `<rect x="72" y="126" width="72" height="82" rx="20" fill="${MOVEL}" stroke="${BORDA}" stroke-width="2"/>`;
  const c = cabeca({ x: 108, y: 108, s: 1.14, pele: ela.pele, cabelo: "cacheado", corCabelo: CABELO.castanho, rosto: "neutro", olhar: 2.6, inclina: -8 });
  s += c.atras + c.pescoco + tronco(108, 138, { L: 54, C: 48, A: 62, roupa: ela.roupa, pele: ela.pele });
  s += braco([[132, 148], [146, 182], [160, 196]], { ...ela, w: 12 });
  s += mesa(24, 236, 200, 266) + notebook(186, 200, 72, 48) + ampulheta(46, 200) + c.frente;
  s += braco([[86, 148], [80, 194], [104, 134]], { ...ela, w: 12 });
  return { w: 400, h: 300, titulo: "Vcall: a sala está demorando para responder", corpo: s };
};

// -- saída ------------------------------------------------------------------

const so = process.argv.slice(2);
for (const [nome, cena] of Object.entries(cenas)) {
  if (so.length && !so.includes(nome)) continue;
  const { w, h, titulo, corpo } = cena();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none"><title>${titulo}</title>${corpo}</svg>\n`;
  writeFileSync(`${DESTINO}${nome}.svg`, svg);
  console.log(`${nome}.svg  ${(svg.length / 1024).toFixed(1)} kB`);
}
