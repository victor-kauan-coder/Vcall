//! A antessala: a credencial (ESPEC 2; public/index.html:78-175,
//! css/app.css:22-541, js/ui/lobby.js). No papel, a câmera, o nome, os
//! aparelhos e o avatar; no canhoto escuro, o botão de entrar. Atrás, as duas
//! manchas da marca (`.ambient`).

#[path = "saguao_midia.rs"]
mod midia;
#[path = "saguao_pecas.rs"]
pub(crate) mod pecas;

use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use futures::StreamExt;
use futures::channel::mpsc::UnboundedSender;
use gpui::{
    Context, Corners, Entity, Focusable, FontWeight, Hsla, MouseMoveEvent, PathPromptOptions, RenderImage, Rgba, SharedString, Window, WindowControlArea, canvas, div, fill, img, linear_color_stop,
    linear_gradient, point, prelude::*, px, rgb, size,
};

use super::comp::{icone, icone_traco};
use super::tema::{FONTE, FONTE_DISPLAY, Tema, raio, rgba_f, sombra};
use crate::chamada::{Chamada, Opcoes};
use crate::entrada::{self, Entrada};
use crate::sala::Avatar;
use pecas::{degrade_css, dica, espacado, mistura, subir, tracejado};

/// O que a chamada precisa e o saguão só repassa.
pub struct Destino {
    pub ws: String,
    pub sala_id: String,
    pub ice: Vec<libwebrtc::prelude::IceServer>,
    pub opcoes: Opcoes,
}

/* As cores do cartão (app.css:79): o papel é o mesmo nos dois temas. */
const PAPEL: u32 = 0xfff6ec;
const TINTA: u32 = 0x1d0a1f;
const TINTA_2: u32 = 0x554150;
const CANHOTO_TEXTO: u32 = 0xf4f0ff;
const LOGO: &[u8] = include_bytes!("../../../public/assets/logo-mark.png");

fn tinta(a: f32) -> Hsla {
    rgba_f(29., 10., 31., a)
}

/// O que está sob o mouse (para as dicas e os hovers que mudam o ícone).
#[derive(Clone, Copy, PartialEq)]
enum Sobre {
    Tema,
    Mic,
    Cam,
    Avatar(usize),
}

#[derive(Clone, Copy)]
enum Tom {
    Ok,
    Aviso,
}

/// O botão de tema: sistema → claro → escuro (theme.js:27). O tema da janela
/// vem de `Tema::de`, que lê VCALL_TEMA; o botão troca essa variável.
static MODO_TEMA: AtomicU8 = AtomicU8::new(0);

pub struct Saguao {
    pub nome: Entity<Entrada>,
    pub avatar: Avatar,
    destino: Option<Destino>,
    teste: bool,
    /// A semente da grade de avatares (lobby.js: a mesma para todos os estilos).
    semente: String,
    /// O estilo de antes da foto ("avatar:style" do app), para o Sortear.
    estilo_antes_da_foto: Option<String>,
    mic: Option<midia::Microfone>,
    cam: Option<midia::Camera>,
    quadro: Option<Arc<RenderImage>>,
    tx_quadros: UnboundedSender<Arc<RenderImage>>,
    nivel: f32,
    mics: Vec<String>,
    cams: Vec<String>,
    escolhidos: [usize; 2],
    menu: Option<usize>,
    sobre: Option<Sobre>,
    /// Hover do "Entrar na sala": (posição de partida, alvo, quando mudou).
    cta: (f32, f32, Instant),
    inicio: Instant,
    /// O fundo segue o ponteiro (motion.js wireAmbient): alvo e atual, em [-0,5, 0,5].
    ponteiro: [f32; 4],
    aviso: Option<(u64, SharedString, Tom, Instant)>,
    _assinaturas: Vec<gpui::Subscription>,
}

impl Saguao {
    pub fn novo(destino: Destino, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let nome = cx.new(|cx| {
            let mut e = Entrada::nova("Seu nome", cx);
            e.limite = 32;
            e.cor_dica = rgb(0x74606e).into();
            e
        });
        let assinaturas = vec![
            cx.subscribe(&nome, |_, _, _: &entrada::Mudou, cx| cx.notify()),
            cx.subscribe_in(&nome, window, |s: &mut Saguao, _, _: &entrada::Enviado, window, cx| s.entrar(window, cx)),
        ];
        let (tx, mut rx) = futures::channel::mpsc::unbounded::<Arc<RenderImage>>();
        cx.spawn(async move |este, cx| {
            while let Some(q) = rx.next().await {
                let vivo = este.update(cx, |s, cx| {
                    let velho = if s.cam.is_some() { s.quadro.replace(q) } else { Some(q) };
                    if let Some(v) = velho {
                        cx.drop_image(v, None);
                    }
                    cx.notify();
                });
                if vivo.is_err() {
                    break;
                }
            }
        })
        .detach();
        let teste = destino.opcoes.teste;
        let (mics, cams) = midia::aparelhos(teste);
        let avatar = super::avatar::padrao();
        let semente = match &avatar {
            Avatar::Gerado { semente, .. } => semente.clone(),
            _ => vcall_avatares::semente_aleatoria(),
        };
        // Como o app: pede microfone e câmera ao abrir, os dois ligados.
        Saguao {
            nome,
            avatar,
            destino: Some(destino),
            teste,
            semente,
            estilo_antes_da_foto: None,
            mic: Some(midia::microfone(teste, 0)),
            cam: Some(midia::camera(teste, 0, tx.clone())),
            quadro: None,
            tx_quadros: tx,
            nivel: 0.,
            mics,
            cams,
            escolhidos: [0, 0],
            menu: None,
            sobre: None,
            cta: (0., 0., Instant::now()),
            inicio: Instant::now(),
            ponteiro: [0.; 4],
            aviso: None,
            _assinaturas: assinaturas,
        }
    }

