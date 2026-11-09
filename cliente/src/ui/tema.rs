//! Os tokens do app web (public/css/tokens.css + paletas.css, visual "vcall",
//! paleta "tinta"), resolvidos para os dois temas. O tema segue o sistema,
//! como o app (sem `data-theme`, vale o `prefers-color-scheme`).
//!
//! Fonte: a ficha extraída do CSS (seção 1). Mudou o CSS, muda aqui.

use gpui::{BoxShadow, Hsla, Rgba, Window, WindowAppearance, point, px, rgb, rgba};

#[derive(Clone, Copy)]
pub struct Tema {
    pub escuro: bool,
    pub bg: Hsla,
    pub bg_elevated: Hsla,
    pub surface: Hsla,
    pub surface_2: Hsla,
    pub surface_3: Hsla,
    pub surface_hover: Hsla,
    pub border: Hsla,
    pub border_strong: Hsla,
    pub border_subtle: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub text_muted: Hsla,
    pub text_inverse: Hsla,
    pub tile_bg: Hsla,
    pub tile_glow: Hsla,
    pub accent: Hsla,
    pub accent_soft: Hsla,
    pub accent_text: Hsla,
    pub accent_2: Hsla,
    pub accent_2_soft: Hsla,
    pub ok: Hsla,
    pub ok_soft: Hsla,
    pub warn: Hsla,
    pub warn_soft: Hsla,
    pub danger: Hsla,
    pub danger_hover: Hsla,
    pub danger_soft: Hsla,
    /// Fundo das dicas (tooltip), igual nos dois temas.
    pub brand_ink: Hsla,
    pub scrim: Hsla,
    pub glow_opacity: f32,
    /// As duas pontas do degradê da marca (rosa -> laranja da paleta).
    pub gradiente: (Hsla, Hsla),
    /// A cor dos símbolos de min/max/fechar (desktop/main.js `coresDaBarra`).
    pub simbolo_barra: Hsla,
}

fn c(v: u32) -> Hsla {
    rgb(v).into()
}

fn ca(v: u32) -> Hsla {
    rgba(v).into()
}

impl Tema {
    pub fn de(window: &Window) -> Tema {
        match preferencia() {
            1 => return Tema::claro(),
            2 => return Tema::escuro(),
            _ => {}
        }
        // VCALL_TEMA=claro|escuro força um (fotos de comparação nos dois temas).
        match std::env::var("VCALL_TEMA").as_deref() {
            Ok("claro") => return Tema::claro(),
            Ok("escuro") => return Tema::escuro(),
            _ => {}
        }
        match window.appearance() {
            WindowAppearance::Dark | WindowAppearance::VibrantDark => Tema::escuro(),
            _ => Tema::claro(),
        }
    }

    pub fn escuro() -> Tema {
        Tema {
            escuro: true,
            bg: c(0x0d1218),
            bg_elevated: c(0x161b21),
            surface: c(0x1e2329),
            surface_2: c(0x262b32),
            surface_3: c(0x31373e),
            surface_hover: c(0x2c3138),
            border: c(0x31373e),
            border_strong: c(0x474e55),
            border_subtle: c(0x1f242a),
            text: c(0xeef0f3),
            text_secondary: c(0xb2b6ba),
            text_muted: c(0x9fa3a8),
            text_inverse: c(0x0d1218),
            tile_bg: c(0x11171c),
            tile_glow: c(0x1f252b),
            accent: c(0xfd4d87),
            accent_soft: ca(0xfd4d8729),
            accent_text: c(0xffffff),
            accent_2: c(0xfe9c5f),
            accent_2_soft: ca(0xfe9c5f29),
            ok: c(0x37d399),
            ok_soft: ca(0x37d39926),
            warn: c(0xffb648),
            warn_soft: ca(0xffb64826),
            danger: c(0xff5470),
            danger_hover: c(0xff6d85),
            danger_soft: ca(0xff547029),
            brand_ink: c(0x110c3a),
            scrim: c(0x050a0f),
            glow_opacity: 0.22,
            gradiente: (c(0xfd4d87), c(0xfe9c5f)),
            simbolo_barra: c(0xa8b1c2),
        }
    }

