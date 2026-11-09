//! O que o CSS do app usa e o GPUI não traz pronto: letter-spacing,
//! degradês do CSS (lineares exatos, radiais pixel a pixel), tracejados no
//! passo do Chromium, as curvas do motion.js e a dica (`[data-tip]`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use gpui::{
    AnimationExt, Background, Corners, Font, FontWeight, Hsla, LineLayout, Pixels, RenderImage, Rgba, SharedString, TextRun, Window, canvas, div, fill, linear_color_stop, linear_gradient, point, prelude::*, px, size,
};

use super::super::tema::{Tema, raio, rgba_f, sombra};

/* ------------------------------ texto ------------------------------ */

fn layout(window: &Window, texto: &str, familia: &'static str, tamanho: f32, peso: FontWeight) -> Arc<LineLayout> {
    let run = TextRun { len: texto.len(), font: Font { weight: peso, ..gpui::font(familia) }, color: gpui::black(), background_color: None, underline: None, strikethrough: None };
    window.text_system().layout_line(texto, px(tamanho), &[run], None)
}

/// Largura com `letter-spacing` (o Chromium põe o espaço depois de cada letra, inclusive a última).
pub fn largura(window: &Window, texto: &str, familia: &'static str, tamanho: f32, peso: FontWeight, espaco: f32) -> f32 {
    f32::from(layout(window, texto, familia, tamanho, peso).width) + espaco * texto.chars().count() as f32
}

/// Uma linha de texto com `letter-spacing` em px (o GPUI não tem): cada glifo
/// é pintado deslocado, mantendo o kerning da fonte.
pub fn espacado(window: &Window, texto: &str, familia: &'static str, tamanho: f32, peso: FontWeight, espaco: f32, altura: f32, cor: Hsla) -> impl IntoElement + use<> {
    let l = layout(window, texto, familia, tamanho, peso);
    let w = f32::from(l.width) + espaco * texto.chars().count() as f32;
    let texto = texto.to_string();
    canvas(
        |_, _, _| (),
        move |b, _, window, _| {
            let base = b.origin.y + (px(altura) - l.ascent - l.descent) / 2. + l.ascent;
            for run in &l.runs {
                for g in &run.glyphs {
                    let n = texto[..g.index].chars().count() as f32;
                    let _ = window.paint_glyph(point(b.origin.x + g.position.x + px(espaco * n), base), run.font_id, g.id, px(tamanho), cor);
                }
            }
        },
    )
    .w(px(w))
    .h(px(altura))
    .flex_none()
}

/// `text-wrap: balance` em até duas linhas (o título da antessala): a quebra
/// que deixa as duas linhas mais parecidas; mais que isso, quebra gulosa.
pub fn equilibrar(window: &Window, texto: &str, familia: &'static str, tamanho: f32, peso: FontWeight, espaco: f32, max: f32) -> Vec<String> {
    let medir = |s: &str| largura(window, s, familia, tamanho, peso, espaco);
    let palavras: Vec<&str> = texto.split_whitespace().collect();
    if medir(texto) <= max || palavras.len() < 2 {
        return vec![texto.to_string()];
    }
    let melhor = (1..palavras.len())
        .map(|k| (palavras[..k].join(" "), palavras[k..].join(" ")))
        .filter(|(a, b)| medir(a) <= max && medir(b) <= max)
        .min_by(|(a, b), (c, d)| medir(a).max(medir(b)).total_cmp(&medir(c).max(medir(d))));
    if let Some((a, b)) = melhor {
        return vec![a, b];
    }
    let mut linhas: Vec<String> = Vec::new();
    for p in palavras {
        match linhas.last_mut() {
            Some(l) if medir(&format!("{l} {p}")) <= max => *l = format!("{l} {p}"),
            _ => linhas.push(p.to_string()),
        }
    }
    linhas
}

/* ------------------------------ cores ------------------------------ */

pub fn mistura(a: Hsla, b: Hsla, t: f32) -> Hsla {
    let (a, b): (Rgba, Rgba) = (a.into(), b.into());
    Rgba { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t }.into()
}

