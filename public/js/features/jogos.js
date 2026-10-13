/**
 * features/jogos.js — os jogos de equipe: Planning Poker, Retrospectiva e
 * Daily. Só a lógica; o desenho fica em ui/jogos.js.
 *
 * UM ESTADO SÓ, IGUAL EM TODO MUNDO, SEM SERVIDOR NOVO
 *
 * Tudo o que os jogos precisam lembrar mora num mapa chave → valor, copiado
 * em cada participante. Cada escrita leva um carimbo (relógio de Lamport +
 * id de quem escreveu) e, quando duas escritas disputam a mesma chave, vence
 * a de carimbo maior — em todo computador, na mesma ordem. Isso faz a fusão
 * ser comutativa e idempotente: receber a mesma escrita duas vezes, fora de
 * ordem, ou por dois caminhos (canal direto e servidor) dá o mesmo resultado.
 * Quem entra no meio recebe o mapa de quem já estava e chega ao mesmo estado.
 *
 * As mensagens são minúsculas (uma ou duas chaves por clique) e vão pelo
 * mesmo canal do quadro branco — nenhuma conexão nova.
 *
 * VOTO ESCONDIDO DE VERDADE
 *
 * No Planning Poker, antes da revelação só viaja "fulano votou". O valor fica
 * no computador de quem votou e só é publicado quando alguém revela. Na
 * Retrospectiva é igual com o texto das notas na fase de escrita. Ninguém
 * espia o voto dos outros pelo console.
 */
import { Emitter } from "../lib/emitter.js";

/* ------------------------------------------------------------------ *
 * O estado compartilhado
 * ------------------------------------------------------------------ */

const CHAVE_OK = /^[a-z]+(?:\/[A-Za-z0-9_.:-]{1,64}){0,4}$/;
const MAX_CHAVES = 4000;
const MAX_TEXTO = 600;

/** Valor aceitável vindo de outro participante: pequeno e sem funções. */
function valorOk(v) {
  if (v == null || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.length <= MAX_TEXTO;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).length <= 4000;
    } catch {
      return false;
    }
  }
  return false;
}

export class EstadoJogos extends Emitter {
  /** chave -> { v, c, a } */
  mapa = new Map();
  relogio = 0;

  constructor({ eu = "eu" } = {}) {
    super();
    this.eu = String(eu);
  }

  ler(chave, padrao = null) {
    const e = this.mapa.get(chave);
    return e === undefined || e.v === null ? padrao : e.v;
  }

  /** Entradas cuja chave começa com `prefixo` (valores nulos ficam de fora). */
  *com(prefixo) {
    for (const [k, e] of this.mapa) if (k.startsWith(prefixo) && e.v !== null) yield [k, e.v];
  }

  /** Escreve localmente e avisa para mandar aos outros. `pares`: [[chave, valor], …] */
  definir(pares) {
    const lote = [];
    for (const [k, v] of pares) {
      if (!CHAVE_OK.test(k) || !valorOk(v)) continue;
      this.relogio += 1;
      const e = { v: v ?? null, c: this.relogio, a: this.eu };
      this.mapa.set(k, e);
      lote.push([k, e.v, e.c, e.a]);
    }
    if (lote.length) {
      this.emit("enviar", lote);
      this.emit("mudou", lote.map((x) => x[0]));
    }
    return lote;
  }

  /** Funde o que veio de outro participante. Devolve as chaves que mudaram. */
  aplicar(lote) {
    if (!Array.isArray(lote)) return [];
    const mudou = [];
    for (const item of lote.slice(0, MAX_CHAVES)) {
      if (!Array.isArray(item) || item.length !== 4) continue;
      const [k, v, c, a] = item;
      if (typeof k !== "string" || !CHAVE_OK.test(k) || !valorOk(v)) continue;
      if (!Number.isSafeInteger(c) || c < 0 || typeof a !== "string" || a.length > 64) continue;
      const atual = this.mapa.get(k);
      this.relogio = Math.max(this.relogio, c);
      if (atual && (atual.c > c || (atual.c === c && atual.a >= a))) continue;
      if (!atual && this.mapa.size >= MAX_CHAVES) continue;
      this.mapa.set(k, { v: v ?? null, c, a });
      mudou.push(k);
    }
    if (mudou.length) this.emit("mudou", mudou);
    return mudou;
  }

