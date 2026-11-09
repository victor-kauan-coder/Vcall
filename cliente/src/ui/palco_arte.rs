//! O que o CSS do palco faz e o GPUI 0.2.2 não tem pronto: degradê radial e
//! cônico, `letter-spacing`, vídeo com `object-fit: cover` E cantos
//! redondos, SVG nítido (e nas cores certas), molas, transições e as contas
//! de cor em OKLCH do fundo do avatar.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use gpui::{
    App, BorderStyle, Bounds, ContentMask, Corners, Font, Hsla, Image, ImageFormat, IntoElement, Pixels, RenderImage, Rgba, Styled, TextRun, Window, canvas, point, px,
    quad, transparent_black,
};

/* ------------------------------ cores ------------------------------ */

pub fn rgba(c: Hsla) -> Rgba {
    c.into()
}

pub fn hex(v: u32) -> Hsla {
    gpui::rgb(v).into()
}

pub fn alfa(c: Hsla, a: f32) -> Hsla {
    Hsla { a: c.a * a, ..c }
}

/// Mistura em sRGB (como a transição do CSS entre duas cores opacas).
pub fn misturar(a: Hsla, b: Hsla, t: f32) -> Hsla {
    let (a, b) = (rgba(a), rgba(b));
    let l = |x: f32, y: f32| x + (y - x) * t;
    Rgba { r: l(a.r, b.r), g: l(a.g, b.g), b: l(a.b, b.b), a: l(a.a, b.a) }.into()
}

/// `filter: saturate(0)` (matriz de luminância do CSS).
pub fn cinza(c: Hsla) -> Hsla {
    let c = rgba(c);
    let y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    Rgba { r: y, g: y, b: y, a: c.a }.into()
}

fn lin(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}
fn gama(c: f32) -> f32 {
    let c = c.clamp(0., 1.);
    if c <= 0.003_130_8 { 12.92 * c } else { 1.055 * c.powf(1. / 2.4) - 0.055 }
}

/// sRGB (0-1) -> OKLCH (L, C, h em radianos).
pub fn oklch(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (r, g, b) = (lin(r), lin(g), lin(b));
    let l = (0.412_221_47 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    let ll = 0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s;
    let a = 1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s;
    let bb = 0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s;
    (ll, (a * a + bb * bb).sqrt(), bb.atan2(a))
}

/// `oklch(L C h / a)` -> cor (fora da gama: corta, como o navegador).
pub fn de_oklch(ll: f32, c: f32, h: f32, a: f32) -> Hsla {
    let (aa, bb) = (c * h.cos(), c * h.sin());
    let l = (ll + 0.396_337_78 * aa + 0.215_803_76 * bb).powi(3);
    let m = (ll - 0.105_561_346 * aa - 0.063_854_17 * bb).powi(3);
    let s = (ll - 0.089_484_18 * aa - 1.291_485_5 * bb).powi(3);
    let r = 4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s;
    let g = -1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s;
    let b = -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s;
    Rgba { r: gama(r), g: gama(g), b: gama(b), a }.into()
}

/// A cor principal do avatar (ui/avatars.js `extrairCor`): 32x32, caixas de
/// 4 bits por canal, peso = quantidade x (0,08 + saturação), escuros valem 0,1.
pub fn cor_principal(img: &RenderImage) -> Option<[f32; 3]> {
    let dados = img.as_bytes(0)?;
    let tam = img.size(0);
    let (w, h) = (tam.width.0 as usize, tam.height.0 as usize);
    if w == 0 || h == 0 {
        return None;
    }
    let mut caixas: HashMap<u32, (f32, f32, f32, f32)> = HashMap::new();
    for j in 0..32 {
        for i in 0..32 {
            let p = ((j * h / 32 + h / 64).min(h - 1) * w + (i * w / 32 + w / 64).min(w - 1)) * 4;
            let (b, g, r, a) = (dados[p] as u32, dados[p + 1] as u32, dados[p + 2] as u32, dados[p + 3]);
            if a < 200 {
                continue;
            }
            let c = caixas.entry(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)).or_default();
            *c = (c.0 + 1., c.1 + r as f32, c.2 + g as f32, c.3 + b as f32);
        }
    }
    let mut melhor = None;
    let mut maior = 0.;
    for (n, r, g, b) in caixas.into_values() {
        let cor = [r / n, g / n, b / n];
        let max = cor[0].max(cor[1]).max(cor[2]);
        let sat = if max > 0. { (max - cor[0].min(cor[1]).min(cor[2])) / max } else { 0. };
        let peso = n * (0.08 + sat) * if max < 40. { 0.1 } else { 1. };
        if peso > maior {
            (melhor, maior) = (Some(cor.map(|v| v.round() / 255.)), peso);
        }
    }
    melhor
}

