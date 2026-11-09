//! A barra de controles (ESPEC 4: app.css .dock/.ctrl + call.css, js/ui/dock.js,
//! main.js buildDock, motion.js magnifyDock/ripple). DONO: agente da barra.
//!
//! O GPUI não tem `transform` em div: a ampliação, o aperto e as entradas
//! são feitos redimensionando o desenho (o lugar do botão na barra fica fixo,
//! como no CSS, onde `scale` não mexe no layout).

#[path = "dock_mov.rs"]
pub mod mov;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use gpui::{
    AnyElement, App, Bounds, BoxShadow, Context, DispatchPhase, FontWeight, Hsla, KeyBinding, MouseButton, MouseDownEvent, MouseExitEvent, MouseMoveEvent,
    MouseUpEvent, Pixels, Point, SharedString, WeakEntity, Window, actions, canvas, div, point, prelude::*, px, size,
};

use super::comp::{icone, icone_traco};
use super::reacoes::{self, REACOES, SINAIS};
use super::tema::{Tema, sombra_dock};
use crate::chamada::{Chamada, Painel};
use mov::{BOUNCY, SNAPPY, SOLTAR, Trans, bezier, ease_out, ease_out_css, quadros, segundos};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum B {
    Mic,
    Cam,
    Surdo,
    Tela,
    TelaOpcoes,
    Quadro,
    Jogos,
    Mao,
    Reagir,
    Legendas,
    Gravar,
    Conversa,
    Pessoas,
    Qualidade,
    Layout,
    Config,
    Mini,
    Sair,
}

/// A ordem de main.js buildDock: (botão, data-id, grupo, largura). "more" só
/// aparece em telas estreitas (≤ 820 px, menos que a janela mínima).
const BOTOES: [(B, &str, u8, f32); 18] = [
    (B::Mic, "mic", 0, 46.),
    (B::Cam, "cam", 0, 46.),
    (B::Surdo, "deafen", 0, 46.),
    (B::Tela, "screen", 1, 46.),
    (B::TelaOpcoes, "screenOpts", 1, 30.),
    (B::Quadro, "board", 1, 46.),
    (B::Jogos, "jogos", 1, 46.),
    (B::Mao, "hand", 2, 46.),
    (B::Reagir, "react", 2, 46.),
    (B::Legendas, "captions", 2, 46.),
    (B::Gravar, "record", 2, 46.),
    (B::Conversa, "chat", 3, 46.),
    (B::Pessoas, "people", 3, 46.),
    (B::Qualidade, "stats", 3, 46.),
    (B::Layout, "layout", 3, 46.),
    (B::Config, "settings", 3, 46.),
    (B::Mini, "mini", 4, 46.),
    (B::Sair, "leave", 4, 58.),
];
const REAGIR: usize = 8;

#[derive(Clone, Copy, PartialEq)]
enum Tom {
    Normal,
    /// aria-pressed="false": microfone mudo, câmera desligada.
    Desligado,
    /// data-active="true": painel aberto, mão levantada, tela no ar.
    Ativo,
    /// .ctrl--hangup: o call.css apaga o vermelho do app.css (ESPEC 4.4), sobra o ícone branco.
    Sair,
}

struct Cara {
    icone: &'static str,
    rotulo: &'static str,
    atalho: Option<&'static str>,
    tom: Tom,
    selo: usize,
}

fn cara(c: &Chamada, b: B) -> Cara {
    let k = |icone, rotulo, atalho, tom| Cara { icone, rotulo, atalho, tom, selo: 0 };
    let liga = |sim: bool| if sim { Tom::Normal } else { Tom::Desligado };
    let ativo = |sim: bool| if sim { Tom::Ativo } else { Tom::Normal };
    match b {
        B::Mic if c.mic.is_some() => k("mic", "Microfone ligado", Some("M"), Tom::Normal),
        B::Mic => k("mic-off", "Microfone mudo", Some("M"), liga(false)),
        B::Cam if c.cam.is_some() => k("video", "Câmera ligada", Some("V"), Tom::Normal),
        B::Cam => k("video-off", "Câmera desligada", Some("V"), liga(false)),
        B::Surdo => k("volume-2", "Silenciar tudo", Some("D"), Tom::Normal),
        B::Tela if c.tela.is_some() => k("screen-share-off", "Parar de compartilhar", Some("S"), Tom::Ativo),
        B::Tela => k("screen-share", "Compartilhar tela", Some("S"), Tom::Normal),
        B::TelaOpcoes => k("chevron-down", "Opções de compartilhamento", None, Tom::Normal),
        B::Quadro => k("pencil", "Quadro branco", Some("Q"), Tom::Normal),
        B::Jogos => k("dices", "Jogos", Some("K"), Tom::Normal),
        B::Mao => k("hand", if c.mao { "Baixar a mão" } else { "Levantar a mão" }, Some("H"), ativo(c.mao)),
        B::Reagir => k("smile", "Reagir", Some("R"), Tom::Normal),
        B::Legendas => k("eye-off", "Legendar minha fala", Some("T"), Tom::Normal),
        B::Gravar => k("radio", "Gravar a chamada", None, Tom::Normal),
        B::Conversa => Cara { selo: c.nao_lidas, ..k("message-square", "Conversa", Some("C"), ativo(c.painel == Some(Painel::Conversa))) },
        B::Pessoas => k("users", "Pessoas", Some("P"), ativo(c.painel == Some(Painel::Pessoas))),
        B::Qualidade => k("activity", "Qualidade da chamada", None, ativo(c.painel == Some(Painel::Qualidade))),
        B::Layout => k("layout-grid", "Alternar layout", Some("L"), Tom::Normal),
        B::Config => k("settings", "Configurações", None, Tom::Normal),
        B::Mini => k("picture-in-picture-2", "Mini-janela flutuante", Some("J"), Tom::Normal),
        B::Sair => k("phone-off", "Sair da chamada", None, Tom::Sair),
    }
}

