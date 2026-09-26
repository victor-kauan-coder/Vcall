/**
 * desktop/fala.js — legendas que funcionam dentro do aplicativo de mesa.
 *
 * POR QUE ISTO EXISTE: no navegador, a legenda usa o reconhecimento de voz do
 * Chrome, que manda o áudio para os servidores do Google. Dentro do Electron
 * esse serviço não existe (falta a chave de acesso que só o Chrome oficial
 * tem) e o reconhecimento falha na hora com "network". Ou seja: no app, a
 * transcrição da própria fala simplesmente não funcionava.
 *
 * A solução é reconhecer a fala NA PRÓPRIA MÁQUINA, com o Vosk (Kaldi em
 * WebAssembly, public/vendor/vosk.js). Vantagem de brinde: nenhum áudio sai
 * do computador. O modelo de cada idioma (~30–50 MB) é baixado uma vez, na
 * primeira vez que a pessoa liga a legenda, e fica guardado.
 *
 * O Vosk no navegador espera o modelo em .tar.gz; o site oficial distribui
 * .zip. `zipParaTarGz` converte, sem dependência nenhuma. É a parte testável
 * sem rede (scripts/fixes-test.mjs).
 */
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync, inflateRawSync } from "node:zlib";

/** Esquema interno pelo qual a página busca o modelo (desktop/main.js). */
export const ESQUEMA_FALA = "vcall-fala";

const BASE = "https://alphacephei.com/vosk/models/";

/** Idioma da legenda -> modelo pequeno do Vosk (tamanho aproximado). */
export const MODELOS = {
  "pt-BR": { arquivo: "vosk-model-small-pt-0.3.zip", mb: 31 },
  "pt-PT": { arquivo: "vosk-model-small-pt-0.3.zip", mb: 31 },
  "en-US": { arquivo: "vosk-model-small-en-us-0.15.zip", mb: 40 },
  "es-ES": { arquivo: "vosk-model-small-es-0.42.zip", mb: 39 },
  "fr-FR": { arquivo: "vosk-model-small-fr-0.22.zip", mb: 41 },
  "de-DE": { arquivo: "vosk-model-small-de-0.15.zip", mb: 45 },
  "it-IT": { arquivo: "vosk-model-small-it-0.22.zip", mb: 48 },
  "ja-JP": { arquivo: "vosk-model-small-ja-0.22.zip", mb: 48 },
};

/** Nome do arquivo guardado para um idioma (só letras e hífen: vira caminho). */
export function nomeDoModelo(lang) {
  const chave = MODELOS[lang] ? lang : "pt-BR";
  return `${chave}.tar.gz`;
}

/* ------------------------------------------------------------------ *
 * .zip -> .tar.gz
 * ------------------------------------------------------------------ */

/**
 * Lê as entradas de um .zip (sem ZIP64: os modelos têm dezenas de MB).
 * @returns {Array<{nome:string, dados:Buffer, pasta:boolean}>}
 */
export function lerZip(buf) {
  // Fim do diretório central: assinatura 0x06054b50, nos últimos ~64 kB.
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("arquivo .zip inválido (sem diretório central)");

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = [];
  for (let n = 0; n < total; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("diretório central corrompido");
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + tamNome);
    p += 46 + tamNome + tamExtra + tamComent;

    // Nada de caminhos que escapem da pasta ("../") nem absolutos.
    if (nome.includes("..") || nome.startsWith("/") || nome.includes("\\")) {
      throw new Error(`caminho suspeito no .zip: ${nome}`);
    }
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("cabeçalho local corrompido");
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(inicio, inicio + tamComp);
    const pasta = nome.endsWith("/");
    let dados;
    if (pasta) dados = Buffer.alloc(0);
    else if (metodo === 0) dados = Buffer.from(bruto);
    else if (metodo === 8) dados = inflateRawSync(bruto);
    else throw new Error(`compressão ${metodo} não suportada em ${nome}`);
    saida.push({ nome, dados, pasta });
  }
  return saida;
}

function campoOctal(valor, largura) {
  return `${valor.toString(8).padStart(largura - 1, "0")}\0`;
}