/* ------------------------------ curvas ------------------------------ */

/// `cubic-bezier(x1, y1, x2, y2)` em `x` (0-1).
pub fn bezier(x1: f32, y1: f32, x2: f32, y2: f32, x: f32) -> f32 {
    let curva = |t: f32, a: f32, b: f32| 3. * a * t * (1. - t).powi(2) + 3. * b * t * t * (1. - t) + t.powi(3);
    let (mut lo, mut hi) = (0f32, 1f32);
    for _ in 0..24 {
        let m = (lo + hi) / 2.;
        if curva(m, x1, x2) < x { lo = m } else { hi = m }
    }
    curva((lo + hi) / 2., y1, y2)
}

/// `--ease-out` (tokens.css).
pub fn ease_out(x: f32) -> f32 {
    bezier(0.22, 1., 0.36, 1., x.clamp(0., 1.))
}

/// A mola de ui/motion.js, em `t` segundos (passa de 1 no balanço).
pub fn mola(rigidez: f32, amortecimento: f32, t: f32) -> f32 {
    let w0 = rigidez.sqrt();
    let z = amortecimento / (2. * rigidez.sqrt());
    if z < 1. {
        let wd = w0 * (1. - z * z).sqrt();
        1. - (-z * w0 * t).exp() * ((wd * t).cos() + (z * w0 / wd) * (wd * t).sin())
    } else {
        1. - (-w0 * t).exp() * (1. + w0 * t)
    }
}

/// `SPRING.bouncy` (300/17, 725 ms).
pub fn bouncy(t: f32) -> f32 {
    if t >= 0.725 { 1. } else { mola(300., 17., t.max(0.)) }
}

/* ---------------------------- transições ---------------------------- */

struct Trans {
    alvo: bool,
    de: f32,
    t0: Instant,
    dur: f32,
}

/// `transition: X <dur> var(--ease-out)` entre dois estados: 0 = desligado,
/// 1 = ligado. A volta parte de onde a ida estava, como no navegador.
#[derive(Default)]
pub struct Transicoes(HashMap<String, Trans>);

impl Transicoes {
    pub fn valor(&mut self, chave: &str, alvo: bool, dur_ms: f32, window: &mut Window) -> f32 {
        let agora = Instant::now();
        let calc = |e: &Trans| {
            let p = (agora - e.t0).as_secs_f32() * 1000. / e.dur.max(1.);
            (e.de + (alvo_f(e.alvo) - e.de) * ease_out(p), p < 1.)
        };
        let e = self.0.entry(chave.to_string()).or_insert(Trans { alvo, de: alvo_f(alvo), t0: agora, dur: 0. });
        if e.alvo != alvo {
            let (atual, _) = calc(e);
            *e = Trans { alvo, de: atual, t0: agora, dur: dur_ms };
        }
        let (v, andando) = calc(e);
        if andando {
            window.request_animation_frame();
        }
        v
    }
}

fn alvo_f(b: bool) -> f32 {
    if b { 1. } else { 0. }
}

/// O que está com o mouse em cima (on_hover de cada peça).
#[derive(Default)]
pub struct Sob(pub HashSet<String>);

impl Sob {
    pub fn marcar(&mut self, chave: &str, sim: bool) {
        if sim {
            self.0.insert(chave.to_string());
        } else {
            self.0.remove(chave);
        }
    }
    pub fn tem(&self, chave: &str) -> bool {
        self.0.contains(chave)
    }
}

/* --------------------------- imagens geradas --------------------------- */

