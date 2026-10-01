#!/usr/bin/env node
/**
 * scripts/ilustracoes.mjs — troca as cores cravadas das ilustrações por tokens.
 *
 * As ilustrações entravam por `<img src="...svg">`, e um SVG carregado assim é
 * um documento isolado: o CSS da página não o alcança, `currentColor` não vale,
 * variável nenhuma atravessa. Por isso elas continuavam claras no tema escuro,
 * com um painel branco no meio de uma tela preta.
 *
 * Aqui as cores viram `var(--ilu-*, #original)`. O original fica como reserva,
 * então o arquivo continua correto se for aberto sozinho. Quem define os
 * tokens por tema é tokens.css, e quem põe o SVG dentro da página — para a
 * variável alcançar — é `ilustracao()` em public/js/ui/ilustracao.js.
 *
 * TOM DE PELE NÃO É TEMA. Pessoas têm pele, e a cor dela não muda porque
 * alguém trocou o tema do aplicativo. Esses valores ficam de fora.
 *
 *   node scripts/ilustracoes.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pasta = path.join(raiz, "public", "assets", "illustrations");

/**
 * De cor cravada para token.
 *
 * Os nomes dizem o PAPEL na cena, não o tom: é o papel que precisa continuar
 * legível quando o fundo vira preto. Um painel claro atrás de uma figura
 * escura, invertido sem critério, some os dois.
 */
const MAPA = {
  // A marca acompanha a paleta escolhida, como o resto da interface.
  "#fd4d87": "--ilu-marca",

  // Superfícies grandes e claras: a "janela do app" dentro do desenho.
  "#f4e6f0": "--ilu-painel",
  "#fdf5f9": "--ilu-painel-claro",
  "#f2f2f2": "--ilu-painel-claro",

  // A figura em primeiro plano: roupa e cabelo.
  "#2f2e41": "--ilu-figura",
  "#2f2e43": "--ilu-figura",
  "#3f3d56": "--ilu-figura-2",

  // Traços, bordas e sombras finas.
  "#d6d6e3": "--ilu-linha",
  "#d5d5d6": "--ilu-linha",
  "#707070": "--ilu-linha",

  "#090814": "--ilu-tinta",
};

/** Tons de pele — intocados de propósito. */
const PELE = new Set(["#a0616a", "#9f616a", "#ffb6b6", "#ed9da0", "#f3a3a6"]);

const arquivos = ["hero.svg", "empty.svg", "calling.svg"];
let total = 0;

for (const nome of arquivos) {
  const alvo = path.join(pasta, nome);
  let svg = await readFile(alvo, "utf8");

  // Já processado? `var(--ilu-` só aparece depois de passar por aqui.
  if (svg.includes("var(--ilu-")) {
    console.log(`  ${nome}: já tokenizado, pulando`);
    continue;
  }

  let trocas = 0;
  svg = svg.replace(/#[0-9a-fA-F]{6}/g, (cor) => {
    const minuscula = cor.toLowerCase();
    if (PELE.has(minuscula)) return cor;
    const token = MAPA[minuscula];
    if (!token) return cor;
    trocas += 1;
    return `var(${token}, ${cor})`;
  });

  await writeFile(alvo, svg);
  total += trocas;
  console.log(`  ${nome}: ${trocas} cores viraram token`);
}

console.log(`\n✓ ${total} trocas. Os tokens --ilu-* estão em public/css/tokens.css.`);