/// O que ainda não veio para o app nativo: a mesma cara, e um aviso no clique.
fn em_breve(b: B) -> &'static str {
    match b {
        B::Surdo => "Silenciar tudo chega em breve ao app nativo",
        B::TelaOpcoes => "As opções de compartilhamento chegam em breve ao app nativo",
        B::Quadro => "O quadro branco chega em breve ao app nativo",
        B::Jogos => "Os jogos chegam em breve ao app nativo",
        B::Legendas => "As legendas chegam em breve ao app nativo",
        B::Gravar => "A gravação chega em breve ao app nativo",
        B::Layout => "A troca de layout chega em breve ao app nativo",
        B::Config => "As configurações chegam em breve ao app nativo",
        _ => "A mini-janela chega em breve ao app nativo",
    }
}

fn acionar(c: &mut Chamada, b: B, cx: &mut Context<Chamada>) {
    match b {
        B::Mic => c.alternar("mic", cx),
        B::Cam => c.alternar("cam", cx),
        B::Tela => c.alternar("tela", cx),
        B::Mao => {
            let sobe = !c.mao;
            c.alternar_mao(cx);
            if sobe {
                c.avisar("Você levantou a mão", cx);
            }
        }
        B::Reagir => {
            let e = &mut c.ui.dock;
            e.pop = if e.pop.is_some() { None } else { Some(Pop::novo()) };
            cx.notify();
        }
        B::Conversa => c.abrir_painel(Painel::Conversa, cx),
        B::Pessoas => c.abrir_painel(Painel::Pessoas, cx),
        B::Qualidade => c.abrir_painel(Painel::Qualidade, cx),
        B::Sair => c.sair(cx),
        B::Layout => {
            c.ui.palco.grade_igualitaria = !c.ui.palco.grade_igualitaria;
            cx.notify();
        }
        _ => c.avisar(em_breve(b), cx),
    }
}

/// Um emoji do menu de reagir (o pulo e, se a rede deixa, a reação).
fn reagir_menu(c: &mut Chamada, j: usize, cx: &mut Context<Chamada>) {
    if let Some(p) = c.ui.dock.pop.as_mut() {
        p.pulo[j] = Some(Instant::now());
    }
    // Como o menu do navegador: {type:"reacao", r, n} pelo canal do quadro.
    c.reagir_id(REACOES[j].0, cx);
    cx.notify();
}

/* -------------------------- atalhos -------------------------- */

actions!(
    barra,
    [
        Microfone, Camera, SilenciarTudo, CompartilharTela, QuadroBranco, AbrirJogos, LevantarMao, AbrirReacoes, Legendar, AbrirConversa, AbrirPessoas,
        AlternarLayout, MiniJanela, Fechar, Emoji1, Emoji2, Emoji3, Emoji4, Emoji5, Emoji6, Emoji7, Emoji8, Emoji9
    ]
);

thread_local!(static ALVO: RefCell<Option<WeakEntity<Chamada>>> = const { RefCell::new(None) });
static TECLAS: AtomicBool = AtomicBool::new(false);

fn com(cx: &mut App, f: fn(&mut Chamada, &mut Context<Chamada>)) {
    if let Some(e) = ALVO.with(|a| a.borrow().as_ref().and_then(WeakEntity::upgrade)) {
        e.update(cx, |c, cx| f(c, cx));
    }
}

