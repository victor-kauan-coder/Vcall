/**
 * ui/avatar-vcall.js — o estilo de avatar "Vcall", desenhado aqui mesmo.
 *
 * Cabeça redonda, olhos em cápsula, bochecha rosa, cabelos e acessórios
 * feitos só de círculos e cápsulas.
 *
 * Determinístico como os estilos do DiceBear: a mesma semente dá o mesmo
 * rosto em qualquer computador da sala, e só o par {style, seed} trafega.
 * Quem estiver numa versão antiga recebe o estilo padrão no lugar.
 */
const TINTA = "#1d0a1f";
const ROSA = "#fd4d87";
const LARANJA = "#fe9c5f";
const PELE = ["#f8d5c0", "#eebc9a", "#d89b73", "#b8744f", "#8d5639", "#5f3a28"];
const CABELO = ["#1d0a1f", "#1d0a1f", "#3b2416", "#6b3e26", "#c46b3f", "#f0c36a"];
const CABELO_COLORIDO = ["#8f8db8", ROSA];
const FUNDO = ["#ffd9e6", "#ffe3cf", "#e6e0ff", "#d6f2ec", "#fff0c4", "#dce8ff"];
const ROUPA = [ROSA, LARANJA, "#6d63a8", "#2a2350", "#3ec7a8", "#ffd27a"];
const ESTILOS = ["curto", "coque", "cacheado", "black", "rabo", "longo", "trancas", "careca"];
/** Cabelo que fica atrás do corpo (desce pelos ombros). */
const ATRAS = new Set(["longo", "black", "trancas", "rabo"]);

