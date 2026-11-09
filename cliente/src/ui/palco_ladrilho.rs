//! O ladrilho (app.css .tile + call.css): vídeo ou avatar, etiqueta com o
//! nome, sinal da conexão, botões ao passar o mouse, volume, anel de quem
//! fala, "Conectando…", convite para assistir uma tela, mão levantada.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gpui::{
    Animation, AnimationExt, AnyElement, BoxShadow, Bounds, Context, Corners, FontWeight, Hsla, ImageSource, MouseButton, MouseDownEvent, MouseMoveEvent, ObjectFit, Pixels,
    RenderImage, SharedString, Transformation, Window, canvas, div, img, linear_color_stop, linear_gradient, point, prelude::*, px, radians, size,
};

use super::arte::{self, alfa, cinza, hex, misturar, v4};
use super::{Estado, dica};
use crate::chamada::Chamada;
use crate::sala::Avatar;
use crate::ui::comp::{icone, icone_traco};
use crate::ui::tema::{self, Tema, rgba_f, sombra};
use crate::ui::avatar;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tipo {
    Cam,
    Tela,
}

/// Um ladrilho a desenhar (o que o Tile de ui/stage.js guarda).
pub struct Ladrilho {
    /// "eu:cam", "<id>:cam", "<id>:tela".
    pub chave: String,
    pub pessoa: String,
    pub tipo: Tipo,
    pub eu: bool,
    pub nome: String,
    pub rotulo: String,
    pub avatar: Avatar,
    pub mic: bool,
    pub quadro: Option<Arc<RenderImage>>,
    /// Câmera (ou tela assistida) ligada, sem o primeiro quadro ainda.
    pub esperando: bool,
    /// "Conectando…" e se o ícone gira.
    pub conexao: Option<(&'static str, bool)>,
    /// Tela de outra pessoa que eu não assisto (3.24).
    pub convite: bool,
    /// A minha tela inteira (sem prévia: efeito espelho).
    pub apresentando: bool,
    pub qualidade: Qualidade,
    /// Voz, 0 a 1 (`--lv`), e se a pessoa está falando.
    pub voz: f32,
    pub falando: bool,
}

#[derive(Clone, Copy)]
pub enum Qualidade {
    Boa,
    Desconhecida,
}

/// Onde o ladrilho está: muda o que cabe nele.
#[derive(Clone, Copy, Default)]
pub struct Lugar {
    pub bolha: bool,
    pub faixa: bool,
    /// Degrau `lg`/`xl` da grade: sem volume.
    pub sem_volume: bool,
    /// Degrau `xl`: etiqueta de 11 px.
    pub rotulo_pequeno: bool,
}

const ESCURO_72: (f32, f32, f32) = (7., 4., 22.);

fn noite(a: f32) -> Hsla {
    rgba_f(ESCURO_72.0, ESCURO_72.1, ESCURO_72.2, a)
}

fn branco(a: f32) -> Hsla {
    rgba_f(255., 255., 255., a)
}

/// O lado do avatar: `clamp(32px, min(26cqw, 46cqh), 128px)`.
fn lado_avatar(t: gpui::Size<Pixels>) -> f32 {
    (0.26 * f32::from(t.width)).min(0.46 * f32::from(t.height)).clamp(32., 128.)
}

pub fn alternar_fixar(c: &mut Chamada, chave: &str) {
    c.fixado = if c.fixado.as_deref() == Some(chave) { None } else { Some(chave.to_string()) };
}

pub fn ladrilho(l: &Ladrilho, lugar: Lugar, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let k = l.chave.clone();
    let fixado = c.fixado.as_deref() == Some(k.as_str());
    let ui = &mut c.ui.palco;
    let tam = ui.medidas.borrow().get(&k).copied();
    let raio = if lugar.bolha { tema::raio::XL } else { tema::raio::TILE };
    let sobre = ui.sob.tem(&k);
    let v_sobre = ui.trans.valor(&format!("sob:{k}"), sobre, 120., window);
    let v_fixo = ui.trans.valor(&format!("fixo:{k}"), fixado, 200., window);
    let v_fala = ui.trans.valor(&format!("fala:{k}"), l.falando, 220., window);
    let v_eq = ui.trans.valor(&format!("eq:{k}"), l.voz > 0.05, 120., window);
    if l.falando {
        let g = ui.giro.entry(k.clone()).or_default();
        *g = (*g + 1.5 + l.voz * 9.) % 360.;
        window.request_animation_frame();
    }
    let giro = ui.giro.get(&k).copied().unwrap_or(0.);
    let mostra_controles = !lugar.bolha && !l.convite;

    let mut raiz = div()
        .id(SharedString::from(format!("tile:{k}")))
        .size_full()
        .relative()
        .overflow_hidden()
        .rounded(px(raio))
        .bg(t.tile_bg)
        .border_1()
        .border_color(alfa(t.accent_2, v_fixo))
        .shadow(tema::sombra_tile())
        .on_hover(cx.listener({
            let k = k.clone();
            move |c, h: &bool, _, cx| {
                c.ui.palco.sob.marcar(&k, *h);
                cx.notify();
            }
        }))
        .on_mouse_down(
            MouseButton::Left,
            cx.listener({
                let k = k.clone();
                move |c, e: &MouseDownEvent, _, cx| {
                    if e.click_count == 2 {
                        alternar_fixar(c, &k);
                        cx.notify();
                    }
                }
            }),
        );

    // Vídeo, ou o avatar sobre o fundo no tom dele.
    let previa = c.ui.palco.previa.contains(&k);
    let video_visivel = l.quadro.is_some() && !l.convite && (!l.apresentando || previa);
    if let (true, Some(q)) = (video_visivel, l.quadro.clone()) {
        raiz = raiz.child(video(&k, q, l.eu && l.tipo == Tipo::Cam, l.tipo == Tipo::Tela, raio - 1., &c.ui.palco));
    } else if !l.convite && !l.apresentando {
        raiz = raiz.child(fundo_avatar(l, tam, raio - 1., c, t, window, cx));
    }
    if l.convite || l.apresentando {
        raiz = raiz.child(convite(l, tam, previa, raio - 1., c, t, cx));
    }
    if l.esperando && !l.convite {
        raiz = raiz.child(espera(l.tipo, t, &c.ui.palco, window));
    }

    // Medida do ladrilho (a próxima pintura usa) e o anel da marca.
    let medidas = c.ui.palco.medidas.clone();
    let (rosa, laranja) = t.gradiente;
    let (voz, falando) = (l.voz, l.falando);
    let km = k.clone();
    raiz = raiz.child(
        canvas(
            move |b, window, _| {
                let mut m = medidas.borrow_mut();
                if m.get(&km) != Some(&b.size) {
                    m.insert(km, b.size);
                    window.request_animation_frame();
                }
            },
            move |b, _, window, _| {
                // call.css .tile::before: 2,5 px, rosa -> laranja -> #ffd1e1 -> rosa.
                let antes = [(rosa, 0.), (laranja, 1. / 3.), (hex(0xffd1e1), 2. / 3.), (rosa, 1.)];
                arte::anel(b, raio, 2.5, &antes, giro, v_fala * (0.6 + 0.4 * voz), window);
                // app.css .tile.is-speaking::after (cores fixas): só 1 px aparece, por dentro.
                if falando {
                    let (r, o) = (hex(0xfd4d87), hex(0xfe9c5f));
                    let depois = [(r, 0.), (o, 0.3), (r, 0.6), (o, 0.8), (r, 1.)];
                    arte::anel(b, raio - 1., 1., &depois, giro, voz, window);
                }
            },
        )
        .absolute()
        .size_full(),
    );

    if mostra_controles {
        raiz = raiz.child(sinal(l.qualidade, t));
    }
    raiz = raiz.child(etiqueta(l, lugar, v_eq, t));
    if mostra_controles {
        raiz = raiz.child(acoes(l, fixado, v_sobre, c, t, window, cx));
        if !l.eu && !lugar.faixa && !lugar.sem_volume {
            raiz = raiz.child(volume(l, v_sobre, c, t, window, cx));
        }
    }
    // A mão levantada, o selo e a origem das reações de cada câmera são da barra (ui/reacoes.rs).
    if l.tipo == Tipo::Cam {
        raiz = raiz.child(crate::ui::reacoes::marca(l.pessoa.clone()));
    }
    if let Some((texto, gira)) = l.conexao {
        raiz = raiz.child(estado_conexao(&k, texto, gira));
    }
    raiz.into_any_element()
}

/// O quadro de vídeo: `cover` recortado (cantos redondos certos) ou `contain`
/// (tela compartilhada, sobre preto; câmera que perderia mais de 30%).
fn video(k: &str, quadro: Arc<RenderImage>, espelhar: bool, tela: bool, raio: f32, ui: &Estado) -> impl IntoElement + use<> {
    let cache = ui.imagens.clone();
    let k = format!("video:{k}");
    canvas(
        |_, _, _| {},
        move |b, _, window, _| {
            let t = quadro.size(0);
            let (vw, vh) = (t.width.0 as f32, t.height.0 as f32);
            if vw < 1. || vh < 1. || f32::from(b.size.width) < 1. || f32::from(b.size.height) < 1. {
                return;
            }
            let quadro_lugar = f32::from(b.size.width) / f32::from(b.size.height);
            let visivel = if vw / vh > quadro_lugar { quadro_lugar / (vw / vh) } else { (vw / vh) / quadro_lugar };
            let conter = tela || visivel < 0.7;
            let aspecto = (!conter).then_some(quadro_lugar);
            let assinatura = format!("{:p}:{:?}:{espelhar}", Arc::as_ptr(&quadro), aspecto.map(|a| (a * 200.).round() as i32));
            let img = if aspecto.is_none() && !espelhar {
                quadro.clone()
            } else {
                let q = quadro.clone();
                cache.borrow_mut().obter(&k, assinatura, || arte::recorte(&q, aspecto, espelhar).unwrap_or(q.clone()), window)
            };
            if conter {
                if tela {
                    window.paint_quad(gpui::fill(b, gpui::black()).corner_radii(Corners::all(px(raio))));
                }
                let nb = ObjectFit::Contain.get_bounds(b, img.size(0));
                // Cantos: só onde a imagem encosta no arredondado do ladrilho.
                let folga = f32::from(nb.origin.x - b.origin.x).max(f32::from(nb.origin.y - b.origin.y));
                let _ = window.paint_image(nb, Corners::all(px((raio - folga).max(0.))), img, 0, false);
            } else {
                let _ = window.paint_image(b, Corners::all(px(raio)), img, 0, false);
            }
        },
    )
    .absolute()
    .size_full()
}

/// `.tile__avatar`: o fundo (no tom do avatar, com grão) e o avatar no meio.
fn fundo_avatar(l: &Ladrilho, tam: Option<gpui::Size<Pixels>>, raio: f32, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let k = l.chave.clone();
    let av = tam.map_or(128., lado_avatar);
    let sf = window.scale_factor();
    let lado_px = (av * sf).ceil() as u32;
    let imagem = avatar::imagem(&l.avatar);
    // Cor do avatar (corDoAvatar): da própria imagem rasterizada.
    let raster: Option<Arc<RenderImage>> = imagem.as_ref().and_then(|i| arte::svg_nitido(i, lado_px.max(64), lado_px.max(64), cx).or_else(|| i.clone().use_render_image(window, cx)));
    let amb = match (imagem.as_ref(), raster.as_ref()) {
        (Some(i), Some(r)) => *c.ui.palco.amb.entry(i.id()).or_insert_with(|| arte::cor_principal(r)),
        _ => None,
    };
    let v_amb = c.ui.palco.trans.valor(&format!("amb:{k}"), amb.is_some(), 700., window);
    let escala_brilho = c.ui.palco.trans.valor(&format!("brilho:{k}"), l.falando, 240., window) * l.voz * 0.12 + 1.;
    let cores = amb.map(|[r, g, b]| {
        let (_, ch, h) = arte::oklch(r, g, b);
        (
            arte::de_oklch(0.25, ch.min(0.05), h, 1.),
            arte::de_oklch(0.15, ch.min(0.025), h, 1.),
            arte::de_oklch(0.45, ch.min(0.09), h, 0.45),
            arte::de_oklch(0.1, 0.03, h, 0.9),
        )
    });
    let (glow, bg) = (v4(t.tile_glow), v4(t.tile_bg));
    let cache = c.ui.palco.imagens.clone();
    let fundo = canvas(|_, _, _| {}, {
        let k = k.clone();
        move |b, _, window, _| {
            let (w, h) = (f32::from(b.size.width), f32::from(b.size.height));
            if w < 1. || h < 1. {
                return;
            }
            let assinatura = format!("{w:.0}x{h:.0}:{glow:?}:{bg:?}:{:?}:{v_amb:.2}", cores.map(|c| v4(c.0)));
            let sf = window.scale_factor() / 2.;
            let img = cache.borrow_mut().obter(
                &format!("fundo:{k}"),
                assinatura,
                || {
                    arte::gerar(w, h, sf, |x, y| {
                        // radial-gradient(circle at 50% 42%, glow, bg 70%)
                        let (cx, cy) = (w / 2., h * 0.42);
                        let r = cx.max(w - cx).hypot(cy.max(h - cy));
                        let base = arte::lerp4(glow, bg, (x - cx).hypot(y - cy) / (0.7 * r));
                        match cores {
                            // ::before: elipse 75% 85% no tom do avatar + grão.
                            Some((c1, c2, _, _)) => {
                                let d = ((x - w / 2.) / (0.75 * w)).hypot((y - h / 2.) / (0.85 * h));
                                let tom = arte::sobre([1., 1., 1., arte::grao(x, y)], arte::lerp4(v4(c1), v4(c2), d));
                                arte::lerp4(base, tom, v_amb)
                            }
                            None => base,
                        }
                    })
                },
                window,
            );
            let _ = window.paint_image(b, Corners::all(px(raio)), img, 0, false);
            // ::after: o brilho atrás do avatar (cresce com a voz).
            if let Some((_, _, brilho, _)) = cores {
                let r = 1.1 * av * escala_brilho;
                let disco = cache.borrow_mut().obter(&format!("brilho:{k}"), format!("{:?}", v4(brilho)), || {
                    arte::gerar(64., 64., 1., |x, y| {
                        let d = ((x - 32.).hypot(y - 32.) / 32.).min(1.);
                        let c = v4(brilho);
                        [c[0], c[1], c[2], c[3] * (1. - d)]
                    })
                }, window);
                let centro = b.center();
                let caixa = Bounds { origin: point(centro.x - px(r), centro.y - px(r)), size: size(px(2. * r), px(2. * r)) };
                let _ = window.paint_image(caixa, Corners::default(), disco, 0, false);
            }
        }
    })
    .absolute()
    .size_full();

    let sombra_av = cores.map(|(_, _, _, s)| vec![sombra(0., 18., 36., -18., alfa(s, v_amb))]).unwrap_or_default();
    let rosto: AnyElement = match (imagem, raster) {
        (Some(i), _) if i.format != gpui::ImageFormat::Svg => img(i).size_full().rounded_full().object_fit(ObjectFit::Cover).into_any_element(),
        (Some(_), Some(r)) => img(ImageSource::Render(r)).size_full().rounded_full().into_any_element(),
        _ => div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .text_size(px(av * 0.42))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(t.text)
            .child(avatar::inicial(&l.nome))
            .into_any_element(),
    };
    div()
        .absolute()
        .size_full()
        .child(fundo)
        .child(
            div()
                .absolute()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(div().size(px(av)).flex_none().rounded_full().bg(t.surface_3).shadow(sombra_av).child(rosto)),
        )
        .into_any_element()
}

/// `.tile__present` / `.tile__convite`: "Fulano está transmitindo" + Assistir,
/// ou "Você está compartilhando a tela inteira" + Ver prévia.
fn convite(l: &Ladrilho, tam: Option<gpui::Size<Pixels>>, previa: bool, raio: f32, c: &mut Chamada, t: &Tema, cx: &mut Context<Chamada>) -> AnyElement {
    let k = l.chave.clone();
    let cache = c.ui.palco.imagens.clone();
    let destaque = v4(t.accent);
    let fundo = canvas(|_, _, _| {}, {
        let k = k.clone();
        move |b, _, window, _| {
            let (w, h) = (f32::from(b.size.width), f32::from(b.size.height));
            if w < 1. || h < 1. {
                return;
            }
            let sf = window.scale_factor() / 2.;
            let img = cache.borrow_mut().obter(&format!("convite:{k}"), format!("{w:.0}x{h:.0}:{destaque:?}"), || {
                // radial-gradient(circle at 50% 35%, accent 30%, transparent 60%), #120c33
                arte::gerar(w, h, sf, |x, y| {
                    let (cx, cy) = (w / 2., h * 0.35);
                    let r = cx.max(w - cx).hypot(cy.max(h - cy));
                    let a = 0.3 * (1. - (x - cx).hypot(y - cy) / (0.6 * r)).max(0.);
                    arte::sobre([destaque[0], destaque[1], destaque[2], a], v4(hex(0x120c33)))
                })
            }, window);
            let _ = window.paint_image(b, Corners::all(px(raio)), img, 0, false);
        }
    });
    let (w, h) = tam.map_or((600., 300.), |s| (f32::from(s.width), f32::from(s.height)));
    let so_botao = h <= 150.;
    let botao = |id: &str, icone_nome: &'static str, texto: &'static str, primario: bool, sob: bool| {
        div()
            .id(SharedString::from(format!("{id}:{k}")))
            .h(px(40.))
            .px(px(16.))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .rounded(px(tema::raio::MD))
            .border_1()
            .when(primario, |d| d.bg(t.accent).border_color(gpui::transparent_black()).text_color(t.accent_text).font_weight(FontWeight::SEMIBOLD))
            .when(!primario, |d| d.border_color(branco(0.3)).text_color(gpui::white()).font_weight(FontWeight::MEDIUM).when(sob, |d| d.bg(t.surface_2)))
            .text_size(px(tema::texto::BASE))
            .whitespace_nowrap()
            .cursor_pointer()
            .child(icone_traco(icone_nome, 16., 2.1, if primario { t.accent_text } else { gpui::white() }))
            .when(w > 120., |d| d.child(texto))
    };
    if l.apresentando && previa {
        // .is-peek: só o botão, num cartão no canto.
        let sob = c.ui.palco.sob.tem(&format!("previa:{k}"));
        return div()
            .absolute()
            .right(px(12.))
            .bottom(px(12.))
            .p(px(8.))
            .rounded(px(tema::raio::MD))
            .bg(rgba_f(18., 12., 51., 0.85))
            .child(alternar_previa(botao("previa", "eye", "Esconder prévia", false, sob), &k, cx))
            .into_any_element();
    }
    let mut miolo = div().absolute().size_full().flex().flex_col().items_center().justify_center().gap(px(8.)).p(px(16.)).text_color(gpui::white());
    if !so_botao {
        miolo = miolo
            .child(icone_traco("screen-share", 30., 1.8, t.accent))
            .child(div().max_w_full().truncate().text_size(px(tema::texto::MD)).font_weight(FontWeight::BOLD).child(if l.apresentando {
                "Você está compartilhando a tela inteira".to_string()
            } else {
                format!("{} está transmitindo", l.nome)
            }));
        if l.apresentando {
            miolo = miolo.child(
                div()
                    .max_w(px(44. * 6.6))
                    .text_size(px(tema::texto::XS))
                    .line_height(px(18.))
                    .text_center()
                    .opacity(0.8)
                    .child("Quem clicar em Assistir vê a sua tela. A prévia fica escondida para não gerar o efeito espelho."),
            );
        }
    }
    miolo = if l.apresentando {
        let sob = c.ui.palco.sob.tem(&format!("previa:{k}"));
        miolo.child(alternar_previa(botao("previa", "eye", "Ver prévia", false, sob), &k, cx))
    } else {
        let pessoa = l.pessoa.clone();
        miolo.child(botao("assistir", "eye", "Assistir", true, false).on_click(cx.listener(move |c, _, _, cx| {
            c.ui.palco.assistindo.insert(pessoa.clone());
            cx.notify();
        })))
    };
    div().absolute().size_full().child(fundo.absolute().size_full()).child(miolo).into_any_element()
}

fn alternar_previa(botao: gpui::Stateful<gpui::Div>, k: &str, cx: &mut Context<Chamada>) -> gpui::Stateful<gpui::Div> {
    let (k1, k2) = (k.to_string(), format!("previa:{k}"));
    botao
        .on_hover(cx.listener(move |c, h: &bool, _, cx| {
            c.ui.palco.sob.marcar(&k2, *h);
            cx.notify();
        }))
        .on_click(cx.listener(move |c, _, _, cx| {
            let p = &mut c.ui.palco.previa;
            if !p.remove(&k1) {
                p.insert(k1.clone());
            }
            cx.notify();
        }))
}

/// `.tile__espera`: anel girando e "Carregando o vídeo…" até o primeiro quadro.
fn espera(tipo: Tipo, t: &Tema, ui: &Estado, window: &mut Window) -> AnyElement {
    let cache = ui.imagens.clone();
    let (rosa, laranja) = (v4(t.gradiente.0), v4(t.gradiente.1));
    window.request_animation_frame();
    let anel = canvas(|_, _, _| {}, move |b, _, window, _| {
        // conic-gradient(transparent 0 30%, rosa, laranja), máscara de anel (55%..57%
        // do canto mais distante), girando 900 ms: 60 quadros prontos.
        let img = cache.borrow_mut().obter("espera", format!("{rosa:?}{laranja:?}"), || {
            let quadros = (0..60)
                .map(|f| {
                    let giro = f as f32 * 6.;
                    let mut px = Vec::with_capacity(56 * 56 * 4);
                    for j in 0..56 {
                        for i in 0..56 {
                            let (x, y) = ((i as f32 + 0.5) / 2. - 14., (j as f32 + 0.5) / 2. - 14.);
                            let d = x.hypot(y);
                            let cobre = ((d - 10.89) / 0.4).clamp(0., 1.) * (14. - d + 0.5).clamp(0., 1.);
                            let ang = ((x.atan2(-y).to_degrees() - giro) / 360.).rem_euclid(1.);
                            let (cor, a) = if ang < 0.3 { (rosa, 0.) } else if ang < 0.65 { (rosa, (ang - 0.3) / 0.35) } else { (arte::lerp4(rosa, laranja, (ang - 0.65) / 0.35), 1.) };
                            let a = a * cobre;
                            px.extend_from_slice(&[(cor[2] * 255.) as u8, (cor[1] * 255.) as u8, (cor[0] * 255.) as u8, (a * 255.) as u8]);
                        }
                    }
                    image::Frame::new(image::RgbaImage::from_raw(56, 56, px).expect("56x56"))
                })
                .collect::<Vec<_>>();
            Arc::new(RenderImage::new(quadros))
        }, window);
        let quadro = (super::relogio().as_millis() % 900) as usize * 60 / 900;
        let _ = window.paint_image(b, Corners::default(), img, quadro, false);
    });
    div()
        .absolute()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(10.))
        .px(px(12.))
        .text_color(branco(0.78))
        .text_size(px(13.12))
        .child(anel.size(px(28.)).flex_none())
        .child(if tipo == Tipo::Tela { "Carregando a tela…" } else { "Carregando o vídeo…" })
        .into_any_element()
}