/// `linear-gradient(<ang>deg, c0, c1)` do CSS numa imagem de fundo `bw`×`bh`
/// na posição (`ox`, `oy`) de uma caixa `w`×`h` (background-size/position),
/// convertido no degradê do GPUI equivalente para a caixa. O GPUI não segue
/// a geometria do CSS (estica a direção pela proporção da caixa), então o
/// ângulo e as paradas são recalculados para dar a mesma cor em cada ponto.
#[allow(clippy::too_many_arguments)]
pub fn degrade_css(ang: f32, w: f32, h: f32, bw: f32, bh: f32, ox: f32, oy: f32, c0: Hsla, c1: Hsla) -> Background {
    let a = ang.to_radians();
    let dir = (a.sin(), -a.cos());
    let l = (bw * a.sin()).abs() + (bh * a.cos()).abs();
    // t do CSS no centro da caixa visível.
    let (cx, cy) = (w / 2. - (ox + bw / 2.), h / 2. - (oy + bh / 2.));
    let tc = (cx * dir.0 + cy * dir.1) / l + 0.5;
    // A direção do GPUI que, depois de esticada, aponta para `dir` (um fio
    // de folga para o shader não ficar no empate entre largura e altura).
    let phi = (dir.1 * w * 1.0005).atan2(dir.0 * h);
    let d = if w > h { (phi.cos(), phi.sin() * h / w) } else { (phi.cos() * w / h, phi.sin()) };
    let n = if d.0.abs() > d.1.abs() { w } else { h };
    let passo = l / n;
    let s0 = 0.5 - tc * passo;
    linear_gradient((phi.to_degrees() + 90.).rem_euclid(360.), linear_color_stop(c0, s0), linear_color_stop(c1, s0 + passo))
}

/// Φ, a normal acumulada (Abramowitz-Stegun 7.1.26), para o borrão do CSS.
pub fn phi(x: f32) -> f32 {
    let z = x.abs() / std::f32::consts::SQRT_2;
    let t = 1. / (1. + 0.327_591_1 * z);
    let erf = 1. - (((((1.061_405_4 * t - 1.453_152_1) * t) + 1.421_413_7) * t - 0.284_496_74) * t + 0.254_829_6) * t * (-z * z).exp();
    0.5 * (1. + erf.copysign(x))
}

/* ------------------------------ fundos gerados ------------------------------ */

thread_local! {
    static GERADAS: RefCell<HashMap<&'static str, ((u32, u32, u64), Arc<RenderImage>)>> = RefCell::new(HashMap::new());
}

/// Um fundo calculado pixel a pixel (os degradês radiais do CSS, que o GPUI
/// não tem), no tamanho exato do elemento em pixels da tela. Refeito só
/// quando o tamanho ou a `assinatura` (o tema) mudam. `cor(x, y, w, h)` em px CSS.
pub fn fundo(chave: &'static str, assinatura: u64, raios: Corners<Pixels>, cor: impl Fn(f32, f32, f32, f32) -> Rgba + 'static) -> impl IntoElement + Styled {
    canvas(
        move |b, window, _| {
            let s = window.scale_factor();
            let (bw, bh) = (f32::from(b.size.width), f32::from(b.size.height));
            let (w, h) = ((bw * s).ceil().max(1.) as u32, (bh * s).ceil().max(1.) as u32);
            GERADAS.with(|g| {
                let mut g = g.borrow_mut();
                if let Some((k, img)) = g.get(chave)
                    && *k == (w, h, assinatura)
                {
                    return img.clone();
                }
                let mut px_ = vec![0u8; (w * h * 4) as usize];
                for y in 0..h {
                    for x in 0..w {
                        let c = cor((x as f32 + 0.5) / s, (y as f32 + 0.5) / s, bw, bh);
                        let i = ((y * w + x) * 4) as usize;
                        // O GPUI guarda as imagens em BGRA.
                        px_[i..i + 4].copy_from_slice(&[(c.b * 255.).round() as u8, (c.g * 255.).round() as u8, (c.r * 255.).round() as u8, (c.a * 255.).round() as u8]);
                    }
                }
                let img = Arc::new(RenderImage::new(vec![image::Frame::new(image::RgbaImage::from_raw(w, h, px_).expect("tamanho"))]));
                if let Some((_, velha)) = g.insert(chave, ((w, h, assinatura), img.clone())) {
                    let _ = window.drop_image(velha);
                }
                img
            })
        },
        move |b, img, window, _| {
            let _ = window.paint_image(b, raios, img, 0, false);
        },
    )
}

