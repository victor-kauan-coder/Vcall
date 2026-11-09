//! A barra do topo da chamada (ESPEC 3.1). DONO: agente do palco.

use gpui::{AnyElement, Context, Window, div, prelude::*};

use super::tema::Tema;
use crate::chamada::Chamada;

pub fn topo(_c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> AnyElement {
    div().h(gpui::px(56.)).w_full().window_control_area(gpui::WindowControlArea::Drag).into_any_element()
}
