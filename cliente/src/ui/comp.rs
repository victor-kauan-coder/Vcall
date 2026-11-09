//! Peças pequenas usadas por todas as partes da interface.

use gpui::{Hsla, Svg, prelude::*, px, svg};

/// Um ícone do sprite do app (public/vendor/icons.svg, Lucide), na cor dada.
/// `traco`: a espessura do traço quando o CSS daquele lugar troca a do Lucide (2).
pub fn icone(nome: &str, tamanho: f32, cor: Hsla) -> Svg {
    svg().path(format!("icone/{nome}.svg")).size(px(tamanho)).flex_none().text_color(cor)
}

pub fn icone_traco(nome: &str, tamanho: f32, traco: f32, cor: Hsla) -> Svg {
    svg().path(format!("icone/{nome}@{traco}.svg")).size(px(tamanho)).flex_none().text_color(cor)
}