    pub fn claro() -> Tema {
        Tema {
            escuro: false,
            bg: c(0xf2f6fa),
            bg_elevated: c(0xffffff),
            surface: c(0xffffff),
            surface_2: c(0xedf1f6),
            surface_3: c(0xe1e7ed),
            surface_hover: c(0xe7ecf1),
            border: c(0xd4dae0),
            border_strong: c(0xb8bec6),
            border_subtle: c(0xe3e8ed),
            text: c(0x1b1e22),
            text_secondary: c(0x4c5055),
            text_muted: c(0x5c6267),
            text_inverse: c(0xffffff),
            tile_bg: c(0x1f2328),
            tile_glow: c(0x31363b),
            accent: c(0xc21f55),
            accent_soft: ca(0xc21f5529),
            accent_text: c(0xffffff),
            accent_2: c(0x9c5212),
            accent_2_soft: ca(0x9c521229),
            ok: c(0x0f8f63),
            ok_soft: ca(0x0f8f631f),
            warn: c(0xa96a05),
            warn_soft: ca(0xa96a051f),
            danger: c(0xd32848),
            danger_hover: c(0xb81f3c),
            danger_soft: ca(0xd328481a),
            brand_ink: c(0x110c3a),
            scrim: c(0x2a2e33),
            glow_opacity: 0.13,
            gradiente: (c(0xc21f55), c(0x9c5212)),
            simbolo_barra: c(0x3c4654),
        }
    }

    /// `--shadow-md` (dicas).
    pub fn sombra_md(&self) -> Vec<BoxShadow> {
        let (y, blur, spread, cor) = if self.escuro { (8., 24., -8., rgba_f(0., 0., 0., 0.65)) } else { (8., 24., -10., rgba_f(22., 16., 63., 0.2)) };
        vec![sombra(0., y, blur, spread, cor)]
    }

    /// `--shadow-lg` (menus, avisos, janelas).
    pub fn sombra_lg(&self) -> Vec<BoxShadow> {
        let (y, blur, spread, cor) = if self.escuro { (24., 56., -16., rgba_f(0., 0., 0., 0.75)) } else { (24., 56., -18., rgba_f(22., 16., 63., 0.26)) };
        vec![sombra(0., y, blur, spread, cor)]
    }
}

static PREFERENCIA: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// O botão de tema (theme.js): 0 = o do sistema, 1 = claro, 2 = escuro.
pub fn preferencia() -> u8 {
    PREFERENCIA.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn definir_preferencia(modo: u8) {
    PREFERENCIA.store(modo % 3, std::sync::atomic::Ordering::Relaxed);
}

/// Raios (tokens.css:81-86 e os do call.css).
pub mod raio {
    pub const XS: f32 = 6.;
    pub const SM: f32 = 9.;
    pub const MD: f32 = 13.;
    pub const LG: f32 = 18.;
    pub const XL: f32 = 24.;
    pub const TILE: f32 = 22.;
    pub const CTRL: f32 = 16.;
    pub const DOCK: f32 = 26.;
}

/// Escala de texto (tokens.css:50-58), em px.
pub mod texto {
    pub const XXS: f32 = 11.;
    pub const XS: f32 = 12.;
    pub const SM: f32 = 13.;
    pub const BASE: f32 = 15.;
    pub const MD: f32 = 16.;
    pub const LG: f32 = 18.;
    pub const XL: f32 = 22.;
    pub const XXL: f32 = 28.;
    pub const XXXL: f32 = 36.;
}

/// Fonte do corpo: a do sistema (no Windows o Chromium resolve para Segoe UI).
pub const FONTE: &str = if cfg!(windows) {
    "Segoe UI"
} else if cfg!(target_os = "macos") {
    ".SystemUIFont"
} else {
    "Noto Sans"
};
/// Fonte de destaque (títulos, "Entrar na sala").
pub const FONTE_DISPLAY: &str = "Bricolage Grotesque";

pub fn rgba_f(r: f32, g: f32, b: f32, a: f32) -> Hsla {
    Rgba { r: r / 255., g: g / 255., b: b / 255., a }.into()
}

pub fn sombra(x: f32, y: f32, blur: f32, spread: f32, cor: Hsla) -> BoxShadow {
    BoxShadow { color: cor, offset: point(px(x), px(y)), blur_radius: px(blur), spread_radius: px(spread) }
}

/// Sombra do ladrilho e da barra (iguais nos dois temas; call.css:60 e :138).
pub fn sombra_tile() -> Vec<BoxShadow> {
    vec![sombra(0., 16., 36., -22., rgba_f(0., 0., 0., 0.7))]
}

pub fn sombra_dock() -> Vec<BoxShadow> {
    vec![sombra(0., 22., 48., -22., rgba_f(0., 0., 0., 0.65)), sombra(0., 2., 6., -2., rgba_f(0., 0., 0., 0.3))]
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn tokens_iguais_aos_da_paleta_tinta() {
        // As cores-chave conferidas contra public/css/paletas.css (bloco da paleta "tinta").
        let css = include_str!("../../../public/css/paletas.css");
        for hex in ["#0d1218", "#161b21", "#262b32", "#fd4d87", "#f2f6fa", "#edf1f6", "#c21f55"] {
            assert!(css.to_lowercase().contains(hex), "{hex} não está em paletas.css");
        }
        let (e, c) = (Tema::escuro(), Tema::claro());
        assert!(e.escuro && !c.escuro);
        assert_ne!(e.bg, c.bg);
    }
}