/// Uma imagem BGRA (o formato das texturas do GPUI) a partir de uma função
/// de cor por ponto (coordenadas lógicas), em metade da resolução da tela:
/// degradês são lisos e o GPU amplia sem degrau.
pub fn gerar(w: f32, h: f32, escala: f32, cor: impl Fn(f32, f32) -> [f32; 4]) -> Arc<RenderImage> {
    let (gw, gh) = (((w * escala).ceil() as u32).max(1), ((h * escala).ceil() as u32).max(1));
    let mut px = Vec::with_capacity((gw * gh * 4) as usize);
    for j in 0..gh {
        for i in 0..gw {
            let [r, g, b, a] = cor((i as f32 + 0.5) / gw as f32 * w, (j as f32 + 0.5) / gh as f32 * h);
            px.extend_from_slice(&[(b * 255.).round() as u8, (g * 255.).round() as u8, (r * 255.).round() as u8, (a * 255.).round() as u8]);
        }
    }
    bgra(gw, gh, px)
}

pub fn bgra(w: u32, h: u32, px: Vec<u8>) -> Arc<RenderImage> {
    let img = image::RgbaImage::from_raw(w, h, px).expect("tamanho do buffer");
    Arc::new(RenderImage::new(vec![image::Frame::new(img)]))
}

/// `a` por cima de `b` (as duas em RGBA 0-1, `b` opaca).
pub fn sobre(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [a[0] * a[3] + b[0] * (1. - a[3]), a[1] * a[3] + b[1] * (1. - a[3]), a[2] * a[3] + b[2] * (1. - a[3]), 1.]
}

pub fn v4(c: Hsla) -> [f32; 4] {
    let c = rgba(c);
    [c.r, c.g, c.b, c.a]
}

pub fn lerp4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let t = t.clamp(0., 1.);
    [0, 1, 2, 3].map(|i| a[i] + (b[i] - a[i]) * t)
}

/// Grão fino (o feTurbulence do fundo do avatar): branco a ~3%.
pub fn grao(x: f32, y: f32) -> f32 {
    // lowbias32: sem listras de linha ou coluna.
    let mut n = ((x * 2.) as u32).wrapping_add(((y * 2.) as u32).wrapping_mul(0x9e37_79b9));
    n = (n ^ (n >> 16)).wrapping_mul(0x7feb_352d);
    n = (n ^ (n >> 15)).wrapping_mul(0x846c_a68b);
    n ^= n >> 16;
    0.06 * (0.2 + 0.6 * (n & 0xffff) as f32 / 65535.)
}

/// Imagens que dependem do tamanho do lugar (degradês, recortes de vídeo):
/// uma por chave; a velha sai da placa de vídeo quando a nova entra.
#[derive(Default)]
pub struct Cache(HashMap<String, (String, Arc<RenderImage>)>);

pub type CacheRc = Rc<RefCell<Cache>>;

impl Cache {
    /// A imagem de `chave` feita com `assinatura`; refaz quando ela muda.
    pub fn obter(&mut self, chave: &str, assinatura: String, fazer: impl FnOnce() -> Arc<RenderImage>, window: &mut Window) -> Arc<RenderImage> {
        if let Some((a, img)) = self.0.get(chave)
            && *a == assinatura
        {
            return img.clone();
        }
        let img = fazer();
        if let Some((_, velha)) = self.0.insert(chave.to_string(), (assinatura, img.clone())) {
            let _ = window.drop_image(velha);
        }
        img
    }

    /// Solta o que não está mais na tela.
    pub fn reter(&mut self, vivo: impl Fn(&str) -> bool, window: &mut Window) {
        let fora: Vec<String> = self.0.keys().filter(|k| !vivo(k)).cloned().collect();
        for k in fora {
            if let Some((_, img)) = self.0.remove(&k) {
                let _ = window.drop_image(img);
            }
        }
    }
}

/// O quadro de vídeo recortado no formato do lugar (`object-fit: cover`) e,
/// na própria câmera, espelhado. O GPUI arredonda os cantos da imagem
/// desenhada, não do recorte: sem cortar aqui, o `cover` saía de cantos
/// quadrados.
pub fn recorte(fonte: &RenderImage, aspecto: Option<f32>, espelhar: bool) -> Option<Arc<RenderImage>> {
    let dados = fonte.as_bytes(0)?;
    let t = fonte.size(0);
    let (w, h) = (t.width.0 as usize, t.height.0 as usize);
    let (cw, ch) = match aspecto {
        Some(a) if (w as f32 / h as f32) > a => (((h as f32 * a).round() as usize).clamp(1, w), h),
        Some(a) => (w, ((w as f32 / a).round() as usize).clamp(1, h)),
        None => (w, h),
    };
    let (x0, y0) = ((w - cw) / 2, (h - ch) / 2);
    let mut px = Vec::with_capacity(cw * ch * 4);
    for j in y0..y0 + ch {
        let linha = &dados[(j * w + x0) * 4..(j * w + x0 + cw) * 4];
        if espelhar {
            for p in linha.chunks_exact(4).rev() {
                px.extend_from_slice(p);
            }
        } else {
            px.extend_from_slice(linha);
        }
    }
    Some(bgra(cw as u32, ch as u32, px))
}

