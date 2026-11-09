//! O palco: grade, duo, destaque e os ladrilhos (ESPEC 3.2 a 3.8). DONO: agente do palco.
//!
//! As regras de ui/stage.js, nesta ordem: sozinho na sala (convite ao lado do
//! seu vídeo); a dois (o outro no palco, você num balão arrastável); alguém
//! fixado ou uma tela assistida (destaque + faixa de 168 px); senão, grade.

#[path = "palco_arte.rs"]
pub mod arte;
#[path = "palco_flutuante.rs"]
mod flutuante;
#[path = "palco_ladrilho.rs"]
mod ladrilho;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use gpui::{
    Animation, AnimationExt, AnyElement, ClipboardItem, Context, Div, Font, FontWeight, Image, ImageFormat, ImageSource, KeyDownEvent, MouseButton, MouseDownEvent,
    MouseMoveEvent, Pixels, SharedString, Size, Stateful, Task, TextRun, Window, anchored, canvas, deferred, div, img, point, prelude::*, px, relative, size,
};

use super::comp::icone_traco;
use super::tema::{self, FONTE, FONTE_DISPLAY, Tema, rgba_f, sombra};
use crate::chamada::Chamada;
use ladrilho::{Ladrilho, Lugar, Qualidade, Tipo};

/// O estado só do desenho do palco (bolha arrastável do duo, ladrilho com o mouse em cima...).
#[derive(Default)]
pub struct Estado {
    /// "Alternar layout" (dock): grade igualitária no lugar do destaque automático.
    pub grade_igualitaria: bool,
    /// O que está com o mouse em cima e as transições de hover (também do topo).
    pub(crate) sob: arte::Sob,
    pub(crate) trans: arte::Transicoes,
    /// Tema escolhido no botão do topo: 0 sistema, 1 claro, 2 escuro.
    pub(crate) tema: u8,
    medidas: Rc<RefCell<HashMap<String, Size<Pixels>>>>,
    imagens: arte::CacheRc,
    /// A ordem da grade como o DOM do app: quem entra na grade vai para o fim.
    ordem: Vec<String>,
    lugar: HashMap<String, u8>,
    /// Volume por pessoa (%, e o de antes de silenciar).
    volumes: HashMap<String, (u32, u32)>,
    /// De quem eu assisto a tela (o resto vira convite).
    assistindo: HashSet<String>,
    previa: HashSet<String>,
    giro: HashMap<String, f32>,
    amb: HashMap<u64, Option<[f32; 3]>>,
    tela_cheia: Option<String>,
    bolha: Bolha,
    relogio: Option<Task<()>>,
    sozinho_antes: bool,
}

#[derive(Default)]
struct Bolha {
    /// (em cima, à esquerda); o padrão é embaixo à direita.
    canto: (bool, bool),
    arrasto: Option<Arrasto>,
    /// Depois de soltar: desliza até o canto com a mola bouncy.
    mola: Option<(Instant, f32, f32)>,
}

struct Arrasto {
    x0: f32,
    y0: f32,
    dx: f32,
    dy: f32,
    origem: (f32, f32),
    tam: (f32, f32),
    pontos: Vec<(f32, f32, Instant)>,
}

const AREA: &str = "palco:area";
const GRADE: u8 = 0;
const DESTAQUE: u8 = 1;
const BOLHA: u8 = 2;

/// Relógio das animações que giram sozinhas.
pub(crate) fn relogio() -> Duration {
    static INICIO: OnceLock<Instant> = OnceLock::new();
    INICIO.get_or_init(Instant::now).elapsed()
}