  /** O mapa inteiro, para quem acabou de chegar. */
  instantaneo() {
    return [...this.mapa].map(([k, e]) => [k, e.v, e.c, e.a]);
  }

  get vazio() {
    return this.mapa.size === 0;
  }
}

/** Ids curtos para histórias, notas e ações. */
export function novoId() {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Planning Poker
 * ------------------------------------------------------------------ */

export const BARALHOS = {
  fibonacci: { nome: "Fibonacci", cartas: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕"] },
  modificado: { nome: "Fibonacci modificada", cartas: ["0", "½", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "☕"] },
  camisetas: { nome: "Tamanhos de camiseta", cartas: ["PP", "P", "M", "G", "GG", "XGG", "?", "☕"], ordinal: true },
  potencias: { nome: "Potências de 2", cartas: ["0", "1", "2", "4", "8", "16", "32", "64", "?", "☕"] },
  confianca: { nome: "Confiança (punho de 5)", cartas: ["1", "2", "3", "4", "5"], confianca: true },
};

/** Valor numérico de uma carta, ou null (?, ☕, camisetas). */
export function numero(carta) {
  if (carta === "½") return 0.5;
  const n = Number(carta);
  return Number.isFinite(n) && carta !== "" ? n : null;
}

/**
 * Resultado de uma rodada revelada.
 * @param {string[]} votos  as cartas escolhidas
 */
export function resultado(votos, baralho = BARALHOS.fibonacci) {
  const validos = votos.filter((v) => v != null && v !== "?" && v !== "☕");
  const contagem = new Map();
  for (const v of votos) contagem.set(v, (contagem.get(v) || 0) + 1);
  // Ordem do baralho, para o gráfico.
  const distribuicao = [...contagem].sort((a, b) => baralho.cartas.indexOf(a[0]) - baralho.cartas.indexOf(b[0])).map(([carta, n]) => ({ carta, n }));

  let maioria = null;
  let maiorN = 0;
  for (const [carta, n] of contagem) {
    if (carta === "?" || carta === "☕") continue;
    if (n > maiorN) {
      maiorN = n;
      maioria = carta;
    }
  }
  const nums = validos.map(numero).filter((n) => n != null).sort((a, b) => a - b);
  const media = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
  const mediana = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null;
  // Sugestão: a carta do baralho mais perto da média (sem ultrapassar o
  // maior voto — arredondar para cima de todo mundo não é consenso).
  let sugestao = maioria;
  if (media != null && !baralho.ordinal) {
    const cartas = baralho.cartas.map((c) => [c, numero(c)]).filter(([, n]) => n != null);
    let melhor = null;
    for (const [c, n] of cartas) if (!melhor || Math.abs(n - media) < Math.abs(melhor[1] - media)) melhor = [c, n];
    sugestao = melhor?.[0] ?? maioria;
  }
  const concordancia = validos.length ? Math.round((maiorN / validos.length) * 100) : 0;
  return {
    total: votos.length,
    validos: validos.length,
    distribuicao,
    media: media != null ? Math.round(media * 10) / 10 : null,
    mediana,
    maioria,
    sugestao,
    concordancia,
    consenso: validos.length >= 2 && contagem.get(maioria) === validos.length,
    menor: nums.length ? nums[0] : null,
    maior: nums.length ? nums[nums.length - 1] : null,
  };
}

/** A rodada atual de uma história (ou "_", votação avulsa). */
export function rodadaDe(estado, hid) {
  return Number(estado.ler(`p/r/${hid}`, 0)) || 0;
}

export function historiaAtual(estado) {
  return estado.ler("p/atual", "_") || "_";
}

/** Histórias, na ordem. */
export function historias(estado) {
  const lista = [];
  for (const [k, h] of estado.com("p/h/")) {
    if (h?.apagada) continue;
    lista.push({ id: k.slice(4), titulo: String(h.titulo || "").slice(0, 200), ordem: Number(h.ordem) || 0, estimativa: h.estimativa ?? null });
  }
  return lista.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
}

/**
 * O que a mesa mostra: quem votou, quem é espectador, e — revelado — os
 * valores e o resultado.
 * @param {{pessoas: {id:string, nome:string}[], meuVoto: string|null}} o
 */
export function mesaPoker(estado, { pessoas, meuVoto = null, agora = Date.now() }) {
  const hid = historiaAtual(estado);
  const r = rodadaDe(estado, hid);
  const base = `${hid}/${r}`;
  const revEm = estado.ler(`p/rev/${base}`, null);
  const revelado = revEm != null && agora >= Number(revEm);
  const contagem = revEm != null && !revelado ? Math.max(0, Math.ceil((Number(revEm) - agora) / 1000)) : null;
  const baralhoId = estado.ler("p/baralho", "fibonacci");
  const baralho = BARALHOS[baralhoId] || BARALHOS.fibonacci;

  const votaram = new Map();
  for (const [k, v] of estado.com(`p/v/${base}/`)) votaram.set(k.split("/").pop(), v?.n || "");
  const valores = new Map();
  for (const [k, v] of estado.com(`p/val/${base}/`)) if (baralho.cartas.includes(v)) valores.set(k.split("/").pop(), v);

  const presentes = new Set(pessoas.map((p) => p.id));
  const jogadores = pessoas.map((p) => ({
    id: p.id,
    nome: p.nome,
    eu: p.id === estado.eu,
    espectador: !!estado.ler(`p/esp/${p.id}`, false),
    votou: votaram.has(p.id),
    valor: revelado ? (valores.get(p.id) ?? (p.id === estado.eu ? meuVoto : null)) : null,
    presente: true,
  }));
  // Quem votou e saiu continua contando (com o nome que deixou).
  for (const [id, nome] of votaram) {
    if (presentes.has(id)) continue;
    jogadores.push({ id, nome: nome || "Saiu", eu: false, espectador: false, votou: true, valor: revelado ? (valores.get(id) ?? null) : null, presente: false });
  }
  const votantes = jogadores.filter((j) => !j.espectador && j.presente);
  const todosVotaram = votantes.length > 0 && votantes.every((j) => j.votou);
  return {
    historia: hid,
    rodada: r,
    baralhoId,
    baralho,
    revelado,
    contagem,
    jogadores,
    todosVotaram,
    faltam: votantes.filter((j) => !j.votou).length,
    resultado: revelado ? resultado(jogadores.filter((j) => j.valor != null).map((j) => j.valor), baralho) : null,
  };
}

/**
 * As jogadas do Poker. `segredos` guarda o voto de quem está neste
 * computador até a revelação.
 */
export class Poker {
  /** `${hid}/${rodada}` -> carta */
  meus = new Map();

  constructor(estado, { nome = () => "" } = {}) {
    this.estado = estado;
    this.nome = nome;
    // Toda mudança pode ter sido uma revelação: hora de publicar o que é meu.
    estado.on("mudou", () => this.publicarSegredos());
  }

  get base() {
    const hid = historiaAtual(this.estado);
    return `${hid}/${rodadaDe(this.estado, hid)}`;
  }

  meuVoto() {
    return this.meus.get(this.base) ?? null;
  }

  votar(carta) {
    const base = this.base;
    if (this.estado.ler(`p/rev/${base}`) != null) return false; // revelado: só na próxima rodada
    const eu = this.estado.eu;
    if (carta == null || this.meus.get(base) === carta) {
      // Clicar de novo na mesma carta tira o voto.
      this.meus.delete(base);
      this.estado.definir([[`p/v/${base}/${eu}`, null]]);
      return true;
    }
    this.meus.set(base, carta);
    this.estado.definir([[`p/v/${base}/${eu}`, { n: this.nome().slice(0, 40) }]]);
    return true;
  }

  /** Revela depois de uma contagem curta (`ms`), igual para todos. */
  revelar({ ms = 2500, agora = Date.now() } = {}) {
    const base = this.base;
    if (this.estado.ler(`p/rev/${base}`) != null) return false;
    this.estado.definir([[`p/rev/${base}`, agora + ms]]);
    return true;
  }

  novaRodada() {
    const hid = historiaAtual(this.estado);
    this.estado.definir([[`p/r/${hid}`, rodadaDe(this.estado, hid) + 1]]);
  }

  publicarSegredos() {
    const eu = this.estado.eu;
    for (const [base, carta] of this.meus) {
      if (this.estado.ler(`p/rev/${base}`) == null) continue;
      if (this.estado.ler(`p/val/${base}/${eu}`) === carta) continue;
      this.estado.definir([[`p/val/${base}/${eu}`, carta]]);
    }
  }

  adicionarHistorias(titulos) {
    const atuais = historias(this.estado);
    let ordem = atuais.length ? Math.max(...atuais.map((h) => h.ordem)) + 1 : 1;
    const pares = [];
    let primeira = null;
    for (const t of titulos.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)) {
      const id = novoId();
      primeira ||= id;
      pares.push([`p/h/${id}`, { titulo: t.slice(0, 200), ordem: ordem++, estimativa: null }]);
    }
    // Sem história em votação: a primeira nova vira a atual.
    if (primeira && historiaAtual(this.estado) === "_") pares.push(["p/atual", primeira]);
    this.estado.definir(pares);
    return primeira;
  }

  escolherHistoria(hid) {
    this.estado.definir([["p/atual", hid || "_"]]);
  }

  /** Guarda a estimativa da história e passa para a próxima sem estimativa. */
  salvarEstimativa(hid, carta, { avancar = true } = {}) {
    const h = this.estado.ler(`p/h/${hid}`);
    if (!h) return;
    const pares = [[`p/h/${hid}`, { ...h, estimativa: carta }]];
    if (avancar) {
      const proxima = historias(this.estado).find((x) => x.id !== hid && x.estimativa == null);
      if (proxima) pares.push(["p/atual", proxima.id]);
    }
    this.estado.definir(pares);
  }

  apagarHistoria(hid) {
    const h = this.estado.ler(`p/h/${hid}`);
    if (!h) return;
    const pares = [[`p/h/${hid}`, { ...h, apagada: true }]];
    if (historiaAtual(this.estado) === hid) pares.push(["p/atual", "_"]);
    this.estado.definir(pares);
  }

  definirBaralho(id) {
    if (BARALHOS[id]) this.estado.definir([["p/baralho", id]]);
  }

  espectador(sim) {
    this.estado.definir([[`p/esp/${this.estado.eu}`, !!sim]]);
    if (sim) this.votar(null);
  }
}

/** Histórias estimadas em CSV (abre no Excel/Sheets e importa no Jira). */
export function historiasCsv(estado) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return ["Historia;Estimativa", ...historias(estado).map((h) => `${esc(h.titulo)};${esc(h.estimativa ?? "")}`)].join("\r\n");
}