    /// Troca esta tela pela chamada, já com o que estava ligado aqui.
    pub fn entrar(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let nome = self.nome.read(cx).texto().trim().to_string();
        if nome.is_empty() {
            self.nome.read(cx).focus_handle(cx).focus(window);
            return;
        }
        let Some(mut d) = self.destino.take() else { return };
        d.opcoes.ligar = [("mic", self.mic.is_some()), ("cam", self.cam.is_some())].into_iter().filter(|(_, l)| *l).map(|(p, _)| p.to_string()).collect();
        // A webcam não abre duas vezes: a prévia solta antes da chamada pegar.
        (self.mic, self.cam) = (None, None);
        if let Some(q) = self.quadro.take() {
            cx.drop_image(q, Some(window));
        }
        let avatar = self.avatar.clone();
        window.replace_root(cx, move |_, cx| Chamada::nova(d.ws, d.sala_id, nome, avatar, d.ice, d.opcoes, cx));
    }

    fn alternar(&mut self, papel: usize, cx: &mut Context<Self>) {
        if papel == 0 {
            self.mic = if self.mic.is_some() { None } else { Some(midia::microfone(self.teste, self.escolhidos[0])) };
        } else if self.cam.take().is_none() {
            self.cam = Some(midia::camera(self.teste, self.escolhidos[1], self.tx_quadros.clone()));
        } else if let Some(q) = self.quadro.take() {
            cx.drop_image(q, None);
        }
        cx.notify();
    }

    fn escolher(&mut self, papel: usize, i: usize, cx: &mut Context<Self>) {
        self.escolhidos[papel] = i;
        self.menu = None;
        // Trocar de aparelho reabre o que estava ligado.
        if papel == 0 && self.mic.is_some() {
            self.mic = Some(midia::microfone(self.teste, i));
        }
        if papel == 1 && self.cam.is_some() {
            self.cam = Some(midia::camera(self.teste, i, self.tx_quadros.clone()));
        }
        cx.notify();
    }

    fn sortear(&mut self, cx: &mut Context<Self>) {
        let estilo = match &self.avatar {
            Avatar::Gerado { estilo, .. } => Some(estilo.clone()),
            _ => self.estilo_antes_da_foto.clone(),
        };
        let padrao = super::avatar::padrao();
        let Avatar::Gerado { estilo: e_padrao, semente } = padrao else { return };
        self.semente = semente.clone();
        self.avatar = Avatar::Gerado { estilo: estilo.unwrap_or(e_padrao), semente };
        cx.notify();
    }

    fn usar_foto(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let escolha = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn_in(window, async move |este, cx| {
            let Ok(Ok(Some(caminhos))) = escolha.await else { return };
            let Some(c) = caminhos.into_iter().next() else { return };
            let feito = cx.background_executor().spawn(async move { midia::foto(&c) }).await;
            let _ = este.update(cx, |s, cx| match feito {
                Ok((url, bytes)) => {
                    if let Avatar::Gerado { estilo, .. } = &s.avatar {
                        s.estilo_antes_da_foto = Some(estilo.clone());
                    }
                    s.avatar = Avatar::Foto(url);
                    s.avisar(format!("Foto definida ({} kB)", (bytes as f32 / 1024.).round()), Tom::Ok, 2200, cx);
                }
                Err(e) => s.avisar(e, Tom::Aviso, 4200, cx),
            });
        })
        .detach();
    }

