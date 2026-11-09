//! Caixa de texto de uma linha (nome no saguão, mensagem do chat).
//!
//! O GPUI 0.2 não traz uma pronta. Esta liga o `InputHandler` dele, que é o
//! que faz acento por tecla morta (ã, é) e IME funcionarem; sem isso só
//! chegariam teclas cruas. O visual (borda, fundo, fonte) é de quem a usa.
//!
//! ponytail: cursor sempre no fim, sem seleção nem setas; o exemplo
//! `input.rs` do GPUI tem tudo isso se fizer falta.

use std::ops::Range;

use gpui::{
    App, Bounds, Context, CursorStyle, ElementInputHandler, EntityInputHandler, EventEmitter, FocusHandle, Focusable, Hsla, MouseButton, Pixels, SharedString, UTF16Selection, Window, actions, canvas, div,
    prelude::*, px,
};

actions!(entrada, [Apagar, Enviar, Colar]);

/// Teclas da caixa (registradas uma vez, em main).
pub fn teclas() -> Vec<gpui::KeyBinding> {
    vec![
        gpui::KeyBinding::new("backspace", Apagar, Some("Entrada")),
        gpui::KeyBinding::new("enter", Enviar, Some("Entrada")),
        gpui::KeyBinding::new("ctrl-v", Colar, Some("Entrada")),
        gpui::KeyBinding::new("cmd-v", Colar, Some("Entrada")),
    ]
}

/// Enter na caixa, com o texto (já sem espaço nas pontas).
pub struct Enviado(pub String);
/// O texto mudou (quem desenha um botão "Entrar" aceso depende disso).
pub struct Mudou;

pub struct Entrada {
    foco: FocusHandle,
    texto: String,
    marcado: Option<Range<usize>>,
    dica: SharedString,
    pub cor_dica: Hsla,
    pub cor_cursor: Hsla,
    pub limite: usize,
}

impl EventEmitter<Enviado> for Entrada {}
impl EventEmitter<Mudou> for Entrada {}

impl Focusable for Entrada {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.foco.clone()
    }
}

impl Entrada {
    pub fn nova(dica: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Entrada { foco: cx.focus_handle(), texto: String::new(), marcado: None, dica: dica.into(), cor_dica: gpui::opaque_grey(0.5, 1.0), cor_cursor: gpui::white(), limite: 2000 }
    }

    pub fn texto(&self) -> &str {
        &self.texto
    }

    pub fn definir(&mut self, texto: &str, cx: &mut Context<Self>) {
        self.texto = texto.chars().take(self.limite).collect();
        self.marcado = None;
        cx.emit(Mudou);
        cx.notify();
    }

    fn apagar(&mut self, _: &Apagar, _: &mut Window, cx: &mut Context<Self>) {
        if self.texto.pop().is_some() {
            cx.emit(Mudou);
            cx.notify();
        }
    }

    fn enviar(&mut self, _: &Enviar, _: &mut Window, cx: &mut Context<Self>) {
        let t = self.texto.trim().to_string();
        if !t.is_empty() {
            cx.emit(Enviado(t));
        }
    }

    fn colar(&mut self, _: &Colar, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(t) = cx.read_from_clipboard().and_then(|c| c.text()) {
            self.replace_text_in_range(None, &t.replace(['\r', '\n'], " "), window, cx);
        }
    }

    /// Posição em UTF-16 (como o sistema conta) -> posição em bytes.
    fn em_bytes(&self, u16: usize) -> usize {
        let mut n = 0;
        for (i, c) in self.texto.char_indices() {
            if n >= u16 {
                return i;
            }
            n += c.len_utf16();
        }
        self.texto.len()
    }

    fn em_utf16(&self, bytes: usize) -> usize {
        self.texto[..bytes.min(self.texto.len())].chars().map(char::len_utf16).sum()
    }

    fn trocar(&mut self, faixa: Option<Range<usize>>, novo: &str) -> Range<usize> {
        let fim = self.texto.len();
        let r = faixa.map(|r| self.em_bytes(r.start)..self.em_bytes(r.end)).or(self.marcado.clone()).unwrap_or(fim..fim);
        let cabe = self.limite.saturating_sub(self.texto.chars().count() - self.texto[r.clone()].chars().count());
        let novo: String = novo.chars().filter(|c| !c.is_control()).take(cabe).collect();
        self.texto.replace_range(r.clone(), &novo);
        r.start..r.start + novo.len()
    }
}

impl EntityInputHandler for Entrada {
    fn text_for_range(&mut self, r: Range<usize>, real: &mut Option<Range<usize>>, _: &mut Window, _: &mut Context<Self>) -> Option<String> {
        let b = self.em_bytes(r.start)..self.em_bytes(r.end);
        real.replace(self.em_utf16(b.start)..self.em_utf16(b.end));
        Some(self.texto[b].to_string())
    }

    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        let fim = self.em_utf16(self.texto.len());
        Some(UTF16Selection { range: fim..fim, reversed: false })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marcado.as_ref().map(|r| self.em_utf16(r.start)..self.em_utf16(r.end))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marcado = None;
    }

    fn replace_text_in_range(&mut self, faixa: Option<Range<usize>>, novo: &str, _: &mut Window, cx: &mut Context<Self>) {
        self.trocar(faixa, novo);
        self.marcado = None;
        cx.emit(Mudou);
        cx.notify();
    }

    fn replace_and_mark_text_in_range(&mut self, faixa: Option<Range<usize>>, novo: &str, _: Option<Range<usize>>, _: &mut Window, cx: &mut Context<Self>) {
        let r = self.trocar(faixa, novo);
        self.marcado = (!r.is_empty()).then_some(r);
        cx.emit(Mudou);
        cx.notify();
    }

    fn bounds_for_range(&mut self, _: Range<usize>, caixa: Bounds<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<Bounds<Pixels>> {
        Some(caixa) // a janela de sugestões do IME abre junto da caixa
    }

    fn character_index_for_point(&mut self, _: gpui::Point<Pixels>, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        None
    }
}

impl Render for Entrada {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focada = self.foco.is_focused(window);
        let cor_cursor = self.cor_cursor;
        let cursor = move || div().flex_none().w(px(1.5)).h(px(18.)).bg(cor_cursor);
        let (entidade, foco) = (cx.entity(), self.foco.clone());
        div()
            .id("entrada")
            .key_context("Entrada")
            .track_focus(&self.foco)
            .on_action(cx.listener(Self::apagar))
            .on_action(cx.listener(Self::enviar))
            .on_action(cx.listener(Self::colar))
            .on_mouse_down(MouseButton::Left, cx.listener(|e, _, w, _| e.foco.focus(w)))
            .cursor(CursorStyle::IBeam)
            .relative()
            .size_full()
            .flex()
            .items_center()
            .overflow_hidden()
            .when(self.texto.is_empty(), |d| d.when(focada, |d| d.child(cursor())).child(div().text_color(self.cor_dica).child(self.dica.clone())))
            .when(!self.texto.is_empty(), |d| d.child(div().whitespace_nowrap().child(self.texto.clone())).when(focada, |d| d.child(cursor())))
            // O InputHandler só pode ser registrado durante o desenho.
            .child(canvas(|_, _, _| (), move |caixa, _, w, cx| w.handle_input(&foco, ElementInputHandler::new(caixa, entidade), cx)).absolute().size_full())
    }
}