/// `.tile__net`: o sinal da conexão, no canto de cima à esquerda.
fn sinal(q: Qualidade, t: &Tema) -> impl IntoElement + use<> {
    let (nome, cor) = match q {
        Qualidade::Boa => ("signal", t.ok),
        Qualidade::Desconhecida => ("signal-zero", t.text_muted),
    };
    div()
        .absolute()
        .top(px(8.))
        .left(px(8.))
        .size(px(26.))
        .rounded(px(tema::raio::SM))
        .bg(noite(0.55))
        .flex()
        .items_center()
        .justify_center()
        .child(icone_traco(nome, 15., 2.1, cor))
}

/// `.tile__label`: microfone, equalizador da voz e o nome.
fn etiqueta(l: &Ladrilho, lugar: Lugar, v_eq: f32, t: &Tema) -> impl IntoElement + use<> {
    let pequeno = lugar.bolha || lugar.rotulo_pequeno;
    let tam = if pequeno { tema::texto::XXS } else { tema::texto::XS };
    let altura_eq = if lugar.faixa { 10. } else { 12. };
    let lv = l.voz;
    let barra = |h: f32| div().w(px(3.)).h(px(altura_eq * h)).rounded_full().bg(t.accent);
    div()
        .absolute()
        .left(px(12.))
        .right(px(12.))
        .bottom(px(12.))
        .flex()
        .child(
            div()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(8.))
                .pl(px(8.))
                .pr(px(10.))
                .py(px(5.))
                .rounded_full()
                .bg(noite(0.72))
                .text_color(gpui::white())
                .text_size(px(tam))
                .line_height(px(tam * 1.5))
                .font_weight(FontWeight::MEDIUM)
                .child(icone_traco(if l.mic { "mic" } else { "mic-off" }, 14., 2.1, if l.mic { gpui::white() } else { t.danger }))
                .when(l.tipo == Tipo::Cam, |d| {
                    d.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(2.))
                            .h(px(altura_eq))
                            .opacity(v_eq)
                            .child(barra(0.18 + 0.62 * lv))
                            .child(barra(0.22 + 0.78 * lv))
                            .child(barra(0.18 + 0.5 * lv)),
                    )
                })
                .child(div().min_w_0().truncate().child(l.rotulo.clone())),
        )
}

