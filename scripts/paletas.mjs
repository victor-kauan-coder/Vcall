#!/usr/bin/env node
/**
 * scripts/paletas.mjs — gera public/css/paletas.css e confere o contraste.
 *
 * POR QUE GERADO E NÃO ESCRITO À MÃO: são cinco paletas × dois temas × treze
 * variáveis de neutro. Escrevendo à mão, duas coisas acontecem sempre — uma
 * paleta fica com um degrau de cinza fora de passo com as outras, e alguma
 * combinação de texto sobre superfície passa despercebida abaixo de 4.5:1.
 * Aqui a rampa sai de uma fórmula só, e o contraste é CONFERIDO: se uma
 * paleta não bate o mínimo, o script falha e nenhum CSS é escrito.
 *
 *   node scripts/paletas.mjs
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * Cor
 *
 * OKLCH porque a claridade é perceptual: 0.20 de claridade parece o mesmo
 * tom de escuro em qualquer matiz. Em HSL não parece — um azul e um amarelo
 * com a mesma "lightness" têm contraste bem diferente, e a rampa sairia
 * torta de paleta para paleta. A conversão é feita aqui e gravada em hex
 * para o CSS não depender de suporte a oklch em navegador antigo.
 * ------------------------------------------------------------------ */

function oklchParaRgb(L, C, Hgraus) {
  const h = (Hgraus * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const gama = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
  return lin.map((v) => Math.round(Math.min(255, Math.max(0, gama(v) * 255))));
}

const hex = (L, C, H) =>
  "#" +
  oklchParaRgb(L, C, H)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

const canal = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luz = (h) => {
  const n = parseInt(h.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};
const razao = (a, b) => {
  const x = luz(a);
  const y = luz(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* ------------------------------------------------------------------ *
 * As paletas
 *
 * Cada uma é: um matiz de neutro, quanto desse matiz aparece (croma) e os
 * dois acentos. Os acentos ficam em hex à mão de propósito — são a
 * identidade, não um ponto numa rampa.
 * ------------------------------------------------------------------ */

const PALETAS = [
  {
    id: "tinta",
    nome: "Tinta",
    descricao: "Nanquim frio. O padrão: a sala some e os rostos aparecem.",
    h: 250,
    c: 0.014,
    acentos: { escuro: ["#fd4d87", "#fe9c5f"], claro: ["#c21f55", "#9c5212"] },
  },
  {
    id: "ametista",
    nome: "Ametista",
    descricao: "O roxo original do Vcall, de volta inteiro.",
    h: 285,
    c: 0.075,
    acentos: { escuro: ["#fd4d87", "#fe9c5f"], claro: ["#c21f55", "#9c5212"] },
  },
  {
    id: "carvao",
    nome: "Carvão",
    descricao: "Cinza puro, sem matiz nenhum. Para quem quer a tela calada.",
    h: 0,
    c: 0,
    acentos: { escuro: ["#ffb020", "#ff7a45"], claro: ["#8a5200", "#963612"] },
  },
  {
    id: "oceano",
    nome: "Oceano",
    descricao: "Azul profundo com acento de água rasa.",
    h: 225,
    c: 0.055,
    acentos: { escuro: ["#38bdf8", "#2dd4bf"], claro: ["#0369a1", "#0f766e"] },
  },
  {
    id: "brasa",
    nome: "Brasa",
    descricao: "Marrom-queimado e luz de fogo. Quente para reunião de noite.",
    h: 45,
    c: 0.035,
    acentos: { escuro: ["#ff8a5b", "#ffc94d"], claro: ["#99390a", "#6f4c00"] },
  },
];

/**
 * A rampa.
 *
 * Os degraus de claridade são os mesmos para todas as paletas — é isso que
 * faz uma sombra, uma borda e um texto secundário terem o mesmo peso visual
 * independentemente da cor escolhida. Só o matiz e o croma mudam.
 *
 * O croma cai nos tons mais claros do tema escuro (e sobe de leve nos textos)
 * porque cor saturada em área grande cansa, e em texto pequeno some.
 */
function rampa({ h, c }, tema) {
  const n = (L, mult = 1) => hex(L, c * mult, h);
  if (tema === "escuro") {
    return {
      "--bg": n(0.18),
      "--bg-elevated": n(0.221),
      "--surface": n(0.254),
      "--surface-2": n(0.288),
      "--surface-3": n(0.335),
      "--surface-hover": n(0.312),
      "--border": n(0.335),
      "--border-strong": n(0.42),
      "--border-subtle": n(0.258),
      "--text": n(0.955, 0.35),
      "--text-secondary": n(0.775, 0.5),
      "--text-muted": n(0.715, 0.6),
      "--text-inverse": n(0.18),
      "--tile-bg": n(0.2),
      "--tile-glow": n(0.262),
      "--board-paper": n(0.2),
      "--board-ink": n(0.955, 0.35),
      "--scrim": n(0.14),
    };
  }
  return {
    "--bg": n(0.972, 0.5),
    "--bg-elevated": n(1, 0),
    "--surface": n(1, 0),
    "--surface-2": n(0.957, 0.6),
    "--surface-3": n(0.925, 0.7),
    "--surface-hover": n(0.941, 0.65),
    "--border": n(0.885, 0.8),
    "--border-strong": n(0.8, 0.9),
    "--border-subtle": n(0.929, 0.6),
    "--text": n(0.235, 0.6),
    "--text-secondary": n(0.43, 0.7),
    "--text-muted": n(0.492, 0.8),
    "--text-inverse": n(1, 0),
    // O ladrilho de vídeo NÃO acompanha o tema: vídeo pede fundo escuro em
    // qualquer luz, e um ladrilho branco com o vídeo desligado ofusca.
    "--tile-bg": n(0.255, 0.8),
    "--tile-glow": n(0.33, 0.8),
    "--board-paper": n(1, 0),
    "--board-ink": n(0.235, 0.6),
    "--scrim": n(0.3, 0.8),
  };
}

/* ------------------------------------------------------------------ *
 * Conferência
 * ------------------------------------------------------------------ */

const MINIMO = 4.5;
const falhas = [];

function conferir(paleta, tema, vars, acentos) {
  // Texto corrido e secundário precisam valer sobre TODA superfície em que
  // podem cair — inclusive a mais clara do tema escuro, que é onde escapa.
  const fundos = ["--bg", "--bg-elevated", "--surface", "--surface-2", "--surface-3"];
  const textos = ["--text", "--text-secondary", "--text-muted"];
  for (const t of textos) {
    for (const f of fundos) {
      const r = razao(vars[t], vars[f]);
      if (r < MINIMO) {
        falhas.push(`${paleta.id}/${tema}: ${t} sobre ${f} = ${r.toFixed(2)}:1`);
      }
    }
  }
  // O acento é usado em texto de link e em ícone; 3:1 é o piso de elemento
  // gráfico, 4.5:1 o de texto. Exigimos o de texto sobre o fundo base.
  const r = razao(acentos[0], vars["--bg"]);
  if (r < MINIMO) falhas.push(`${paleta.id}/${tema}: acento sobre --bg = ${r.toFixed(2)}:1`);
}

/* ------------------------------------------------------------------ *
 * Saída
 * ------------------------------------------------------------------ */

const bloco = (seletor, vars, acentos) => {
  const linhas = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  const [a1, a2] = acentos;
  linhas.push(`  --accent: ${a1};`);
  linhas.push(`  --accent-hover: ${a1};`);
  linhas.push(`  --accent-soft: ${a1}29;`);
  linhas.push(`  --accent-2: ${a2};`);
  linhas.push(`  --accent-2-soft: ${a2}29;`);
  linhas.push(`  --brand-pink: ${a1};`);
  linhas.push(`  --brand-orange: ${a2};`);
  return `${seletor} {\n${linhas.join("\n")}\n}`;
};

const partes = [
  `/*
 * public/css/paletas.css — GERADO POR scripts/paletas.mjs. NÃO EDITE À MÃO.
 *
 * Rode \`node scripts/paletas.mjs\` depois de mexer nas paletas de lá. O
 * script confere o contraste de cada combinação antes de gravar: se algum
 * texto ficar abaixo de 4.5:1, ele falha e este arquivo não muda.
 *
 * Carregado DEPOIS de tokens.css e ANTES de app.css: sobrepõe os neutros
 * padrão e continua sendo sobreposto pelo que é específico de componente.
 */
`,
];

for (const p of PALETAS) {
  for (const [tema, rotulo] of [
    ["escuro", "dark"],
    ["claro", "light"],
  ]) {
    const vars = rampa(p, tema);
    const acentos = p.acentos[tema];
    conferir(p, tema, vars, acentos);

    const alvo =
      rotulo === "dark"
        ? `:root[data-paleta="${p.id}"], :root[data-paleta="${p.id}"][data-theme="dark"]`
        : `:root[data-paleta="${p.id}"][data-theme="light"]`;
    partes.push(`/* ${p.nome} — ${p.descricao} (${tema}) */\n${bloco(alvo, vars, acentos)}`);

    if (rotulo === "light") {
      // O tema automático precisa da mesma regra, senão quem deixou o sistema
      // decidir fica com os neutros do escuro sobre um fundo claro.
      partes.push(
        `@media (prefers-color-scheme: light) {\n  ${bloco(
          `:root[data-paleta="${p.id}"]:not([data-theme="dark"])`,
          vars,
          acentos,
        )
          .split("\n")
          .join("\n  ")}\n}`,
      );
    }
  }
}

/*
 * As amostras dos botões de escolha.
 *
 * Elas têm de mostrar a paleta DELAS, não a que está ligada no momento — por
 * isso as cores entram fixas aqui, e não por variável herdada do <html>. A
 * amostra segue o tema vigente: escolher no claro mostrando o escuro faria a
 * pessoa escolher errado.
 */
const amostras = [];
for (const p of PALETAS) {
  for (const tema of ["escuro", "claro"]) {
    const v = rampa(p, tema);
    const sel =
      tema === "escuro"
        ? `.paletaOpcao[data-paleta-amostra="${p.id}"]`
        : `:root[data-theme="light"] .paletaOpcao[data-paleta-amostra="${p.id}"]`;
    amostras.push(
      [
        `${sel} .paletaOpcao__fundo { background: ${v["--bg"]}; }`,
        `${sel} .paletaOpcao__superficie { background: ${v["--surface-2"]}; }`,
        `${sel} .paletaOpcao__acento { background: ${p.acentos[tema][0]}; }`,
      ].join("\n"),
    );
  }
}
partes.push(["/* Amostras dos botões de escolha de paleta. */", ...amostras].join("\n"));

if (falhas.length) {
  console.error("Contraste insuficiente — nada foi gravado:");
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}

const saida = path.join(raiz, "public", "css", "paletas.css");
await writeFile(saida, partes.join("\n\n") + "\n");

console.log(`✓ ${PALETAS.length} paletas × 2 temas, contraste conferido`);
console.log(`  ${path.relative(raiz, saida)}`);

/* A lista que a interface usa para montar os botões. */
const manifesto = PALETAS.map(({ id, nome, descricao, acentos }) => ({
  id,
  nome,
  descricao,
  amostra: [acentos.escuro[0], acentos.escuro[1]],
}));
await writeFile(
  path.join(raiz, "public", "js", "ui", "paletas.js"),
  `/**
 * ui/paletas.js — GERADO POR scripts/paletas.mjs. NÃO EDITE À MÃO.
 *
 * Só a lista para a interface montar os botões de escolha. As cores de
 * verdade estão em public/css/paletas.css, aplicadas por [data-paleta].
 */
export const PALETAS = ${JSON.stringify(manifesto, null, 2)};

export const PADRAO = "tinta";
`,
);
console.log(`  public/js/ui/paletas.js`);