/// Um tracejado no passo do Chromium: traços de `traco` px, vãos perto de
/// `vao` px, ajustados para começar e terminar num traço.
pub fn tracejado(vertical: bool, traco: f32, vao: f32, cor: Hsla) -> impl IntoElement + Styled {
    canvas(
        |_, _, _| (),
        move |b, _, window, _| {
            let (comp, esp) = if vertical { (f32::from(b.size.height), f32::from(b.size.width)) } else { (f32::from(b.size.width), f32::from(b.size.height)) };
            let n = ((comp + vao) / (traco + vao)).round().max(1.);
            let vao = if n > 1. { (comp - n * traco) / (n - 1.) } else { 0. };
            for i in 0..n as usize {
                let p = i as f32 * (traco + vao);
                let (o, s) = if vertical { (point(b.origin.x, b.origin.y + px(p)), size(px(esp), px(traco))) } else { (point(b.origin.x + px(p), b.origin.y), size(px(traco), px(esp))) };
                window.paint_quad(fill(gpui::Bounds::new(o, s), cor));
            }
        },
    )
}

/* ------------------------------ movimento ------------------------------ */

/// `cubic-bezier(x1, y1, x2, y2)` em `u` ∈ [0, 1].
pub fn bezier(x1: f32, y1: f32, x2: f32, y2: f32, u: f32) -> f32 {
    let u = u.clamp(0., 1.);
    let c = |a: f32, b: f32, t: f32| 3. * a * t * (1. - t) * (1. - t) + 3. * b * t * t * (1. - t) + t * t * t;
    let (mut lo, mut hi) = (0f32, 1f32);
    for _ in 0..30 {
        let m = (lo + hi) / 2.;
        if c(x1, x2, m) < u { lo = m } else { hi = m }
    }
    c(y1, y2, (lo + hi) / 2.)
}

/// `--ease-out` (tokens.css:89).
pub fn ease_out(u: f32) -> f32 {
    bezier(0.22, 1., 0.36, 1., u)
}

/// A mola do motion.js (`spring`), em segundos: (duração, posição em t).
pub fn mola(rigidez: f32, amortecimento: f32) -> (f32, impl Fn(f32) -> f32) {
    let w0 = rigidez.sqrt();
    let zeta = amortecimento / (2. * rigidez.sqrt());
    let wd = w0 * (1. - zeta * zeta).max(0.).sqrt();
    let x = move |t: f32| if zeta < 1. { 1. - (-zeta * w0 * t).exp() * ((wd * t).cos() + (zeta * w0 / wd) * (wd * t).sin()) } else { 1. - (-w0 * t).exp() * (1. + w0 * t) };
    let mut fim = 0f32;
    let mut t = 0f32;
    while t < 3. {
        if (1. - x(t)).abs() > 0.001 {
            fim = t;
        }
        t += 1. / 120.;
    }
    let fim = fim.max(0.12);
    (fim, move |t: f32| if t >= fim { 1. } else { x(t.max(0.)) })
}

/// `rise()` (motion.js:75) em `t` segundos depois do atraso: (opacidade,
/// deslocamento em y). Escala e desfoque o GPUI não faz em div.
pub fn subir(t: f32, y: f32) -> (f32, f32) {
    let (_, m) = mola(300., 17.);
    (ease_out(t / 0.38), y * (1. - m(t)))
}

/* ------------------------------ dica ------------------------------ */