    /// Um aviso passageiro (toast.js), um por vez.
    fn avisar(&mut self, texto: impl Into<SharedString>, tom: Tom, ms: u64, cx: &mut Context<Self>) {
        let id = self.aviso.as_ref().map_or(1, |a| a.0 + 1);
        self.aviso = Some((id, texto.into(), tom, Instant::now()));
        cx.spawn(async move |este, cx| {
            cx.background_executor().timer(Duration::from_millis(ms)).await;
            let _ = este.update(cx, |s, cx| {
                if s.aviso.as_ref().is_some_and(|a| a.0 == id) {
                    s.aviso = None;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn marcar(&mut self, s: Sobre, dentro: bool, cx: &mut Context<Self>) {
        if dentro {
            self.sobre = Some(s);
        } else if self.sobre == Some(s) {
            self.sobre = None;
        }
        cx.notify();
    }

    fn trocar_tema(&mut self, window: &mut Window) {
        let modo = (MODO_TEMA.load(Ordering::Relaxed) + 1) % 3;
        MODO_TEMA.store(modo, Ordering::Relaxed);
        super::tema::definir_preferencia(modo as u8);
        window.refresh();
    }
}

/// As medidas da credencial na largura da janela (as do CSS com vw/vmax).
#[derive(Clone, Copy)]
struct Medidas {
    vw: f32,
    vh: f32,
    vmax: f32,
    cartao: f32,
    canhoto: f32,
    papel: f32,
    previa: f32,
    form: f32,
    /// Até 1000 px a foto vai em cima do formulário (app.css:510).
    coluna: bool,
    titulo: f32,
}

impl Medidas {
    fn de(window: &Window) -> Medidas {
        let v = window.viewport_size();
        let (vw, vh) = (f32::from(v.width), f32::from(v.height));
        let cartao = 1120f32.min(vw - 32.);
        let canhoto = (0.18 * vw).clamp(220., 252.);
        let papel = cartao - canhoto;
        let miolo = papel - 60.;
        let coluna = vw <= 1000.;
        let (previa, form) = if coluna { (miolo, miolo) } else { ((miolo - 30.) * 1.25 / 2.25, (miolo - 30.) / 2.25) };
        Medidas { vw, vh, vmax: vw.max(vh) / 100., cartao, canhoto, papel, previa, form, coluna, titulo: (17.6 + 0.014 * vw).clamp(30.4, 43.2) }
    }
}

/// O nome que o app mostra para cada estilo (avatars.js STYLE_LABELS).
fn rotulo_estilo(estilo: &str) -> &str {
    match estilo {
        "paisagemMontanha" => "Montanhas",
        "paisagemLago" => "Lago",
        "paisagemMar" => "Mar",
        "paisagemFloresta" => "Floresta",
        "paisagemDunas" => "Dunas",
        "paisagemColinas" => "Colinas",
        "paisagemNeve" => "Neve",
        "paisagemNoite" => "Noite",
        "paisagemAurora" => "Aurora",
        "paisagemCidade" => "Cidade",
        "vcall" => "Vcall",
        "notionistsNeutral" => "Traço",
        "loreleiNeutral" => "Retrato",
        "adventurerNeutral" => "Aventura",
        "botttsNeutral" => "Robô",
        "personas" => "Pessoa",
        "miniavs" => "Mini",
        "thumbs" => "Polegar",
        "shapes" => "Formas",
        "identicon" => "Geométrico",
        "initials" => "Iniciais",
        e => e,
    }
}

/// Um avatar redondo (`.avatar`: fundo surface-3 por baixo).
fn avatar_img(av: &Avatar, tam: f32, t: &Tema) -> gpui::AnyElement {
    let base = div().size(px(tam)).flex_none().rounded_full().bg(t.surface_3);
    match super::avatar::para_img(av) {
        Some(i) => base.child(img(i).size_full().rounded_full()).into_any_element(),
        None => base.into_any_element(),
    }
}

/// A cor do fundo (página + manchas) num ponto da janela: o que aparece nos
/// entalhes do ingresso, que no CSS são buracos na máscara.
fn fundo_em(t: &Tema, m: &Medidas, mancha: &[(f32, f32, Hsla); 2], x: f32, y: f32) -> Hsla {
    let r = 26. * m.vmax;
    let mut c = t.bg;
    for (cx, cy, cor) in mancha {
        let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
        c = mistura(c, cor.opacity(1.), t.glow_opacity * pecas::phi((r - d) / 120.));
    }
    c
}

impl Render for Saguao {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        super::registrar_tamanho(window);
        let t = Tema::de(window);
        let m = Medidas::de(window);
        let agora = self.inicio.elapsed().as_secs_f32();

        // O medidor: sobe na hora, desce devagar (lobby.js #medirSom).
        let bruto = self.mic.as_ref().map_or(0., |mic| (mic.nivel() * 5.).min(1.));
        self.nivel = if bruto > self.nivel { bruto } else { self.nivel * 0.9 };
        // O fundo atrás do ponteiro, com a mesma inércia (x += (alvo − x)·0,06).
        let [ax, ay, mx, my] = self.ponteiro;
        let (mx, my) = (mx + (ax - mx) * 0.06, my + (ay - my) * 0.06);
        self.ponteiro = [ax, ay, mx, my];
        let cta_t = self.cta.2.elapsed().as_secs_f32() / 0.5;
        let animando = agora < 1.0 || self.mic.is_some() || self.nivel > 0.001 || (ax - mx).abs() + (ay - my).abs() > 1e-4 || cta_t < 1. || self.aviso.is_some();
        if animando {
            window.request_animation_frame();
        }

        // As manchas (app.css:22-61, motion.css:108): 52vmax, borrão de 120 px.
        let d = 52. * m.vmax;
        let manchas = [
            (-16. * m.vmax + mx * 6. * m.vmax, -22. * m.vmax + my * 6. * m.vmax, t.gradiente.0),
            (m.vw + 18. * m.vmax - d - mx * 5. * m.vmax, m.vh + 26. * m.vmax - d - my * 5. * m.vmax, t.gradiente.1),
        ];
        let centros = manchas.map(|(x, y, c)| (x + d / 2., y + d / 2., c));
        let ambiente = div().absolute().inset_0().children(manchas.map(|(x, y, cor)| {
            div().absolute().left(px(x)).top(px(y)).size(px(d)).rounded(px(d / 2.)).shadow(vec![sombra(0., 0., 120., 0., cor.opacity(t.glow_opacity))])
        }));

        let papel = self.papel(&t, &m, window, cx);
        let canhoto = self.canhoto(&t, &m, window, cx);
        let (op_p, y_p) = subir(agora - 0.06, 14.);
        let (op_c, y_c) = subir(agora - 0.15, 14.);

        // A sombra do cartão é um filtro sobre o ingresso inteiro (app.css:79/482).
        let sombra_cartao = if t.escuro {
            vec![sombra(0., 30., 17., 0., rgba_f(4., 2., 18., 0.55)), sombra(0., 2., 1.5, 0., rgba_f(4., 2., 18., 0.4))]
        } else {
            vec![sombra(0., 26., 15., 0., rgba_f(22., 16., 63., 0.2)), sombra(0., 2., 1.5, 0., rgba_f(22., 16., 63., 0.16))]
        };
        // Os entalhes: buracos de raio 14 no topo e no pé da emenda. Pintados
        // com a cor do fundo naquele ponto e a sombra que cai neles.
        let (tm, papel_w) = (t, m.papel);
        let fundo_args = (centros, m);
        let entalhes = canvas(
            |_, _, _| (),
            move |b, _, window, _| {
                let (centros, m) = &fundo_args;
                let (sombra_cor, topo, pe) = if tm.escuro { (rgba_f(4., 2., 18., 1.), 0.2, 0.55) } else { (rgba_f(22., 16., 63., 1.), 0.045, 0.2) };
                let x = f32::from(b.origin.x) + papel_w;
                for (y, a) in [(f32::from(b.origin.y), topo), (f32::from(b.origin.y + b.size.height), pe)] {
                    let cor = mistura(fundo_em(&tm, m, centros, x, y + 7. * if a == topo { 1. } else { -1. }), sombra_cor, a);
                    window.paint_quad(fill(gpui::Bounds::new(point(px(x - 14.), px(y - 14.)), size(px(28.), px(28.))), cor).corner_radii(px(14.)));
                }
            },
        )
        .absolute()
        .inset_0();
        let cartao = div()
            .relative()
            .w(px(m.cartao))
            .flex()
            .child(div().absolute().inset_0().rounded(px(22.)).shadow(sombra_cartao).opacity(op_p).top(px(y_p)))
            .child(papel.opacity(op_p).top(px(y_p)))
            .child(canhoto.opacity(op_c).top(px(y_c)))
            .child(div().absolute().inset_0().opacity(op_p).top(px(y_p)).child(entalhes));

        div()
            .size_full()
            .relative()
            .overflow_hidden()
            .bg(t.bg)
            .text_color(t.text)
            .font_family(FONTE)
            .text_size(px(15.))
            .line_height(px(22.5))
            .on_mouse_move(cx.listener(move |s, e: &MouseMoveEvent, _, cx| {
                s.ponteiro[0] = f32::from(e.position.x) / m.vw - 0.5;
                s.ponteiro[1] = f32::from(e.position.y) / m.vh - 0.5;
                cx.notify();
            }))
            .child(ambiente)
            .child(
                div().id("antessala").absolute().inset_0().overflow_y_scroll().child(
                    // `.lobby`: centrado; no app de mesa o topo é a altura da barra de título (app.css:3977).
                    div().min_h_full().flex().items_center().justify_center().pt(px(40.)).pb(px((4. * m.vh / 100.).clamp(16., 48.))).px(px(16.)).child(cartao),
                ),
            )
            // A tira invisível de arrastar a janela, até os botões de janela.
            .child(div().id("arrastar").absolute().top_0().left_0().right(px(138.)).h(px(40.)).window_control_area(WindowControlArea::Drag))
            .children(self.aviso.as_ref().map(|(_, texto, tom, inicio)| aviso(&t, &m, texto.clone(), *tom, *inicio)))
            .child(super::janela::controles(&t, window))
    }
}

/// O aviso passageiro (`.toast`, base.css:418-470).
fn aviso(t: &Tema, m: &Medidas, texto: SharedString, tom: Tom, inicio: Instant) -> impl IntoElement {
    let (ic, cor) = match tom {
        Tom::Ok => ("check", t.ok),
        Tom::Aviso => ("alert-triangle", t.warn),
    };
    let e = pecas::ease_out(inicio.elapsed().as_secs_f32() / 0.2);
    div().absolute().left_0().right_0().bottom(px(100.)).flex().justify_center().child(
        div()
            .w(px(440f32.min(m.vw - 64.)))
            .flex()
            .justify_center()
            .opacity(e)
            .relative()
            .top(px(10. * (1. - e)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .px(px(16.))
                    .py(px(12.))
                    .rounded(px(raio::LG))
                    .bg(t.bg_elevated)
                    .border_1()
                    .border_color(t.border)
                    .shadow(pecas::sombra_lg(t))
                    .text_size(px(13.))
                    .line_height(px(19.5))
                    .child(icone_traco(ic, 16., 2.1, cor))
                    .child(texto),
            ),
    )
}

impl Saguao {
    /// A parte de papel (`.lobby__papel`, app.css:96).
    fn papel(&mut self, t: &Tema, m: &Medidas, window: &mut Window, cx: &mut Context<Self>) -> gpui::Div {
        let sobre_tema = self.sobre == Some(Sobre::Tema);
        let modo = MODO_TEMA.load(Ordering::Relaxed) as usize;
        let topo = div()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(40.))
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(div().flex().items_center().gap(px(8.)).child(img(Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Png, LOGO.to_vec()))).size(px(22.)).rounded(px(6.))).child(espacado(
                        window,
                        "Vcall",
                        FONTE_DISPLAY,
                        16.,
                        FontWeight::EXTRA_BOLD,
                        -0.32,
                        24.,
                        rgb(TINTA).into(),
                    )))
                    .child(div().flex_1())
                    .child(
                        div()
                            .id("tema")
                            .relative()
                            .size(px(40.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(raio::MD))
                            .cursor_pointer()
                            .when(sobre_tema, |d| d.bg(tinta(0.07)))
                            .child(icone(["laptop", "sun", "moon"][modo], 20., if sobre_tema { rgb(TINTA).into() } else { rgb(TINTA_2).into() }))
                            .on_hover(cx.listener(|s, h: &bool, _, cx| s.marcar(Sobre::Tema, *h, cx)))
                            .on_click(cx.listener(|s, _, w, _| s.trocar_tema(w)))
                            .when(sobre_tema, |d| d.child(dica(["Tema do sistema", "Tema claro", "Tema escuro"][modo], true, t))),
                    ),
            )
            .child(tracejado(false, 3., 2., tinta(0.16)).mt(px(12.)).h(px(1.)).w_full());

        let previa = self.previa(t, m, cx);
        let form = self.form(t, m, window, cx);
        let miolo = if m.coluna { div().flex().flex_col().gap(px(30.)) } else { div().flex().gap(px(30.)) };
        div()
            .relative()
            .w(px(m.papel))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(18.))
            .pt(px(22.))
            .px(px(30.))
            .pb(px(30.))
            .rounded_l(px(22.))
            .bg(rgb(PAPEL))
            .text_color(rgb(TINTA))
            // No tema claro, um fio por dentro do papel (app.css:486).
            .when(!t.escuro, |d| d.child(div().absolute().inset_0().rounded_l(px(22.)).border_1().border_color(tinta(0.07))))
            .child(topo)
            .child(miolo.child(previa).child(form))
    }

    /// A foto da credencial (`.lobby__preview`, app.css:149).
    fn previa(&mut self, t: &Tema, m: &Medidas, cx: &mut Context<Self>) -> gpui::AnyElement {
        let fundo = if let (Some(cam), Some(q)) = (&self.cam, &self.quadro) {
            // A câmera recorta o quadro na proporção desta caixa (object-fit: cover
            // com os cantos redondos, que o img do GPUI não faz junto).
            let (prop, q) = (cam.proporcao.clone(), q.clone());
            canvas(
                move |b, _, _| prop.store((f32::from(b.size.width) / f32::from(b.size.height).max(1.)).to_bits(), Ordering::Relaxed),
                move |b, _, window, _| {
                    let _ = window.paint_image(b, Corners::all(px(16.)), q, 0, false);
                },
            )
            .absolute()
            .inset_0()
            .into_any_element()
        } else if self.cam.is_some() {
            // Ligando: a caixa vazia (o <video> sem quadro ainda), mas já avisa a proporção.
            let prop = self.cam.as_ref().map(|c| c.proporcao.clone());
            canvas(move |b, _, _| prop.iter().for_each(|p| p.store((f32::from(b.size.width) / f32::from(b.size.height).max(1.)).to_bits(), Ordering::Relaxed)), |_, _, _, _| {})
                .absolute()
                .inset_0()
                .into_any_element()
        } else {
            let (glow, base): (Rgba, Rgba) = (t.tile_glow.into(), t.tile_bg.into());
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(12.))
                .pb(px(64.))
                .child(
                    // radial-gradient(circle at 50% 40%, tile-glow, tile-bg 70%), até o canto mais longe.
                    pecas::fundo("placeholder", t.escuro as u64, Corners::all(px(16.)), move |x, y, w, h| {
                        let r = ((w / 2.).powi(2) + (h * 0.6).powi(2)).sqrt();
                        let k = (((x - w / 2.).powi(2) + (y - h * 0.4).powi(2)).sqrt() / (0.7 * r)).min(1.);
                        Rgba { r: glow.r + (base.r - glow.r) * k, g: glow.g + (base.g - glow.g) * k, b: glow.b + (base.b - glow.b) * k, a: 1. }
                    })
                    .absolute()
                    .inset_0(),
                )
                .child(avatar_img(&self.avatar, 112., t))
                .child(div().text_color(rgba_f(244., 240., 255., 0.72)).child("Câmera desligada"))
                .into_any_element()
        };
        let barra_fundo = linear_gradient(0., linear_color_stop(rgba_f(7., 4., 22., 0.8), 0.), linear_color_stop(rgba_f(7., 4., 22., 0.), 1.));
        let caixa = div().relative().flex().flex_col().rounded(px(16.)).bg(t.tile_bg);
        let caixa = if m.coluna { caixa.w_full().h(px(m.previa * 0.75)) } else { caixa.w(px(m.previa)).flex_none().min_h(px(300.)) };
        caixa
            .child(fundo)
            .child(
                div()
                    .relative()
                    .mt_auto()
                    .flex()
                    .justify_center()
                    .gap(px(12.))
                    .p(px(16.))
                    .rounded_b(px(16.))
                    .bg(barra_fundo)
                    .child(self.ctrl(t, 0, cx))
                    .child(self.ctrl(t, 1, cx)),
            )
            .into_any_element()
    }

    /// Microfone e câmera da prévia (`button.ctrl`, call.css:160): quadrados de 46, raio 16.
    fn ctrl(&self, t: &Tema, papel: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let ligado = if papel == 0 { self.mic.is_some() } else { self.cam.is_some() };
        let s_ = if papel == 0 { Sobre::Mic } else { Sobre::Cam };
        let sobre = self.sobre == Some(s_);
        let (ic, rotulo) = match (papel, ligado) {
            (0, true) => ("mic", "Microfone ligado"),
            (0, false) => ("mic-off", "Microfone mudo"),
            (_, true) => ("video", "Câmera ligada"),
            (_, false) => ("video-off", "Câmera desligada"),
        };
        let fundo = if sobre { t.surface_hover } else if ligado { t.surface_2 } else { t.danger_soft };
        div()
            .id(("ctrl", papel))
            .relative()
            .size(px(46.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(raio::CTRL))
            .border_1()
            .border_color(if sobre { t.border } else { gpui::transparent_black() })
            .bg(fundo)
            .cursor_pointer()
            .child(icone(ic, 24., if ligado { t.text } else { t.danger }))
            .on_hover(cx.listener(move |s, h: &bool, _, cx| s.marcar(s_, *h, cx)))
            .on_click(cx.listener(move |s, _, _, cx| s.alternar(papel, cx)))
            .when(sobre, |d| d.child(dica(rotulo, false, t)))
    }

    fn form(&mut self, t: &Tema, m: &Medidas, window: &mut Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let focado = self.nome.read(cx).focus_handle(cx).is_focused(window);
        let vazio = self.nome.read(cx).texto().is_empty();
        let foco: Hsla = if t.escuro { rgb(0xb73a68).into() } else { rgb(0x8f1d46).into() };
        self.nome.update(cx, |e, _| e.cor_cursor = foco);

        let rotulo = |s: &'static str| div().text_size(px(12.)).line_height(px(18.)).font_weight(FontWeight::SEMIBOLD).text_color(rgb(TINTA_2)).child(s);
        let titulo = pecas::equilibrar(window, "Te chamaram para uma call.", FONTE_DISPLAY, m.titulo, FontWeight::EXTRA_BOLD, -0.04 * m.titulo, m.form);
        let titulo = div().flex().flex_col().children(titulo.iter().map(|l| espacado(window, l, FONTE_DISPLAY, m.titulo, FontWeight::EXTRA_BOLD, -0.04 * m.titulo, m.titulo, rgb(TINTA).into())));

        let nome = div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(rotulo("Como você quer aparecer"))
            .child(
                div()
                    .id("nome")
                    .h(px(46.))
                    .px(px(2.))
                    .font_family(FONTE_DISPLAY)
                    .text_size(px(24.))
                    .line_height(px(30.))
                    .font_weight(if vazio { FontWeight::SEMIBOLD } else { FontWeight::BOLD })
                    .text_color(rgb(TINTA))
                    // Em foco o fio engrossa: a borda e a sombra de 1,5 px juntas (app.css:259).
                    .when(focado, |d| d.border_b(px(3.)).mb(px(-1.5)).border_color(foco))
                    .when(!focado, |d| d.border_b(px(1.5)).border_color(tinta(0.3)).hover(|s| s.border_color(tinta(0.5))))
                    .child(self.nome.clone()),
            );

        let form = div().w(px(m.form)).flex_none().flex().flex_col().gap(px(18.)).child(titulo).child(nome);
        let form = if m.coluna { form.w_full() } else { form };
        form.child(self.aparelhos(t, cx)).child(self.avatares(t, m, window, cx)).into_any_element()
    }

    /// "Microfone e câmera" (`.lobby__aparelhos`, app.css:322).
    fn aparelhos(&mut self, t: &Tema, cx: &mut Context<Self>) -> gpui::AnyElement {
        if self.mics.is_empty() && self.cams.is_empty() {
            return div().into_any_element();
        }
        let nivel = self.nivel;
        // O medidor (app.css:367): segmentos de 8 px a cada 11, o aceso cortado em `nivel`.
        let medidor = canvas(
            |_, _, _| (),
            move |b, _, window, _| {
                let w = f32::from(b.size.width);
                let corte = w * nivel;
                let n = (w / 11.).ceil() as usize;
                for i in 0..n {
                    let x = i as f32 * 11.;
                    let seg = |fim: f32| gpui::Bounds::new(point(b.origin.x + px(x), b.origin.y), size(px((fim - x).min(8.)), b.size.height));
                    let ultimo = i == n - 1 && x + 8. >= w;
                    let r = Corners { top_left: px(if i == 0 { 3. } else { 0. }), bottom_left: px(if i == 0 { 3. } else { 0. }), top_right: px(if ultimo { 3. } else { 0. }), bottom_right: px(if ultimo { 3. } else { 0. }) };
                    window.paint_quad(fill(seg(w), tinta(0.14)).corner_radii(r));
                    if x < corte {
                        window.paint_quad(fill(seg(corte), rgb(0x1f9d6f)));
                    }
                }
            },
        )
        .h(px(10.))
        .w_full();
        let mic = self.escolha(t, 0, cx);
        let cam = self.escolha(t, 1, cx);
        let rotulo = div().text_size(px(12.)).line_height(px(18.)).font_weight(FontWeight::SEMIBOLD).text_color(rgb(TINTA_2)).child("Microfone e câmera");
        let linha = || div().flex().items_center().gap(px(10.)).text_color(rgb(TINTA_2));
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(rotulo)
            .child(linha().child(icone_traco("mic", 16., 2.1, rgb(TINTA_2).into())).child(div().flex_1().min_w_0().flex().flex_col().gap(px(6.)).child(mic).child(medidor)))
            .child(linha().child(icone_traco("video", 16., 2.1, rgb(TINTA_2).into())).child(div().flex_1().min_w_0().child(cam)))
            .into_any_element()
    }

    /// Um aparelho: o nome, ou a lista quando há mais de um (`select.lobby__select`).
    fn escolha(&mut self, _t: &Tema, papel: usize, cx: &mut Context<Self>) -> gpui::AnyElement {
        let lista = if papel == 0 { &self.mics } else { &self.cams };
        let atual = lista.get(self.escolhidos[papel]).cloned().unwrap_or_else(|| if papel == 0 { "Microfone".into() } else { "Câmera".into() });
        if lista.len() < 2 {
            return div().text_size(px(14.)).line_height(px(21.)).text_color(rgb(TINTA)).truncate().child(atual).into_any_element();
        }
        let aberto = self.menu == Some(papel);
        let opcoes = lista.clone();
        let escolhido = self.escolhidos[papel];
        div()
            .id(("select", papel))
            .relative()
            .h(px(32.))
            .pl(px(6.))
            .pr(px(4.))
            .flex()
            .items_center()
            .border_b(px(1.5))
            .border_color(if aberto { rgb(0x8f1d46).into() } else { tinta(0.25) })
            .text_size(px(14.))
            .font_weight(FontWeight::MEDIUM)
            .text_color(rgb(TINTA))
            .cursor_pointer()
            .on_click(cx.listener(move |s, _, _, cx| {
                s.menu = if s.menu == Some(papel) { None } else { Some(papel) };
                cx.notify();
            }))
            .child(div().flex_1().min_w_0().truncate().child(atual))
            .child(icone_traco("chevron-down", 14., 2.6, rgb(TINTA).into()))
            .when(aberto, |d| {
                d.child(
                    gpui::deferred(
                        div()
                            .absolute()
                            .top(px(33.))
                            .left_0()
                            .right_0()
                            .py(px(4.))
                            .bg(gpui::white())
                            .border_1()
                            .border_color(rgba_f(0., 0., 0., 0.2))
                            .rounded(px(4.))
                            .shadow(vec![sombra(0., 4., 6., 0., rgba_f(0., 0., 0., 0.2))])
                            .font_weight(FontWeight::NORMAL)
                            .children(opcoes.into_iter().enumerate().map(|(i, o)| {
                                div()
                                    .id(("opcao", i))
                                    .px(px(8.))
                                    .py(px(3.))
                                    .when(i == escolhido, |d| d.bg(rgb(0xe8e1e6)))
                                    .hover(|s| s.bg(rgb(0x1d0a1f)).text_color(gpui::white()))
                                    .truncate()
                                    .child(o)
                                    .on_click(cx.listener(move |s, _, _, cx| s.escolher(papel, i, cx)))
                            })),
                    )
                    .with_priority(2),
                )
            })
            .into_any_element()
    }

    /// "Avatar" e a grade (`.avatarPicker`, app.css:569 + 296-320).
    fn avatares(&mut self, t: &Tema, m: &Medidas, window: &mut Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let _ = window;
        let mini = |id: &'static str, ic: &'static str, texto: &'static str| {
            div()
                .id(id)
                .group(id)
                .h(px(28.))
                .px(px(10.))
                .flex()
                .items_center()
                .gap(px(6.))
                .rounded_full()
                .text_size(px(12.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(TINTA_2))
                .cursor_pointer()
                .hover(|s| s.bg(tinta(0.07)).text_color(rgb(TINTA)))
                .child(icone_traco(ic, 16., 2.1, rgb(TINTA_2).into()).group_hover(id, |s| s.text_color(rgb(TINTA))))
                .child(texto)
        };
        let largura = if m.coluna { m.previa } else { m.form };
        let n = ((largura + 6.) / 48.).floor().max(1.);
        let col = (largura - 6. * (n - 1.)) / n - 0.01;
        let foto = matches!(self.avatar, Avatar::Foto(_));
        let mut opcoes: Vec<(Avatar, bool, SharedString)> = Vec::new();
        if foto {
            opcoes.push((self.avatar.clone(), true, "Sua foto".into()));
        }
        for e in super::avatar::estilos() {
            let sel = !foto && matches!(&self.avatar, Avatar::Gerado { estilo, .. } if *estilo == e);
            opcoes.push((Avatar::Gerado { estilo: e.clone(), semente: self.semente.clone() }, sel, rotulo_estilo(&e).to_string().into()));
        }
        let grade = div().flex().flex_wrap().gap(px(6.)).children(opcoes.into_iter().enumerate().map(|(i, (av, sel, rot))| {
            let sobre = self.sobre == Some(Sobre::Avatar(i));
            let escolha = av.clone();
            div()
                .id(("avatar", i))
                .relative()
                .size(px(col))
                .p(px(2.))
                .rounded_full()
                .border_2()
                .border_color(if sel { rgb(TINTA).into() } else { gpui::transparent_black() })
                .when(sobre && !sel, |d| d.bg(tinta(0.07)))
                .cursor_pointer()
                .child(avatar_img(&av, col - 8., t))
                .on_hover(cx.listener(move |s, h: &bool, _, cx| s.marcar(Sobre::Avatar(i), *h, cx)))
                .on_click(cx.listener(move |s, _, w, cx| {
                    if matches!(escolha, Avatar::Foto(_)) {
                        s.usar_foto(w, cx);
                    } else {
                        s.avatar = escolha.clone();
                        cx.notify();
                    }
                }))
                .when(sobre, |d| d.child(dica(rot, true, t)))
        }));
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(div().text_size(px(12.)).line_height(px(18.)).font_weight(FontWeight::SEMIBOLD).text_color(rgb(TINTA_2)).child("Avatar"))
                    .child(div().flex_1())
                    .child(mini("usar-foto", "image", "Usar foto").on_click(cx.listener(|s, _, w, cx| s.usar_foto(w, cx))))
                    .child(mini("sortear", "shuffle", "Sortear").on_click(cx.listener(|s, _, _, cx| s.sortear(cx)))),
            )
            .child(grade)
            .into_any_element()
    }

    /// O canhoto escuro (`.lobby__canhoto`, app.css:393).
    fn canhoto(&mut self, t: &Tema, m: &Medidas, window: &mut Window, cx: &mut Context<Self>) -> gpui::Div {
        let (rosa, laranja, base): (Rgba, Rgba, Rgba) = (t.gradiente.0.into(), t.gradiente.1.into(), t.tile_bg.into());
        let mistura_px = |c: Rgba, d: Rgba, a: f32| Rgba { r: c.r + (d.r - c.r) * a, g: c.g + (d.g - c.g) * a, b: c.b + (d.b - c.b) * a, a: 1. };
        // Dois radiais sobre o tile-bg: rosa a 30% no canto de cima à direita,
        // laranja a 20% no de baixo à esquerda (pintados pixel a pixel).
        let fundo = pecas::fundo("canhoto", t.escuro as u64, Corners { top_left: px(0.), bottom_left: px(0.), top_right: px(22.), bottom_right: px(22.) }, move |x, y, w, h| {
            let t2 = ((x / (0.9 * w)).powi(2) + ((y - h) / (0.6 * h)).powi(2)).sqrt();
            let t1 = (((x - w) / (1.2 * w)).powi(2) + (y / (0.7 * h)).powi(2)).sqrt();
            let c = mistura_px(base, laranja, 0.2 * (1. - t2 / 0.6).max(0.));
            mistura_px(c, rosa, 0.3 * (1. - t1 / 0.62).max(0.))
        });

        let ativo = !self.nome.read(cx).texto().trim().is_empty();
        // Desligado, o CSS esmaece o botão inteiro de uma vez (opacity .45 no
        // grupo); o GPUI esmaeceria cada peça e a sombra apareceria pelo
        // fundo. Então as cores já saem compostas sobre o canhoto (tile-bg).
        let esmaecer = |c: Hsla| if ativo { c } else { mistura(t.tile_bg, c, 0.45) };
        let cta_texto: Hsla = esmaecer(if t.escuro { rgb(0x1a0a1e).into() } else { gpui::white() });
        let botao_w = m.canhoto - 48.;
        // background-size 170% e o hover que desliza até o laranja em 500 ms.
        let (de, alvo, quando) = self.cta;
        let pos = de + (alvo - de) * pecas::ease_out(quando.elapsed().as_secs_f32() / 0.5);
        let sombra_rosa: Hsla = if t.escuro { rgb(0xcc3c6c).into() } else { rgb(0x9c1743).into() };
        let botao = div()
            .id("entrar")
            .relative()
            .w_full()
            .h(px(56.))
            .px(px(18.))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(10.))
            .rounded_full()
            .bg(degrade_css(135., botao_w, 56., botao_w * 1.7, 56., -0.7 * botao_w * pos, 0., esmaecer(t.gradiente.0), esmaecer(t.gradiente.1)))
            .shadow(vec![sombra(0., 14., 13., -14., sombra_rosa.opacity(if ativo { 1. } else { 0.45 }))])
            .when(!ativo, |d| d.cursor_not_allowed())
            .when(ativo, |d| d.cursor_pointer())
            // inset 0 1px 0 rgb(255 255 255 / .35)
            .child(div().absolute().inset_0().rounded_full().border_t_1().border_color(rgba_f(255., 255., 255., if ativo { 0.35 } else { 0.16 })))
            .child(icone("video", 20., cta_texto))
            .child(espacado(window, "Entrar na sala", FONTE_DISPLAY, 18., FontWeight::EXTRA_BOLD, -0.36, 27., cta_texto))
            .on_hover(cx.listener(move |s, h: &bool, _, cx| {
                let ativo = !s.nome.read(cx).texto().trim().is_empty();
                let (de, alvo, quando) = s.cta;
                let agora = de + (alvo - de) * pecas::ease_out(quando.elapsed().as_secs_f32() / 0.5);
                s.cta = (agora, if *h && ativo { 1. } else { 0. }, Instant::now());
                cx.notify();
            }))
            .on_click(cx.listener(|s, _, w, cx| s.entrar(w, cx)));

        div()
            .relative()
            .w(px(m.canhoto))
            .flex_none()
            .flex()
            .flex_col()
            .justify_center()
            .gap(px(16.))
            .pt(px(30.))
            .px(px(24.))
            .pb(px(26.))
            .rounded_r(px(22.))
            .text_color(rgb(CANHOTO_TEXTO))
            .child(fundo.absolute().inset_0())
            // A picotagem (app.css:414): 2 px tracejados, de r+4 a r+4 das pontas.
            .child(tracejado(true, 6., 4., rgba_f(255., 255., 255., 0.3)).absolute().left_0().top(px(18.)).bottom(px(18.)).w(px(2.)))
            .child(espacado(window, "Tudo certo?", FONTE_DISPLAY, 26., FontWeight::EXTRA_BOLD, -0.78, 27.3, rgb(CANHOTO_TEXTO).into()))
            .child(botao)
            .child(
                div()
                    .text_size(px(12.))
                    .line_height(px(18.))
                    .text_color(rgba_f(244., 240., 255., 0.74))
                    .child("Áudio, vídeo e tela vão direto de um navegador ao outro, criptografados. O servidor só apresenta os participantes: ele não vê nem guarda nada da conversa."),
            )
    }
}
