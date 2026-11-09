//! Reações na tela: emoji voando, combo "×N", selo no ladrilho, chuva e a mão
//! levantada (ESPEC 6: public/js/ui/reacoes.js + css/reacoes.css), e os avisos
//! passageiros (js/ui/toast.js + base.css `.toast`). DONO: agente da barra.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{
    AnyElement, Bounds, Context, Image, ImageFormat, Img, MouseButton, Pixels, SharedString, TextRun, Window, canvas, div, font, img,
    linear_color_stop, linear_gradient, point, prelude::*, px, size,
};

use super::comp::icone_traco;
use super::dock::mov::{BOUNCY, aleatorio, bezier, ease_in_out, ease_out, misturar, quadros, segundos};
use super::tema::{FONTE, Tema, rgba_f, sombra};
use crate::chamada::Chamada;
use crate::recursos;

/// As reações do menu (features/reacoes.js REACOES): id, emoji do sprite, nome.
pub const REACOES: [(&str, &str, &str); 18] = [
    ("joinha", "thumbs-up", "Joinha"),
    ("amei", "red-heart", "Amei"),
    ("risos", "face-with-tears-of-joy", "Kkkk"),
    ("uau", "face-with-open-mouth", "Uau"),
    ("palmas", "clapping-hands", "Palmas"),
    ("festa", "party-popper", "Festa"),
    ("fogo", "fire", "Arrasou"),
    ("hmm", "thinking-face", "Hmm…"),
    ("triste", "crying-face", "Triste"),
    ("valeu", "folded-hands", "Valeu"),
    ("cem", "hundred-points", "Perfeito"),
    ("bora", "rocket", "Bora!"),
    ("incrivel", "star-struck", "Incrível"),
    ("isso", "raising-hands", "Isso aí!"),
    ("olho", "eyes", "Tô de olho"),
    ("apaixonado", "smiling-face-with-heart-eyes", "Apaixonado"),
    ("morri", "skull", "Morri"),
    ("explodiu", "exploding-head", "Explodiu a mente"),
];

/// O protocolo antigo, pelo servidor (features/reacoes.js DO_ANTIGO): é o
/// único que o cliente nativo fala hoje (chamada::REACOES).
const DO_ANTIGO: [(&str, &str); 6] = [("like", "joinha"), ("clap", "palmas"), ("heart", "amei"), ("laugh", "risos"), ("wow", "uau"), ("question", "hmm")];

/// O tipo do protocolo antigo de uma reação do menu (None: só pelo canal direto).
pub fn antigo_de(id: &str) -> Option<&'static str> {
    DO_ANTIGO.iter().find(|(_, novo)| *novo == id).map(|(antigo, _)| *antigo)
}

fn emoji_do_tipo(tipo: &str) -> Option<&'static str> {
    let id = DO_ANTIGO.iter().find(|(a, _)| *a == tipo).map_or(tipo, |(_, n)| n);
    REACOES.iter().find(|r| r.0 == id).map(|r| r.1)
}

/// Os sinais (features/reacoes.js SINAIS): ícone e nome.
pub const SINAIS: [(&str, &str); 7] = [
    ("check", "Sim"),
    ("x", "Não"),
    ("turtle", "Mais devagar"),
    ("rabbit", "Mais rápido"),
    ("repeat", "Pode repetir?"),
    ("volume-x", "Não estou ouvindo"),
    ("coffee", "Já volto"),
];

/* -------------------------- emoji -------------------------- */

/// O emoji vai num quadro maior que o do sprite (viewBox -12 -12 56 56 sobre
/// 32×32): sobra lugar para girar e para a sombra do voo.
const MARGEM: f32 = 56. / 32.;

