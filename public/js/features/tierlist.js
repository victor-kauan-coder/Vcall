/**
 * features/tierlist.js — a Tier List da chamada. Só a lógica; o desenho fica
 * em ui/tierlist.js.
 *
 * COMO SE JOGA
 *
 *   1. MONTAR. Alguém escolhe um tema pronto (ou começa do zero) e a turma
 *      inteira monta junto: título, faixas (nome e cor), estilo (S–F,
 *      notas, emoji…), paleta e os itens. Todo mundo vê tudo na hora.
 *   2. RANQUEAR. Cada um arrasta os itens para as faixas na SUA lista, sem
 *      ver a dos outros. Só viaja "fulano já colocou 7 de 12".
 *   3. REVELAR. Quando todos dão "Pronto!" (ou alguém revela antes), cada
 *      um publica a própria lista e aparece a TIER LIST DA GALERA: a média
 *      de todo mundo, com o item mais polêmico, as unanimidades, as almas
 *      gêmeas (quem pensa igual) e quem é do contra.
 *
 * Mesmas regras de convivência dos outros jogos (features/festa.js):
 *
 *   - Tudo mora no estado compartilhado (EstadoJogos), sem servidor novo.
 *   - CADA UM ESCREVE O QUE É SEU: progresso e lista vão em `tl/pr/<id>` e
 *     `tl/val/<id>`; ninguém disputa a chave de ninguém.
 *   - O QUE É SEGREDO FICA EM CASA ATÉ A HORA: a lista de cada um só é
 *     publicada depois de `tl/rev` apontar para a rodada atual.
 *   - RODADAS SÓ CRESCEM: `l` é a lista (muda com "Nova tier list") e `r` a
 *     rodada de ranqueamento dentro dela. Lista e progresso velhos, de outro
 *     `l`/`r`, são ignorados sem precisar apagar.
 */
import { Emitter } from "../lib/emitter.js";
import { lider, novoId } from "./jogos.js";

export const MAX_ITENS = 40;
export const MIN_TIERS = 2;
export const MAX_TIERS = 8;
const MAX_NOME_TIER = 18;
const MAX_ITEM = 40;
const MAX_TITULO = 60;

const texto = (v, max = 60) => (typeof v === "string" ? v.slice(0, max) : "");
const corOk = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/* ------------------------------------------------------------------ *
 * Personalização: paletas, estilos de faixa e temas prontos
 * ------------------------------------------------------------------ */

