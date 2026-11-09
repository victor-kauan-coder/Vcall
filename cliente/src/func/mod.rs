//! Os recursos da chamada além de vídeo e voz (quadro, jogos, festa, QuizzV,
//! Poker, legendas, gravação, arquivos...), cada um no seu módulo, com o seu
//! estado em `c.func`. Eles conversam com os outros pelo canal do quadro, como
//! no navegador (core/mesh.js: o que não é chat nem da malha vira "board").
//!
//! Encaixe na interface: o recurso aberto ocupa o palco no lugar da grade
//! (`palco`), como no app; a barra abre e fecha com `abrir`/`fechar`.

use gpui::{AnyElement, Context, Window};
use serde_json::Value;

use crate::chamada::Chamada;
use crate::ui::tema::Tema;

/// Os recursos que ocupam o palco quando abertos.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Recurso {
    Quadro,
    Jogos,
    Festa,
    Poker,
}

/// O estado de cada recurso (cada módulo é dono do seu).
#[derive(Default)]
pub struct Estados {
    pub aberto: Option<Recurso>,
}

pub fn abrir(c: &mut Chamada, r: Recurso, cx: &mut Context<Chamada>) {
    c.func.aberto = if c.func.aberto == Some(r) { None } else { Some(r) };
    cx.notify();
}

pub fn fechar(c: &mut Chamada, cx: &mut Context<Chamada>) {
    c.func.aberto = None;
    cx.notify();
}

/// O recurso aberto, no lugar da grade de vídeos (None: a grade normal).
pub fn palco(c: &mut Chamada, _t: &Tema, _window: &mut Window, _cx: &mut Context<Chamada>) -> Option<AnyElement> {
    match c.func.aberto? {
        Recurso::Quadro | Recurso::Jogos | Recurso::Festa | Recurso::Poker => None,
    }
}

/// Uma operação de recurso chegou de `de` (pelo canal de dados ou, de quem
/// ainda não abriu o canal, pelo servidor).
pub fn receber(_c: &mut Chamada, de: &str, op: &Value, _cx: &mut Context<Chamada>) {
    if std::env::var_os("VCALL_NATIVO_LOG").is_some() {
        eprintln!("dados de {de}: {}", op.get("type").or_else(|| op.get(0)).map(|v| v.to_string()).unwrap_or_default());
    }
}

/// O cursor do quadro de alguém.
pub fn cursor(_c: &mut Chamada, _de: &str, _op: &Value, _cx: &mut Context<Chamada>) {}

/// Um pedaço binário (imagem do quadro, arquivo).
pub fn blob(_c: &mut Chamada, _de: &str, _dados: &[u8], _cx: &mut Context<Chamada>) {}
