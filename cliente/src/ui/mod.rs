//! A interface, igual à do app web (public/css + DESIGN.md). Cada parte num
//! arquivo, com assinatura fixa, para poderem ser feitas em paralelo:
//!   topo.rs    barra do topo         palco.rs   grade, duo, destaque, ladrilhos
//!   dock.rs    barra de controles    painel.rs  Conversa, Pessoas, Legendas...
//!   reacoes.rs reações na tela       saguao.rs  a antessala (outra tela)
//!   janela.rs  min/max/fechar        tema.rs    tokens; comp.rs peças comuns

pub mod avatar;
pub mod comp;
pub mod dock;
pub mod janela;
pub mod painel;
pub mod palco;
pub mod reacoes;
pub mod saguao;
pub mod tema;
pub mod topo;

use gpui::{Context, Window, div, prelude::*, px};

use crate::chamada::Chamada;
use tema::{FONTE, Tema};

/// Para as fotos de comparação (scripts/nativo-foto.mjs): o tamanho em que a
/// janela está desenhando (em pixels lógicos) e a escala, quando mudam.
pub fn registrar_tamanho(window: &Window) {
    if std::env::var_os("VCALL_NATIVO_FOTO").is_none() {
        return;
    }
    thread_local!(static ULTIMO: std::cell::Cell<(f32, f32)> = const { std::cell::Cell::new((0., 0.)) });
    let s = window.viewport_size();
    let agora = (f32::from(s.width), f32::from(s.height));
    if ULTIMO.with(|u| u.replace(agora)) != agora {
        eprintln!("tamanho {}x{} escala {}", agora.0.round(), agora.1.round(), window.scale_factor());
    }
}

/// O estado só do desenho, de cada parte (cada uma é dona do seu).
#[derive(Default)]
pub struct EstadoUi {
    pub palco: palco::Estado,
    pub dock: dock::Estado,
    pub painel: painel::Estado,
    pub reacoes: reacoes::Estado,
}

impl Render for Chamada {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        registrar_tamanho(window);
        let t = Tema::de(window);
        let topo = topo::topo(self, &t, window, cx);
        // Um recurso aberto (quadro, jogo...) ocupa o palco no lugar da grade.
        let palco = match crate::func::palco(self, &t, window, cx) {
            Some(r) => r,
            None => palco::palco(self, &t, window, cx),
        };
        let painel = painel::painel(self, &t, window, cx);
        let dock = dock::dock(self, &t, window, cx);
        let reacoes = reacoes::camada(self, &t, window, cx);
        let batidas = painel::batidas(self, &t, cx);
        div()
            .size_full()
            .relative()
            .bg(t.bg)
            .text_color(t.text)
            .font_family(FONTE)
            .text_size(px(tema::texto::BASE))
            .line_height(px(22.5))
            .flex()
            .flex_col()
            .child(topo)
            .child(div().flex_1().min_h_0().flex().child(palco).children(painel))
            .child(dock)
            .child(reacoes)
            .children(batidas)
            .child(janela::controles(&t, window))
    }
}