/** FNV-1a da semente alimentando um mulberry32: rápido, estável, sem dependência. */
export function sorteador(semente) {
  let h = 2166136261;
  for (const c of String(semente)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cabelo(estilo, cor) {
  const c = `fill="${cor}"`;
  return {
    curto: `<circle cx="64" cy="50" r="33" ${c}/>`,
    coque: `<circle cx="64" cy="18" r="13" ${c}/><circle cx="64" cy="50" r="33" ${c}/>`,
    cacheado: [[36, 44], [44, 28], [58, 20], [72, 20], [86, 28], [94, 44], [40, 62], [90, 62]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" ${c}/>`).join(""),
    black: `<circle cx="64" cy="46" r="44" ${c}/>`,
    rabo: `<rect x="86" y="34" width="20" height="54" rx="10" ${c} transform="rotate(-18 96 40)"/><circle cx="64" cy="50" r="33" ${c}/>`,
    longo: `<rect x="28" y="40" width="72" height="72" rx="30" ${c}/><circle cx="64" cy="50" r="34" ${c}/>`,
    trancas: `<rect x="26" y="52" width="16" height="56" rx="8" ${c}/><rect x="86" y="52" width="16" height="56" rx="8" ${c}/><circle cx="64" cy="50" r="33" ${c}/>`,
    careca: "",
  }[estilo];
}

function franja(estilo, cor) {
  const c = `fill="${cor}"`;
  return {
    curto: `<rect x="40" y="30" width="44" height="16" rx="8" ${c}/>`,
    coque: `<rect x="38" y="32" width="30" height="14" rx="7" ${c}/>`,
    rabo: `<rect x="42" y="30" width="40" height="15" rx="7.5" ${c}/>`,
    longo: `<rect x="38" y="30" width="52" height="16" rx="8" ${c}/>`,
    trancas: `<rect x="40" y="30" width="48" height="14" rx="7" ${c}/>`,
    cacheado: `<circle cx="52" cy="34" r="9" ${c}/><circle cx="66" cy="31" r="9" ${c}/><circle cx="79" cy="35" r="8" ${c}/>`,
  }[estilo] || "";
}

/** Markup SVG (128 x 128, redondo) do avatar desta semente. */
export function avatarVcall(semente) {
  const sortear = sorteador(semente || "vcall");
  const um = (lista) => lista[Math.floor(sortear() * lista.length)];
  const chance = (p) => sortear() < p;

  const pele = um(PELE);
  const estilo = um(ESTILOS);
  const corCabelo = chance(0.12) ? um(CABELO_COLORIDO) : um(CABELO);
  const fundo = um(FUNDO);
  const roupa = um(ROUPA);
  const oculos = chance(0.25);
  const fone = chance(0.12);
  const bone = !fone && (estilo === "curto" || estilo === "careca") && chance(0.2);
  const pelos = chance(0.2) ? um(["barba", "bigode"]) : null;
  const brincos = !fone && chance(0.22);
  const sardas = PELE.indexOf(pele) < 3 && chance(0.18);

  const cab = cabelo(estilo, corCabelo);
  const olhos = oculos
    ? `<rect x="48.5" y="54" width="7" height="10" rx="3.5" fill="${TINTA}"/><rect x="72.5" y="54" width="7" height="10" rx="3.5" fill="${TINTA}"/><g fill="none" stroke="${TINTA}" stroke-width="3"><circle cx="52" cy="58" r="10"/><circle cx="76" cy="58" r="10"/><path d="M62 57h4"/></g><circle cx="49" cy="55" r="2.4" fill="#fff" opacity=".6"/>`
    : `<rect x="47" y="52" width="8" height="13" rx="4" fill="${TINTA}"/><rect x="73" y="52" width="8" height="13" rx="4" fill="${TINTA}"/><circle cx="52.5" cy="55.5" r="1.8" fill="#fff"/><circle cx="78.5" cy="55.5" r="1.8" fill="#fff"/>`;
  const extras = [
    sardas ? `<g fill="#b8744f" opacity=".5"><circle cx="46" cy="70" r="1.6"/><circle cx="50" cy="73" r="1.6"/><circle cx="78" cy="70" r="1.6"/><circle cx="82" cy="73" r="1.6"/></g>` : "",
    pelos === "barba" ? `<path d="M38 64a26 26 0 0 0 52 0v8a26 26 0 0 1-52 0z" fill="${corCabelo}"/>` : "",
    pelos === "bigode" ? `<rect x="54" y="68" width="20" height="6" rx="3" fill="${corCabelo}"/>` : "",
    brincos ? `<circle cx="34" cy="74" r="4" fill="${LARANJA}"/><circle cx="94" cy="74" r="4" fill="${LARANJA}"/>` : "",
    bone ? `<rect x="32" y="24" width="64" height="26" rx="13" fill="${um(ROUPA)}"/><rect x="60" y="40" width="46" height="10" rx="5" fill="${um(ROUPA)}"/>` : "",
    fone ? `<path d="M30 58a34 34 0 0 1 68 0" fill="none" stroke="#2a2350" stroke-width="6" stroke-linecap="round"/><rect x="24" y="52" width="14" height="22" rx="7" fill="#2a2350"/><rect x="90" y="52" width="14" height="22" rx="7" fill="#2a2350"/>` : "",
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><clipPath id="moldura"><circle cx="64" cy="64" r="64"/></clipPath><g clip-path="url(#moldura)">`
    + `<rect width="128" height="128" fill="${fundo}"/>`
    + (ATRAS.has(estilo) ? cab : "")
    + `<rect x="22" y="98" width="84" height="70" rx="38" fill="${roupa}"/><rect x="53" y="78" width="22" height="26" rx="10" fill="${pele}"/>`
    + (ATRAS.has(estilo) ? "" : cab)
    + `<circle cx="64" cy="60" r="28" fill="${pele}"/><circle cx="36" cy="62" r="6" fill="${pele}"/><circle cx="92" cy="62" r="6" fill="${pele}"/>`
    + franja(estilo, corCabelo)
    + `<circle cx="45" cy="70" r="5" fill="${ROSA}" fill-opacity=".28"/><circle cx="83" cy="70" r="5" fill="${ROSA}" fill-opacity=".28"/>`
    + olhos + extras
    + `<path d="M57 74q7 6 14 0" fill="none" stroke="${pelos === "barba" ? "#ffd9cc" : TINTA}" stroke-width="3" stroke-linecap="round"/>`
    + `</g></svg>`;
}
