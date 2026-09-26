/**
 * features/whisper-nucleo.js — o reconhecimento em si, sem nada em volta.
 *
 * Usado pelo worker do app (features/whisper-worker.js) e pela medição de
 * precisão (scripts/bench-fala.mjs), que roda no CI com gravações de voz
 * humana. A biblioteca (transformers.js) é passada de fora: no navegador ela
 * vem de /vendor, no Node do pacote npm.
 */

/** Whisper chama os idiomas pelo código de duas letras. */
const IDIOMAS = ["pt", "en", "es", "fr", "de", "it", "ja"];

/**
 * Abre o modelo.
 * @param {object} lib  { Tensor, WhisperTokenizer, AutoFeatureExtractor, WhisperForConditionalGeneration }
 * @param {{repo:string, idioma:string, lerJson:(arq:string)=>Promise<object>, opcoes:object, curto:boolean}} o
 */
export async function abrirWhisper(lib, { repo, idioma = "pt", lerJson, opcoes = {}, curto = false }) {
  /*
   * Montado à mão em vez de `pipeline()`: a versão 4 da biblioteca decide
   * se o tokenizador existe consultando o Hugging Face e, com o modelo
   * servido localmente, concluía que não. E assim dá para passar o contexto
   * e o limite de tokens, que o pipeline não expõe.
   */
  const [tokenizer, extrator, modelo] = await Promise.all([
    Promise.all([lerJson("tokenizer.json"), lerJson("tokenizer_config.json")]).then(([t, c]) => new lib.WhisperTokenizer(t, c)),
    lib.AutoFeatureExtractor.from_pretrained(repo, opcoes),
    lib.WhisperForConditionalGeneration.from_pretrained(repo, opcoes),
  ]);
  const lang = IDIOMAS.includes(String(idioma).slice(0, 2)) ? String(idioma).slice(0, 2) : "pt";
  const id = (t) => tokenizer.convert_tokens_to_ids([t])[0];
  const inicio = [id("<|startoftranscript|>"), id(`<|${lang}|>`), id("<|transcribe|>"), id("<|notimestamps|>")];
  const anterior = id("<|startofprev|>");
  if (inicio.some((x) => x == null)) throw new Error("tokens especiais ausentes");

  /**
   * Transcreve um trecho (Float32, 16 kHz).
   * @param {{maxTokens?:number, contexto?:string}} o
   */
  async function transcrever(audio, { maxTokens = 128, contexto = "" } = {}) {
    let { input_features } = await extrator(audio);
    if (curto) {
      // Só o tamanho do áudio (+1 s), em vez da janela fixa de 30 s.
      const [, mels, total] = input_features.dims;
      const t = quadrosPara(audio.length);
      if (t < total) {
        const dados = input_features.data;
        const corte = new Float32Array(mels * t);
        for (let m = 0; m < mels; m += 1) corte.set(dados.subarray(m * total, m * total + t), m * t);
        input_features = new lib.Tensor("float32", corte, [1, mels, t]);
      }
    }
    let prefixo = inicio;
    if (contexto) {
      // O contexto vai depois de <|startofprev|>, antes do começo da transcrição.
      const ids = tokenizer.encode(` ${contexto}`, { add_special_tokens: false }).slice(-48);
      prefixo = [anterior, ...ids, ...inicio];
    }
    const saida = await modelo.generate({
      inputs: input_features,
      decoder_input_ids: prefixo,
      max_new_tokens: maxTokens,
      // Gulosa: busca em feixe custa o triplo de decodificação por pouco ganho.
      num_beams: 1,
      do_sample: false,
    });
    const ids = (saida.sequences ?? saida).tolist()[0].map(Number).slice(prefixo.length);
    return tokenizer.decode(ids, { skip_special_tokens: true });
  }

  return { transcrever, modelo };
}

/** Quadros de espectrograma (10 ms cada) que o encoder lê para um trecho. */
export function quadrosPara(amostras) {
  // A fala inteira + 1 s de folga (o modelo foi treinado com silêncio depois
  // da fala), em múltiplos de 100 — menos formas diferentes, menos recompilação.
  const q = Math.ceil(amostras / 160) + 100;
  return Math.min(3000, Math.ceil(q / 100) * 100);
}

/** Tokens de texto que cabem num trecho: português falado dá ~4 tokens/s. */
export function tokensPara(amostras, folga = 12) {
  return Math.min(200, Math.ceil((amostras / 16_000) * 9) + folga);
}

/*
 * O Whisper foi treinado com legendas da internet e, diante de ruído ou de
 * silêncio, "completa" com frases que nunca foram ditas. Estas são as
 * clássicas; um trecho que é só isso é descartado.
 */
const ALUCINACOES = [
  /^(obrigad[oa]s?( por assistir(em)?)?[.!]?)$/i,
  /legendas? (pela|por) comunidade/i,
  /amara\.org/i,
  /^inscreva-se( no canal)?[.!]?$/i,
  /^(thank you|thanks)( for watching)?[.!]?$/i,
  /^subtitles? by/i,
  /^tchau[.!]?$/i,
  /^(\.|…|,|-|\s)+$/,
];

export function limpar(texto, contexto = "") {
  let t = String(texto || "")
    // Anotações de som que o Whisper escreve entre colchetes/parênteses.
    .replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || ALUCINACOES.some((re) => re.test(t))) return "";
  // A mesma palavra ou expressão repetida em laço é outro tique do modelo.
  t = t.replace(/\b(\S+)(?:\s+\1\b){2,}/gi, "$1");
  t = t.replace(/\b(\S+\s+\S+)(?:\s+\1\b){2,}/gi, "$1");
  // Com áudio fraco o modelo às vezes só repete o contexto que recebeu.
  if (contexto && t.length > 8 && contexto.toLowerCase().endsWith(t.toLowerCase())) return "";
  return t;
}

/* ------------------------------------------------------------------ *
 * Palavras confirmadas (LocalAgreement-2)
 * ------------------------------------------------------------------ */

const chave = (p) => p.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Uma palavra só é confirmada quando duas leituras seguidas concordam nela
 * (Whisper-Streaming, Macháček et al., 2023). O que foi confirmado não muda
 * mais na tela; o resto aparece como provisório.
 */
export class Acordo {
  confirmadas = [];
  anterior = [];
  reiniciar() {
    this.confirmadas = [];
    this.anterior = [];
  }
  ler(texto) {
    const palavras = texto.split(" ").filter(Boolean);
    let n = this.confirmadas.length;
    while (n < palavras.length && n < this.anterior.length && chave(palavras[n]) === chave(this.anterior[n])) n += 1;
    if (n > this.confirmadas.length) this.confirmadas = [...this.confirmadas, ...palavras.slice(this.confirmadas.length, n)];
    this.anterior = palavras;
    return {
      confirmado: this.confirmadas.join(" "),
      provisorio: palavras.slice(this.confirmadas.length).join(" "),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Medida de erro (WER), para a medição
 * ------------------------------------------------------------------ */

export function normalizar(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Taxa de erro por palavra: edições / palavras da referência. */
export function wer(referencia, hipotese) {
  const r = normalizar(referencia).split(" ").filter(Boolean);
  const h = normalizar(hipotese).split(" ").filter(Boolean);
  let ant = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= h.length; j += 1) {
      atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    ant = atual;
  }
  return { erros: ant[h.length], palavras: r.length };
}
