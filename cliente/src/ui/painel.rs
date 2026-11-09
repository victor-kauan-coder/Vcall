//! O painel lateral: Conversa, Pessoas, Legendas, Qualidade (ESPEC 5). DONO: agente do painel.

use gpui::{AnyElement, Context, Window};

use super::tema::Tema;
use crate::chamada::Chamada;

/// O estado só do desenho do painel (rolagem...).
#[derive(Default)]
pub struct Estado {}

/// None quando o painel está fechado.
pub fn painel(c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> Option<AnyElement> {
    c.painel?;
    None
}