/// `.tile__actions`: fixar, tela cheia, janela flutuante (+ parar de assistir /
/// trocar a fonte), aparecendo com o mouse em cima.
fn acoes(l: &Ladrilho, fixado: bool, v_sobre: f32, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let k = l.chave.clone();
    let mut lista: Vec<(&'static str, &'static str, bool)> = vec![
        (if fixado { "pin-off" } else { "pin" }, if fixado { "Desafixar" } else { "Fixar na tela" }, fixado),
        ("maximize-2", "Tela cheia", false),
        ("panel-right-open", "Janela flutuante", false),
    ];
    if l.tipo == Tipo::Tela && !l.eu {
        lista.push(("eye-off", "Parar de assistir", false));
    }
    if l.tipo == Tipo::Tela && l.eu {
        lista.push(("refresh-cw", "Trocar o que estou mostrando", false));
    }
    let mut linha = div().absolute().top(px(8.)).right(px(8.)).flex().gap(px(4.)).opacity(v_sobre);
    for (i, (nome, rotulo, pressionado)) in lista.into_iter().enumerate() {
        let chave = format!("acao:{k}:{i}");
        let sob = c.ui.palco.sob.tem(&chave);
        let v = c.ui.palco.trans.valor(&chave, sob || pressionado, 120., window);
        let v_dica = c.ui.palco.trans.valor(&format!("dica:{chave}"), sob && v_sobre > 0.5, 120., window);
        let (k2, pessoa) = (k.clone(), l.pessoa.clone());
        linha = linha.child(
            div()
                .id(SharedString::from(chave.clone()))
                .relative()
                .size(px(32.))
                .rounded(px(tema::raio::SM))
                .bg(misturar(noite(0.65), t.accent, v))
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .child(icone_traco(nome, 16., 2.1, gpui::white()))
                .when(v_dica > 0., |d| d.child(dica(rotulo, v_dica, 32., t)))
                .on_hover(cx.listener(move |c, h: &bool, _, cx| {
                    c.ui.palco.sob.marcar(&chave, *h);
                    cx.notify();
                }))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |c, _, window, cx| {
                    match nome {
                        "pin" | "pin-off" => alternar_fixar(c, &k2),
                        "maximize-2" => {
                            let ui = &mut c.ui.palco;
                            ui.tela_cheia = if ui.tela_cheia.as_deref() == Some(k2.as_str()) { None } else { Some(k2.clone()) };
                            if ui.tela_cheia.is_some() != window.is_fullscreen() {
                                window.toggle_fullscreen();
                            }
                        }
                        "panel-right-open" => super::flutuante::abrir(&k2, cx),
                        "eye-off" => {
                            c.ui.palco.assistindo.remove(&pessoa);
                        }
                        // ponytail: trocar a fonte da tela pede o seletor de janelas (não há no nativo).
                        _ => {}
                    }
                    cx.notify();
                })),
        );
    }
    linha.into_any_element()
}