/** Cores das faixas, de cima (a melhor) para baixo. Oito cada, o máximo de faixas. */
export const PALETAS = {
  classica: { nome: "Clássica", cores: ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#ffff7f", "#bfff7f", "#7fff7f", "#7fffff", "#7fbfff"] },
  vcall: { nome: "Vcall", cores: ["#fd4d87", "#fe6a79", "#fe8a69", "#fe9c5f", "#f8b86c", "#c79bff", "#9b87ff", "#6f8cff"] },
  neon: { nome: "Neon", cores: ["#ff2e88", "#ff8a00", "#ffe600", "#39ff14", "#00e5ff", "#7c4dff", "#ff4dff", "#b0b8c4"] },
  pastel: { nome: "Pastel", cores: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"] },
  porDoSol: { nome: "Pôr do sol", cores: ["#ff4e50", "#fc913a", "#f9d423", "#ede574", "#c5e8b7", "#9ad3bc", "#3f9cb0", "#2a5d8f"] },
  oceano: { nome: "Oceano", cores: ["#00f5d4", "#00bbf9", "#3a86ff", "#4361ee", "#7209b7", "#b5179e", "#f72585", "#adb5bd"] },
};

/** Nomes das faixas, de cima para baixo. */
export const ESTILOS = {
  classico: { nome: "S, A, B, C…", faixas: ["S", "A", "B", "C", "D", "F"] },
  brasileiro: { nome: "Do divino ao nem a pau", faixas: ["Divino", "Top demais", "De boa", "Meh", "Nem a pau"] },
  temperatura: { nome: "Temperatura", faixas: ["Pelando", "Quente", "Morno", "Frio", "Congelado"] },
  notas: { nome: "Notas", faixas: ["10", "8", "6", "4", "2"] },
  coracao: { nome: "Coração", faixas: ["Casaria", "Namoraria", "Amizade", "Conhecido", "Bloqueado"] },
  rapido: { nome: "Ama, gosta, odeia", faixas: ["Amo", "Gosto", "Tanto faz", "Odeio"] },
};

/*
 * Temas prontos. O emoji é o nome no Fluent Emoji Flat (/vendor/emoji.svg,
 * gerado por scripts/vendor.mjs a partir de EMOJI_TIER): igual em todo
 * sistema, sem depender da fonte do Linux.
 */
export const TEMAS = {
  boteco: {
    nome: "Petiscos de boteco",
    e: "oden",
    itens: [
      ["Coxinha", "poultry-leg"], ["Pastel", "dumpling"], ["Pão de queijo", "cheese-wedge"], ["Bolinho de bacalhau", "fish"],
      ["Torresmo", "bacon"], ["Batata frita", "french-fries"], ["Mandioca frita", null], ["Calabresa acebolada", "hot-dog"],
      ["Espetinho", "oden"], ["Kibe", null], ["Empada", "pie"], ["Caldinho de feijão", "beans"],
    ],
  },
  pizza: {
    nome: "Sabores de pizza",
    e: "pizza",
    itens: [
      ["Calabresa", "pizza"], ["Margherita", null], ["Portuguesa", null], ["Quatro queijos", "cheese-wedge"],
      ["Frango com catupiry", "poultry-leg"], ["Pepperoni", null], ["Chocolate", "chocolate-bar"], ["Banana com canela", "banana"],
      ["Atum", "fish"], ["Rúcula com tomate seco", null], ["Moda da casa", null], ["Abacaxi", "pineapple"],
    ],
  },
  doces: {
    nome: "Doces de festa",
    e: "birthday-cake",
    itens: [
      ["Brigadeiro", "chocolate-bar"], ["Beijinho", "coconut"], ["Cajuzinho", null], ["Bicho de pé", null],
      ["Olho de sogra", null], ["Pé de moleque", null], ["Paçoca", null], ["Quindim", null],
      ["Bolo de pote", "birthday-cake"], ["Pudim", "custard"], ["Cocada", "coconut"], ["Bem-casado", null],
    ],
  },
  bebidas: {
    nome: "Bebidas",
    e: "tropical-drink",
    itens: [
      ["Café", "hot-beverage"], ["Chimarrão", "mate"], ["Guaraná", null], ["Suco de laranja", "tangerine"],
      ["Água de coco", "coconut"], ["Chá gelado", "bubble-tea"], ["Achocolatado", "chocolate-bar"], ["Refrigerante de cola", null],
      ["Caldo de cana", null], ["Limonada", "lemon"], ["Leite", "glass-of-milk"], ["Energético", "high-voltage"],
    ],
  },
  clima: {
    nome: "Clima e estações",
    e: "sun",
    itens: [
      ["Verão", "sun"], ["Inverno", "snowflake"], ["Outono", "fallen-leaf"], ["Primavera", "cherry-blossom"],
      ["Garoa", "umbrella-with-rain-drops"], ["Tempestade", "cloud-with-lightning-and-rain"], ["Neblina", "fog"], ["Calor de 40°", "hot-pepper"],
      ["Friozinho de 15°", null], ["Dia nublado", "cloud"], ["Ventania", "wind-face"], ["Céu de brigadeiro", null],
    ],
  },
  role: {
    nome: "Programas de fim de semana",
    e: "party-popper",
    itens: [
      ["Praia", "beach-with-umbrella"], ["Churrasco", "meat-on-bone"], ["Maratona de série", "television"], ["Show", "microphone"],
      ["Trilha", "hiking-boot"], ["Shopping", "shopping-bags"], ["Dormir até tarde", "sleeping-face"], ["Videogame", "video-game"],
      ["Cinema", "popcorn"], ["Barzinho", "clinking-beer-mugs"], ["Piquenique", "basket"], ["Faxina", "broom"],
    ],
  },
  firma: {
    nome: "Coisas do trabalho",
    e: "briefcase",
    itens: [
      ["Reunião que podia ser e-mail", "e-mail"], ["Câmera desligada", null], ["\"Você está no mudo\"", "muted-speaker"], ["Compartilhar a tela errada", null],
      ["Daily de uma hora", "hourglass-not-done"], ["Sexta às 17h", null], ["Post-it", "memo"], ["Planilha", "bar-chart"],
      ["Café da firma", "hot-beverage"], ["Happy hour", "clinking-beer-mugs"], ["Prazo pra ontem", "fire"], ["Home office", "house"],
    ],
  },
  bichos: {
    nome: "Bichos de estimação",
    e: "dog-face",
    itens: [
      ["Cachorro", "dog-face"], ["Gato", "cat-face"], ["Peixe", "fish"], ["Hamster", "hamster"],
      ["Papagaio", "parrot"], ["Tartaruga", "turtle"], ["Coelho", "rabbit-face"], ["Cobra", "snake"],
      ["Porquinho-da-índia", "pig-face"], ["Calopsita", "bird"], ["Galinha", "rooster"], ["Vaca no quintal", "cow-face"],
    ],
  },
  poderes: {
    nome: "Superpoderes",
    e: "high-voltage",
    itens: [
      ["Voar", "rocket"], ["Ficar invisível", "ghost"], ["Teletransporte", null], ["Ler mentes", "brain"],
      ["Superforça", "flexed-biceps"], ["Viajar no tempo", "hourglass-not-done"], ["Parar o tempo", "stopwatch"], ["Falar com animais", "parrot"],
      ["Curar qualquer coisa", "red-heart"], ["Respirar debaixo d'água", "fish"], ["Nunca precisar dormir", "sleeping-face"], ["Falar todas as línguas", "speech-balloon"],
    ],
  },
  polemicas: {
    nome: "Opiniões polêmicas",
    e: "hot-pepper",
    itens: [
      ["Abacaxi na pizza", "pineapple"], ["Feijão por cima do arroz", "beans"], ["Banho à noite", null], ["Café sem açúcar", "hot-beverage"],
      ["Ketchup na pizza", null], ["Áudio de 5 minutos", "microphone"], ["Uva-passa no arroz", null], ["Meia com chinelo", null],
      ["Dormir de meia", null], ["Ler o final do livro antes", "open-book"], ["Ligar em vez de mandar mensagem", "telephone-receiver"], ["Leite antes do cereal", "glass-of-milk"],
    ],
  },
};

/** Emoji que dá para escolher para um item (todos os dos temas, mais alguns de sobra). */
export const EMOJI_TIER = [
  ...new Set([
    ...Object.values(TEMAS).flatMap((t) => [t.e, ...t.itens.map((i) => i[1])]),
    "star-struck", "smiling-face-with-heart-eyes", "face-with-tears-of-joy", "thinking-face", "skull", "fire",
    "red-heart", "hundred-points", "crown", "trophy", "gem-stone", "rocket", "video-game", "musical-notes",
    "soccer-ball", "books", "movie-camera", "artist-palette", "camera", "airplane", "automobile", "mobile-phone",
  ]),
].filter(Boolean);

/** Uma cor (de 0 a 359) para o ladrilho de um item, sempre a mesma para o mesmo texto. */
export function matiz(textoItem) {
  let h = 2166136261;
  for (const ch of String(textoItem)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h % 360;
}

/** Preto ou branco, o que se lê melhor sobre a cor (luminância relativa, WCAG). */
export function tintaPara(hex) {
  const c = corOk(hex) || "#888888";
  const lin = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#14121f" : "#ffffff";
}

/** As faixas de um estilo com as cores de uma paleta. */
export function montarFaixas(estilo = "classico", paleta = "classica") {
  const nomes = (ESTILOS[estilo] || ESTILOS.classico).faixas;
  const cores = (PALETAS[paleta] || PALETAS.classica).cores;
  return nomes.map((n, i) => ({ n, c: cores[i % cores.length] }));
}

/* ------------------------------------------------------------------ *
 * O resultado: a tier list da galera e os destaques
 * ------------------------------------------------------------------ */

const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Junta as listas de todo mundo.
 *
 * @param {{id:string}[]} itens
 * @param {number} nTiers
 * @param {{id:string, nome:string, p:Record<string, number>}[]} votos
 * @returns a faixa de cada item pela média (arredondada), a distribuição dos
 *   votos, o desvio (o quanto a turma discordou) e os destaques.
 */
export function resultadoTier(itens, nTiers, votos) {
  const valido = (t) => Number.isInteger(t) && t >= 0 && t < nTiers;
  const escala = Math.max(1, nTiers - 1);
  const porItem = itens.map((it) => {
    const vs = votos.filter((v) => valido(v.p?.[it.id])).map((v) => ({ id: v.id, nome: v.nome, t: v.p[it.id] }));
    const m = vs.length ? media(vs.map((v) => v.t)) : null;
    const desvio = vs.length ? Math.sqrt(media(vs.map((v) => (v.t - m) ** 2))) : 0;
    const dist = Array.from({ length: nTiers }, (_, t) => vs.filter((v) => v.t === t).length);
    // Math.round(1.5) = 2: no empate, o item cai para a faixa de baixo (a galera é exigente).
    return { ...it, votos: vs, media: m, tier: m == null ? null : Math.min(nTiers - 1, Math.round(m)), desvio, dist };
  });
  const faixas = Array.from({ length: nTiers }, (_, t) =>
    porItem.filter((x) => x.tier === t).sort((a, b) => a.media - b.media || b.votos.length - a.votos.length || a.t.localeCompare(b.t)),
  );
  const semVoto = porItem.filter((x) => x.tier == null);

  const comVarios = porItem.filter((x) => x.votos.length >= 2);
  const polemico = comVarios.filter((x) => x.desvio >= 0.5).sort((a, b) => b.desvio - a.desvio || a.t.localeCompare(b.t))[0] || null;
  const unanimes = comVarios.filter((x) => x.desvio === 0 && x.votos.length >= 2).sort((a, b) => a.tier - b.tier);

  // Quanto cada um concorda com a galera, de 0 a 100.
  const pessoas = votos
    .map((v) => {
      const difs = porItem.filter((x) => valido(v.p?.[x.id]) && x.media != null).map((x) => Math.abs(v.p[x.id] - x.media));
      return { id: v.id, nome: v.nome, itens: difs.length, concordancia: difs.length ? Math.round(100 * (1 - media(difs) / escala)) : null };
    })
    .filter((p) => p.itens > 0);

  // Pares: quem pensa mais parecido.
  const pares = [];
  for (let i = 0; i < votos.length; i += 1) {
    for (let j = i + 1; j < votos.length; j += 1) {
      const a = votos[i];
      const b = votos[j];
      const difs = itens.filter((it) => valido(a.p?.[it.id]) && valido(b.p?.[it.id])).map((it) => Math.abs(a.p[it.id] - b.p[it.id]));
      if (difs.length) pares.push({ a: { id: a.id, nome: a.nome }, b: { id: b.id, nome: b.nome }, itens: difs.length, afinidade: Math.round(100 * (1 - media(difs) / escala)) });
    }
  }
  pares.sort((x, y) => y.afinidade - x.afinidade || y.itens - x.itens);
  const almasGemeas = pares[0] || null;
  const doContra = pessoas.length >= 3 ? [...pessoas].sort((a, b) => a.concordancia - b.concordancia)[0] : null;

  return { porItem, faixas, semVoto, polemico, unanimes, pessoas, pares, almasGemeas, doContra };
}

/* ------------------------------------------------------------------ *
 * Enquete com notas: perguntas, escala, nota mínima de cada faixa
 * ------------------------------------------------------------------ */

export const MAX_PERGUNTAS = 8;
const MAX_PERGUNTA = 60;
export const MODOS = { arrastar: "Arrastar", notas: "Enquete com notas" };
/** As escalas de nota. A de estrelas começa em 1 (não existe "zero estrela"). */
export const ESCALAS = { 10: { nome: "0 a 10", min: 0, max: 10 }, 5: { nome: "1 a 5 estrelas", min: 1, max: 5 } };
/** Perguntas prontas para tocar e pôr. */
export const PERGUNTAS_PRONTAS = ["Gosto pessoal", "Qualidade", "Sabor", "Aparência", "Custo-benefício", "Originalidade", "Diversão", "Utilidade", "Nostalgia", "Vale a pena?"];
const TEMAS_DE_COMER = new Set(["boteco", "pizza", "doces", "bebidas"]);
/** As perguntas com que a enquete começa, conforme o tema. */
export const perguntasIniciais = (tema) => (TEMAS_DE_COMER.has(tema) ? ["Sabor", "Aparência", "Custo-benefício"] : ["Gosto pessoal", "Qualidade", "Originalidade"]).map((t) => ({ t, w: 1 }));

const arred = (x) => Math.round(x * 10) / 10;

/**
 * A nota mínima de cada faixa, de cima para baixo, dividindo a escala em
 * partes iguais. 5 faixas de 0 a 10: S ≥ 8, A ≥ 6, B ≥ 4, C ≥ 2, D ≥ 0.
 */
export function cortesPadrao(n, escala = 10) {
  const { min, max } = ESCALAS[escala] || ESCALAS[10];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? min : arred(max - ((i + 1) * (max - min)) / n)));
}

/** A faixa de uma nota: a primeira (de cima) cuja nota mínima ela alcança. */
export function faixaPorNota(nota, cortes) {
  if (nota == null || !Number.isFinite(nota)) return null;
  for (let i = 0; i < cortes.length; i += 1) if (nota >= cortes[i] - 1e-9) return i;
  return cortes.length - 1;
}

/** As notas de uma pessoa num item -> a nota do item (média ponderada das perguntas respondidas). */
export function notaDoItem(respostas, perguntas, escala = 10) {
  const { min, max } = ESCALAS[escala] || ESCALAS[10];
  if (!Array.isArray(respostas)) return null;
  let soma = 0;
  let pesos = 0;
  perguntas.forEach((q, i) => {
    const v = respostas[i];
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) {
      soma += v * q.w;
      pesos += q.w;
    }
  });
  return pesos ? soma / pesos : null;
}