/// Atalho global (main.js bindShortcuts), menos quando se digita num campo
/// (contexto "Entrada": lá a tecla é texto).
fn tecla<A: gpui::Action + Clone>(cx: &mut App, k: &str, acao: A, f: fn(&mut Chamada, &mut Context<Chamada>)) {
    cx.bind_keys([KeyBinding::new(k, acao, None), KeyBinding::new(k, gpui::NoAction, Some("Entrada"))]);
    cx.on_action(move |_: &A, cx| com(cx, f));
}

fn emoji_tecla(c: &mut Chamada, j: usize, cx: &mut Context<Chamada>) {
    if c.ui.dock.pop.is_some() {
        reagir_menu(c, j, cx);
    }
}

fn iniciar(c: &mut Chamada, cx: &mut Context<Chamada>) {
    if c.ui.dock.iniciado {
        return;
    }
    c.ui.dock.iniciado = true;
    c.ui.dock.entrada = Some(Instant::now());
    ALVO.with(|a| *a.borrow_mut() = Some(cx.entity().downgrade()));
    // VCALL_DOCK_TESTE (fotos de comparação): "dica=chat", "reagir", "aviso=texto".
    for parte in std::env::var("VCALL_DOCK_TESTE").unwrap_or_default().split(';') {
        match parte.split_once('=') {
            Some(("dica", id)) => c.ui.dock.forcado = BOTOES.iter().position(|b| b.1 == id),
            // "aviso=6000:texto": o aviso depois de 6 s (na hora da foto).
            Some(("aviso", resto)) => {
                let (ms, texto) = resto.split_once(':').map_or((0, resto), |(m, t)| (m.parse().unwrap_or(0), t));
                let texto = texto.to_string();
                cx.spawn(async move |este, cx| {
                    cx.background_executor().timer(std::time::Duration::from_millis(ms)).await;
                    let _ = este.update(cx, |c, cx| c.avisar(texto, cx));
                })
                .detach();
            }
            // "reagir" abre o menu; "reagir=0", com o mouse no primeiro emoji.
            Some(("reagir", j)) => c.ui.dock.pop = Some(Pop { sobre: j.parse().ok(), ..Pop::novo() }),
            _ if parte == "reagir" => c.ui.dock.pop = Some(Pop::novo()),
            _ => {}
        }
    }
    if TECLAS.swap(true, Ordering::Relaxed) {
        return;
    }
    tecla(cx, "m", Microfone, |c, cx| acionar(c, B::Mic, cx));
    tecla(cx, "v", Camera, |c, cx| acionar(c, B::Cam, cx));
    tecla(cx, "d", SilenciarTudo, |c, cx| acionar(c, B::Surdo, cx));
    tecla(cx, "s", CompartilharTela, |c, cx| acionar(c, B::Tela, cx));
    tecla(cx, "q", QuadroBranco, |c, cx| acionar(c, B::Quadro, cx));
    tecla(cx, "k", AbrirJogos, |c, cx| acionar(c, B::Jogos, cx));
    tecla(cx, "h", LevantarMao, |c, cx| acionar(c, B::Mao, cx));
    // R abre o menu (main.js chama openReactionMenu, que alterna).
    tecla(cx, "r", AbrirReacoes, |c, cx| acionar(c, B::Reagir, cx));
    tecla(cx, "t", Legendar, |c, cx| acionar(c, B::Legendas, cx));
    tecla(cx, "c", AbrirConversa, |c, cx| acionar(c, B::Conversa, cx));
    tecla(cx, "p", AbrirPessoas, |c, cx| acionar(c, B::Pessoas, cx));
    tecla(cx, "l", AlternarLayout, |c, cx| acionar(c, B::Layout, cx));
    tecla(cx, "j", MiniJanela, |c, cx| acionar(c, B::Mini, cx));
    // Escape fecha o menu (dock.js) e o painel (main.js), os dois de uma vez.
    tecla(cx, "escape", Fechar, |c, cx| {
        c.ui.dock.pop = None;
        c.painel = None;
        cx.notify();
    });
    // Com o menu de reagir aberto, 1 a 9 reagem direto.
    tecla(cx, "1", Emoji1, |c, cx| emoji_tecla(c, 0, cx));
    tecla(cx, "2", Emoji2, |c, cx| emoji_tecla(c, 1, cx));
    tecla(cx, "3", Emoji3, |c, cx| emoji_tecla(c, 2, cx));
    tecla(cx, "4", Emoji4, |c, cx| emoji_tecla(c, 3, cx));
    tecla(cx, "5", Emoji5, |c, cx| emoji_tecla(c, 4, cx));
    tecla(cx, "6", Emoji6, |c, cx| emoji_tecla(c, 5, cx));
    tecla(cx, "7", Emoji7, |c, cx| emoji_tecla(c, 6, cx));
    tecla(cx, "8", Emoji8, |c, cx| emoji_tecla(c, 7, cx));
    tecla(cx, "9", Emoji9, |c, cx| emoji_tecla(c, 8, cx));
}