thread_local!(static IMAGENS: RefCell<HashMap<(&'static str, i32, u32, u32), Arc<Image>>> = RefCell::default());

/// O `img` do GPUI não gira nem tem `drop-shadow`: cada giro (de 2 em 2°) é
/// uma imagem, com a sombra do voo desenhada no próprio SVG, como o CSS faz
/// (o filtro antes do transform: a sombra gira junto).
fn imagem(nome: &'static str, base: f32, giro: f32, com_sombra: bool, escala_tela: f32) -> Option<Arc<Image>> {
    let giro = (giro / 2.).round() as i32 * 2;
    let raster = ((base * MARGEM * escala_tela * 1.3 / 8.).ceil() * 8.) as u32;
    let chave = (nome, giro, raster, if com_sombra { base as u32 } else { 0 });
    if let Some(i) = IMAGENS.with(|m| m.borrow().get(&chave).cloned()) {
        return Some(i);
    }
    let fonte = recursos::emoji(nome)?;
    let svg = std::str::from_utf8(&fonte.bytes).ok()?;
    let corpo = trocar_rb(&svg[svg.find('>')? + 1..svg.rfind("</svg>")?]);
    // drop-shadow(0 6px 12px rgb(0 0 0/.25)), em unidades do sprite (32 = `base` px).
    let (filtro, usa) = if com_sombra {
        let u = 6. * 32. / base;
        (
            format!(r##"<defs><filter id="vcall-sombra" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="{u}" stdDeviation="{u}" flood-color="#000" flood-opacity="0.25"/></filter></defs>"##),
            r#" filter="url(#vcall-sombra)""#,
        )
    } else {
        (String::new(), "")
    };
    let s = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{raster}" height="{raster}" viewBox="-12 -12 56 56">{filtro}<g transform="rotate({giro} 16 16)"><g{usa}>{corpo}</g></g></svg>"#
    );
    let i = Arc::new(Image::from_bytes(ImageFormat::Svg, s.into_bytes()));
    IMAGENS.with(|m| m.borrow_mut().insert(chave, i.clone()));
    Some(i)
}

/// O GPUI 0.2.2 passa o pixmap RGBA do SVG adiante como BGRA (vermelho e
/// azul trocados): as cores vão trocadas no próprio SVG para sair certo.
fn trocar_rb(svg: &str) -> String {
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
    String::from_utf8(s).unwrap_or_default()
}

/// Um emoji de `tam` px (o tamanho visível de agora), centrado em (x, y).
/// `base`: o tamanho sem animação (resolução e sombra).
pub fn emoji(nome: &'static str, x: f32, y: f32, tam: f32, base: f32, giro: f32, com_sombra: bool, window: &Window) -> Option<Img> {
    let i = imagem(nome, base, giro, com_sombra, window.scale_factor())?;
    let d = tam * MARGEM;
    Some(img(i).absolute().left(px(x - d / 2.)).top(px(y - d / 2.)).size(px(d)))
}

/* -------------------------- onde está cada ladrilho -------------------------- */

thread_local! {
    static QUADROS: RefCell<HashMap<String, (Bounds<Pixels>, u64)>> = RefCell::default();
    static GERACAO: Cell<u64> = const { Cell::new(0) };
}

/// Para o palco pôr em cada ladrilho de câmera (absoluto, cobre o ladrilho):
/// guarda onde ele ficou, para as reações saírem dele e o selo e a mão
/// pousarem nele, como `quadro()` faz no app. Sem ela, a camada estima a
/// grade pelas regras do app (`estimar`).
#[allow(dead_code)]
pub fn marca(pessoa: impl Into<String>) -> impl IntoElement {
    let pessoa = pessoa.into();
    canvas(
        move |b, _, _| {
            let g = GERACAO.with(Cell::get);
            QUADROS.with(|q| q.borrow_mut().insert(pessoa, (b, g)));
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

fn f(v: Pixels) -> f32 {
    f32::from(v)
}

/// O ladrilho de câmera de alguém: o marcado no quadro anterior, ou a estimativa.
fn quadro_de(c: &Chamada, pessoa: &str, geracao: u64, vw: f32, vh: f32) -> Option<Bounds<Pixels>> {
    QUADROS.with(|q| q.borrow().get(pessoa).filter(|(_, g)| *g == geracao).map(|(b, _)| *b)).or_else(|| estimar(c, pessoa, vw, vh))
}

/// A grade como o app a monta (stage.js #relayout + app.css/call.css): os
/// outros na ordem de chegada e você por último; sozinho, duo e grade.
/// ponytail: sem o destaque (tela assistida, fixado); o palco pode marcar os
/// ladrilhos de verdade com `marca`.
fn estimar(c: &Chamada, pessoa: &str, vw: f32, vh: f32) -> Option<Bounds<Pixels>> {
    let eu = c.eu();
    let mut ordem: Vec<&str> = c.sala.pessoas.iter().map(|p| p.id.as_str()).filter(|p| Some(*p) != eu).collect();
    ordem.extend(eu);
    let i = ordem.iter().position(|p| *p == pessoa)?;
    let n = ordem.len();
    let painel = if c.painel.is_some() { 348. } else { 0. };
    // .stage__main: entre o topo (52) e a barra (8 + 64 + 16), com 12 de respiro.
    let (pw, ph) = (vw - painel, vh - 52. - 88.);
    let (x0, y0, w, h) = (12., 64., pw - 24., ph - 24.);
    let caixa = |x: f32, y: f32, w: f32, h: f32| Some(Bounds::new(point(px(x), px(y)), size(px(w), px(h))));
    match n {
        // Sozinho (call.css .stage--alone): colunas .9fr 1.1fr, vão 48, laterais 64; 16:10.
        1 => {
            let util = pw - 128. - 48.;
            let tw = util * 1.1 / 2.;
            let th = tw * 10. / 16.;
            caixa(64. + util * 0.9 / 2. + 48., 52. + (ph - th) / 2., tw, th)
        }
        // Duo: o outro ocupa o palco; você é o balão no canto (app.css .floatSelf).
        2 if i == 1 => {
            let bw = (w * 0.22).clamp(132., 280.);
            let bh = bw * 10. / 16.;
            caixa(x0 + w - 16. - bw, y0 + h - 16. - bh, bw, bh)
        }
        2 => caixa(x0, y0, w, h),
        _ => {
            let cols = if n <= 4 { 2 } else { melhores_colunas(n, w, h) };
            let vao = if n > 12 { 4. } else if n > 8 { 8. } else { 12. };
            let linhas = n.div_ceil(cols);
            let tw = (w - vao * (cols - 1) as f32) / cols as f32;
            let th = (h - vao * (linhas - 1) as f32) / linhas as f32;
            caixa(x0 + (i % cols) as f32 * (tw + vao), y0 + (i / cols) as f32 * (th + vao), tw, th)
        }
    }
}

/// stage.js bestColumns: a grade mais perto de 16:9, punindo casas vazias.
fn melhores_colunas(n: usize, w: f32, h: f32) -> usize {
    (1..=n)
        .map(|cols| {
            let linhas = n.div_ceil(cols);
            let erro = ((w / cols as f32) / (h / linhas as f32) / (16. / 9.)).ln().abs() + (cols * linhas - n) as f32 * 0.03;
            (cols, erro)
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map_or(1, |m| m.0)
}

/* -------------------------- estado -------------------------- */

struct Voo {
    emoji: &'static str,
    x: f32,
    y: f32,
    tam: f32,
    dx: f32,
    sobe: f32,
    giro: f32,
    dur: f32,
    atraso: f32,
    t0: Instant,
}

struct Combo {
    x: f32,
    y: f32,
    texto: SharedString,
    forca: f32,
    t0: Instant,
}

struct Selo {
    emoji: &'static str,
    ligou: Instant,
    pulo: Instant,
    /// Quando o selo começa a sair (2,5 s depois da última reação).
    ate: Instant,
    /// O pulo de quem já estava aceso não refaz a entrada.
    reaceso: bool,
}

struct AvisoVisto {
    id: u64,
    texto: SharedString,
    entrou: Instant,
    saiu: Option<Instant>,
}

#[derive(Default)]
pub struct Estado {
    ultima: u64,
    voos: Vec<Voo>,
    combos: Vec<Combo>,
    selos: HashMap<String, Selo>,
    /// (pessoa, tipo) -> (tamanho do combo, até quando ele continua).
    seq: HashMap<(String, String), (u32, Instant)>,
    /// tipo -> quem reagiu e quando; e quando choveu por último.
    chuva: HashMap<String, (HashMap<String, Instant>, Option<Instant>)>,
    maos: HashMap<String, Instant>,
    avisos: Vec<AvisoVisto>,
    ultimo_aviso: u64,
}

const NO_AR: usize = 48;
const SELO: Duration = Duration::from_millis(2500);
/// Altura de um aviso de uma linha: 12 + 19,5 + 12 + 2 de borda.
const ALTURA_AVISO: f32 = 45.5;

impl Estado {
    fn particula(&mut self, v: Voo) {
        if self.voos.len() < NO_AR {
            self.voos.push(v);
        }
    }

    /// Uma reação nova (reacoes.js `voar` + main.js `mostrarReacao`).
    fn reagiu(&mut self, de: &str, tipo: &str, eu: bool, quadro: Option<Bounds<Pixels>>, palco: Bounds<Pixels>, vh: f32, agora: Instant) {
        let Some(nome) = emoji_do_tipo(tipo) else { return };
        let (x, y) = match quadro {
            Some(q) => (f(q.center().x), f(q.top()) + f(q.size.height) * 0.78),
            None => (72., vh - 140.),
        };
        // Combo: o seu junta cliques com 1,2 s entre eles; o dos outros, 1,5 s.
        let janela = Duration::from_millis(if eu { 1200 } else { 1500 });
        let chave = (de.to_string(), tipo.to_string());
        let combo = match self.seq.get(&chave) {
            Some((n, ate)) if agora < *ate => n + 1,
            _ => 1,
        };
        self.seq.insert(chave, (combo, agora + janela));
        if quadro.is_some() {
            let aceso = self.selos.get(de).is_some_and(|s| agora < s.ate);
            let ligou = self.selos.get(de).filter(|_| aceso).map_or(agora, |s| s.ligou);
            self.selos.insert(de.to_string(), Selo { emoji: nome, ligou, pulo: agora, ate: agora + SELO, reaceso: aceso });
        }
        let tam = (40. + (combo - 1) as f32 * 4.).min(64.);
        self.particula(Voo {
            emoji: nome,
            x,
            y,
            tam,
            dx: aleatorio(-70., 70.).round(),
            sobe: -aleatorio(200., 320.).round(),
            giro: aleatorio(-28., 28.).round(),
            dur: aleatorio(1700., 2300.).round() / 1000.,
            atraso: 0.,
            t0: agora,
        });
        if combo > 1 {
            self.combos.push(Combo { x: x + 22., y: y - 46., texto: format!("×{combo}").into(), forca: (1. + combo as f32 / 12.).min(1.6), t0: agora });
        }
        // Chuva (features/reacoes.js Chuva): 3 pessoas em 4 s, uma vez a cada 6 s.
        let (vistos, ultima) = self.chuva.entry(tipo.to_string()).or_default();
        vistos.insert(de.to_string(), agora);
        vistos.retain(|_, t| agora.duration_since(*t) <= Duration::from_secs(4));
        if vistos.len() >= 3 && ultima.is_none_or(|u| agora.duration_since(u) >= Duration::from_secs(6)) {
            *ultima = Some(agora);
            let (l, w, b, h) = (f(palco.left()), f(palco.size.width), f(palco.bottom()), f(palco.size.height));
            for _ in 0..18 {
                self.particula(Voo {
                    emoji: nome,
                    x: l + aleatorio(0.06, 0.94) * w,
                    y: b - 20.,
                    tam: aleatorio(40., 72.).round(),
                    dx: aleatorio(-70., 70.).round(),
                    sobe: -(aleatorio(0.45, 0.85) * h).round(),
                    giro: aleatorio(-28., 28.).round(),
                    dur: aleatorio(2200., 3000.).round() / 1000.,
                    atraso: aleatorio(0., 1100.).round() / 1000.,
                    t0: agora,
                });
            }
        }
    }
}

/* -------------------------- desenho -------------------------- */

/// Curva do voo (reacoes.css .reacaoVoo).
fn voo_curva(x: f32) -> f32 {
    bezier(0.22, 0.61, 0.36, 1., x)
}

fn desenhar_voo(v: &Voo, p: f32, window: &Window) -> Option<AnyElement> {
    // @keyframes reacaoSobe (reacoes.css:30); o 22% não diz giro (0) nem opacidade.
    let tx = quadros(&[(0., 0.), (0.12, 0.15), (0.22, 0.25), (0.5, -0.35), (0.8, 0.6), (1., 1.)], p, voo_curva) * v.dx;
    let ty = quadros(&[(0., 0.), (0.12, 0.12), (0.22, 0.22), (0.5, 0.55), (0.8, 0.85), (1., 1.)], p, voo_curva) * v.sobe;
    let sc = quadros(&[(0., 0.2), (0.12, 1.18), (0.22, 0.96), (0.5, 1.), (0.8, 0.92), (1., 0.8)], p, voo_curva);
    let giro = quadros(&[(0., 0.), (0.12, -0.5), (0.22, 0.), (0.5, 1.), (0.8, -0.6), (1., 0.)], p, voo_curva) * v.giro;
    let op = quadros(&[(0., 0.), (0.12, 1.), (0.5, 1.), (0.8, 0.85), (1., 0.)], p, voo_curva);
    let e = emoji(v.emoji, v.x + tx, v.y + ty, v.tam * sc, v.tam, giro, true, window)?;
    Some(div().absolute().size_full().opacity(op).child(e).into_any_element())
}

fn desenhar_combo(t: &Tema, k: &Combo, p: f32, window: &Window) -> AnyElement {
    // @keyframes comboPula (reacoes.css:67), 900 ms --ease-out.
    let sc = quadros(&[(0., 0.3), (0.25, 1.25 * k.forca), (0.45, k.forca), (1., k.forca)], p, ease_out);
    let ty = quadros(&[(0., 10.), (0.25, -4.), (0.45, 0.), (1., -26.)], p, ease_out);
    let op = quadros(&[(0., 0.), (0.25, 1.), (1., 0.)], p, ease_out);
    let fonte = font(FONTE).bold();
    let run = TextRun { len: k.texto.len(), font: fonte.clone(), color: gpui::white(), background_color: None, underline: None, strikethrough: None };
    let largura = f(window.text_system().shape_line(k.texto.clone(), px(16.), &[run], None).width) + 20.;
    // O transform é scale() translateY(): o deslocamento também escala.
    let (cx, cy) = (k.x + largura / 2., k.y + 14. + ty * sc);
    div()
        .absolute()
        .left(px(cx - 150.))
        .top(px(cy - 60.))
        .w(px(300.))
        .h(px(120.))
        .flex()
        .items_center()
        .justify_center()
        .opacity(op)
        .child(
            div()
                .px(px(10. * sc))
                .py(px(2. * sc))
                .rounded_full()
                .bg(linear_gradient(135., linear_color_stop(t.gradiente.0, 0.), linear_color_stop(t.gradiente.1, 1.)))
                .shadow(vec![sombra(0., 6. * sc, 16. * sc, -6. * sc, rgba_f(0., 0., 0., 0.45))])
                .font(fonte)
                .text_size(px(16. * sc))
                .line_height(px(24. * sc))
                .text_color(gpui::white())
                .whitespace_nowrap()
                .child(k.texto.clone()),
        )
        .into_any_element()
}

/// O selo da última reação no canto do ladrilho (reacoes.css .tile__reacao).
fn desenhar_selo(t: &Tema, s: &Selo, q: Bounds<Pixels>, agora: Instant, window: &Window) -> Option<AnyElement> {
    let saindo = agora >= s.ate;
    let (op, sc, giro) = if saindo {
        let d = segundos(s.ate, agora);
        (1. - ease_out(d / 0.22), misturar(1., 0.4, ease_out(d / 0.26)), 0.)
    } else {
        // .is-on: opacidade 220 ms; o seloPulo (420 ms, 1,25 e −8° aos 40%) parte de .4 na entrada.
        let d = segundos(s.pulo, agora) / 0.42;
        let de = if s.reaceso { 1. } else { 0.4 };
        let op = if s.reaceso { 1. } else { ease_out(segundos(s.ligou, agora) / 0.22) };
        (op, quadros(&[(0., de), (0.4, 1.25), (1., 1.)], d, ease_out), quadros(&[(0., 0.), (0.4, -8.), (1., 0.)], d, ease_out))
    };
    let (cx, cy) = (f(q.left()) + 31., f(q.top()) + 31.);
    let d = 42. * sc;
    Some(
        div()
            .absolute()
            .size_full()
            .opacity(op)
            .child(
                div()
                    .absolute()
                    .left(px(cx - d / 2.))
                    .top(px(cy - d / 2.))
                    .size(px(d))
                    .rounded_full()
                    .bg(t.surface.opacity(0.85))
                    .shadow(vec![sombra(0., 4. * sc, 14. * sc, -4. * sc, rgba_f(0., 0., 0., 0.4))]),
            )
            .child(emoji(s.emoji, cx, cy, 30. * sc, 30., giro, false, window)?)
            .into_any_element(),
    )
}

/// A mão levantada no ladrilho (app.css .tile__hand, hand-bob 1,6 s).
fn desenhar_mao(t: &Tema, q: Bounds<Pixels>, desde: Instant, agora: Instant) -> AnyElement {
    let fase = (segundos(desde, agora) / 1.6).fract();
    let y = quadros(&[(0., 0.), (0.5, -4.), (1., 0.)], fase, ease_in_out);
    div()
        .absolute()
        .left(px(f(q.center().x) - 17.))
        .top(px(f(q.top()) + 8. + y))
        .size(px(34.))
        .rounded_full()
        .bg(t.warn)
        .flex()
        .items_center()
        .justify_center()
        .child(icone_traco("hand", 16., 2.1, gpui::rgb(0x1a1000).into()))
        .into_any_element()
}

fn desenhar_aviso(t: &Tema, a: &AvisoVisto, agora: Instant, cx: &mut Context<Chamada>) -> AnyElement {
    // Entra na mola bouncy (motion.js onAdded .toast); sai em 200 ms (base.css toast-out).
    let p = BOUNCY.em(segundos(a.entrou, agora));
    let (mut op, mut ty, mut sc) = (p.min(1.), 16. * (1. - p), 0.9 + 0.1 * p);
    if let Some(saiu) = a.saiu {
        let q = ease_in_out(segundos(saiu, agora) / 0.2);
        op *= 1. - q;
        ty += 6. * q;
        sc *= 1. - 0.03 * q;
    }
    let id = a.id;
    let sombra_lg = t.sombra_lg().into_iter().map(|mut s| {
        s.offset = s.offset * sc;
        s.blur_radius = s.blur_radius * sc;
        s.spread_radius = s.spread_radius * sc;
        s
    });
    div()
        .id(("aviso", id))
        .flex()
        .items_center()
        .gap(px(12. * sc))
        .px(px(16. * sc))
        .py(px(12. * sc))
        .max_w(px(440. * sc))
        .rounded(px(18. * sc))
        .bg(t.bg_elevated)
        .border(px(sc))
        .border_color(t.border)
        .shadow(sombra_lg.collect())
        .text_size(px(13. * sc))
        .line_height(px(19.5 * sc))
        .text_color(t.text)
        .opacity(op)
        .relative()
        .top(px(ty))
        .on_click(cx.listener(move |c: &mut Chamada, _, _, cx| {
            c.avisos.retain(|a| a.id != id);
            cx.notify();
        }))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .child(icone_traco("info", 16. * sc, 2.1, t.accent))
        .child(a.texto.clone())
        .into_any_element()
}

/// Camada por cima de tudo (absoluta; só os avisos recebem clique).
pub fn camada(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let agora = Instant::now();
    let vp = window.viewport_size();
    let (vw, vh) = (f(vp.width), f(vp.height));
    let geracao = GERACAO.with(|g| {
        let v = g.get();
        g.set(v + 1);
        v
    });
    // #stage: entre o topo e a barra, a largura toda (o painel mora dentro dele).
    let palco = Bounds::new(point(px(0.), px(52.)), size(px(vw), px(vh - 52. - 88.)));
    let eu = c.eu().map(str::to_string);

    // Reações novas (os ids só sobem).
    let novas: Vec<(u64, String, String)> = c.reacoes.iter().filter(|r| r.id > c.ui.reacoes.ultima).map(|r| (r.id, r.de.clone(), r.tipo.clone())).collect();
    for (id, de, tipo) in novas {
        let quadro = quadro_de(c, &de, geracao, vw, vh);
        c.ui.reacoes.reagiu(&de, &tipo, eu.as_deref() == Some(de.as_str()), quadro, palco, vh, agora);
        c.ui.reacoes.ultima = c.ui.reacoes.ultima.max(id);
    }

    // Avisos: o mesmo texto de novo troca o antigo (toast.js `key`); quem saiu de c.avisos sai animado.
    let e = &mut c.ui.reacoes;
    let visto = e.ultimo_aviso;
    for a in c.avisos.iter().filter(|a| a.id > visto) {
        e.avisos.retain(|v| v.texto != a.texto);
        e.avisos.push(AvisoVisto { id: a.id, texto: a.texto.clone(), entrou: agora, saiu: None });
        e.ultimo_aviso = e.ultimo_aviso.max(a.id);
    }
    for v in e.avisos.iter_mut().filter(|v| v.saiu.is_none()) {
        if !c.avisos.iter().any(|a| a.id == v.id) {
            v.saiu = Some(agora);
        }
    }
    e.avisos.retain(|v| v.saiu.is_none_or(|s| segundos(s, agora) < 0.2));
    e.voos.retain(|v| segundos(v.t0, agora) < v.atraso + v.dur);
    e.combos.retain(|k| segundos(k.t0, agora) < 0.9);
    e.selos.retain(|_, s| agora < s.ate + Duration::from_millis(260));
    let com_mao: Vec<String> = c.sala.pessoas.iter().filter(|p| p.mao).map(|p| p.id.clone()).collect();
    e.maos.retain(|p, _| com_mao.contains(p));
    for p in &com_mao {
        e.maos.entry(p.clone()).or_insert(agora);
    }

    let mut filhos: Vec<AnyElement> = Vec::new();
    let e = &c.ui.reacoes;
    for (p, desde) in &e.maos {
        if let Some(q) = quadro_de(c, p, geracao, vw, vh) {
            filhos.push(desenhar_mao(t, q, *desde, agora));
        }
    }
    for (p, s) in &e.selos {
        if let Some(q) = quadro_de(c, p, geracao, vw, vh) {
            filhos.extend(desenhar_selo(t, s, q, agora, window));
        }
    }
    for v in &e.voos {
        let p = (segundos(v.t0, agora) - v.atraso) / v.dur;
        if p >= 0. {
            filhos.extend(desenhar_voo(v, p, window));
        }
    }
    for k in &e.combos {
        filhos.push(desenhar_combo(t, k, segundos(k.t0, agora) / 0.9, window));
    }
    // Avisos: coluna presa a 100 px do pé (base.css .toasts), o mais novo embaixo.
    let n = e.avisos.len();
    for (i, a) in e.avisos.iter().enumerate() {
        let el = desenhar_aviso(t, a, agora, cx);
        filhos.push(
            div()
                .absolute()
                .left_0()
                .w_full()
                .bottom(px(100. + (n - 1 - i) as f32 * (ALTURA_AVISO + 8.)))
                .h(px(ALTURA_AVISO))
                .flex()
                .items_center()
                .justify_center()
                .child(el)
                .into_any_element(),
        );
    }

    let e = &c.ui.reacoes;
    if !e.voos.is_empty() || !e.combos.is_empty() || !e.selos.is_empty() || !e.maos.is_empty() || e.avisos.iter().any(|a| a.saiu.is_some() || segundos(a.entrou, agora) < BOUNCY.dur) {
        window.request_animation_frame();
    }
    div().absolute().top_0().left_0().size_full().children(filhos).into_any_element()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn cores_trocadas_e_catalogo() {
        assert_eq!(trocar_rb(r##"<path fill="#FFC83D"/><g fill="#fff">é</g>"##), r##"<path fill="#3DC8FF"/><g fill="#fff">é</g>"##);
        assert_eq!(antigo_de("palmas"), Some("clap"));
        assert_eq!(antigo_de("fogo"), None);
        assert_eq!(emoji_do_tipo("question"), Some("thinking-face"));
        for (_, nome, _) in REACOES {
            assert!(recursos::emoji(nome).is_some(), "{nome} fora do sprite");
        }
    }

    #[test]
    fn grade_estimada_como_a_do_app() {
        // 5 a 9 ladrilhos em 1256×636 dão 3 colunas; 10 a 16, 4 (ESPEC 3.2).
        assert_eq!(melhores_colunas(5, 1256., 636.), 3);
        assert_eq!(melhores_colunas(9, 1256., 636.), 3);
        assert_eq!(melhores_colunas(12, 1256., 636.), 4);
    }
}