/** Respondeu todas as perguntas deste item? */
export const completo = (respostas, perguntas) => Array.isArray(respostas) && perguntas.every((_, i) => typeof respostas[i] === "number");

/**
 * O resultado da enquete. Cada pessoa dá uma nota a cada item (a média
 * ponderada das perguntas); a nota do item é a média das pessoas, e a faixa
 * vem da nota mínima de cada uma (`cortes`). Os destaques são os mesmos da
 * tier list arrastada, medidos em nota, e mais o melhor de cada pergunta.
 */
export function resultadoNotas(itens, nTiers, perguntas, escala, cortes, votos) {
  const { min, max } = ESCALAS[escala] || ESCALAS[10];
  const faixa = (vNota) => faixaPorNota(vNota, cortes);
  const amp = Math.max(1, max - min);
  const notaDe = (v, id) => notaDoItem(v.p?.[id], perguntas, escala);
  const porItem = itens.map((it) => {
    const vs = votos.map((v) => ({ id: v.id, nome: v.nome, nota: notaDe(v, it.id), r: v.p?.[it.id] })).filter((x) => x.nota != null);
    const m = vs.length ? media(vs.map((x) => x.nota)) : null;
    const desvio = vs.length ? Math.sqrt(media(vs.map((x) => (x.nota - m) ** 2))) : 0;
    const dist = Array.from({ length: nTiers }, (_, t) => vs.filter((x) => faixa(x.nota) === t).length);
    const porPergunta = perguntas.map((_, q) => {
      const ns = vs.map((x) => x.r?.[q]).filter((n) => typeof n === "number" && n >= min && n <= max);
      return ns.length ? media(ns) : null;
    });
    return { ...it, votos: vs.map((x) => ({ id: x.id, nome: x.nome, t: faixa(x.nota), nota: x.nota })), nota: m, media: m, tier: faixa(m), desvio, dist, porPergunta };
  });
  const faixas = Array.from({ length: nTiers }, (_, t) => porItem.filter((x) => x.tier === t).sort((a, b) => b.nota - a.nota || a.t.localeCompare(b.t)));
  const semVoto = porItem.filter((x) => x.tier == null);
  const comVarios = porItem.filter((x) => x.votos.length >= 2);
  const polemico = comVarios.filter((x) => x.desvio / amp >= 0.15).sort((a, b) => b.desvio - a.desvio || a.t.localeCompare(b.t))[0] || null;
  const unanimes = comVarios.filter((x) => x.desvio / amp <= 0.05).sort((a, b) => b.nota - a.nota);
  const pessoas = votos
    .map((v) => {
      const difs = porItem.filter((x) => x.nota != null && notaDe(v, x.id) != null).map((x) => Math.abs(notaDe(v, x.id) - x.nota));
      return { id: v.id, nome: v.nome, itens: difs.length, concordancia: difs.length ? Math.round(100 * (1 - media(difs) / amp)) : null };
    })
    .filter((x) => x.itens > 0);
  const pares = [];
  for (let i = 0; i < votos.length; i += 1) {
    for (let j = i + 1; j < votos.length; j += 1) {
      const a = votos[i];
      const b = votos[j];
      const difs = itens.map((it) => [notaDe(a, it.id), notaDe(b, it.id)]).filter(([x, y]) => x != null && y != null).map(([x, y]) => Math.abs(x - y));
      if (difs.length) pares.push({ a: { id: a.id, nome: a.nome }, b: { id: b.id, nome: b.nome }, itens: difs.length, afinidade: Math.round(100 * (1 - media(difs) / amp)) });
    }
  }
  pares.sort((x, y) => y.afinidade - x.afinidade || y.itens - x.itens);
  const melhores = perguntas
    .map((q, i) => {
      const top = porItem.filter((x) => x.porPergunta[i] != null).sort((a, b) => b.porPergunta[i] - a.porPergunta[i])[0];
      return top ? { pergunta: q.t, item: top, nota: top.porPergunta[i] } : null;
    })
    .filter(Boolean);
  const comNota = porItem.filter((x) => x.nota != null).sort((a, b) => b.nota - a.nota);
  return {
    porItem,
    faixas,
    semVoto,
    polemico,
    unanimes,
    pessoas,
    pares,
    almasGemeas: pares[0] || null,
    doContra: pessoas.length >= 3 ? [...pessoas].sort((a, b) => a.concordancia - b.concordancia)[0] : null,
    melhores,
    campeao: comNota[0] || null,
    lanterna: comNota.length > 1 ? comNota[comNota.length - 1] : null,
  };
}