/* ------------------------------------------------------------------ *
 * Retrospectiva
 * ------------------------------------------------------------------ */

export const MODELOS_RETRO = {
  ccp: { nome: "Começar · Parar · Continuar", colunas: ["Começar", "Parar", "Continuar"] },
  bmi: { nome: "Bom · Melhorar · Ideias", colunas: ["Foi bom", "Pode melhorar", "Ideias"] },
  "4l": { nome: "4Ls", colunas: ["Gostei", "Aprendi", "Faltou", "Desejei"] },
  fts: { nome: "Feliz · Triste · Bravo", colunas: ["😀 Feliz", "😢 Triste", "😠 Bravo"] },
};
export const FASES_RETRO = ["escrever", "votar", "discutir"];

export function retro(estado, { pessoas = [] } = {}) {
  const modelo = MODELOS_RETRO[estado.ler("r/modelo", "ccp")] || MODELOS_RETRO.ccp;
  const fase = FASES_RETRO.includes(estado.ler("r/fase")) ? estado.ler("r/fase") : "escrever";
  const votosPorPessoa = Math.min(10, Math.max(1, Number(estado.ler("r/votos", 3)) || 3));
  const notas = [];
  const usados = new Map();
  for (const [k, n] of estado.com("r/n/")) {
    const id = k.slice(4);
    if (!n || n.apagada) continue;
    let votos = 0;
    for (const [kv, qtd] of estado.com(`r/vt/${id}/`)) {
      const q = Math.max(0, Math.min(votosPorPessoa, Number(qtd) || 0));
      votos += q;
      const uid = kv.split("/").pop();
      usados.set(uid, (usados.get(uid) || 0) + q);
    }
    notas.push({
      id,
      col: Math.max(0, Math.min(modelo.colunas.length - 1, Number(n.col) || 0)),
      autor: n.autor,
      nome: n.nome || "",
      texto: estado.ler(`r/t/${id}`, null),
      ordem: Number(n.ordem) || 0,
      votos,
    });
  }
  const acoes = [];
  for (const [k, a] of estado.com("r/a/")) {
    if (!a || a.apagada) continue;
    acoes.push({ id: k.slice(4), texto: String(a.texto || "").slice(0, 300), dono: a.dono || "", feita: !!a.feita, ordem: Number(a.ordem) || 0 });
  }
  acoes.sort((a, b) => a.ordem - b.ordem);
  const ordenar = fase === "discutir" ? (a, b) => b.votos - a.votos || a.ordem - b.ordem : (a, b) => a.ordem - b.ordem;
  return {
    modelo,
    modeloId: estado.ler("r/modelo", "ccp"),
    fase,
    votosPorPessoa,
    meusVotosUsados: usados.get(estado.eu) || 0,
    colunas: modelo.colunas.map((titulo, i) => ({ titulo, notas: notas.filter((n) => n.col === i).sort(ordenar) })),
    escreveram: pessoas.map((p) => ({ ...p, notas: notas.filter((n) => n.autor === p.id).length })),
    acoes,
  };
}