/// A dica do app (`[data-tip]::after`, base.css:351), centrada sobre (ou
/// sob) o elemento pai, que precisa ser `relative`. Pintada por último para
/// ficar por cima do que vem depois.
pub fn dica(texto: impl Into<SharedString>, abaixo: bool, t: &Tema) -> impl IntoElement {
    let texto: SharedString = texto.into();
    let bolha = div()
        .px(px(12.))
        .py(px(4.))
        .rounded(px(raio::SM))
        .bg(t.brand_ink)
        .text_color(gpui::white())
        .text_size(px(12.))
        .line_height(px(18.))
        .font_weight(FontWeight::MEDIUM)
        .whitespace_nowrap()
        .shadow(sombra_md(t))
        .child(texto.clone());
    let caixa = div().absolute().left_0().right_0().flex().justify_center();
    let caixa = if abaixo { caixa.top(gpui::relative(1.)).mt(px(10.)) } else { caixa.bottom(gpui::relative(1.)).mb(px(10.)) };
    gpui::deferred(caixa.child(bolha.with_animation(texto, gpui::Animation::new(std::time::Duration::from_millis(120)).with_easing(ease_out), move |b, d| {
        let y = 4. * (1. - d) * if abaixo { -1. } else { 1. };
        b.opacity(d).relative().top(px(y))
    })))
    .with_priority(3)
}

/// `--shadow-md` com o borrão do CSS (o GPUI usa o desvio, metade do borrão).
pub fn sombra_md(t: &Tema) -> Vec<gpui::BoxShadow> {
    if t.escuro { vec![sombra(0., 8., 12., -8., rgba_f(0., 0., 0., 0.65))] } else { vec![sombra(0., 8., 12., -10., rgba_f(22., 16., 63., 0.2))] }
}

/// `--shadow-lg`, idem.
pub fn sombra_lg(t: &Tema) -> Vec<gpui::BoxShadow> {
    if t.escuro { vec![sombra(0., 24., 28., -16., rgba_f(0., 0., 0., 0.75))] } else { vec![sombra(0., 24., 28., -18., rgba_f(22., 16., 63., 0.26))] }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn curvas_e_mola() {
        assert!((ease_out(0.) - 0.).abs() < 1e-3 && (ease_out(1.) - 1.).abs() < 1e-3 && ease_out(0.5) > 0.8);
        // Mesmos números do motion.js: bouncy ≈ 725 ms, snappy ≈ 342 ms.
        assert!((mola(300., 17.).0 - 0.725).abs() < 0.01, "{}", mola(300., 17.).0);
        assert!((mola(520., 34.).0 - 0.342).abs() < 0.01);
        assert!((phi(0.) - 0.5).abs() < 1e-4 && (phi(1.68) - 0.9535).abs() < 1e-3);
    }

    #[test]
    fn degrade_igual_ao_do_css() {
        // Reproduz o shader do GPUI (shaders.hlsl gradient_color) e compara com o t do CSS.
        let (w, h, bw, ox) = (196.8f32, 56f32, 334.56f32, -40f32);
        let fundo = degrade_css(135., w, h, bw, h, ox, 0., gpui::black(), gpui::white());
        let ang = fundo_angulo(&fundo);
        let r = (ang - 90.).to_radians();
        let mut d = (r.cos(), r.sin());
        if w > h { d.1 *= h / w } else { d.0 *= w / h }
        let (s0, s1) = fundo_paradas(&fundo);
        for (x, y) in [(0f32, 0f32), (w, h), (w / 3., h / 2.), (w, 0.)] {
            let mut t = ((x - w / 2.) * d.0 + (y - h / 2.) * d.1) / (d.0 * d.0 + d.1 * d.1).sqrt();
            t = if d.0.abs() > d.1.abs() { (t + w / 2.) / w } else { (t + h / 2.) / h };
            let gpui_t = ((t - s0) / (s1 - s0)).clamp(0., 1.);
            let a = 135f32.to_radians();
            let l = (bw * a.sin()).abs() + (h * a.cos()).abs();
            let css_t = (((x - (ox + bw / 2.)) * a.sin() + (y - h / 2.) * -a.cos()) / l + 0.5).clamp(0., 1.);
            assert!((gpui_t - css_t).abs() < 0.01, "({x},{y}): gpui {gpui_t} css {css_t}");
        }
    }

    // O Background do GPUI não expõe os campos; o Serialize expõe.
    fn fundo_angulo(b: &Background) -> f32 {
        serde_json::to_value(b).unwrap()["gradient_angle_or_pattern_height"].as_f64().unwrap() as f32
    }

    fn fundo_paradas(b: &Background) -> (f32, f32) {
        let v = serde_json::to_value(b).unwrap();
        (v["colors"][0]["percentage"].as_f64().unwrap() as f32, v["colors"][1]["percentage"].as_f64().unwrap() as f32)
    }
}