/* -------------------------- estado -------------------------- */

struct Anim {
    fundo: Trans<Hsla>,
    cor: Trans<Hsla>,
    dica: Trans<f32>,
    amplia: Trans<f32>,
    apertou: Option<Instant>,
    soltou: Option<Instant>,
    /// A onda do clique: ponto (no botão sem escala) e quando.
    ondas: Vec<(f32, f32, Instant)>,
}

/// O menu de reagir aberto (reacoes.js montarMenu, popover--reactions).
struct Pop {
    aberto: Instant,
    sobre: Option<usize>,
    apertado: Option<usize>,
    escala: Vec<Trans<f32>>,
    fundo: Vec<Trans<f32>>,
    dica: Vec<Trans<f32>>,
    pulo: Vec<Option<Instant>>,
}

impl Pop {
    fn novo() -> Pop {
        let n = REACOES.len();
        Pop {
            aberto: Instant::now(),
            sobre: None,
            apertado: None,
            escala: vec![Trans::new(1., 140., ease_out); n],
            fundo: vec![Trans::new(0., 140., ease_out); n],
            dica: vec![Trans::new(0., 120., ease_out); n],
            pulo: vec![None; n],
        }
    }
}

/// O estado só do desenho da barra.
#[derive(Default)]
pub struct Estado {
    iniciado: bool,
    entrada: Option<Instant>,
    /// A caixa de dentro da barra (sem a borda) e a do menu, no último quadro.
    caixa: Rc<Cell<Option<Bounds<Pixels>>>>,
    caixa_pop: Rc<Cell<Option<Bounds<Pixels>>>>,
    /// Onde cada botão está desenhado (já ampliado) e a escala dele.
    rects: Vec<(Bounds<Pixels>, f32)>,
    /// x do ponteiro dentro da barra (a ampliação segue ele).
    ponteiro: Option<f32>,
    sobre: Option<usize>,
    forcado: Option<usize>,
    apertado: Option<usize>,
    anim: Vec<Anim>,
    pop: Option<Pop>,
}

impl Estado {
    /// O mouse andou (na janela toda): quem está embaixo dele e onde.
    fn mover(&mut self, pos: Point<Pixels>) -> bool {
        let Some(caixa) = self.caixa.get() else { return false };
        let no_menu = self.caixa_pop.get().is_some_and(|b| b.contains(&pos));
        let sobre = if no_menu { None } else { self.rects.iter().rposition(|(r, _)| r.contains(&pos)) };
        // O pointermove do menu também sobe até a barra (ele mora dentro dela).
        let dentro = no_menu || sobre.is_some() || caixa.contains(&pos);
        let ponteiro = dentro.then(|| f32::from(pos.x - caixa.origin.x));
        let mudou = ponteiro != self.ponteiro || sobre != self.sobre;
        (self.ponteiro, self.sobre) = (ponteiro, sobre);
        mudou
    }

    fn apertar(&mut self, i: usize, pos: Point<Pixels>) {
        let agora = Instant::now();
        let Some(&(r, s)) = self.rects.get(i) else { return };
        let a = &mut self.anim[i];
        a.apertou = Some(agora);
        a.soltou = None;
        a.ondas.push((f32::from(pos.x - r.origin.x) / s, f32::from(pos.y - r.origin.y) / s, agora));
        self.apertado = Some(i);
    }

    /// Botão do mouse solto em qualquer lugar: a mola volta, e um clique fora fecha o menu.
    fn soltar(&mut self, pos: Point<Pixels>) {
        if let Some(i) = self.apertado.take() {
            let a = &mut self.anim[i];
            a.apertou = None;
            a.soltou = Some(Instant::now());
        }
        let no_menu = self.caixa_pop.get().is_some_and(|b| b.contains(&pos));
        let no_dono = self.rects.get(REAGIR).is_some_and(|(r, _)| r.contains(&pos));
        if let Some(p) = self.pop.as_mut() {
            p.apertado = None;
            if !no_menu && !no_dono {
                self.pop = None;
                self.caixa_pop.set(None);
            }
        }
    }
}

/* -------------------------- desenho -------------------------- */

pub(super) fn escalar(v: Vec<BoxShadow>, s: f32) -> Vec<BoxShadow> {
    v.into_iter()
        .map(|b| BoxShadow { color: b.color, offset: point(b.offset.x * s, b.offset.y * s), blur_radius: b.blur_radius * s, spread_radius: b.spread_radius * s })
        .collect()
}

fn cores(t: &Tema, tom: Tom) -> (Hsla, Hsla) {
    match tom {
        Tom::Normal => (t.surface_2, t.text),
        Tom::Desligado => (t.danger_soft, t.danger),
        Tom::Ativo => (t.accent_soft, t.accent),
        Tom::Sair => (t.surface_2, gpui::white()),
    }
}

