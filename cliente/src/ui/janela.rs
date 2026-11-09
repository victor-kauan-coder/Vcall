//! Minimizar, maximizar e fechar, onde o Electron põe os botões nativos do
//! Windows (titleBarOverlay de 40 px, desktop/main.js `coresDaBarra`). A barra
//! de título é do app (appears_transparent); a área de arrastar é a barra do
//! topo de cada tela (WindowControlArea::Drag).

use gpui::{AnyElement, Window, WindowControlArea, div, prelude::*, px, rgb};

use super::tema::Tema;

/// Os glifos do próprio Windows (Segoe Fluent Icons; MDL2 no Windows 10).
const MIN: &str = "\u{E921}";
const MAX: &str = "\u{E922}";
const RESTAURAR: &str = "\u{E923}";
const FECHAR: &str = "\u{E8BB}";

pub fn controles(t: &Tema, window: &Window) -> AnyElement {
    if !cfg!(windows) {
        return div().into_any_element();
    }
    let simbolo = t.simbolo_barra;
    let hover = if t.escuro { gpui::rgba(0xffffff17) } else { gpui::rgba(0x0000000f) };
    let botao = |id: &'static str, glifo: &'static str, area: WindowControlArea, fechar: bool| {
        div()
            .id(id)
            .w(px(46.))
            .h(px(40.))
            .flex()
            .items_center()
            .justify_center()
            .font_family("Segoe Fluent Icons")
            .text_size(px(10.))
            .text_color(simbolo)
            .window_control_area(area)
            .when(fechar, |d| d.hover(|s| s.bg(rgb(0xc42b1c)).text_color(rgb(0xffffff))))
            .when(!fechar, |d| d.hover(|s| s.bg(hover)))
            .child(glifo)
    };
    div()
        .absolute()
        .top_0()
        .right_0()
        .flex()
        .child(botao("min", MIN, WindowControlArea::Min, false))
        .child(botao("max", if window.is_maximized() { RESTAURAR } else { MAX }, WindowControlArea::Max, false))
        .child(botao("fechar", FECHAR, WindowControlArea::Close, true))
        .into_any_element()
}