/// A dica (`[data-tip]::after`, base.css:351) embaixo de um botão de `alto` px.
pub(crate) fn dica(texto: &str, v: f32, alto: f32, t: &Tema) -> Div {
    div().absolute().top(px(alto + 10. + 4. * (1. - v))).left(px(-120.)).right(px(-120.)).flex().justify_center().child(
        div()
            .px(px(12.))
            .py(px(4.))
            .rounded(px(tema::raio::SM))
            .bg(t.brand_ink)
            .shadow(t.sombra_md())
            .text_color(gpui::white())
            .text_size(px(tema::texto::XS))
            .line_height(px(18.))
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .opacity(v)
            .child(texto.to_string()),
    )
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Estilo {
    Normal,
    Primario,
    Fantasma,
}

/// `.btn` (base.css:177): 40 px (48 no `--lg`), raio 13 (18), ícone + texto;
/// hover em 120 ms; aperto desce 1 px.
#[allow(clippy::too_many_arguments)]
pub(crate) fn botao(id: &str, icone: &str, tam_icone: f32, texto: Option<&str>, estilo: Estilo, grande: bool, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> Stateful<Div> {
    let sob = c.ui.palco.sob.tem(id);
    let v = c.ui.palco.trans.valor(&format!("btn:{id}"), sob, 120., window);
    let (bg, borda, cor) = match estilo {
        Estilo::Normal => (arte::misturar(t.surface_2, t.surface_hover, v), arte::misturar(t.border, t.border_strong, v), t.text),
        Estilo::Primario => (t.accent, gpui::transparent_black(), t.accent_text),
        Estilo::Fantasma => (arte::alfa(t.surface_2, v), gpui::transparent_black(), arte::misturar(t.text_secondary, t.text, v)),
    };
    let traco = if tam_icone <= 16. { 2.1 } else { 2. };
    let chave = id.to_string();
    div()
        .id(SharedString::from(id.to_string()))
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .gap(px(8.))
        .h(px(if grande { 48. } else { 40. }))
        .when(texto.is_none(), |d| d.w(px(40.)))
        .when(texto.is_some(), |d| d.px(px(if grande { 24. } else { 16. })))
        .rounded(px(if grande { tema::raio::LG } else { tema::raio::MD }))
        .border_1()
        .border_color(borda)
        .bg(bg)
        .text_color(cor)
        .text_size(px(if grande { tema::texto::MD } else { tema::texto::BASE }))
        .font_weight(if estilo == Estilo::Primario { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
        .whitespace_nowrap()
        .cursor_pointer()
        .active(|s| s.top(px(1.)))
        .child(icone_traco(icone, tam_icone, traco, cor))
        .children(texto.map(str::to_string))
        .on_hover(cx.listener(move |c, h: &bool, _, cx| {
            c.ui.palco.sob.marcar(&chave, *h);
            cx.notify();
        }))
}

/// O link da sala: o mesmo que abriu o cliente (main.rs lê o primeiro argumento).
pub(crate) fn link_da_sala() -> String {
    std::env::args().nth(1).unwrap_or_default()
}

pub(crate) fn copiar_link(c: &mut Chamada, cx: &mut Context<Chamada>) {
    let link = link_da_sala();
    cx.write_to_clipboard(ClipboardItem::new_string(link.clone()));
    let local = link.starts_with("http://127.") || link.starts_with("http://localhost");
    c.avisar(if local { "Link copiado, mas ele só abre neste computador" } else { "Link copiado" }, cx);
}

/// Voz de cada um, 0 a 1 (`--lv` = min(1, nível x 3,2)), de `c.falando`
/// (a própria medida aqui, a dos outros pelo canal de voz). VCALL_PALCO_VOZ
/// simula um nível fixo (para conferir o anel nas fotos).
fn voz(c: &Chamada, id: &str) -> f32 {
    static SIMULADA: OnceLock<Option<f32>> = OnceLock::new();
    if let Some(v) = *SIMULADA.get_or_init(|| std::env::var("VCALL_PALCO_VOZ").ok().and_then(|v| v.parse().ok())) {
        return v;
    }
    let id = if id.is_empty() { c.eu().unwrap_or("") } else { id };
    c.falando.get(id).map_or(0., |f| if f.falando { (f.nivel * 3.2).min(1.) } else { 0. })
}

fn conexao(estado: Option<&String>) -> Option<(&'static str, bool)> {
    let Some(e) = estado.map(|s| s.to_lowercase()) else { return Some(("Conectando…", true)) };
    match e.as_str() {
        "new" | "connecting" => Some(("Conectando…", true)),
        "disconnected" => Some(("Sinal instável…", false)),
        "closed" => Some(("Desconectado", false)),
        e if e == "failed" || e.starts_with("falhou") => Some(("Conexão perdida", false)),
        _ => None,
    }
}

/// Os ladrilhos da sala: a minha câmera, a de cada um, e as telas.
fn ladrilhos(c: &mut Chamada) -> Vec<Ladrilho> {
    let eu = c.eu().unwrap_or("").to_string();
    let quadro = |c: &Chamada, id: &str, papel: &str| c.quadros.get(&(id.to_string(), papel.to_string())).cloned();
    // Parou de transmitir: na próxima vez é convite de novo.
    let transmitindo: HashSet<String> = c.sala.pessoas.iter().filter(|p| p.tela).map(|p| p.id.clone()).collect();
    c.ui.palco.assistindo.retain(|id| transmitindo.contains(id));

    let v = voz(c, &eu);
    let minha = c.cam.as_ref().and_then(|_| quadro(c, &eu, "cam"));
    let mut lista = vec![Ladrilho {
        chave: "eu:cam".into(),
        pessoa: eu.clone(),
        tipo: Tipo::Cam,
        eu: true,
        nome: c.nome.clone(),
        rotulo: format!("{} (você)", c.nome),
        avatar: c.avatar.clone(),
        mic: c.mic.is_some(),
        esperando: c.cam.is_some() && minha.is_none(),
        quadro: minha,
        conexao: None,
        convite: false,
        apresentando: false,
        qualidade: Qualidade::Boa,
        voz: v,
        falando: v > 0.05,
    }];
    for p in c.sala.pessoas.iter().filter(|p| p.id != eu) {
        let v = voz(c, &p.id);
        let estado = conexao(c.conexoes.get(&p.id));
        let q = if p.cam { quadro(c, &p.id, "cam") } else { None };
        lista.push(Ladrilho {
            chave: format!("{}:cam", p.id),
            pessoa: p.id.clone(),
            tipo: Tipo::Cam,
            eu: false,
            nome: p.nome.clone(),
            rotulo: p.nome.clone(),
            avatar: p.avatar.clone(),
            mic: p.mic,
            esperando: p.cam && q.is_none() && estado.is_none(),
            quadro: q,
            conexao: estado,
            convite: false,
            apresentando: false,
            qualidade: Qualidade::Desconhecida,
            voz: v,
            falando: v > 0.05,
        });
        if p.tela {
            let vendo = c.ui.palco.assistindo.contains(&p.id);
            let q = if vendo { quadro(c, &p.id, "screen") } else { None };
            lista.push(Ladrilho {
                chave: format!("{}:tela", p.id),
                pessoa: p.id.clone(),
                tipo: Tipo::Tela,
                eu: false,
                nome: p.nome.clone(),
                rotulo: format!("Tela de {}", p.nome),
                avatar: p.avatar.clone(),
                mic: true,
                esperando: vendo && q.is_none(),
                quadro: q,
                conexao: None,
                convite: !vendo,
                apresentando: false,
                qualidade: Qualidade::Desconhecida,
                voz: 0.,
                falando: false,
            });
        }
    }
    if c.tela.is_some() {
        lista.push(Ladrilho {
            chave: "eu:tela".into(),
            pessoa: eu.clone(),
            tipo: Tipo::Tela,
            eu: true,
            nome: c.nome.clone(),
            rotulo: "Sua tela".into(),
            avatar: c.avatar.clone(),
            mic: true,
            quadro: quadro(c, &eu, "screen"),
            esperando: false,
            conexao: None,
            convite: false,
            apresentando: true,
            qualidade: Qualidade::Boa,
            voz: 0.,
            falando: false,
        });
    }
    lista
}

/// A ordem da grade como no app: um ladrilho que chega à grade (novo, ou
/// voltando do destaque/balão) vai para o fim. Os que chegam juntos entram
/// como o app acaba mostrando: os outros, você, as telas (no app cada um
/// chega num evento, e você passa pelo balão antes de voltar à grade).
fn ordenar(ui: &mut Estado, lista: &[Ladrilho], destino: impl Fn(usize) -> u8) -> Vec<usize> {
    let na_grade: Vec<usize> = (0..lista.len()).filter(|&i| destino(i) == GRADE).collect();
    let mut novos: Vec<usize> = na_grade.iter().copied().filter(|&i| ui.lugar.get(&lista[i].chave) != Some(&GRADE) || !ui.ordem.contains(&lista[i].chave)).collect();
    ui.ordem.retain(|k| na_grade.iter().any(|&i| &lista[i].chave == k) && !novos.iter().any(|&i| &lista[i].chave == k));
    novos.sort_by_key(|&i| (lista[i].tipo == Tipo::Tela, lista[i].eu));
    ui.ordem.extend(novos.iter().map(|&i| lista[i].chave.clone()));
    ui.lugar = (0..lista.len()).map(|i| (lista[i].chave.clone(), destino(i))).collect();
    ui.ordem.iter().filter_map(|k| lista.iter().position(|l| &l.chave == k)).collect()
}

/// Quantas colunas deixam os ladrilhos mais perto de 16:9 (stage.js bestColumns).
fn melhores_colunas(n: usize, w: f32, h: f32) -> usize {
    if n == 0 || w <= 0. || h <= 0. {
        return 1;
    }
    (1..=n)
        .map(|cols| {
            let linhas = n.div_ceil(cols);
            let erro = ((w / cols as f32) / (h / linhas as f32) / (16. / 9.)).ln().abs() + (cols * linhas - n) as f32 * 0.03;
            (cols, erro)
        })
        .fold((1, f32::INFINITY), |m, x| if x.1 < m.1 { x } else { m })
        .0
}

pub fn palco(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    // O cronômetro do topo anda sozinho, mesmo sem vídeo chegando.
    if c.ui.palco.relogio.is_none() {
        c.ui.palco.relogio = Some(cx.spawn(async move |este, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                if este.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }
        }));
    }
    let lista = ladrilhos(c);
    if c.fixado.as_ref().is_some_and(|f| !lista.iter().any(|l| &l.chave == f)) {
        c.fixado = None;
    }
    let sozinho = c.sala.pessoas.len() <= 1;
    let fixado = c.fixado.clone();
    let ui = &mut c.ui.palco;
    if ui.tela_cheia.as_ref().is_some_and(|k| !lista.iter().any(|l| &l.chave == k)) {
        ui.tela_cheia = None;
    }
    let vivos: HashSet<&str> = lista.iter().map(|l| l.chave.as_str()).collect();
    ui.imagens.borrow_mut().reter(|k| k == "espera" || k.split_once(':').is_some_and(|(_, r)| vivos.contains(r)), window);

    let duo = (!ui.grade_igualitaria && fixado.is_none() && lista.len() == 2 && lista.iter().all(|l| l.tipo == Tipo::Cam) && lista.iter().any(|l| l.eu))
        .then(|| lista.iter().position(|l| !l.eu))
        .flatten();
    let destaque = if sozinho {
        None
    } else if duo.is_some() {
        duo
    } else if let Some(f) = &fixado {
        lista.iter().position(|l| &l.chave == f)
    } else if ui.grade_igualitaria {
        None
    } else {
        lista.iter().position(|l| l.tipo == Tipo::Tela && !l.convite)
    };
    let bolha = duo.and_then(|_| lista.iter().position(|l| l.eu));
    // Saiu da sala vazia: no app você passou pelo balão e voltou por último.
    if ui.sozinho_antes && !sozinho {
        ui.ordem.clear();
    }
    ui.sozinho_antes = sozinho;
    let grade = ordenar(ui, &lista, |i| if Some(i) == destaque { DESTAQUE } else if Some(i) == bolha { BOLHA } else { GRADE });

    let vp = window.viewport_size();
    let area = ui.medidas.borrow().get(AREA).copied().unwrap_or(size(vp.width - px(if c.painel.is_some() { 348. } else { 0. }), vp.height - px(140.)));

    let medidas = c.ui.palco.medidas.clone();
    let mut raiz = div()
        .id("palco")
        .flex_1()
        .min_w_0()
        .h_full()
        .relative()
        .overflow_hidden()
        .flex()
        .child(
            canvas(
                move |b, window, _| {
                    let mut m = medidas.borrow_mut();
                    if m.get(AREA) != Some(&b.size) {
                        m.insert(AREA.into(), b.size);
                        window.request_animation_frame();
                    }
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
        .on_mouse_move(cx.listener(|c, e: &MouseMoveEvent, _, cx| {
            if let Some(a) = &mut c.ui.palco.bolha.arrasto {
                (a.dx, a.dy) = (f32::from(e.position.x) - a.x0, f32::from(e.position.y) - a.y0);
                a.pontos.push((f32::from(e.position.x), f32::from(e.position.y), Instant::now()));
                if a.pontos.len() > 6 {
                    a.pontos.remove(0);
                }
                cx.notify();
            }
        }))
        .on_mouse_up(MouseButton::Left, cx.listener(|c, _, _, cx| soltar_bolha(c, cx)))
        .on_mouse_up_out(MouseButton::Left, cx.listener(|c, _, _, cx| soltar_bolha(c, cx)));

    if sozinho {
        // .stage--alone: o convite (0,9fr) e o seu vídeo em 16:10 (1,1fr).
        let todos: Vec<usize> = grade.iter().copied().chain(destaque).collect();
        let grade_el = grade_de(&todos, &lista, area, c, t, window, cx);
        raiz = raiz
            .flex_row()
            .items_center()
            .gap(px(48.))
            .px(px(64.))
            .py(px(12.))
            .child(crescer(div().flex_basis(px(0.)).min_w_0(), 0.9).child(cartao_espera(c, t, window, cx)))
            .child(crescer(div().flex_basis(px(0.)).min_w_0().h_full().flex().flex_col().justify_center(), 1.1).child(proporcao(div().w_full().max_h_full().flex(), 1.6).child(grade_el)));
    } else if let Some(d) = destaque {
        raiz = raiz.flex_row().p(px(12.)).gap(px(12.)).child(div().flex_1().min_w_0().h_full().relative().child(celula(&lista[d], Lugar::default(), "destaque", c, t, window, cx)));
        if !grade.is_empty() {
            let mut faixa = div().id("faixa").w(px(168.)).h_full().flex_none().flex().flex_col().gap(px(12.)).overflow_y_scroll();
            for &i in &grade {
                faixa = faixa.child(div().w_full().h(px(108.)).flex_none().relative().child(celula(&lista[i], Lugar { faixa: true, ..Default::default() }, "faixa", c, t, window, cx)));
            }
            raiz = raiz.child(faixa);
        }
    } else {
        raiz = raiz.flex_col().p(px(12.)).child(grade_de(&grade, &lista, size(area.width - px(24.), area.height - px(24.)), c, t, window, cx));
    }
    if let Some(b) = bolha {
        raiz = raiz.child(balao(&lista[b], area, c, t, window, cx));
    }
    if let Some(k) = c.ui.palco.tela_cheia.clone()
        && let Some(i) = lista.iter().position(|l| l.chave == k)
    {
        raiz = raiz.child(tela_cheia(&lista[i], c, t, window, cx));
    }
    raiz.into_any_element()
}

fn crescer(mut d: Div, f: f32) -> Div {
    d.style().flex_grow = Some(f);
    d
}

fn proporcao(mut d: Div, a: f32) -> Div {
    d.style().aspect_ratio = Some(a);
    d
}

/// `.grid`: colunas por quantidade (1; 2 de 2 a 4; 16:9 a partir de 5),
/// linhas de alturas iguais, ladrilhos esticados.
fn grade_de(idx: &[usize], lista: &[Ladrilho], area: Size<Pixels>, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let n = idx.len();
    let vao = if n > 12 { 4. } else if n > 8 { 8. } else { 12. };
    let lugar = Lugar { sem_volume: n > 8, rotulo_pequeno: n > 12, ..Default::default() };
    let cols = match n {
        0 | 1 => 1,
        2..=4 => 2,
        _ => melhores_colunas(n, f32::from(area.width), f32::from(area.height)),
    };
    let mut g = div().flex_1().min_h_0().size_full().flex().flex_col().gap(px(vao));
    for r in 0..n.div_ceil(cols) {
        let mut linha = div().flex_1().min_h_0().flex().gap(px(vao));
        for col in 0..cols {
            linha = linha.child(match idx.get(r * cols + col) {
                Some(&i) => div().flex_1().min_w_0().h_full().relative().child(celula(&lista[i], lugar, "grade", c, t, window, cx)),
                None => div().flex_1(),
            });
        }
        g = g.child(linha);
    }
    g.into_any_element()
}

/// O lugar de um ladrilho, com a entrada: `ladrilhoEntra` (200 ms, de 0,92) e o
/// FLIP de quem chega (opacidade e escala 0,86 na mola bouncy), juntos.
fn celula(l: &Ladrilho, lugar: Lugar, onde: &str, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    if c.ui.palco.tela_cheia.as_deref() == Some(l.chave.as_str()) {
        return div().into_any_element();
    }
    let tile = ladrilho::ladrilho(l, lugar, c, t, window, cx);
    div()
        .absolute()
        .size_full()
        .child(tile)
        .with_animation(SharedString::from(format!("entra:{onde}:{}", l.chave)), Animation::new(Duration::from_millis(725)), |d, p| {
            let s = p * 0.725;
            let escala = (0.86 + 0.14 * arte::bouncy(s)) * (0.92 + 0.08 * arte::ease_out(s / 0.2));
            let folga = (1. - escala) / 2.;
            d.top(relative(folga)).left(relative(folga)).w(relative(escala)).h(relative(escala)).opacity(arte::bouncy(s).clamp(0., 1.))
        })
        .into_any_element()
}

fn origem_canto(area: Size<Pixels>, w: f32, h: f32, (topo, esq): (bool, bool)) -> (f32, f32) {
    (if esq { 16. } else { f32::from(area.width) - 16. - w }, if topo { 16. } else { f32::from(area.height) - 16. - h })
}

/// `.floatSelf`: o seu vídeo num balão (22% da largura, 132 a 280 px, 16:10)
/// que se arrasta e desliza para o canto mais próximo.
fn balao(l: &Ladrilho, area: Size<Pixels>, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let w = (0.22 * f32::from(area.width)).clamp(132., 280.);
    let h = w / 1.6;
    let b = &mut c.ui.palco.bolha;
    let base = origem_canto(area, w, h, b.canto);
    let mut desvio = (0., 0.);
    if let Some(a) = &b.arrasto {
        desvio = (a.dx, a.dy);
    } else if let Some((t0, ox, oy)) = b.mola {
        let s = t0.elapsed().as_secs_f32();
        let k = 1. - arte::bouncy(s);
        desvio = (ox * k, oy * k);
        if s < 0.725 {
            window.request_animation_frame();
        } else {
            b.mola = None;
        }
    }
    let arrastando = b.arrasto.is_some();
    let sombras = if arrastando {
        vec![sombra(0., 28., 60., -14., rgba_f(8., 4., 30., 0.65)), sombra(0., 0., 0., 2., t.accent)]
    } else {
        vec![sombra(0., 18., 40., -12., rgba_f(8., 4., 30., 0.55)), sombra(0., 0., 0., 1., rgba_f(255., 255., 255., 0.08))]
    };
    div()
        .id("bolha")
        .absolute()
        .left(px(base.0 + desvio.0))
        .top(px(base.1 + desvio.1))
        .w(px(w))
        .h(px(h))
        .rounded(px(tema::raio::XL))
        .shadow(sombras)
        .when(arrastando, |d| d.cursor_grabbing())
        .when(!arrastando, |d| d.cursor_grab())
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |c, e: &MouseDownEvent, _, cx| {
                let agora = Instant::now();
                c.ui.palco.bolha.mola = None;
                c.ui.palco.bolha.arrasto = Some(Arrasto { x0: f32::from(e.position.x), y0: f32::from(e.position.y), dx: 0., dy: 0., origem: base, tam: (w, h), pontos: vec![(f32::from(e.position.x), f32::from(e.position.y), agora)] });
                cx.notify();
            }),
        )
        .child(celula(l, Lugar { bolha: true, ..Default::default() }, "bolha", c, t, window, cx))
        .into_any_element()
}

/// Soltou o balão: a velocidade final projeta onde ele "cairia" (v x 180 ms) e
/// o canto mais perto desse ponto vence.
fn soltar_bolha(c: &mut Chamada, cx: &mut Context<Chamada>) {
    let ui = &mut c.ui.palco;
    let Some(a) = ui.bolha.arrasto.take() else { return };
    cx.notify();
    if a.dx.hypot(a.dy) < 4. {
        return;
    }
    let Some(area) = ui.medidas.borrow().get(AREA).copied() else { return };
    let (p0, p1) = (a.pontos[0], a.pontos[a.pontos.len() - 1]);
    let dt = ((p1.2 - p0.2).as_secs_f32() * 1000.).max(1.);
    let (vx, vy) = ((p1.0 - p0.0) / dt * 180., (p1.1 - p0.1) / dt * 180.);
    let cx_ = a.origem.0 + a.tam.0 / 2. + a.dx + vx;
    let cy_ = a.origem.1 + a.tam.1 / 2. + a.dy + vy;
    let canto = (cy_ < f32::from(area.height) / 2., cx_ < f32::from(area.width) / 2.);
    let depois = origem_canto(area, a.tam.0, a.tam.1, canto);
    ui.bolha.canto = canto;
    ui.bolha.mola = Some((Instant::now(), a.origem.0 + a.dx - depois.0, a.origem.1 + a.dy - depois.1));
}

/// Tela cheia do ladrilho (o botão maximize-2): por cima de tudo, na janela
/// em tela cheia; Esc sai, como no navegador.
fn tela_cheia(l: &Ladrilho, c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let vp = window.viewport_size();
    let fraca = cx.entity().downgrade();
    let tile = ladrilho::ladrilho(l, Lugar::default(), c, t, window, cx);
    let esc = canvas(|_, _, _| {}, move |_, _, window, _| {
        let fraca = fraca.clone();
        window.on_key_event(move |e: &KeyDownEvent, _, window, cx| {
            if e.keystroke.key == "escape" {
                if let Some(ch) = fraca.upgrade() {
                    ch.update(cx, |c, cx| {
                        c.ui.palco.tela_cheia = None;
                        cx.notify();
                    });
                }
                if window.is_fullscreen() {
                    window.toggle_fullscreen();
                }
            }
        });
    });
    deferred(anchored().position(point(px(0.), px(0.))).child(div().id("tela-cheia").w(vp.width).h(vp.height).bg(gpui::black()).child(tile).child(esc.size_0())))
        .with_priority(1)
        .into_any_element()
}

/* --------------------------- sala de espera --------------------------- */

/// Entrada em cascata (motion.js rise): opacidade 380 ms ease-out e subida de
/// 14 px na mola bouncy, depois de `atraso` ms.
fn subir(el: impl IntoElement, id: &str, atraso: f32) -> AnyElement {
    let total = atraso + 725.;
    div()
        .relative()
        .child(el)
        .with_animation(SharedString::from(format!("sobe:{id}")), Animation::new(Duration::from_secs_f32(total / 1000.)), move |d, p| {
            let ms = p * total - atraso;
            d.opacity(arte::ease_out(ms / 380.)).top(px(14. * (1. - arte::bouncy(ms / 1000.))))
        })
        .into_any_element()
}

/// A ilustração `sala-vazia` com as cores do tema (o app põe o SVG dentro da
/// página para as variáveis valerem).
fn ilustracao(t: &Tema, window: &Window, cx: &mut Context<Chamada>) -> Option<AnyElement> {
    const SVG: &str = include_str!("../../../public/assets/illustrations/sala-vazia.svg");
    let cor = |c: gpui::Hsla| {
        let c = arte::rgba(c);
        format!("rgba({:.0},{:.0},{:.0},{:.3})", c.r * 255., c.g * 255., c.b * 255., c.a)
    };
    let pares = [("accent-soft", t.accent_soft), ("border-strong", t.border_strong), ("surface-3", t.surface_3), ("surface", t.surface), ("text-muted", t.text_muted)];
    let mut svg = String::with_capacity(SVG.len());
    let mut resto = SVG;
    while let Some(i) = resto.find("var(--") {
        svg.push_str(&resto[..i]);
        let fim = i + resto[i..].find(')')?;
        let nome = resto[i + 6..fim].split(',').next()?.trim();
        svg.push_str(&pares.iter().find(|(n, _)| *n == nome).map_or_else(|| resto[i..=fim].to_string(), |(_, c)| cor(*c)));
        resto = &resto[fim + 1..];
    }
    svg.push_str(resto);
    let sf = window.scale_factor();
    let img_ = arte::svg_nitido(&Image::from_bytes(ImageFormat::Svg, svg.into_bytes()), (300. * sf) as u32, (225. * sf) as u32, cx)?;
    Some(img(ImageSource::Render(img_)).w(px(300.)).h(px(225.)).max_w_full().flex_none().into_any_element())
}

/// `.waiting` (main.js buildWaiting, call.css:185): ilustração, título, texto,
/// o código da sala e os botões de convidar.
fn cartao_espera(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let vw = f32::from(window.viewport_size().width);
    let tam = (16. + 0.016 * vw).clamp(25.6, 36.8);
    let display = Font { weight: FontWeight::EXTRA_BOLD, ..gpui::font(FONTE_DISPLAY) };
    let titulo = div().flex().flex_col().children(["Só você por aqui,", "por enquanto"].map(|linha| arte::texto_espacado(linha, display.clone(), tam, -0.03 * tam, 1.1 * tam, t.text, window)));
    // 40ch: a largura do "0" da fonte do corpo.
    let corpo = gpui::font(FONTE);
    let zero: f32 = window.text_system().shape_line("0".into(), px(15.), &[TextRun { len: 1, font: corpo, color: t.text, background_color: None, underline: None, strikethrough: None }], None).width.into();
    let lead = div()
        .max_w(px(40. * zero))
        .text_size(px(tema::texto::BASE))
        .line_height(px(15. * 1.55))
        .text_color(t.text_secondary)
        .child("Mande o link ou dite o código. A chamada começa no instante em que alguém entrar.");

    let codigo: gpui::SharedString = if c.sala.codigo.is_empty() { "······".into() } else { c.sala.codigo.clone().into() };
    let sob = c.ui.palco.sob.tem("codigo");
    let v = c.ui.palco.trans.valor("btn:codigo", sob, 120., window);
    let mono = Font { weight: FontWeight::BOLD, ..gpui::font("Cascadia Code") };
    let codigo_btn = div()
        .id("codigo")
        .flex()
        .flex_none()
        .items_center()
        .gap(px(12.))
        .pl(px(18.))
        .pr(px(16.))
        .py(px(10.))
        .border_1()
        .border_dashed()
        .border_color(arte::misturar(t.border_strong, t.accent, v))
        .rounded(px(tema::raio::LG))
        .bg(t.surface)
        .cursor_pointer()
        .child(arte::texto_espacado(&codigo, mono, 25.6, 0.22 * 25.6, 38.4, t.text, window))
        .child(icone_traco("copy", 16., 2.1, arte::misturar(t.text_muted, t.accent, v)))
        .on_hover(cx.listener(|c, h: &bool, _, cx| {
            c.ui.palco.sob.marcar("codigo", *h);
            cx.notify();
        }))
        .on_click(cx.listener(move |c, _, _, cx| {
            cx.write_to_clipboard(ClipboardItem::new_string(codigo.to_string()));
            c.avisar("Código copiado", cx);
        }));
    let copiar = botao("copiar-link", "link", 20., Some("Copiar link da sala"), Estilo::Primario, true, c, t, window, cx).on_click(cx.listener(|c, _, _, cx| copiar_link(c, cx)));
    // ponytail: o diálogo "Convidar" do app não existe no nativo; copia o link.
    let mais = botao("mais-formas", "user-plus", 20., Some("Mais formas de convidar"), Estilo::Normal, true, c, t, window, cx).on_click(cx.listener(|c, _, _, cx| copiar_link(c, cx)));
    let acoes = div().flex().flex_wrap().gap(px(8.)).child(copiar).child(mais);

    div()
        .flex()
        .flex_col()
        .items_start()
        .gap(px(16.))
        .max_w(px(460.))
        .p(px(24.))
        .children(ilustracao(t, window, cx))
        .child(subir(titulo, "titulo", 120.))
        .child(subir(lead, "lead", 180.))
        .child(subir(codigo_btn, "codigo", 240.))
        .child(subir(acoes, "acoes", 300.))
        .into_any_element()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn colunas_como_o_app() {
        // stage.js: em 1256x636, 5 a 9 -> 3 colunas, 10 a 16 -> 4.
        for n in 5..=9 {
            assert_eq!(melhores_colunas(n, 1256., 636.), 3, "{n}");
        }
        for n in 10..=16 {
            assert_eq!(melhores_colunas(n, 1256., 636.), 4, "{n}");
        }
    }
}
