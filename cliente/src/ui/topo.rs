//! A barra do topo da chamada (ESPEC 3.1). DONO: agente do palco.
//!
//! Selo de criptografia · cronômetro · quantas pessoas; à direita "Convidar"
//! e o botão do tema. Como no app de mesa (.is-desktop .topbar), o fundo
//! arrasta a janela e a direita fica livre para minimizar/maximizar/fechar.

use gpui::{AnyElement, Context, FontWeight, Window, WindowControlArea, deferred, div, prelude::*, px};

use super::comp::icone_traco;
use super::palco::{Estilo, arte, botao, copiar_link, dica};
use super::tema::{self, Tema};
use crate::chamada::Chamada;

/// A largura dos botões da janela (janela.rs: 3 x 46 px).
const CONTROLES: f32 = 138.;

/// `.dot-sep`: "·", 8 px, o texto.
fn separado(texto: String) -> impl IntoElement {
    div().flex().whitespace_nowrap().child(div().mr(px(8.)).child("·")).child(texto)
}

pub fn topo(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let n = c.sala.pessoas.len().max(1);
    let caiu = c.conexao.starts_with("Sem conexão");
    let (selo, cor_selo, cor_icone) = if caiu { ("Reconectando à sala…", t.warn, t.warn) } else { ("Criptografada ponta a ponta", t.text_muted, arte::alfa(t.ok, 0.85)) };

    let meta = div()
        .flex()
        .items_center()
        .gap(px(12.))
        .min_w_0()
        .text_size(px(tema::texto::XS))
        .line_height(px(18.))
        .text_color(t.text_muted)
        .when(!c.sala.nome.is_empty(), |d| {
            d.child(
                div()
                    .max_w(px(34. * 9.))
                    .truncate()
                    .ml(px(4.))
                    .pl(px(12.))
                    .border_l_1()
                    .border_color(t.border)
                    .text_size(px(tema::texto::MD))
                    .line_height(px(24.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(c.sala.nome.clone()),
            )
        })
        .child(div().flex().items_center().gap(px(4.)).whitespace_nowrap().text_color(cor_selo).child(icone_traco("shield-check", 16., 2.1, cor_icone)).child(selo))
        .child(separado(c.cronometro()))
        .child(separado(if n == 1 { "só você".into() } else { format!("{n} pessoas") }));

    let convidar = botao("convidar", "user-plus", 16., Some("Convidar"), Estilo::Normal, false, c, t, window, cx)
        .occlude()
        // ponytail: o diálogo de convite do app não existe no nativo; copia o link da sala.
        .on_click(cx.listener(|c, _, _, cx| copiar_link(c, cx)));

    let modo = c.ui.palco.tema;
    let (icone, rotulo) = [("laptop", "Tema do sistema"), ("sun", "Tema claro"), ("moon", "Tema escuro")][modo as usize % 3];
    let v_dica = c.ui.palco.trans.valor("dica:tema", c.ui.palco.sob.tem("tema"), 120., window);
    let tema_btn = botao("tema", icone, 20., None, Estilo::Fantasma, false, c, t, window, cx)
        .occlude()
        .when(v_dica > 0., |d| d.child(deferred(dica(rotulo, v_dica, 40., t)).with_priority(2)))
        .on_click(cx.listener(|c, _, _, cx| {
            // Sistema -> claro -> escuro (theme.js cycle). Tema::de lê VCALL_TEMA.
            let m = (c.ui.palco.tema + 1) % 3;
            c.ui.palco.tema = m;
            tema::definir_preferencia(m);
            cx.notify();
        }));

    div()
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(12.))
        .h(px(52.))
        .pt(px(12.))
        .pl(px(16.))
        .pr(px(16. + CONTROLES))
        .child(div().absolute().top_0().left_0().bottom_0().right(px(CONTROLES)).window_control_area(WindowControlArea::Drag))
        .child(meta)
        .child(div().flex_1())
        .child(convidar)
        .child(tema_btn)
        .into_any_element()
}
