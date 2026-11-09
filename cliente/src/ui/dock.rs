//! A barra de controles (ESPEC 4). DONO: agente da barra.

use gpui::{AnyElement, Context, Window, div, prelude::*};

use super::tema::Tema;
use crate::chamada::Chamada;

/// O estado só do desenho da barra (menu aberto, seletor de reações...).
#[derive(Default)]
pub struct Estado {}

pub fn dock(_c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> AnyElement {
    div().h(gpui::px(80.)).w_full().into_any_element()
}