thread_local! {
    static SVGS: RefCell<HashMap<(u64, u32, u32), Option<Arc<RenderImage>>>> = RefCell::new(HashMap::new());
}

/// SVG rasterizado no tamanho em que aparece (w x h pixels da tela): o
/// `img()` do GPUI desenha SVG no tamanho natural dele (borrado a 125%).
/// O raster do GPUI sai RGBA e o RenderImage quer BGRA: aqui os canais são
/// trocados (é por isso que o `img()` de um SVG sai com vermelho e azul
/// trocados no GPUI 0.2.2). Use isto para todo SVG colorido.
pub fn svg_nitido(img: &Image, w: u32, h: u32, cx: &App) -> Option<Arc<RenderImage>> {
    if img.format != ImageFormat::Svg {
        return None;
    }
    let chave = (img.id(), w, h);
    if let Some(r) = SVGS.with(|s| s.borrow().get(&chave).cloned()) {
        return r;
    }
    let texto = String::from_utf8_lossy(&img.bytes);
    let r = (|| {
        let ini = texto.find("<svg")?;
        let fim = ini + texto[ini..].find('>')?;
        let mut tag = texto[ini..fim].to_string();
        for attr in ["width", "height"] {
            if let Some(p) = tag.find(&format!(" {attr}=\"")) {
                let q = p + attr.len() + 3;
                let f = q + tag[q..].find('"')?;
                tag.replace_range(p..f + 1, "");
            }
        }
        let novo = format!("{}{tag} width=\"{w}\" height=\"{h}\"{}", &texto[..ini], &texto[fim..]);
        let rasc = Image::from_bytes(ImageFormat::Svg, novo.into_bytes()).to_image_data(cx.svg_renderer()).ok()?;
        let t = rasc.size(0);
        let mut px = rasc.as_bytes(0)?.to_vec();
        // Alfa pré-multiplicado (tiny-skia) -> direto, e RGBA -> BGRA.
        for p in px.chunks_exact_mut(4) {
            let a = p[3] as f32 / 255.;
            for v in &mut p[..3] {
                *v = if a > 0. { (*v as f32 / a).round().min(255.) as u8 } else { 0 };
            }
            p.swap(0, 2);
        }
        Some(bgra(t.width.0 as u32, t.height.0 as u32, px))
    })();
    SVGS.with(|s| s.borrow_mut().insert(chave, r.clone()));
    r
}

/* ------------------------------ anel cônico ------------------------------ */

/// Cor de um `conic-gradient` com paradas (cor, posição 0-1) em `t`.
pub fn conica(paradas: &[(Hsla, f32)], t: f32) -> Hsla {
    for par in paradas.windows(2) {
        let ((a, pa), (b, pb)) = (par[0], par[1]);
        if t <= pb {
            return misturar(a, b, ((t - pa) / (pb - pa).max(1e-4)).clamp(0., 1.));
        }
    }
    paradas.last().map_or(transparent_black(), |p| p.0)
}