/// `.vol`: o volume desta pessoa, só neste computador (0 a 150%).
fn volume(l: &Ladrilho, v_sobre: f32, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let pessoa = l.pessoa.clone();
    let (pct, _) = c.ui.palco.volumes.get(&pessoa).copied().unwrap_or((100, 100));
    let mudo = pct == 0;
    let reforco = pct > 100;
    let acesas = (pct as f32 / 15.).round() as i32;
    let v = if pct != 100 { 1. } else { v_sobre };
    let chave_btn = format!("volbtn:{}", l.chave);
    let sob_btn = c.ui.palco.sob.tem(&chave_btn);
    let chave_vol = format!("vol:{}", l.chave);
    let v_vol = c.ui.palco.trans.valor(&chave_vol, c.ui.palco.sob.tem(&chave_vol), 120., window);
    let caixa: Rc<Cell<Bounds<Pixels>>> = Rc::default();

    let (rosa, laranja) = (hex(0xfd4d87), hex(0xfe9c5f));
    let mut rampa = div().absolute().size_full().flex().items_end().gap(px(3.));
    for i in 0..10 {
        let acesa = (acesas - i).clamp(0, 1) as f32;
        let (c0, c1) = (misturar(rosa, laranja, i as f32 / 10.), misturar(rosa, laranja, (i + 1) as f32 / 10.));
        let (c0, c1, op) = if mudo { (cinza(c0), cinza(c1), 0.2) } else if acesa > 0. { (c0, c1, 1.) } else { (cinza(c0), cinza(c1), 0.22) };
        let brilho = reforco && i >= 7 && acesa > 0.;
        rampa = rampa.child(
            div()
                .flex_1()
                .h(px((0.28 + 0.08 * i as f32) * 22. * (1. + 0.08 * v_vol)))
                .rounded(px(2.))
                .bg(linear_gradient(90., linear_color_stop(c0, 0.), linear_color_stop(c1, 1.)))
                .opacity(op)
                .when(brilho, |d| d.shadow(vec![BoxShadow { color: laranja, offset: point(px(0.), px(0.)), blur_radius: px(9.), spread_radius: px(-1.) }])),
        );
    }
    let ajustar = {
        let (caixa, pessoa) = (caixa.clone(), pessoa.clone());
        move |c: &mut Chamada, x: Pixels| {
            let b = caixa.get();
            let f = (f32::from(x - b.origin.x) - 2.) / (f32::from(b.size.width) - 4.).max(1.);
            let novo = ((f.clamp(0., 1.) * 150. / 5.).round() * 5.) as u32;
            let antes = c.ui.palco.volumes.get(&pessoa).map_or(100, |v| v.1);
            c.ui.palco.volumes.insert(pessoa.clone(), (novo, if novo > 0 { novo } else { antes }));
        }
    };
    let ajustar2 = ajustar.clone();
    let trilho = div()
        .id(SharedString::from(format!("trilho:{}", l.chave)))
        .relative()
        .w(px(92.))
        .h(px(22.))
        .flex_none()
        .cursor_pointer()
        .child(rampa)
        .child(canvas(move |b, _, _| caixa.set(b), |_, _, _, _| {}).absolute().size_full())
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |c, e: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                ajustar(c, e.position.x);
                cx.notify();
            }),
        )
        .on_mouse_move(cx.listener(move |c, e: &MouseMoveEvent, _, cx| {
            if e.pressed_button == Some(MouseButton::Left) {
                ajustar2(c, e.position.x);
                cx.notify();
            }
        }));
    let nome = l.nome.clone();
    div()
        .id(SharedString::from(chave_vol.clone()))
        .absolute()
        .left(px(8.))
        .bottom(px(38. - 4. * (1. - v)))
        .opacity(v)
        .flex()
        .items_center()
        .gap(px(8.))
        .pl(px(4.))
        .pr(px(8.))
        .py(px(4.))
        .rounded_full()
        .bg(noite(0.66))
        .on_hover(cx.listener(move |c, h: &bool, _, cx| {
            c.ui.palco.sob.marcar(&chave_vol, *h);
            cx.notify();
        }))
        .child(
            div()
                .id(SharedString::from(chave_btn.clone()))
                .size(px(26.))
                .flex_none()
                .rounded_full()
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .when(sob_btn, |d| d.bg(branco(0.16)))
                .child(icone_traco(if mudo { "volume-x" } else { "volume-2" }, 16., 2.1, if mudo { t.danger } else { gpui::white() }))
                .on_hover(cx.listener(move |c, h: &bool, _, cx| {
                    c.ui.palco.sob.marcar(&chave_btn, *h);
                    cx.notify();
                }))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |c, _, _, cx| {
                    let (agora, antes) = c.ui.palco.volumes.get(&pessoa).copied().unwrap_or((100, 100));
                    let novo = if agora == 0 { antes.max(5) } else { 0 };
                    c.ui.palco.volumes.insert(pessoa.clone(), (novo, if agora > 0 { agora } else { antes }));
                    c.avisar(if novo == 0 { format!("{nome} silenciado só para você") } else { format!("{nome} audível de novo") }, cx);
                })),
        )
        .child(trilho)
        .child(
            div()
                .min_w(px(21.))
                .text_size(px(tema::texto::XXS))
                .line_height(px(16.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if reforco { laranja } else { branco(0.85) })
                .child(if mudo { "mudo".to_string() } else { format!("{pct}%") }),
        )
        .into_any_element()
}

/// `.tile__status`: "Conectando…" por cima do ladrilho (grade de 2 linhas:
/// o ícone no meio da metade de cima, o texto no meio da de baixo).
fn estado_conexao(k: &str, texto: &'static str, gira: bool) -> impl IntoElement + use<> {
    let simbolo: AnyElement = if gira {
        icone("loader-2", 24., gpui::white())
            .with_animation(SharedString::from(format!("gira:{k}")), Animation::new(Duration::from_millis(900)).repeat(), |s, p| {
                s.with_transformation(Transformation::rotate(radians(p * std::f32::consts::TAU)))
            })
            .into_any_element()
    } else {
        icone("wifi-off", 24., gpui::white()).into_any_element()
    };
    div()
        .absolute()
        .size_full()
        .bg(noite(0.66))
        .p(px(16.))
        .flex()
        .flex_col()
        .gap(px(8.))
        .text_color(gpui::white())
        .text_size(px(tema::texto::SM))
        .child(div().flex_1().flex().items_center().justify_center().child(simbolo))
        .child(div().flex_1().flex().items_center().justify_center().child(texto))
}

