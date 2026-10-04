/**
 * ui/avatars.js — avatares SVG.
 *
 * Os avatares vêm do DiceBear (MIT), vendorizado em /vendor/avatars.js.
 * Nenhum desenho é feito à mão aqui e nenhum emoji é usado: cada avatar é um
 * SVG de verdade, gerado de forma determinística a partir de {estilo, semente}.
 *
 * Consequência de privacidade: o servidor só trafega o par {style, seed} —
 * nunca uma imagem. Nada de base64 de 60 kB por participante.
 */
import { styles, styleIds, createAvatar } from "../../vendor/avatars.js";
import { el } from "../lib/dom.js";
import { randomSeed } from "../lib/util.js";

/**
 * Fundo dos avatares: seis matizes distintos, nenhum deles roxo.
 *
 * O roxo saía igual ao fundo da interface antiga — o avatar sumia dentro do
 * ladrilho, que é o oposto do que um avatar existe para fazer. Agora a
 * interface é tinta fria e neutra, e estes seis são as únicas cores saturadas
 * da tela junto com o rosa da marca: cada pessoa fica reconhecível de
 * relance, de longe, numa grade de dezesseis.
 *
 * Os matizes estão espaçados de propósito (rosa, laranja, âmbar, verde,
 * turquesa, azul) para não haver dois parecidos lado a lado — é o mesmo
 * motivo de um mapa não usar dois tons do mesmo verde em países vizinhos.
 */
const BACKGROUND = ["fd4d87", "fe9c5f", "fbbf24", "34d399", "2dd4bf", "38bdf8"];

export const AVATAR_STYLES = styleIds;

export const STYLE_LABELS = {
  notionistsNeutral: "Traço",
  loreleiNeutral: "Retrato",
  adventurerNeutral: "Aventura",
  botttsNeutral: "Robô",
  personas: "Pessoa",
  miniavs: "Mini",
  thumbs: "Polegar",
  shapes: "Formas",
  identicon: "Geométrico",
  initials: "Iniciais",
};

const cache = new Map();

function cacheKey(style, seed) {
  return `${style}|${seed}`;
}

/**
 * Todo avatar do DiceBear nasce com os mesmos identificadores internos
 * (`id="viewboxMask"`, gradientes etc.). Dentro de uma página, `id` é global:
 * com vários avatares na tela, a máscara de um passa a apontar para o
 * elemento de outro e o desenho some — sobra um retalho de cor. O sintoma é
 * traiçoeiro porque o SVG está inteiro no DOM; só a referência é que aponta
 * para o lugar errado.
 *
 * A solução é dar a cada cópia um sufixo próprio, tanto nas declarações
 * quanto nas referências (`url(#…)` e `href="#…"`).
 */
let uid = 0;

export function uniquifyIds(svg) {
  const ids = new Set();
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  if (!ids.size) return svg;

  const suffix = `-v${(uid += 1)}`;
  let out = svg;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`\\bid="${esc}"`, "g"), `id="${id}${suffix}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${id}${suffix})`)
      .replace(new RegExp(`(xlink:href|href)="#${esc}"`, "g"), `$1="#${id}${suffix}"`);
  }
  return out;
}

/**
 * Gera o markup SVG do avatar. O resultado é memorizado: um participante
 * aparece em vários lugares (ladrilho, lista, chat) e o custo é pago uma vez.
 */
export function isPhoto(spec) {
  return !!spec && typeof spec.photo === "string" && spec.photo.startsWith("data:image/");
}

export function avatarSvg(spec) {
  const style = styles[spec?.style] ? spec.style : "notionistsNeutral";
  const seed = spec?.seed || "vcall";
  const key = cacheKey(style, seed);
  const hit = cache.get(key);
  if (hit) return hit;

  let svg;
  try {
    svg = createAvatar(styles[style], {
      seed,
      size: 128,
      radius: 50,
      backgroundColor: BACKGROUND,
      backgroundType: ["gradientLinear", "solid"],
    }).toString();
  } catch {
    svg = "";
  }
  cache.set(key, svg);
  return svg;
}

/**
 * Elemento de avatar pronto para inserir. O SVG vem de uma biblioteca local e
 * determinística — não há entrada de usuário dentro dele além da semente, que
 * é sanitizada no servidor —, por isso `innerHTML` é seguro neste ponto e
 * evita um parser de SVG inteiro no cliente.
 */
export function avatarEl(spec, { size = null, className = "", title = "" } = {}) {
  const node = el("span.avatar", {
    class: className,
    role: "img",
    "aria-label": title || `Avatar de ${spec?.seed || "participante"}`,
  });
  if (size) {
    node.style.width = `${size}px`;
    node.style.height = `${size}px`;
  }
  setAvatar(node, spec);
  return node;
}

/**
 * Atualiza um avatar já montado sem trocar o nó.
 *
 * Uma foto enviada pelo usuário vira um <img> montado como nó — nunca uma
 * string de HTML. O `innerHTML` só é usado no caminho do SVG gerado
 * localmente pelo DiceBear, cuja única entrada variável é a semente, já
 * higienizada no servidor.
 */
export function setAvatar(node, spec) {
  if (!node) return;
  if (isPhoto(spec)) {
    node.replaceChildren(
      el("img", { src: spec.photo, alt: "", loading: "lazy", decoding: "async" }),
    );
    return;
  }
  // Cada cópia recebe identificadores próprios; ver uniquifyIds.
  node.innerHTML = uniquifyIds(avatarSvg(spec));
}

/** Avatar inicial para quem nunca escolheu um. */
export function defaultAvatar() {
  return { style: AVATAR_STYLES[0], seed: randomSeed() };
}

/** Uma amostra por estilo, para a grade de escolha. */
export function sampleAvatars(seed) {
  return AVATAR_STYLES.map((style) => ({ style, seed }));
}

/**
 * Cor estável por participante, usada no ponteiro laser e nos traços do
 * quadro. Derivada do id para que todos vejam a mesma cor para a mesma pessoa.
 */
const LASER_COLORS = [
  "#fd4d87",
  "#fe9c5f",
  "#37d399",
  "#6ec6ff",
  "#b98bff",
  "#ffd166",
  "#ff7b72",
  "#4dd0c4",
];

export function colorFor(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return LASER_COLORS[hash % LASER_COLORS.length];
}