export class Retro {
  /** id da nota -> texto (as minhas, enquanto a fase é de escrita) */
  meus = new Map();

  constructor(estado, { nome = () => "" } = {}) {
    this.estado = estado;
    this.nome = nome;
    estado.on("mudou", () => this.publicarSegredos());
  }

  get escrevendo() {
    return (this.estado.ler("r/fase") || "escrever") === "escrever";
  }

  adicionarNota(col, texto) {
    const t = String(texto || "").trim().slice(0, 500);
    if (!t) return null;
    const id = novoId();
    this.meus.set(id, t);
    const pares = [[`r/n/${id}`, { col, autor: this.estado.eu, nome: this.nome().slice(0, 40), ordem: Date.now() }]];
    if (!this.escrevendo) pares.push([`r/t/${id}`, t]);
    this.estado.definir(pares);
    return id;
  }

  apagarNota(id) {
    const n = this.estado.ler(`r/n/${id}`);
    if (!n || n.autor !== this.estado.eu) return;
    this.meus.delete(id);
    this.estado.definir([[`r/n/${id}`, { ...n, apagada: true }]]);
  }

  /** +1 / -1 voto numa nota, respeitando o total por pessoa. */
  votar(id, delta) {
    const v = retro(this.estado);
    if (v.fase !== "votar") return false;
    const chave = `r/vt/${id}/${this.estado.eu}`;
    const atual = Number(this.estado.ler(chave, 0)) || 0;
    const novo = atual + delta;
    if (novo < 0 || (delta > 0 && v.meusVotosUsados >= v.votosPorPessoa)) return false;
    this.estado.definir([[chave, novo]]);
    return true;
  }

