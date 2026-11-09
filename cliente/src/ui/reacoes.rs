//! Reações na tela: emoji voando, combo, selo no ladrilho, chuva (ESPEC 6). DONO: agente da barra.

use gpui::{AnyElement, Context, Window, div, prelude::*};

use super::tema::Tema;
use crate::chamada::Chamada;

#[derive(Default)]
pub struct Estado {}

/// Camada por cima de tudo (absoluta, não recebe clique).
pub fn camada(_c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> AnyElement {
    div().into_any_element()
}