/// O x de cada botão dentro da barra (sem a borda) e a largura dela.
fn posicoes() -> ([f32; 18], f32) {
    let mut xs = [0.; 18];
    let mut x = 10.;
    for i in 0..BOTOES.len() {
        if i > 0 {
            // Grupo novo: vão da barra (4) + margem (8) + fio (1) + respiro (8).
            x += if BOTOES[i].2 != BOTOES[i - 1].2 { 21. } else { 6. };
        }
        xs[i] = x;
        x += BOTOES[i].3;
    }
    (xs, x + 10.)
}

/// stagger(.ctrl, {gap: 22, y: 18, blur: 0}) ao entrar (main.js:268): opacidade, y, escala.
fn entrada(desde: Option<Instant>, i: usize, agora: Instant) -> (f32, f32, f32) {
    let Some(t0) = desde else { return (1., 0., 1.) };
    let t = segundos(t0, agora) - 0.022 * i as f32;
    if t < 0. {
        return (0., 18., 0.97);
    }
    let p = BOUNCY.em(t);
    (ease_out(t / 0.38), 18. * (1. - p), 0.97 + 0.03 * p)
}

/// A dica flutuante (base.css [data-tip]::after), centrada em `cx`, com a base em `base`.
fn dica(t: &Tema, texto: SharedString, cx: f32, base: f32, s: f32, h: f32) -> AnyElement {
    let alto = 26. * s;
    div()
        .absolute()
        .left(px(cx - 250.))
        .top(px(base - alto + 4. * s * (1. - h)))
        .w(px(500.))
        .h(px(alto))
        .flex()
        .justify_center()
        .child(
            div()
                .px(px(12. * s))
                .py(px(4. * s))
                .rounded(px(9. * s))
                .bg(t.brand_ink)
                .shadow(escalar(t.sombra_md(), s))
                .text_color(gpui::white())
                .text_size(px(12. * s))
                .line_height(px(18. * s))
                .font_weight(FontWeight::MEDIUM)
                .whitespace_nowrap()
                .opacity(h)
                .child(texto),
        )
        .into_any_element()
}