  fase(f) {
    if (FASES_RETRO.includes(f)) this.estado.definir([["r/fase", f]]);
  }

  modelo(id) {
    if (MODELOS_RETRO[id]) this.estado.definir([["r/modelo", id]]);
  }

  adicionarAcao(texto, dono = "") {
    const t = String(texto || "").trim().slice(0, 300);
    if (!t) return;
    this.estado.definir([[`r/a/${novoId()}`, { texto: t, dono: String(dono).slice(0, 40), feita: false, ordem: Date.now() }]]);
  }

  marcarAcao(id, feita) {
    const a = this.estado.ler(`r/a/${id}`);
    if (a) this.estado.definir([[`r/a/${id}`, { ...a, feita: !!feita }]]);
  }

  apagarAcao(id) {
    const a = this.estado.ler(`r/a/${id}`);
    if (a) this.estado.definir([[`r/a/${id}`, { ...a, apagada: true }]]);
  }

  /** Saiu da fase de escrita: os textos que estavam só aqui são publicados. */
  publicarSegredos() {
    if (this.escrevendo) return;
    const pares = [];
    for (const [id, texto] of this.meus) {
      const n = this.estado.ler(`r/n/${id}`);
      if (!n || n.apagada) continue;
      if (this.estado.ler(`r/t/${id}`) !== texto) pares.push([`r/t/${id}`, texto]);
    }
    if (pares.length) this.estado.definir(pares);
  }
}