/** Cabeçalho ustar de 512 bytes. */
function cabecalhoTar(nome, tamanho, pasta) {
  const h = Buffer.alloc(512, 0);
  let base = nome;
  let prefixo = "";
  if (Buffer.byteLength(nome) > 100) {
    const corte = nome.lastIndexOf("/", 154);
    if (corte <= 0 || Buffer.byteLength(nome.slice(corte + 1)) > 100) throw new Error(`nome longo demais: ${nome}`);
    prefixo = nome.slice(0, corte);
    base = nome.slice(corte + 1);
  }
  h.write(base, 0, 100, "utf8");
  h.write(campoOctal(pasta ? 0o755 : 0o644, 8), 100, "ascii");
  h.write(campoOctal(0, 8), 108, "ascii");
  h.write(campoOctal(0, 8), 116, "ascii");
  h.write(campoOctal(tamanho, 12), 124, "ascii");
  h.write(campoOctal(Math.floor(Date.now() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // soma provisória: espaços
  h.write(pasta ? "5" : "0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefixo, 345, 155, "utf8");
  let soma = 0;
  for (const b of h) soma += b;
  h.write(`${soma.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}

/**
 * Monta um .tar a partir das entradas (mesma estrutura de pastas do .zip).
 *
 * Nem todo .zip lista as pastas, só os arquivos. O tar ganha as pastas que
 * faltarem, antes do conteúdo delas: sem isso o armazenamento do Vosk
 * (IDBFS) falha ao guardar um arquivo cuja pasta "não existe".
 */
export function montarTar(entradas) {
  const partes = [];
  const pastas = new Set(entradas.filter((e) => e.pasta).map((e) => e.nome));
  const completas = [];
  for (const e of entradas) {
    const partesNome = e.nome.split("/").filter(Boolean);
    for (let i = 1; i < partesNome.length; i += 1) {
      const pai = `${partesNome.slice(0, i).join("/")}/`;
      if (!pastas.has(pai)) {
        pastas.add(pai);
        completas.push({ nome: pai, dados: Buffer.alloc(0), pasta: true });
      }
    }
    completas.push(e);
  }
  for (const e of completas) {
    const tam = e.pasta ? 0 : e.dados.length;
    partes.push(cabecalhoTar(e.nome, tam, e.pasta));
    if (tam) {
      partes.push(e.dados);
      const resto = tam % 512;
      if (resto) partes.push(Buffer.alloc(512 - resto, 0));
    }
  }
  partes.push(Buffer.alloc(1024, 0)); // dois blocos zerados encerram o tar
  return Buffer.concat(partes);
}

export function zipParaTarGz(zip) {
  return gzipSync(montarTar(lerZip(zip)), { level: 6 });
}

/* ------------------------------------------------------------------ *
 * Download, cache e entrega
 * ------------------------------------------------------------------ */

/**
 * Garante o modelo do idioma no disco e devolve o caminho.
 *
 * @param {{pasta:string, lang:string, baixar:(url:string)=>Promise<Response>, progresso?:(p:number)=>void}} o
 */
export async function prepararModelo({ pasta, lang, baixar, progresso = () => {} }) {
  const destino = path.join(pasta, nomeDoModelo(lang));
  try {
    const s = await stat(destino);
    if (s.size > 1_000_000) {
      progresso(1);
      return destino;
    }
  } catch {
    /* ainda não baixado */
  }

  const modelo = MODELOS[lang] || MODELOS["pt-BR"];
  const resp = await baixar(BASE + modelo.arquivo);
  if (!resp.ok) throw new Error(`o servidor do modelo respondeu ${resp.status}`);
  const total = Number(resp.headers.get("content-length")) || modelo.mb * 1024 * 1024;

  const pedacos = [];
  let recebido = 0;
  const leitor = resp.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(Buffer.from(value));
    recebido += value.length;
    progresso(Math.min(0.95, recebido / total));
  }

  const tarGz = zipParaTarGz(Buffer.concat(pedacos));
  await mkdir(pasta, { recursive: true });
  // Escreve ao lado e renomeia: um download interrompido nunca deixa um
  // arquivo pela metade com o nome do definitivo.
  await writeFile(`${destino}.parcial`, tarGz);
  await rename(`${destino}.parcial`, destino);
  progresso(1);
  return destino;
}

/**
 * Resposta para `vcall-fala://modelo/<idioma>.tar.gz`. Só entrega arquivos
 * desta pasta, com nome no formato esperado — nada de caminho arbitrário.
 */
export async function responderModelo(pasta, url) {
  let nome;
  try {
    nome = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return new Response("pedido inválido", { status: 400 });
  }
  if (!/^[A-Za-z]{2}-[A-Za-z]{2}\.tar\.gz$/.test(nome)) return new Response("não encontrado", { status: 404 });
  const arquivo = path.join(pasta, nome);
  try {
    const s = await stat(arquivo);
    return new Response(Readable.toWeb(createReadStream(arquivo)), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(s.size),
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("modelo ainda não baixado", { status: 404 });
  }
}