pub fn dock(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    iniciar(c, cx);
    let agora = Instant::now();
    let caras: Vec<Cara> = BOTOES.iter().map(|b| cara(c, b.0)).collect();
    let (xs, largura) = posicoes();
    let ent = cx.entity().downgrade();
    let e = &mut c.ui.dock;
    if e.anim.len() != BOTOES.len() {
        e.anim = caras
            .iter()
            .map(|k| {
                let (fundo, cor) = cores(t, k.tom);
                Anim {
                    fundo: Trans::new(fundo, 120., ease_out),
                    cor: Trans::new(cor, 120., ease_out),
                    dica: Trans::new(0., 120., ease_out),
                    amplia: Trans::new(0., 160., ease_out),
                    apertou: None,
                    soltou: None,
                    ondas: Vec::new(),
                }
            })
            .collect();
    }
    let sobre = e.forcado.or(e.sobre);
    let ponteiro = match e.forcado {
        Some(i) => Some(xs[i] + BOTOES[i].3 / 2.),
        None => e.ponteiro,
    };
    let origem = e.caixa.get().map_or(point(px(0.), px(0.)), |b| b.origin);
    let mut animando = e.entrada.is_some_and(|t0| segundos(t0, agora) < 0.022 * 18. + BOUNCY.dur);
    let mut grupos: Vec<Vec<AnyElement>> = (0..5).map(|_| Vec::new()).collect();
    let mut dicas = Vec::new();
    e.rects.clear();

    for (i, ((b, _, grupo, w), k)) in BOTOES.iter().zip(&caras).enumerate() {
        let (b, w) = (*b, *w);
        let a = &mut e.anim[i];
        let em_cima = sobre == Some(i);
        let (fundo, cor) = cores(t, k.tom);
        // Hover vence o desligado e o ativo no fundo; o ícone fica com a cor do estado.
        a.fundo.ir(if em_cima { t.surface_hover } else { fundo }, agora);
        a.cor.ir(cor, agora);
        a.dica.ir(if em_cima { 1. } else { 0. }, agora);
        let alvo = ponteiro.map_or(0., |p| {
            let k = (1. - (p - (xs[i] + w / 2.)).abs() / 120.).max(0.);
            k * k * (3. - 2. * k)
        });
        a.amplia.ir(alvo, agora);
        let amp = a.amplia.valor(agora);
        // Aperto: 0,93 em 110 ms; solto, volta na mola (500/14), multiplicando a ampliação.
        let aperto = match (a.apertou, a.soltou) {
            (Some(t0), _) => 1. - 0.07 * ease_out_css(segundos(t0, agora) / 0.11),
            (None, Some(t1)) if segundos(t1, agora) < SOLTAR.dur => 0.93 + 0.07 * SOLTAR.em(segundos(t1, agora)),
            _ => 1.,
        };
        let (op, y_ent, s_ent) = entrada(e.entrada, i, agora);
        let s = (1. + 0.26 * amp) * aperto * s_ent;
        let ty = -10. * amp + y_ent;
        let (vw, vh) = (w * s, 46. * s);
        // transform-origin: 50% 100% — a base do botão fica no lugar.
        let (l, topo) = ((w - vw) / 2., 46. + ty - vh);
        e.rects.push((Bounds::new(point(origem.x + px(xs[i] + l), origem.y + px(8. + topo)), size(px(vw), px(vh))), s));
        animando |= a.fundo.andando(agora) || a.cor.andando(agora) || a.dica.andando(agora) || a.amplia.andando(agora) || aperto != 1. || !a.ondas.is_empty();

        let cor = a.cor.valor(agora);
        a.ondas.retain(|o| segundos(o.2, agora) < 0.65);
        let ondas = a.ondas.iter().map(|&(ox, oy, t0)| {
            // A onda (motion.js ripple): círculo de 2× a diagonal, 650 ms.
            let p = bezier(0.2, 0.6, 0.3, 1., segundos(t0, agora) / 0.65);
            let raio = (w * w + 46. * 46.).sqrt() * p;
            let longe = [(0., 0.), (w, 0.), (0., 46.), (w, 46.)].iter().map(|(x, y)| ((x - ox).powi(2) + (y - oy).powi(2)).sqrt()).fold(0., f32::max);
            let tinta = cor.opacity(0.35 * (1. - p));
            // O GPUI só corta em retângulo: cobrindo o botão todo, vira o próprio botão.
            if raio >= longe {
                div().absolute().top_0().left_0().size_full().rounded(px(16. * s)).bg(tinta)
            } else {
                div().absolute().left(px((ox - raio) * s)).top(px((oy - raio) * s)).size(px(2. * raio * s)).rounded_full().bg(tinta)
            }
        });
        let selo = (k.selo > 0).then(|| {
            div()
                .absolute()
                .top(px(5. * s))
                .right(px(5. * s))
                .min_w(px(17. * s))
                .h(px(17. * s))
                .px(px(4. * s))
                .rounded_full()
                .bg(t.accent)
                .flex()
                .items_center()
                .justify_center()
                .text_color(gpui::white())
                .text_size(px(10. * s))
                .line_height(px(10. * s))
                .font_weight(FontWeight::BOLD)
                .child(if k.selo > 9 { "9+".to_string() } else { k.selo.to_string() })
        });
        let visual = div()
            .id(("ctrl", i))
            .absolute()
            .left(px(l))
            .top(px(topo))
            .w(px(vw))
            .h(px(vh))
            .rounded(px(16. * s))
            .bg(a.fundo.valor(agora))
            .border(px(s))
            // A borda do hover não tem transição (o call.css a tirou da lista).
            .border_color(if em_cima { t.border } else { t.border.opacity(0.) })
            .overflow_hidden()
            .flex()
            .items_center()
            .justify_center()
            .opacity(op)
            .cursor_pointer()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |c: &mut Chamada, ev: &MouseDownEvent, _, cx| {
                    c.ui.dock.apertar(i, ev.position);
                    cx.notify();
                }),
            )
            .on_click(cx.listener(move |c: &mut Chamada, _, _, cx| acionar(c, b, cx)))
            .child(icone(k.icone, 24. * s, cor))
            .children(ondas)
            .children(selo);
        grupos[*grupo as usize].push(div().relative().flex_none().w(px(w)).h(px(46.)).child(visual).into_any_element());

        let h = a.dica.valor(agora);
        if h > 0. {
            let texto: SharedString = match k.atalho {
                Some(at) => format!("{} · {at}", k.rotulo).into(),
                None => k.rotulo.into(),
            };
            dicas.push(dica(t, texto, xs[i] + w / 2., 8. + topo - 10. * s, s, h));
        }
    }

    let pop = popover(c, t, xs[REAGIR] + 23., agora, &mut animando, window, cx);
    if animando {
        window.request_animation_frame();
    }

    // O mouse na janela toda: a ampliação, o hover e o fim do aperto.
    let caixa = c.ui.dock.caixa.clone();
    let ouvir = canvas(
        move |b, _, _| caixa.set(Some(b)),
        move |_, _, window, _| {
            let (e1, e2) = (ent.clone(), ent.clone());
            window.on_mouse_event(move |ev: &MouseMoveEvent, fase, _, cx| {
                if fase == DispatchPhase::Bubble {
                    let _ = e1.update(cx, |c, cx| {
                        if c.ui.dock.mover(ev.position) {
                            cx.notify();
                        }
                    });
                }
            });
            window.on_mouse_event(move |ev: &MouseUpEvent, fase, _, cx| {
                if fase == DispatchPhase::Bubble && ev.button == MouseButton::Left {
                    let _ = e2.update(cx, |c, cx| {
                        c.ui.dock.soltar(ev.position);
                        cx.notify();
                    });
                }
            });
            window.on_mouse_event(move |_: &MouseExitEvent, fase, _, cx| {
                if fase == DispatchPhase::Bubble {
                    let _ = ent.update(cx, |c, cx| {
                        (c.ui.dock.ponteiro, c.ui.dock.sobre) = (None, None);
                        cx.notify();
                    });
                }
            });
        },
    )
    .absolute()
    .size_full();

    let barra = div()
        .relative()
        .flex_none()
        .w(px(largura + 2.))
        .flex()
        .items_center()
        .gap(px(4.))
        .px(px(10.))
        .py(px(8.))
        .border_1()
        .border_color(t.border)
        .rounded(px(26.))
        .bg(t.bg_elevated)
        .shadow(sombra_dock())
        .children(grupos.into_iter().enumerate().map(|(g, filhos)| {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .when(g > 0, |d| d.ml(px(8.)).pl(px(8.)).border_l_1().border_color(t.border_subtle))
                .children(filhos)
        }))
        .child(ouvir)
        .children(pop)
        .children(dicas);
    // margin: 8px auto 16px, centrada (call.css .dock).
    div().w_full().flex_none().flex().justify_center().pt(px(8.)).pb(px(16.)).child(barra).into_any_element()
}

