/**
 * features/whisper-worker.js — o Whisper rodando fora da tela.
 *
 * Reconhecer fala custa centenas de milissegundos de CPU por frase; na thread
 * da página isso travaria vídeo, animações e cliques. Aqui ele roda sozinho,
 * e a página só manda áudio (16 kHz, mono) e recebe texto.
 *
 * Mensagens:
 *   → { tipo: "abrir", base, modelo, idioma }   carrega o modelo (uma vez)
 *   → { tipo: "ouvir", id, audio, final }        transcreve um trecho
 *   ← { tipo: "pronto", dispositivo }            | { tipo: "erro", mensagem }
 *   ← { tipo: "texto", id, texto, final, ms }
 */
import {
  AutoFeatureExtractor,
  AutomaticSpeechRecognitionPipeline,
  env,
  WhisperForConditionalGeneration,
  WhisperProcessor,
  WhisperTokenizer,
} from "/vendor/whisper/transformers.js";

let reconhecer = null;
let idioma = "portuguese";

/** Whisper chama os idiomas pelo nome em inglês. */
const IDIOMAS = {
  pt: "portuguese",
  en: "english",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  ja: "japanese",
};

async function abrir({ base, modelo, idioma: lang }) {
  idioma = IDIOMAS[String(lang || "pt").slice(0, 2)] || "portuguese";
  // Tudo local: o modelo vem do disco (vcall-fala://), o motor de /vendor.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = base;
  env.useBrowserCache = false;
  env.backends.onnx.wasm.wasmPaths = "/vendor/whisper/";
  // Várias threads só com isolamento de origem (SharedArrayBuffer).
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    : 1;

  const opcoes = { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, device: "wasm" };
  const dispositivo = "wasm";
  try {
    /*
     * Montado à mão em vez de `pipeline()`: a versão 4 da biblioteca decide
     * se o tokenizador existe consultando o Hugging Face, e com o modelo
     * servido localmente concluía que não — e o reconhecedor nascia sem ele.
     */
    const json = async (arquivo) => {
      const r = await fetch(`${base}${modelo}/${arquivo}`);
      if (!r.ok) throw new Error(`${arquivo}: ${r.status}`);
      return r.json();
    };
    const [tokenizer, feature_extractor, model] = await Promise.all([
      Promise.all([json("tokenizer.json"), json("tokenizer_config.json")]).then(([t, c]) => new WhisperTokenizer(t, c)),
      AutoFeatureExtractor.from_pretrained(modelo, opcoes),
      WhisperForConditionalGeneration.from_pretrained(modelo, opcoes),
    ]);
    const processor = new WhisperProcessor({}, { tokenizer, feature_extractor });
    reconhecer = new AutomaticSpeechRecognitionPipeline({ task: "automatic-speech-recognition", model, tokenizer, processor });
  } catch (err) {
    throw new Error(`o modelo de fala não abriu (${err?.message || err})`);
  }
  // Aquece: a primeira inferência compila o grafo e custa o dobro.
  await reconhecer(new Float32Array(16_000), { language: idioma, task: "transcribe" }).catch(() => {});
  return dispositivo;
}

/*
 * O Whisper foi treinado com legendas da internet e, diante de silêncio ou
 * ruído, "completa" com frases que nunca foram ditas. Estas são as clássicas
 * em português e inglês; um trecho que é só isso é descartado.
 */
const ALUCINACOES = [
  /^(obrigad[oa]s?( por assistir(em)?)?[.!]?)$/i,
  /legendas? (pela|por) comunidade/i,
  /amara\.org/i,
  /^inscreva-se( no canal)?[.!]?$/i,
  /^(thank you|thanks)( for watching)?[.!]?$/i,
  /^subtitles? by/i,
  /^(\.|…|,|-|\s)+$/,
  /^tchau[.!]?$/i,
];

function limpar(texto) {
  let t = String(texto || "")
    // Anotações de som que o Whisper escreve entre colchetes/parênteses.
    .replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || ALUCINACOES.some((re) => re.test(t))) return "";
  // A mesma palavra repetida em laço é outro tique do modelo.
  t = t.replace(/\b(\S+)(?:\s+\1\b){3,}/gi, "$1");
  return t;
}

/*
 * Um pedido por vez, na ordem em que chegaram: duas inferências ao mesmo
 * tempo no mesmo modelo disputam a memória do ONNX Runtime e podem falhar.
 */
let cadeia = Promise.resolve();
self.onmessage = ({ data }) => {
  cadeia = cadeia.then(() => tratar(data));
};

async function tratar(data) {
  try {
    if (data.tipo === "abrir") {
      const dispositivo = await abrir(data);
      self.postMessage({ tipo: "pronto", dispositivo });
      return;
    }
    if (data.tipo === "ouvir" && reconhecer) {
      const inicio = performance.now();
      const saida = await reconhecer(data.audio, {
        language: idioma,
        task: "transcribe",
        // Trechos longos: o Whisper enxerga 30 s por vez.
        chunk_length_s: 30,
        // Gulosa: busca em feixe custa o triplo para ganho pequeno aqui.
        num_beams: 1,
        return_timestamps: false,
      });
      self.postMessage({
        tipo: "texto",
        id: data.id,
        texto: limpar(saida?.text),
        final: !!data.final,
        ms: Math.round(performance.now() - inicio),
      });
    }
  } catch (err) {
    self.postMessage({ tipo: "erro", id: data?.id, mensagem: String(err?.message || err) });
  }
}
