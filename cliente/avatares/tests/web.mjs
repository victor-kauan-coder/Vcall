// Referência do teste igual_ao_web.rs: o avatarSvg do web rodando no Node,
// importado direto de public/ (sem stub: dom.js e util.js carregam sem DOM).
import { avatarSvg, AVATAR_STYLES, semCartum } from "../../../public/js/ui/avatars.js";

const SEMENTES = ["vcall", "maria", "João da Silva", "k3j9x0ab", "", "Ação 😀 <&>\"'", "x".repeat(64)];
// Além da escolha: o estilo antigo da casa e um desconhecido (vira o padrão).
const ESTILOS = [...AVATAR_STYLES, "vcall", "estiloQueNaoExiste"];

console.log(
  JSON.stringify({
    estilos: AVATAR_STYLES,
    avatares: ESTILOS.flatMap((style) => SEMENTES.map((seed) => ({ style, seed, svg: avatarSvg({ style, seed }) }))),
    padrao: SEMENTES.filter(Boolean).map((seed) => ({ seed, style: semCartum({ style: "vcall", seed }).style })),
  }),
);