/// O menu de reagir (reacoes.js montarMenu; app.css .popover + reacoes.css),
/// ancorado no botão "Reagir": 8 px acima do grupo, centrado no botão.
fn popover(c: &mut Chamada, t: &Tema, ancora: f32, agora: Instant, animando: &mut bool, window: &mut Window, cx: &mut Context<Chamada>) -> Option<AnyElement> {
    let caixa_pop = c.ui.dock.caixa_pop.clone();
    let Some(p) = c.ui.dock.pop.as_mut() else {
        caixa_pop.set(None);
        return None;
    };
    // Entrada (motion.js onAdded .popover): opacidade, escala .9 → 1 e 8 px, na mola snappy.
    let d = segundos(p.aberto, agora);
    let m = SNAPPY.em(d);
    let k = 0.9 + 0.1 * m;
    *animando |= d < 0.018 * 3. + 0.38;
    let u = |v: f32| px(v * k);
    // Cada filho sobe 6 px em cascata de 18 ms (stagger, sem desfoque nem escala).
    let subir = |j: usize, el: gpui::Div| {
        let tj = d - 0.018 * j as f32;
        el.relative().top(px(6. * (1. - if tj > 0. { SNAPPY.em(tj) } else { 0. }))).opacity(ease_out(tj.max(0.) / 0.38))
    };
    // letter-spacing: .04em (o GPUI não tem): uma letra por vez, com o vão entre elas.
    let rotulo = |texto: &'static str| {
        div()
            .flex()
            .gap(u(0.44))
            .px(u(12.))
            .pt(u(8.))
            .pb(u(4.))
            .text_size(u(11.))
            .line_height(u(16.5))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(t.text_muted)
            .children(texto.chars().map(|l| div().child(l.to_string())))
    };

    let mut linhas = Vec::new();
    for linha in 0..3 {
        let mut botoes = Vec::new();
        for col in 0..6 {
            let j = linha * 6 + col;
            let em_cima = p.sobre == Some(j);
            let apertado = p.apertado == Some(j);
            p.escala[j].ir(if apertado { 0.9 } else if em_cima { 1.18 } else { 1. }, agora);
            p.fundo[j].ir(if em_cima || apertado { 1. } else { 0. }, agora);
            p.dica[j].ir(if em_cima { 1. } else { 0. }, agora);
            *animando |= p.escala[j].andando(agora) || p.fundo[j].andando(agora) || p.dica[j].andando(agora);
            let sc = p.escala[j].valor(agora);
            // botaoPulo: 1,35 e −10° aos 40%, 380 ms.
            let (ps, pg) = match p.pulo[j] {
                Some(t0) if segundos(t0, agora) < 0.38 => {
                    *animando = true;
                    let q = segundos(t0, agora) / 0.38;
                    (quadros(&[(0., 1.), (0.4, 1.35), (1., 1.)], q, ease_out), quadros(&[(0., 0.), (0.4, -10.), (1., 0.)], q, ease_out))
                }
                _ => (1., 0.),
            };
            let lado = 54. * k * sc;
            let meio = lado / 2.;
            let visual = div()
                .id(("reagir", j))
                .absolute()
                .left(px((54. * k - lado) / 2.))
                .top(px((54. * k - lado) / 2.))
                .size(px(lado))
                .rounded(px(13. * k * sc))
                .bg(t.surface_hover.opacity(p.fundo[j].valor(agora)))
                .cursor_pointer()
                .on_hover(cx.listener(move |c: &mut Chamada, sim: &bool, _, cx| {
                    if let Some(p) = c.ui.dock.pop.as_mut() {
                        if *sim {
                            p.sobre = Some(j);
                        } else if p.sobre == Some(j) {
                            p.sobre = None;
                        }
                        cx.notify();
                    }
                }))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |c: &mut Chamada, _, _, cx| {
                        if let Some(p) = c.ui.dock.pop.as_mut() {
                            p.apertado = Some(j);
                            cx.notify();
                        }
                    }),
                )
                .on_click(cx.listener(move |c: &mut Chamada, _, _, cx| reagir_menu(c, j, cx)))
                .children(reacoes::emoji(REACOES[j].1, meio, meio, 30. * k * sc * ps, 30., pg, false, window));
            botoes.push(div().relative().flex_none().size(u(54.)).child(visual));
        }
        linhas.push(div().flex().gap(u(2.)).children(botoes));
    }
    let grade = div().flex().flex_col().gap(u(2.)).px(u(4.)).pt(u(2.)).pb(u(6.)).children(linhas);

    let sinais = div().flex().flex_col().gap(u(4.)).px(u(4.)).pt(u(2.)).pb(u(4.)).children(SINAIS.chunks(2).enumerate().map(|(l, par)| {
        div().flex().gap(u(4.)).children(par.iter().enumerate().map(|(c2, (icone, nome))| {
            div()
                .id(("sinal", l * 2 + c2))
                .w(u(165.))
                .min_h(u(38.))
                .flex()
                .items_center()
                .gap(u(8.))
                .px(u(10.))
                .rounded(u(13.))
                .border(u(1.))
                .border_color(t.border.opacity(0.))
                .text_size(u(13.))
                .line_height(u(19.5))
                .text_color(t.text)
                .cursor_pointer()
                .hover(|s| s.bg(t.surface_hover))
                .on_click(cx.listener(|c: &mut Chamada, _, _, cx| c.avisar("Os sinais chegam em breve ao app nativo", cx)))
                .child(icone_traco(icone, 16. * k, 2.1, t.text))
                .child(*nome)
        }))
    }));

    // A dica do emoji com o mouse em cima (data-tip-placement top), que cresce junto (1,18).
    let dicas: Vec<AnyElement> = (0..REACOES.len())
        .filter_map(|j| {
            let h = p.dica[j].valor(agora);
            (h > 0.).then(|| {
                let sc = p.escala[j].valor(agora);
                let (x, y) = (12. + (j % 6) as f32 * 56. + 27., 8. + 28.5 + 2. + 2. + (j / 6) as f32 * 56. + 27.);
                dica(t, REACOES[j].2.into(), x * k, (y - 27. * sc) * k - 10. * sc * k, sc * k, h)
            })
        })
        .collect();

    let registro = canvas(move |b, _, _| caixa_pop.set(Some(b)), |_, _, _, _| {}).absolute().size_full();
    Some(
        div()
            .id("menu-reagir")
            .absolute()
            .left(px(ancora - 180. * k))
            .bottom(px(62. - 8. * (1. - m)))
            .w(u(360.))
            .flex()
            .flex_col()
            .gap(u(2.))
            .p(u(8.))
            .border(u(1.))
            .border_color(t.border)
            .rounded(u(18.))
            .bg(t.bg_elevated)
            .shadow(escalar(t.sombra_lg(), k))
            .opacity(m.min(1.))
            .occlude()
            .child(subir(0, rotulo("REAGIR")))
            .child(subir(1, grade))
            .child(subir(2, rotulo("SINAIS · FICAM NO SEU QUADRINHO")))
            .child(subir(3, sinais))
            .child(registro)
            .children(dicas)
            .into_any_element(),
    )
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn barra_do_tamanho_da_do_app() {
        // ESPEC 4.1: ≈1006–1008 × 64 (com a borda).
        let (xs, largura) = posicoes();
        assert_eq!(largura + 2., 1008.);
        assert_eq!(xs[0], 10.);
        assert_eq!(xs[3], 10. + 3. * 46. + 2. * 6. + 21.);
        assert_eq!(BOTOES.iter().filter(|b| b.0 == B::Reagir).count(), 1);
        assert_eq!(BOTOES[REAGIR].0, B::Reagir);
    }
}
