//! A antessala ("credencial"/ingresso), antes de entrar na chamada (ESPEC 2).
//! DONO: agente do saguão. Esta versão é o mínimo que funciona (nome e
//! Entrar); o visual igual ao app entra por cima, mantendo `Saguao::novo` e
//! `entrar`.

use gpui::{Context, Entity, Window, div, prelude::*, px};

use super::tema::{FONTE, Tema};
use crate::chamada::{Chamada, Opcoes};
use crate::entrada::{self, Entrada};
use crate::sala::Avatar;

/// O que a chamada precisa e o saguão só repassa.
pub struct Destino {
    pub ws: String,
    pub sala_id: String,
    pub ice: Vec<libwebrtc::prelude::IceServer>,
    pub opcoes: Opcoes,
}

pub struct Saguao {
    pub nome: Entity<Entrada>,
    pub avatar: Avatar,
    destino: Option<Destino>,
    _assinaturas: Vec<gpui::Subscription>,
}

impl Saguao {
    pub fn novo(destino: Destino, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let nome = cx.new(|cx| Entrada::nova("Seu nome", cx));
        let assinaturas = vec![
            cx.subscribe(&nome, |_, _, _: &entrada::Mudou, cx| cx.notify()),
            cx.subscribe_in(&nome, window, |s: &mut Saguao, _, _: &entrada::Enviado, window, cx| s.entrar(window, cx)),
        ];
        Saguao { nome, avatar: Avatar::Gerado { estilo: "paisagemMontanha".into(), semente: crate::sala::token() }, destino: Some(destino), _assinaturas: assinaturas }
    }

    /// Troca esta tela pela chamada.
    pub fn entrar(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let nome = self.nome.read(cx).texto().trim().to_string();
        if nome.is_empty() {
            return;
        }
        let Some(d) = self.destino.take() else { return };
        let avatar = self.avatar.clone();
        window.replace_root(cx, move |_, cx| Chamada::nova(d.ws, d.sala_id, nome, avatar, d.ice, d.opcoes, cx));
    }
}

impl Render for Saguao {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Tema::de(window);
        div()
            .size_full()
            .relative()
            .bg(t.bg)
            .text_color(t.text)
            .font_family(FONTE)
            .flex()
            .items_center()
            .justify_center()
            .child(div().w(px(320.)).h(px(40.)).border_b_1().border_color(t.border_strong).child(self.nome.clone()))
            .child(div().id("entrar").ml_4().px_4().py_2().bg(t.accent).text_color(t.accent_text).child("Entrar na sala").on_click(cx.listener(|s, _, w, cx| s.entrar(w, cx))))
            .child(super::janela::controles(&t, window))
    }
}