/** A retrospectiva em Markdown, para colar no Confluence, Notion ou Jira. */
export function retroMarkdown(estado) {
  const v = retro(estado);
  const linhas = [`# Retrospectiva — ${v.modelo.nome}`, ""];
  for (const c of v.colunas) {
    linhas.push(`## ${c.titulo}`, "");
    const notas = [...c.notas].sort((a, b) => b.votos - a.votos);
    for (const n of notas) linhas.push(`- ${n.texto ?? "(oculta)"}${n.votos ? ` — ${n.votos} voto(s)` : ""}`);
    if (!notas.length) linhas.push("- (nada)");
    linhas.push("");
  }
  linhas.push("## Ações", "");
  for (const a of v.acoes) linhas.push(`- [${a.feita ? "x" : " "}] ${a.texto}${a.dono ? ` (${a.dono})` : ""}`);
  if (!v.acoes.length) linhas.push("- (nenhuma)");
  return linhas.join("\n");
}

/* ------------------------------------------------------------------ *
 * Daily (reunião diária)
 * ------------------------------------------------------------------ */

/** Embaralha (Fisher–Yates) com o sorteio criptográfico do navegador. */
export function embaralhar(lista) {
  const a = [...lista];
  const r = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i -= 1) {
    globalThis.crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function daily(estado, { agora = Date.now() } = {}) {
  const ordem = Array.isArray(estado.ler("d/ordem")) ? estado.ler("d/ordem").slice(0, 40) : [];
  const i = Number(estado.ler("d/i", -1));
  const tempo = Math.min(600, Math.max(15, Number(estado.ler("d/tempo", 90)) || 90));
  const inicio = Number(estado.ler("d/inicio", 0)) || 0;
  const comecou = Number(estado.ler("d/comecou", 0)) || 0;
  const tempos = estado.ler("d/tempos", {}) || {};
  const atual = i >= 0 && i < ordem.length ? ordem[i] : null;
  const decorrido = atual && inicio ? Math.max(0, (agora - inicio) / 1000) : 0;
  return {
    ordem: ordem.map((p, k) => ({ ...p, k, feito: k < i, atual: k === i, segundos: Number(tempos[p.id]) || null })),
    i,
    tempo,
    atual,
    decorrido,
    restante: tempo - decorrido,
    estourou: decorrido > tempo,
    fim: ordem.length > 0 && i >= ordem.length,
    total: comecou ? Math.max(0, ((i >= ordem.length ? Number(estado.ler("d/terminou", agora)) : agora) - comecou) / 1000) : 0,
  };
}

export class Daily {
  constructor(estado) {
    this.estado = estado;
  }

  sortear(pessoas) {
    const ordem = embaralhar(pessoas.map((p) => ({ id: p.id, nome: String(p.nome || "").slice(0, 40) })));
    this.estado.definir([
      ["d/ordem", ordem],
      ["d/i", -1],
      ["d/inicio", 0],
      ["d/comecou", 0],
      ["d/tempos", {}],
    ]);
  }

  tempo(segundos) {
    this.estado.definir([["d/tempo", Math.min(600, Math.max(15, Number(segundos) || 90))]]);
  }

  /** Começa, ou passa a vez para a próxima pessoa. */
  proximo(agora = Date.now()) {
    const v = daily(this.estado, { agora });
    if (!v.ordem.length || v.fim) return;
    const pares = [];
    if (v.atual) pares.push(["d/tempos", { ...(this.estado.ler("d/tempos", {}) || {}), [v.atual.id]: Math.round(v.decorrido) }]);
    if (v.i < 0) pares.push(["d/comecou", agora]);
    const i = v.i + 1;
    pares.push(["d/i", i], ["d/inicio", agora]);
    if (i >= v.ordem.length) pares.push(["d/terminou", agora]);
    this.estado.definir(pares);
  }

  reiniciar() {
    this.estado.definir([
      ["d/i", -1],
      ["d/inicio", 0],
      ["d/comecou", 0],
      ["d/tempos", {}],
    ]);
  }
}

/* ------------------------------------------------------------------ */

export const JOGOS = {
  poker: { nome: "Planning Poker", icone: "spade", desc: "Estimem histórias com cartas escondidas até revelar." },
  retro: { nome: "Retrospectiva", icone: "sticky-note", desc: "Notas em colunas, votação com pontos e plano de ação." },
  daily: { nome: "Daily", icone: "timer", desc: "Ordem sorteada e tempo de fala para cada um." },
};
