#!/usr/bin/env node
/**
 * scripts/fontes.mjs — traz as fontes da recepção para dentro do projeto.
 *
 * POR QUE AUTO-HOSPEDAR, e não um <link> para o Google Fonts: o executável
 * promete não baixar nada de fora depois de instalado (ver PRODUCT.md). Uma
 * fonte vinda de CDN quebraria essa promessa de três formas — a tela
 * apareceria sem tipografia em máquina offline, o endereço IP de quem usa
 * iria para um terceiro a cada abertura, e a política de segurança de
 * conteúdo teria de abrir `font-src` para fora.
 *
 * Roda uma vez; os arquivos ficam versionados em public/vendor/fontes/.
 *
 *   node scripts/fontes.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(raiz, "public", "vendor", "fontes");

/*
 * O Google devolve woff2 só para navegador moderno; com user-agent de script
 * ele entrega ttf antigo e o CSS vem sem nenhuma @font-face utilizável.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * As duas vozes do cartão QSL.
 *
 * Gótico condensado é a letra do cartão impresso barato dos anos 30 a 50 —
 * cabe muito caractere em pouca largura, que é o que um cartão postal exige.
 * Máquina de escrever é o que o operador batia à mão nos campos de dado.
 * Nenhuma das duas está na lista de faces que a impeccable marca como
 * padrão-de-modelo.
 */
const FAMILIAS = [
  { nome: "Big Shoulders Display", arquivo: "big-shoulders", pesos: [400, 700, 800] },
  { nome: "Courier Prime", arquivo: "courier-prime", pesos: [400, 700] },
];

const pegar = (url, binario = false) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": UA } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${res.statusCode} em ${url}`));
          return;
        }
        const pedacos = [];
        res.on("data", (c) => pedacos.push(c));
        res.on("end", () => resolve(binario ? Buffer.concat(pedacos) : Buffer.concat(pedacos).toString("utf8")));
      })
      .on("error", reject);
  });

await mkdir(destino, { recursive: true });

const regras = [];

for (const familia of FAMILIAS) {
  const consulta = `${familia.nome.replace(/ /g, "+")}:wght@${familia.pesos.join(";")}`;
  const css = await pegar(`https://fonts.googleapis.com/css2?family=${consulta}&display=swap`);

  /*
   * Só os blocos `latin` e `latin-ext`. O Google fatia a fonte em dezenas de
   * subconjuntos (cirílico, grego, vietnamita); baixar todos engordaria o
   * executável em megabytes que o português nunca usa.
   */
  const blocos = css.split("/*").filter((b) => /^\s*(latin|latin-ext)\s*\*\//.test(b));

  for (const bloco of blocos) {
    const subconjunto = bloco.match(/^\s*(latin-ext|latin)\s*\*\//)[1];
    const peso = bloco.match(/font-weight:\s*(\d+)/)?.[1];
    const url = bloco.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const faixa = bloco.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!url || !peso) continue;

    const nomeArquivo = `${familia.arquivo}-${peso}-${subconjunto}.woff2`;
    const dados = await pegar(url, true);
    await writeFile(path.join(destino, nomeArquivo), dados);
    console.log(`  ${nomeArquivo} (${(dados.length / 1024).toFixed(1)} kB)`);

    regras.push(
      [
        `@font-face {`,
        `  font-family: "${familia.nome}";`,
        `  font-style: normal;`,
        `  font-weight: ${peso};`,
        /* `swap` e não `block`: a recepção tem de aparecer mesmo que a fonte
           demore, e numa máquina local ela nunca demora. */
        `  font-display: swap;`,
        `  src: url("/vendor/fontes/${nomeArquivo}") format("woff2");`,
        `  unicode-range: ${faixa};`,
        `}`,
      ].join("\n"),
    );
  }
}

const cabecalho = `/*
 * public/vendor/fontes/fontes.css — GERADO POR scripts/fontes.mjs.
 *
 * As fontes vivem dentro do projeto de propósito: o executável não baixa
 * nada de fora depois de instalado. Ver o comentário do gerador.
 *
 * Big Shoulders Display e Courier Prime são SIL Open Font License 1.1.
 */
`;

await writeFile(path.join(destino, "fontes.css"), `${cabecalho}\n${regras.join("\n\n")}\n`);
console.log(`\n✓ ${regras.length} faces em public/vendor/fontes/fontes.css`);
