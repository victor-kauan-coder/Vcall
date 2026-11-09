//! O palco: grade, duo, destaque e os ladrilhos (ESPEC 3.2 a 3.8). DONO: agente do palco.

use gpui::{AnyElement, Context, Window, div, prelude::*};

use super::tema::Tema;
use crate::chamada::Chamada;

/// O estado só do desenho do palco (bolha arrastável do duo, ladrilho com o mouse em cima...).
#[derive(Default)]
pub struct Estado {}

pub fn palco(_c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> AnyElement {
    div().flex_1().into_any_element()
}