/// Um contorno arredondado com degradê cônico girando (`from <giro>deg`).
/// O GPUI só pinta borda de uma cor: o contorno sai em fatias finas (máscaras
/// alinhadas aos pixels), cada uma na cor do seu ângulo visto do centro.
pub fn anel(b: Bounds<Pixels>, raio: f32, largura: f32, paradas: &[(Hsla, f32)], giro: f32, opacidade: f32, window: &mut Window) {
    if opacidade <= 0.001 {
        return;
    }
    let sf = window.scale_factor();
    let alinhar = |v: f32| (v * sf).round() / sf;
    let passo = (4. * sf).round().max(1.) / sf;
    let (x0, y0) = (alinhar(f32::from(b.origin.x)), alinhar(f32::from(b.origin.y)));
    let (x1, y1) = (alinhar(f32::from(b.origin.x) + f32::from(b.size.width)), alinhar(f32::from(b.origin.y) + f32::from(b.size.height)));
    let (cx, cy) = ((x0 + x1) / 2., (y0 + y1) / 2.);
    let lado = alinhar(raio + largura + 1.).min((x1 - x0) / 2.);
    let meio = alinhar(cy);
    let mut fatia = |xa: f32, ya: f32, xb: f32, yb: f32| {
        let (mx, my) = ((xa + xb) / 2., (ya + yb) / 2.);
        let ang = (mx - cx).atan2(cy - my).to_degrees();
        let cor = conica(paradas, ((ang - giro) / 360.).rem_euclid(1.));
        let mascara = ContentMask { bounds: Bounds::from_corners(point(px(xa), px(ya)), point(px(xb), px(yb))) };
        window.with_content_mask(Some(mascara), |w| w.paint_quad(quad(b, Corners::all(px(raio)), transparent_black(), px(largura), alfa(cor, opacidade), BorderStyle::Solid)));
    };
    let mut y = y0;
    while y < y1 {
        let yy = alinhar(y + passo).min(y1);
        fatia(x0, y, x0 + lado, yy);
        fatia(x1 - lado, y, x1, yy);
        y = yy;
    }
    let mut x = x0 + lado;
    while x < x1 - lado {
        let xx = alinhar(x + passo).min(x1 - lado);
        fatia(x, y0, xx, meio);
        fatia(x, meio, xx, y1);
        x = xx;
    }
}

/* --------------------------- letter-spacing --------------------------- */

/// Uma linha de texto com `letter-spacing` (o GPUI não tem): molda a linha
/// (mantém o kerning) e pinta cada glifo deslocado `espaco` px por letra,
/// como o navegador (o espaço vai depois de cada letra, inclusive a última).
pub fn texto_espacado(texto: &str, fonte: Font, tam: f32, espaco: f32, altura: f32, cor: Hsla, window: &mut Window) -> impl IntoElement + use<> {
    let run = TextRun { len: texto.len(), font: fonte, color: cor, background_color: None, underline: None, strikethrough: None };
    let linha = window.text_system().shape_line(texto.to_string().into(), px(tam), &[run], None);
    let largura = f32::from(linha.width) + espaco * texto.chars().count() as f32;
    let texto = texto.to_string();
    canvas(
        |_, _, _| {},
        move |b, _, window, _| {
            let topo = (altura - f32::from(linha.ascent + linha.descent)) / 2. + f32::from(linha.ascent);
            for run in &linha.runs {
                for g in &run.glyphs {
                    let i = texto[..g.index.min(texto.len())].chars().count() as f32;
                    let origem = b.origin + point(g.position.x + px(espaco * i), px(topo));
                    let _ = window.paint_glyph(origem, run.font_id, g.id, px(tam), cor);
                }
            }
        },
    )
    .w(px(largura))
    .h(px(altura))
    .flex_none()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn curvas_e_cores() {
        assert!((ease_out(0.) - 0.).abs() < 1e-3 && (ease_out(1.) - 1.).abs() < 1e-3 && ease_out(0.5) > 0.8);
        // A mola passa do fim (balanço de ~17%) e assenta em 725 ms.
        let pico = (1..72).map(|i| mola(300., 17., i as f32 / 100.)).fold(0f32, f32::max);
        assert!(pico > 1.1 && pico < 1.25, "{pico}");
        assert_eq!(bouncy(0.8), 1.);
        // OKLCH ida e volta.
        let (l, c, h) = oklch(0.8, 0.3, 0.5);
        let v = rgba(de_oklch(l, c, h, 1.));
        assert!((v.r - 0.8).abs() < 0.01 && (v.g - 0.3).abs() < 0.01 && (v.b - 0.5).abs() < 0.01);
        let rampa = [(hex(0xff0000), 0.), (hex(0x0000ff), 1.)];
        assert!((rgba(conica(&rampa, 0.5)).r - 0.5).abs() < 0.01);
    }

    #[test]
    fn recorte_cobre_e_espelha() {
        // 4x2, recortado para 1:1 no meio e espelhado.
        let px: Vec<u8> = (0..8u8).flat_map(|i| [i, 0, 0, 255]).collect();
        let img = bgra(4, 2, px);
        let r = recorte(&img, Some(1.), true).unwrap();
        assert_eq!(r.size(0).width.0, 2);
        assert_eq!(&r.as_bytes(0).unwrap()[..8], &[2, 0, 0, 255, 1, 0, 0, 255]);
    }
}
