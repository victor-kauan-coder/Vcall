//! O que vai dentro do executável: fontes, ícones e emojis.
//!
//! Ícones e emojis saem dos MESMOS sprites do app web (public/vendor), então
//! um ícone novo lá aparece aqui sem cópia: `icone/<nome>.svg` é o símbolo
//! `i-<nome>` do Lucide (monocromático: o GPUI pinta com a cor do texto) e
//! `emoji/<nome>.svg` é o `e-<nome>` do Fluent Emoji (colorido, vai num img).
//! Nada é baixado depois de instalado (PRODUCT.md).

use std::borrow::Cow;
use std::sync::Arc;

use gpui::{App, AssetSource, Image, ImageFormat, Result, SharedString};

const ICONES: &str = include_str!("../../public/vendor/icons.svg");
const EMOJIS: &str = include_str!("../../public/vendor/emoji.svg");

/// Bricolage Grotesque (OFL), nos pesos que o app usa; o resto do texto é a
/// fonte do sistema, como no CSS (`ui-sans-serif, system-ui, Segoe UI…`).
pub fn carregar_fontes(cx: &mut App) {
    let fontes: Vec<Cow<'static, [u8]>> = vec![
        Cow::Borrowed(include_bytes!("../assets/fontes/BricolageGrotesque-SemiBold.ttf")),
        Cow::Borrowed(include_bytes!("../assets/fontes/BricolageGrotesque-Bold.ttf")),
        Cow::Borrowed(include_bytes!("../assets/fontes/BricolageGrotesque-ExtraBold.ttf")),
    ];
    if let Err(e) = cx.text_system().add_fonts(fontes) {
        eprintln!("[fontes] {e}");
    }
}

/// O conteúdo e o viewBox de `<symbol id="{id}" viewBox="...">...</symbol>`.
fn simbolo<'a>(sprite: &'a str, id: &str) -> Option<(&'a str, &'a str)> {
    let ini = sprite.find(&format!("<symbol id=\"{id}\""))?;
    let abre = ini + sprite[ini..].find('>')?;
    let fim = abre + sprite[abre..].find("</symbol>")?;
    let tag = &sprite[ini..abre];
    let vb = tag.split("viewBox=\"").nth(1)?.split('"').next()?;
    Some((vb, &sprite[abre + 1..fim]))
}

/// Um ícone como SVG avulso. O traço do sprite é o do Lucide (2), como no
/// CSS do app; `traco` troca quando um lugar pede outro.
pub fn icone_svg(nome: &str, traco: f32) -> Option<String> {
    let (vb, corpo) = simbolo(ICONES, &format!("i-{nome}"))?;
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" fill="none" stroke="black" stroke-width="{traco}" stroke-linecap="round" stroke-linejoin="round">{corpo}</svg>"#
    ))
}

/// Um emoji colorido, pronto para `img()` (com os canais trocados: ver `trocar_rb`).
pub fn emoji(nome: &str) -> Option<Arc<Image>> {
    let (vb, corpo) = simbolo(EMOJIS, &format!("e-{nome}"))?;
    let svg = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{corpo}</svg>"#);
    Some(Arc::new(Image::from_bytes(ImageFormat::Svg, trocar_rb(&svg).into_bytes())))
}

/// O GPUI 0.2.2 desenha um SVG em `img()` com vermelho e azul trocados; trocar
/// as cores hex do texto antes compensa. (Cores por nome ou imagens embutidas
/// no SVG não são cobertas: para essas, `ui::palco::arte::svg_nitido`.)
pub fn trocar_rb(svg: &str) -> String {
    let b = svg.as_bytes();
    let mut s = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |n: usize| i + n < b.len() && b[i + 1..=i + n].iter().all(u8::is_ascii_hexdigit) && !b.get(i + n + 1).is_some_and(u8::is_ascii_hexdigit);
        if b[i] == b'#' && hex(6) {
            s.extend_from_slice(&[b'#', b[i + 5], b[i + 6], b[i + 3], b[i + 4], b[i + 1], b[i + 2]]);
            i += 7;
        } else if b[i] == b'#' && hex(3) {
            s.extend_from_slice(&[b'#', b[i + 3], b[i + 2], b[i + 1]]);
            i += 4;
        } else {
            s.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(s).unwrap_or_else(|_| svg.to_string())
}

pub struct Recursos;

impl AssetSource for Recursos {
    /// `icone/mic.svg` (traço 2) ou `icone/mic@1.75.svg` (outro traço).
    fn load(&self, caminho: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let Some(nome) = caminho.strip_prefix("icone/").and_then(|p| p.strip_suffix(".svg")) else { return Ok(None) };
        let (nome, traco) = match nome.split_once('@') {
            Some((n, t)) => (n, t.parse().unwrap_or(2.0)),
            None => (nome, 2.0),
        };
        Ok(icone_svg(nome, traco).map(|s| Cow::Owned(s.into_bytes())))
    }

    fn list(&self, _: &str) -> Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn icones_e_emojis_saem_dos_sprites_do_app() {
        let mic = icone_svg("mic", 2.0).expect("o sprite tem o microfone");
        assert!(mic.starts_with("<svg") && mic.contains("viewBox=\"0 0 24 24\"") && mic.contains("<path"));
        assert!(icone_svg("nao-existe", 2.0).is_none());
        assert!(emoji("thumbs-up").is_some());
        let r = Recursos;
        assert!(r.load("icone/mic@1.75.svg").unwrap().is_some_and(|b| String::from_utf8_lossy(&b).contains("stroke-width=\"1.75\"")));
        assert!(r.load("outra/coisa.png").unwrap().is_none());
    }
}