/* ------------------------------------------------------------------ *
 * Imagens dos itens
 * ------------------------------------------------------------------ */

/*
 * A foto de um item vira uma miniatura (ui/tierlist.js) e viaja no mesmo
 * estado compartilhado, em pedaços de até PEDACO_IMG caracteres
 * (`tl/im/<item>/<k>`): cada valor do estado tem um limite de tamanho, e
 * assim quem entra no meio recebe as imagens junto com o resto.
 */
export const PEDACO_IMG = 3400;
export const MAX_PEDACOS_IMG = 5;
const IMAGEM_OK = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
export const imagemValida = (url) => typeof url === "string" && url.length <= PEDACO_IMG * MAX_PEDACOS_IMG && IMAGEM_OK.test(url);

/* ------------------------------------------------------------------ *
 * O jogo
 * ------------------------------------------------------------------ */

/** sessionStorage pode não existir (testes) ou recusar (aba privada). */
function guardarNaAba(chave, valor) {
  try {
    globalThis.sessionStorage?.setItem(chave, JSON.stringify(valor));
  } catch {
    /* só não sobrevive a recarregar */
  }
}
function lerDaAba(chave) {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(chave) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Uma das partes da configuração (`tl/titulo`, `tl/nomes`, `tl/cores`), só se for desta lista. */
const daLista = (v, l) => (v && typeof v === "object" && v.l === l ? v : null);

export class TierList extends Emitter {
  /** A minha lista, escondida até revelar: { l, r, p: { item: faixa } } */
  #meu = lerDaAba("vcall:tl");
  #pedida = "";
  /** Imagens já montadas: item -> { v, url }. */
  #imagens = new Map();

  constructor(estado, { nome = () => "", agora = () => Date.now() } = {}) {
    super();
    this.estado = estado;
    this.nome = nome;
    this.agora = agora;
    estado.on("mudou", () => this.publicarSegredos());
  }
  get eu() {
    return this.estado.eu;
  }

  /* ----------------------------- leitura ----------------------------- */

  cfg() {
    const c = this.estado.ler("tl/cfg");
    if (!c || typeof c.l !== "string" || !c.l) return null;
    const l = c.l;
    const tema = TEMAS[c.tema] ? c.tema : null;
    const titulo = texto(daLista(this.estado.ler("tl/titulo"), l)?.t, MAX_TITULO) || (tema ? TEMAS[tema].nome : "Minha tier list");
    const nomes = daLista(this.estado.ler("tl/nomes"), l);
    const cores = daLista(this.estado.ler("tl/cores"), l);
    let ns = Array.isArray(nomes?.v) ? nomes.v.slice(0, MAX_TIERS).map((n) => texto(n, MAX_NOME_TIER)) : [];
    if (ns.length < MIN_TIERS) ns = [...ESTILOS.classico.faixas];
    const paleta = PALETAS[cores?.paleta] ? cores.paleta : null;
    const reserva = (PALETAS[paleta] || PALETAS.classica).cores;
    const tiers = ns.map((n, i) => ({ n, c: corOk(Array.isArray(cores?.v) ? cores.v[i] : null) || reserva[i % reserva.length] }));
    const modo = daLista(this.estado.ler("tl/modo"), l)?.m === "notas" ? "notas" : "arrastar";
    /*
     * Cada pergunta mora na sua chave (`tl/q/<id>`), e a escala em outra:
     * mudar o peso de uma enquanto alguém cria outra não apaga nada. Ao
     * começar a votar, a lista é congelada na rodada (`tl/fase`), para todo
     * mundo responder exatamente as mesmas perguntas.
     */
    const f = this.estado.ler("tl/fase");
    const congelada = f && f.l === l && f.f === "ranquear" && Array.isArray(f.q) ? f : null;
    const limparQ = (q) => ({ t: texto(q?.t, MAX_PERGUNTA).trim(), w: [1, 2, 3].includes(q?.w) ? q.w : 1 });
    let perguntas;
    let escala;
    if (congelada) {
      perguntas = congelada.q.slice(0, MAX_PERGUNTAS).map(limparQ).filter((q) => q.t);
      escala = ESCALAS[congelada.e] ? Number(congelada.e) : 10;
    } else {
      const qs = [...this.estado.com("tl/q/")].filter(([, v]) => v && v.l === l);
      perguntas = qs.length
        ? qs
            .sort(([ka, a], [kb, b]) => (Number(a.em) || 0) - (Number(b.em) || 0) || ka.localeCompare(kb))
            .slice(0, MAX_PERGUNTAS)
            .map(([k, v]) => ({ id: k.slice(5), ...limparQ(v) }))
            .filter((q) => q.t)
        : perguntasIniciais(tema);
      const e = daLista(this.estado.ler("tl/escala"), l)?.e;
      escala = ESCALAS[e] ? Number(e) : 10;
    }
    const ct = daLista(this.estado.ler("tl/cortes"), l);
    const { min, max } = ESCALAS[escala];
    const cortesOk =
      Array.isArray(ct?.v) && ct.escala === escala && ct.v.length === tiers.length && ct.v.every((x, i) => typeof x === "number" && x >= min && x <= max && (i === 0 || x <= ct.v[i - 1]));
    const cortes = cortesOk ? ct.v.map(Number) : cortesPadrao(tiers.length, escala);
    return { l, titulo, tiers, estilo: ESTILOS[nomes?.estilo] ? nomes.estilo : null, paleta, tema, modo, perguntas, escala, cortes, cortesAuto: !cortesOk };
  }

  /** A fase da lista atual: montar (r = rodadas já jogadas) ou ranquear (r = esta rodada). */
  fase() {
    const c = this.cfg();
    if (!c) return null;
    const f = this.estado.ler("tl/fase");
    if (!f || f.l !== c.l || !Number.isSafeInteger(f.r) || (f.f !== "montar" && f.f !== "ranquear")) return { l: c.l, r: 0, f: "montar", m: c.modo };
    // O modo da rodada fica gravado ao começar: mudar na montagem não estraga uma rodada em andamento.
    return { l: c.l, r: f.r, f: f.f, m: f.f === "ranquear" ? (f.m === "notas" ? "notas" : "arrastar") : c.modo };
  }

  itens() {
    const c = this.cfg();
    if (!c) return [];
    return [...this.estado.com("tl/it/")]
      .filter(([, v]) => v && v.l === c.l && typeof v.t === "string" && v.t.trim())
      .map(([k, v]) => {
        const id = k.slice(6);
        const it = { id, t: texto(v.t, MAX_ITEM), e: EMOJI_TIER.includes(v.e) ? v.e : null, h: Number.isInteger(v.h) ? ((v.h % 360) + 360) % 360 : matiz(v.t), em: Number(v.em) || 0, img: null };
        if (v.img && Number.isInteger(v.img.n) && v.img.n > 0 && v.img.n <= MAX_PEDACOS_IMG && typeof v.img.v === "string") it.img = this.imagem(id, v.img);
        return it;
      })
      .sort((a, b) => a.em - b.em || a.id.localeCompare(b.id));
  }

  /** A imagem de um item, montada dos pedaços (null enquanto não chegaram todos). */
  imagem(id, ref) {
    const guardada = this.#imagens.get(id);
    if (guardada && guardada.v === ref.v) return guardada.url;
    const partes = [];
    for (let k = 0; k < ref.n; k += 1) {
      const p = this.estado.ler(`tl/im/${id}/${k}`);
      if (!p || p.v !== ref.v || typeof p.d !== "string") return null;
      partes.push(p.d);
    }
    const url = partes.join("");
    if (!imagemValida(url)) return null;
    this.#imagens.set(id, { v: ref.v, url });
    return url;
  }

  revelada(f = this.fase()) {
    if (!f || f.f !== "ranquear") return false;
    const rev = this.estado.ler("tl/rev");
    return !!rev && rev.l === f.l && rev.r === f.r;
  }

  /** A minha lista nesta rodada: { item: faixa }. */
  minha(f = this.fase()) {
    if (!f || f.f !== "ranquear" || !this.#meu || this.#meu.l !== f.l || this.#meu.r !== f.r) return {};
    return { ...(this.#meu.p || {}) };
  }

  /** O progresso de cada um nesta rodada (não diz onde ninguém colocou nada). */
  progresso(f = this.fase()) {
    if (!f) return [];
    return [...this.estado.com("tl/pr/")]
      .filter(([, v]) => v && v.l === f.l && v.r === f.r)
      .map(([k, v]) => ({ id: k.slice(6), nome: texto(v.nome, 40), k: Number(v.k) || 0, ok: !!v.ok }));
  }

  /** As listas publicadas depois da revelação. */
  listas(f = this.fase()) {
    if (!f || !this.revelada(f)) return [];
    return [...this.estado.com("tl/val/")]
      .filter(([, v]) => v && v.l === f.l && v.r === f.r && v.p && typeof v.p === "object")
      .map(([k, v]) => ({ id: k.slice(7), nome: texto(v.nome, 40), p: v.p }));
  }

  /* ------------------------------ montar ------------------------------ */

  /** Começa uma tier list nova, de um tema pronto ou vazia. */
  nova(tema = null, { estilo = "classico", paleta = "classica", titulo = "" } = {}) {
    const t = TEMAS[tema] ? tema : null;
    const l = novoId();
    const agora = this.agora();
    const e = ESTILOS[estilo] ? estilo : "classico";
    const p = PALETAS[paleta] ? paleta : "classica";
    const faixas = montarFaixas(e, p);
    const pares = [
      ["tl/cfg", { l, tema: t }],
      ["tl/titulo", { l, t: texto(String(titulo || "").trim(), MAX_TITULO) || (t ? TEMAS[t].nome : "Minha tier list") }],
      ["tl/nomes", { l, v: faixas.map((x) => x.n), estilo: e }],
      ["tl/cores", { l, v: faixas.map((x) => x.c), paleta: p }],
      ["tl/fase", { l, r: 0, f: "montar" }],
    ];
    if (t) TEMAS[t].itens.forEach(([nome, e], i) => pares.push([`tl/it/${novoId()}`, { l, t: nome, e: e || null, h: matiz(nome), em: agora + i }]));
    this.#meu = null;
    this.estado.definir(pares);
    return l;
  }

  /*
   * Título, nomes e cores das faixas moram em chaves separadas: se uma
   * pessoa troca a paleta enquanto outra renomeia uma faixa, as duas
   * mudanças ficam (numa chave só, a última apagaria a outra).
   */
  #pode() {
    const c = this.cfg();
    return c && this.fase().f === "montar" ? c : null;
  }

  #gravarNomes(c, v, estilo = null) {
    this.estado.definir([["tl/nomes", { l: c.l, v, estilo }]]);
    return true;
  }

  #gravarCores(c, v, paleta = null) {
    this.estado.definir([["tl/cores", { l: c.l, v, paleta }]]);
    return true;
  }

  titulo(t) {
    const c = this.#pode();
    const limpo = String(t ?? "").trim().slice(0, MAX_TITULO);
    if (!c || !limpo || limpo === c.titulo) return false;
    this.estado.definir([["tl/titulo", { l: c.l, t: limpo }]]);
    return true;
  }

  /** Troca os nomes das faixas pelos de um estilo (a quantidade de faixas segue o estilo). */
  estilo(id) {
    const c = this.#pode();
    if (!c || !ESTILOS[id]) return false;
    const nomes = ESTILOS[id].faixas;
    const cores = (PALETAS[c.paleta] || PALETAS.classica).cores;
    this.estado.definir([
      ["tl/nomes", { l: c.l, v: [...nomes], estilo: id }],
      ["tl/cores", { l: c.l, v: nomes.map((_, i) => c.tiers[i]?.c || cores[i % cores.length]), paleta: c.paleta }],
    ]);
    return true;
  }

  /** Pinta as faixas com uma paleta, sem mexer nos nomes. */
  paleta(id) {
    const c = this.#pode();
    const p = PALETAS[id];
    if (!c || !p) return false;
    return this.#gravarCores(c, c.tiers.map((_, i) => p.cores[i % p.cores.length]), id);
  }

  renomearFaixa(i, nome) {
    const c = this.#pode();
    const n = String(nome ?? "").trim().slice(0, MAX_NOME_TIER);
    if (!c || !c.tiers[i] || c.tiers[i].n === n) return false;
    return this.#gravarNomes(c, c.tiers.map((x, j) => (j === i ? n : x.n)));
  }

  pintarFaixa(i, cor) {
    const c = this.#pode();
    const c2 = corOk(cor);
    if (!c || !c2 || !c.tiers[i]) return false;
    return this.#gravarCores(c, c.tiers.map((x, j) => (j === i ? c2 : x.c)));
  }

  /** Mudança de estrutura (pôr, tirar, mover faixa): nomes e cores juntos. */
  #faixas(c, tiers) {
    if (tiers.length < MIN_TIERS || tiers.length > MAX_TIERS) return false;
    this.estado.definir([
      ["tl/nomes", { l: c.l, v: tiers.map((x) => x.n), estilo: null }],
      ["tl/cores", { l: c.l, v: tiers.map((x) => x.c), paleta: c.paleta }],
    ]);
    return true;
  }

  novaFaixa() {
    const c = this.#pode();
    if (!c) return false;
    const cores = (PALETAS[c.paleta] || PALETAS.classica).cores;
    return this.#faixas(c, [...c.tiers, { n: "Nova", c: cores[c.tiers.length % cores.length] }]);
  }

  removerFaixa(i) {
    const c = this.#pode();
    if (!c || !c.tiers[i]) return false;
    return this.#faixas(c, c.tiers.filter((_, j) => j !== i));
  }

  /** Sobe (-1) ou desce (+1) uma faixa. */
  moverFaixa(i, d) {
    const c = this.#pode();
    const j = i + d;
    if (!c || !c.tiers[i] || !c.tiers[j]) return false;
    const t = [...c.tiers];
    [t[i], t[j]] = [t[j], t[i]];
    return this.#faixas(c, t);
  }

  /* ------------------------- enquete com notas ------------------------- */

  /** Arrastar (cada um monta a lista) ou enquete com notas (a nota decide a faixa). */
  modo(m) {
    const c = this.#pode();
    if (!c || !MODOS[m] || c.modo === m) return false;
    const pares = [["tl/modo", { l: c.l, m }]];
    // A primeira vez na enquete: as perguntas iniciais ganham as suas chaves (todos veem as mesmas).
    if (m === "notas" && !c.perguntas.some((q) => q.id)) c.perguntas.forEach((q, i) => pares.push([`tl/q/${novoId()}`, { l: c.l, t: q.t, w: q.w, em: this.agora() + i }]));
    this.estado.definir(pares);
    return true;
  }

  /** As perguntas, com as chaves criadas se ainda são as iniciais. */
  #perguntas() {
    const c = this.#pode();
    if (!c) return null;
    if (!c.perguntas.some((q) => q.id)) {
      this.estado.definir(c.perguntas.map((q, i) => [`tl/q/${novoId()}`, { l: c.l, t: q.t, w: q.w, em: this.agora() + i }]));
    }
    return this.cfg();
  }

  novaPergunta(t) {
    const c = this.#perguntas();
    const q = String(t ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_PERGUNTA);
    if (!c || !q || c.perguntas.length >= MAX_PERGUNTAS || c.perguntas.some((x) => x.t.toLowerCase() === q.toLowerCase())) return false;
    // Sempre no fim, mesmo com o relógio de alguém atrasado.
    const ultima = Math.max(0, ...[...this.estado.com("tl/q/")].filter(([, v]) => v?.l === c.l).map(([, v]) => Number(v.em) || 0));
    this.estado.definir([[`tl/q/${novoId()}`, { l: c.l, t: q, w: 1, em: Math.max(this.agora(), ultima + 1) }]]);
    return true;
  }

  removerPergunta(i) {
    const c = this.#perguntas();
    if (!c || !c.perguntas[i]?.id || c.perguntas.length <= 1) return false;
    this.estado.definir([[`tl/q/${c.perguntas[i].id}`, null]]);
    return true;
  }

  /** O peso de uma pergunta: 1, 2 ou 3 (vale em dobro, em triplo). */
  pesoPergunta(i, w) {
    const c = this.#perguntas();
    const q = c?.perguntas[i];
    if (!q?.id || ![1, 2, 3].includes(w)) return false;
    const atual = this.estado.ler(`tl/q/${q.id}`);
    this.estado.definir([[`tl/q/${q.id}`, { ...atual, w }]]);
    return true;
  }

  /** Troca a escala (0 a 10 ou 1 a 5): as notas mínimas voltam a ser as automáticas. */
  escala(e) {
    const c = this.#pode();
    const n = Number(e);
    if (!c || !ESCALAS[n] || c.escala === n) return false;
    this.estado.definir([["tl/escala", { l: c.l, e: n }]]);
    return true;
  }

  /** A nota mínima de uma faixa. As de baixo nunca ficam acima das de cima. */
  corte(i, valor) {
    const c = this.#pode();
    const { min, max } = ESCALAS[c?.escala] || ESCALAS[10];
    const x = arred(Number(String(valor).replace(",", ".")));
    if (!c || !c.tiers[i] || !Number.isFinite(x) || i === c.tiers.length - 1) return false;
    const v = [...c.cortes];
    v[i] = Math.min(max, Math.max(min, x));
    for (let j = i - 1; j >= 0; j -= 1) v[j] = Math.max(v[j], v[j + 1]);
    for (let j = i + 1; j < v.length; j += 1) v[j] = Math.min(v[j], v[j - 1]);
    v[v.length - 1] = min;
    this.estado.definir([["tl/cortes", { l: c.l, v, escala: c.escala }]]);
    return true;
  }

  /** Volta as notas mínimas para a divisão em partes iguais. */
  cortesAuto() {
    const c = this.#pode();
    if (!c) return false;
    this.estado.definir([["tl/cortes", null]]);
    return true;
  }

  /* ------------------------------- itens ------------------------------- */

  /** Um item novo, com emoji ou imagem (uma miniatura em data URL, ver ui/tierlist.js). */
  novoItem(nome, e = null, imagem = null) {
    const c = this.cfg();
    const f = this.fase();
    const t = String(nome ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ITEM);
    if (!c || f.f !== "montar" || !t) return null;
    const itens = this.itens();
    if (itens.length >= MAX_ITENS || itens.some((x) => x.t.toLowerCase() === t.toLowerCase())) return null;
    if (imagem != null && !imagemValida(imagem)) return null;
    const id = novoId();
    const item = { l: c.l, t, e: EMOJI_TIER.includes(e) ? e : null, h: matiz(t), em: this.agora() };
    this.estado.definir([...this.#pedacos(id, imagem, item), [`tl/it/${id}`, item]]);
    return id;
  }

  /** Põe, troca ou tira (null) a imagem de um item. */
  imagemItem(id, imagem) {
    const it = this.estado.ler(`tl/it/${id}`);
    if (this.fase()?.f !== "montar" || !this.itens().some((x) => x.id === id)) return false;
    if (imagem != null && !imagemValida(imagem)) return false;
    const novo = { ...it };
    const pares = this.#pedacos(id, imagem, novo);
    if (imagem == null) {
      for (let k = 0; k < (it.img?.n || 0); k += 1) pares.push([`tl/im/${id}/${k}`, null]);
      delete novo.img;
    }
    this.estado.definir([...pares, [`tl/it/${id}`, novo]]);
    return true;
  }

  /** Os pedaços da imagem (primeiro), e a referência no item. */
  #pedacos(id, imagem, item) {
    if (imagem == null) return [];
    const v = novoId().slice(0, 6);
    const pares = [];
    for (let k = 0; k * PEDACO_IMG < imagem.length; k += 1) pares.push([`tl/im/${id}/${k}`, { l: item.l, v, d: imagem.slice(k * PEDACO_IMG, (k + 1) * PEDACO_IMG) }]);
    item.img = { n: pares.length, v };
    return pares;
  }

  removerItem(id) {
    if (this.fase()?.f !== "montar" || !this.itens().some((x) => x.id === id)) return false;
    const it = this.estado.ler(`tl/it/${id}`);
    const pares = [[`tl/it/${id}`, null]];
    for (let k = 0; k < (it?.img?.n || 0); k += 1) pares.push([`tl/im/${id}/${k}`, null]);
    this.estado.definir(pares);
    this.#imagens.delete(id);
    return true;
  }

  /* ----------------------------- ranquear ----------------------------- */

  comecar() {
    const f = this.fase();
    const c = this.cfg();
    if (!f || f.f !== "montar" || this.itens().length < 2 || (c.modo === "notas" && !c.perguntas.length)) return false;
    this.#meu = { l: f.l, r: f.r + 1, p: {} };
    guardarNaAba("vcall:tl", this.#meu);
    // Na enquete, perguntas e escala ficam congeladas na rodada (todos votam nas mesmas).
    const rodada = { l: f.l, r: f.r + 1, f: "ranquear", m: c.modo };
    if (c.modo === "notas") Object.assign(rodada, { q: c.perguntas.map(({ t, w }) => ({ t, w })), e: c.escala });
    this.estado.definir([["tl/fase", rodada]]);
    return true;
  }

  /** Volta para a montagem (mexer nos itens e faixas e ranquear de novo). */
  voltarAMontar() {
    const f = this.fase();
    if (!f || f.f !== "ranquear") return false;
    this.estado.definir([["tl/fase", { l: f.l, r: f.r, f: "montar" }]]);
    return true;
  }

  /** Põe um item numa faixa (ou de volta no banco, com `faixa` nula). */
  colocar(item, faixa) {
    const f = this.fase();
    const c = this.cfg();
    if (!f || f.f !== "ranquear" || f.m !== "arrastar" || this.revelada(f) || !this.itens().some((x) => x.id === item)) return false;
    if (faixa != null && !(Number.isInteger(faixa) && faixa >= 0 && faixa < c.tiers.length)) return false;
    if (!this.#meu || this.#meu.l !== f.l || this.#meu.r !== f.r) this.#meu = { l: f.l, r: f.r, p: {} };
    const p = { ...this.#meu.p };
    if (faixa == null) delete p[item];
    else p[item] = faixa;
    this.#meu = { ...this.#meu, p };
    guardarNaAba("vcall:tl", this.#meu);
    this.#publicarProgresso(false);
    return true;
  }

  /** Enquete: a minha nota para a pergunta `q` de um item (null apaga). */
  avaliar(item, q, valor) {
    const f = this.fase();
    const c = this.cfg();
    if (!f || f.f !== "ranquear" || f.m !== "notas" || this.revelada(f) || !this.itens().some((x) => x.id === item) || !c.perguntas[q]) return false;
    const { min, max } = ESCALAS[c.escala];
    if (valor != null && !(Number.isInteger(valor) && valor >= min && valor <= max)) return false;
    if (!this.#meu || this.#meu.l !== f.l || this.#meu.r !== f.r) this.#meu = { l: f.l, r: f.r, p: {} };
    const r = Array.from({ length: c.perguntas.length }, (_, i) => (Array.isArray(this.#meu.p[item]) ? (this.#meu.p[item][i] ?? null) : null));
    r[q] = valor;
    const p = { ...this.#meu.p, [item]: r };
    if (r.every((x) => x == null)) delete p[item];
    this.#meu = { ...this.#meu, p };
    guardarNaAba("vcall:tl", this.#meu);
    this.#publicarProgresso(false);
    return true;
  }

  /** Tudo de volta para o banco. */
  limpar() {
    const f = this.fase();
    if (!f || f.f !== "ranquear" || this.revelada(f)) return false;
    this.#meu = { l: f.l, r: f.r, p: {} };
    guardarNaAba("vcall:tl", this.#meu);
    this.#publicarProgresso(false);
    return true;
  }

  pronto(ok = true) {
    const f = this.fase();
    if (!f || f.f !== "ranquear" || this.revelada(f)) return false;
    this.#publicarProgresso(!!ok);
    return true;
  }

  #publicarProgresso(ok) {
    const f = this.fase();
    const ids = new Set(this.itens().map((x) => x.id));
    const perguntas = this.cfg().perguntas;
    const k = Object.entries(this.minha(f)).filter(([id, v]) => ids.has(id) && (f.m !== "notas" || completo(v, perguntas))).length;
    this.estado.definir([[`tl/pr/${this.eu}`, { l: f.l, r: f.r, k, ok, nome: this.nome().slice(0, 40) }]]);
  }

  revelar() {
    const f = this.fase();
    if (!f || f.f !== "ranquear" || this.revelada(f)) return false;
    this.estado.definir([["tl/rev", { l: f.l, r: f.r }]]);
    return true;
  }

  /** Revelado: publico a minha lista (uma vez por rodada). */
  publicarSegredos() {
    const f = this.fase();
    if (!f || !this.revelada(f)) return;
    const meu = this.minha(f);
    const ids = new Set(this.itens().map((x) => x.id));
    const p = Object.fromEntries(Object.entries(meu).filter(([id, v]) => ids.has(id) && (f.m === "notas" ? Array.isArray(v) : Number.isInteger(v))));
    if (!Object.keys(p).length) return;
    const atual = this.estado.ler(`tl/val/${this.eu}`);
    if (atual && atual.l === f.l && atual.r === f.r && JSON.stringify(atual.p) === JSON.stringify(p)) return;
    this.estado.definir([[`tl/val/${this.eu}`, { l: f.l, r: f.r, p, nome: this.nome().slice(0, 40) }]]);
  }

  /** Todo mundo presente deu "Pronto!": o líder revela. */
  manter(pessoas = []) {
    const f = this.fase();
    if (!f || f.f !== "ranquear" || this.revelada(f)) return;
    const chave = `${f.l}/${f.r}`;
    if (this.#pedida === chave) return;
    const prontos = new Set(this.progresso(f).filter((p) => p.ok).map((p) => p.id));
    if (pessoas.length >= 1 && pessoas.every((p) => prontos.has(p.id)) && lider(pessoas) === this.eu) {
      this.#pedida = chave;
      this.revelar();
    }
  }

  /* ------------------------------- tela ------------------------------- */

  vista(pessoas = []) {
    const c = this.cfg();
    const f = this.fase();
    if (!c) return { fase: "lobby" };
    const itens = this.itens();
    const base = { l: c.l, r: f.r, cfg: c, itens, modo: f.m };
    if (f.f === "montar") return { ...base, fase: "montar" };
    const progresso = this.progresso(f);
    const notas = f.m === "notas";
    if (!this.revelada(f)) {
      const minha = this.minha(f);
      return {
        ...base,
        fase: "ranquear",
        minha,
        colocados: itens.filter((x) => (notas ? completo(minha[x.id], c.perguntas) : minha[x.id] != null)).length,
        progresso: pessoas.map((p) => ({ ...p, ...(progresso.find((x) => x.id === p.id) || { k: 0, ok: false }) })),
        euPronto: !!progresso.find((x) => x.id === this.eu)?.ok,
      };
    }
    const listas = this.listas(f).map((x) => {
      const nome = pessoas.find((p) => p.id === x.id)?.nome || x.nome || "Alguém";
      if (!notas) return { ...x, nome, pt: x.p };
      // Enquete: a faixa de cada item na lista desta pessoa sai da nota dela.
      const nt = {};
      const pt = {};
      for (const it of itens) {
        const n = notaDoItem(x.p[it.id], c.perguntas, c.escala);
        if (n == null) continue;
        nt[it.id] = n;
        pt[it.id] = faixaPorNota(n, c.cortes);
      }
      return { ...x, nome, pt, notas: nt };
    });
    const res = notas ? resultadoNotas(itens, c.tiers.length, c.perguntas, c.escala, c.cortes, listas) : resultadoTier(itens, c.tiers.length, listas);
    return { ...base, fase: "revelada", listas, minha: this.minha(f), res };
  }
}
