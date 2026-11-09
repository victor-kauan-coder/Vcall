//! O painel lateral: Conversa, Pessoas, Transcrição, Qualidade (ESPEC 5;
//! public/js/ui/panel.js, css/app.css:1261-1700). Legendas e estatísticas
//! ainda não vieram para o nativo: as abas mostram o estado inicial do app.

use std::ops::Range;
use std::time::{SystemTime, UNIX_EPOCH};

use gpui::{
    AnyElement, Context, Div, Entity, Focusable, FontWeight, HighlightStyle, InteractiveText, PromptLevel, ScrollHandle, SharedString, Stateful, StyledText, UnderlineStyle, Window, div, img, prelude::*,
    px, relative, rgb,
};

use super::comp::icone_traco;
use super::saguao::pecas::{dica, sombra_lg};
use super::tema::{Tema, raio};
use crate::chamada::{Chamada, Painel};
use crate::entrada::Entrada;
use crate::sala::Avatar;

/// O estado só do desenho do painel.
#[derive(Default)]
pub struct Estado {
    rolagem: ScrollHandle,
    /// Mensagens já mostradas (para seguir o fim só quando chega uma nova).
    vistas: usize,
    /// O elemento sob o mouse (as dicas).
    sobre: Option<SharedString>,
    /// Já pôs o foco na caixa nesta abertura da Conversa.
    focou: bool,
    busca: Option<Entity<Entrada>>,
}

const ABAS: [(Painel, &str, &str); 4] = [
    (Painel::Conversa, "message-square", "Conversa"),
    (Painel::Pessoas, "users", "Pessoas"),
    (Painel::Legendas, "captions", "Transcrição"),
    (Painel::Qualidade, "activity", "Qualidade"),
];

/// None quando o painel está fechado.
pub fn painel(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> Option<AnyElement> {
    let Some(aba) = c.painel else {
        c.ui.painel.focou = false;
        return None;
    };
    // Abrir a conversa põe o foco na caixa (panel.js show).
    if aba == Painel::Conversa && !c.ui.painel.focou {
        c.ui.painel.focou = true;
        let f = c.entrada_chat.focus_handle(cx);
        window.defer(cx, move |w, _| f.focus(w));
    } else if aba != Painel::Conversa {
        c.ui.painel.focou = false;
    }
    let corpo = match aba {
        Painel::Conversa => conversa(c, t, window, cx),
        Painel::Pessoas => pessoas(c, t, window, cx),
        Painel::Legendas => transcricao(c, t, window, cx),
        Painel::Qualidade => qualidade(c, t),
    };
    Some(
        div()
            .w(px(348.))
            .flex_none()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(t.bg_elevated)
            .border_l_1()
            .border_color(t.border)
            .child(abas(c, t, cx))
            .child(corpo)
            .into_any_element(),
    )
}

/* ------------------------------ peças ------------------------------ */

/// Marca/desmarca o elemento sob o mouse (para a dica dele).
fn sobre(id: SharedString) -> impl Fn(&mut Chamada, &bool, &mut Window, &mut Context<Chamada>) + 'static {
    move |c, dentro, _, cx| {
        let s = &mut c.ui.painel.sobre;
        if *dentro {
            *s = Some(id.clone());
        } else if s.as_ref() == Some(&id) {
            *s = None;
        }
        cx.notify();
    }
}

fn com_dica(d: Stateful<Div>, c: &Chamada, id: &SharedString, texto: &'static str, abaixo: bool, t: &Tema, cx: &mut Context<Chamada>) -> Stateful<Div> {
    d.on_hover(cx.listener(sobre(id.clone()))).when(c.ui.painel.sobre.as_ref() == Some(id), |d| d.child(dica(texto, abaixo, t)))
}

/// `.btn.btn--icon.btn--ghost`: 40×40, raio 13, ícone 16 em text-secondary.
fn fantasma(id: impl Into<SharedString>, ic: &'static str, t: &Tema) -> Stateful<Div> {
    let id: SharedString = id.into();
    let texto = t.text;
    div()
        .id(id.clone())
        .group(id.clone())
        .relative()
        .size(px(40.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(raio::MD))
        .cursor_pointer()
        .hover(|s| s.bg(t.surface_2))
        .child(icone_traco(ic, 16., 2.1, t.text_secondary).group_hover(id, move |s| s.text_color(texto)))
}

/// `.btn.btn--ghost` pequeno (people__acao, knock): texto e ícone opcional.
fn botao_texto(id: impl Into<SharedString>, ic: Option<&'static str>, texto: &'static str, primario: bool, alt: f32, fonte: f32, t: &Tema) -> Stateful<Div> {
    let id: SharedString = id.into();
    let cor = if primario { t.accent_text } else { t.text_secondary };
    let texto_hover = t.text;
    div()
        .id(id.clone())
        .group(id.clone())
        .relative()
        .min_h(px(alt))
        .px(px(if alt < 40. { 12. } else { 16. }))
        .flex()
        .items_center()
        .justify_center()
        .gap(px(8.))
        .rounded(px(raio::MD))
        .border_1()
        .border_color(gpui::transparent_black())
        .text_size(px(fonte))
        .line_height(px(fonte * 1.5))
        .font_weight(if primario { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
        .whitespace_nowrap()
        .text_color(cor)
        .cursor_pointer()
        .when(primario, |d| d.bg(t.accent))
        .when(!primario, |d| d.hover(|s| s.bg(t.surface_2).text_color(texto_hover)))
        .children(ic.map(|ic| icone_traco(ic, 16., 2.1, cor).when(!primario, |s| s.group_hover(id.clone(), move |s| s.text_color(texto_hover)))))
        .child(texto)
}

/// `.avatar`: redondo, surface-3 por baixo. Sem avatar, o app desenha o
/// padrão dele (notionistsNeutral, semente "vcall"; avatars.js avatarSvg).
fn avatar(av: &Avatar, tam: f32, t: &Tema) -> AnyElement {
    let padrao = Avatar::Gerado { estilo: "notionistsNeutral".into(), semente: "vcall".into() };
    let av = if matches!(av, Avatar::Nenhum) { &padrao } else { av };
    let base = div().size(px(tam)).flex_none().rounded_full().bg(t.surface_3);
    match super::avatar::para_img(av) {
        Some(i) => base.child(img(i).size_full().rounded_full()).into_any_element(),
        None => base.into_any_element(),
    }
}

/// `.panel__empty`: ícone grande e o texto, no meio da área.
fn vazio(ic: &'static str, linhas: Vec<&'static str>, t: &Tema) -> Div {
    div()
        .m_auto()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .px(px(16.))
        .py(px(32.))
        .text_center()
        .text_size(px(13.))
        .line_height(px(19.5))
        .text_color(t.text_muted)
        .child(icone_traco(ic, 30., 1.8, t.text_muted))
        .children(linhas.into_iter().map(|l| div().child(l)))
}

fn rolagem(id: &'static str) -> Stateful<Div> {
    div().id(id).flex_1().min_h_0().overflow_y_scroll().p(px(16.)).flex().flex_col().gap(px(12.))
}

/* ------------------------------ abas ------------------------------ */

fn abas(c: &mut Chamada, t: &Tema, cx: &mut Context<Chamada>) -> Div {
    let aberta = c.painel;
    let mut linha = div().flex().p(px(8.)).gap(px(4.)).border_b_1().border_color(t.border_subtle);
    for (p, ic, rotulo) in ABAS {
        let ativa = aberta == Some(p);
        let id: SharedString = format!("aba-{rotulo}").into();
        let cor = if ativa { t.accent } else { t.text_muted };
        let texto = t.text;
        let aba = div()
            .id(id.clone())
            .group(id.clone())
            .relative()
            .h(px(40.))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .rounded(px(raio::SM))
            .text_size(px(13.))
            .line_height(px(19.5))
            .font_weight(FontWeight::MEDIUM)
            .text_color(cor)
            .cursor_pointer()
            .when(ativa, |d| d.flex_1().p(px(8.)).bg(t.accent_soft))
            .when(!ativa, |d| d.flex_none().px(px(10.)).py(px(8.)).hover(|s| s.bg(t.surface_2).text_color(texto)))
            .child(icone_traco(ic, 16., 2.1, cor).when(!ativa, |s| s.group_hover(id.clone(), move |s| s.text_color(texto))))
            // Só a aba aberta mostra o nome; as outras, o ícone e a dica.
            .when(ativa, |d| d.child(rotulo))
            .on_click(cx.listener(move |c, _, _, cx| {
                if c.painel != Some(p) {
                    c.abrir_painel(p, cx);
                }
            }));
        linha = linha.child(com_dica(aba, c, &id, rotulo, true, t, cx));
    }
    linha.child(fantasma("fechar-painel", "x", t).on_click(cx.listener(|c, _, _, cx| {
        c.painel = None;
        cx.notify();
    })))
}

/* ------------------------------ conversa ------------------------------ */

/// O fuso local em segundos (a hora "HH:MM" das mensagens, como o toLocaleTimeString).
fn fuso() -> i64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        #[derive(Default)]
        struct Hora {
            ano: u16,
            mes: u16,
            dia_semana: u16,
            dia: u16,
            h: u16,
            m: u16,
            s: u16,
            ms: u16,
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetLocalTime(h: *mut Hora);
            fn GetSystemTime(h: *mut Hora);
        }
        let (mut l, mut u) = (Hora::default(), Hora::default());
        // SAFETY: as duas só preenchem a estrutura que recebem.
        unsafe {
            GetLocalTime(&mut l);
            GetSystemTime(&mut u);
        }
        let dias = match (l.dia_semana as i64 - u.dia_semana as i64).rem_euclid(7) {
            6 => -1,
            d => d,
        };
        (dias * 1440 + (l.h as i64 - u.h as i64) * 60 + (l.m as i64 - u.m as i64)) * 60
    }
    #[cfg(not(windows))]
    0
}

fn hora(h: SystemTime, fuso: i64) -> String {
    let min = ((h.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64 + fuso) / 60).rem_euclid(1440);
    format!("{:02}:{:02}", min / 60, min % 60)
}

/// Os links de um texto (util.js linkify: `\bhttps?://[^\s<>"']+`, sem caixa).
fn links(texto: &str) -> Vec<Range<usize>> {
    let baixo = texto.to_ascii_lowercase();
    let mut v = Vec::new();
    let mut i = 0;
    while let Some(p) = baixo[i..].find("http") {
        let ini = i + p;
        let resto = &baixo[ini..];
        let pre = if resto.starts_with("https://") { 8 } else if resto.starts_with("http://") { 7 } else { 0 };
        let borda = texto[..ini].chars().next_back().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        if pre > 0 && borda {
            let fim = ini + resto.find(|c: char| c.is_whitespace() || "<>\"'".contains(c)).unwrap_or(resto.len());
            if fim > ini + pre {
                v.push(ini..fim);
                i = fim;
                continue;
            }
        }
        i = ini + 4;
    }
    v
}

/// O texto de uma mensagem, com os links em accent e clicáveis.
fn texto_msg(id: (SharedString, usize), texto: &str, t: &Tema) -> AnyElement {
    let faixas = links(texto);
    if faixas.is_empty() {
        return div().text_color(t.text_secondary).child(texto.to_string()).into_any_element();
    }
    let estilo = HighlightStyle { color: Some(t.accent), underline: Some(UnderlineStyle { thickness: px(1.), color: Some(t.accent), wavy: false }), ..Default::default() };
    let urls: Vec<String> = faixas.iter().map(|r| texto[r.clone()].to_string()).collect();
    let rico = StyledText::new(texto.to_string()).with_highlights(faixas.iter().map(|r| (r.clone(), estilo)));
    div()
        .text_color(t.text_secondary)
        .child(InteractiveText::new(id, rico).on_click(faixas, move |i, _, cx| cx.open_url(&urls[i])))
        .into_any_element()
}

fn conversa(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let fuso = fuso();
    // Mensagens do mesmo autor em até 120 s viram um bloco só (panel.js addMessage).
    struct Bloco {
        de: Option<String>,
        avatar: Avatar,
        nome: String,
        hora: SystemTime,
        textos: Vec<String>,
    }
    let mut blocos: Vec<Bloco> = Vec::new();
    for m in &c.chat {
        if let Some(b) = blocos.last_mut()
            && m.de.is_some()
            && b.de == m.de
            && !b.textos.is_empty()
            && m.hora.duration_since(b.hora).is_ok_and(|d| d.as_secs() < 120)
        {
            b.textos.push(m.texto.clone());
            b.hora = m.hora;
            continue;
        }
        let avatar = if m.minha { c.avatar.clone() } else { c.sala.pessoas.iter().find(|p| Some(&p.id) == m.de.as_ref()).map(|p| p.avatar.clone()).unwrap_or_default() };
        let nome = if m.minha { "Você".to_string() } else { m.nome.clone() };
        blocos.push(Bloco { de: m.de.clone(), avatar, nome, hora: m.hora, textos: if m.de.is_some() { vec![m.texto.clone()] } else { vec![] } });
        if m.de.is_none() {
            blocos.last_mut().unwrap().nome = m.texto.clone();
        }
    }
    // Segue o fim quando chega mensagem e quem lê já estava perto dele.
    let estado = &mut c.ui.painel;
    if c.chat.len() != estado.vistas {
        let perto = estado.rolagem.max_offset().height + estado.rolagem.offset().y < px(120.);
        if perto || estado.vistas == 0 {
            estado.rolagem.scroll_to_bottom();
        }
        estado.vistas = c.chat.len();
    }
    let primeira_hora = blocos.first().map(|b| b.hora);
    let lista = rolagem("conversa").track_scroll(&c.ui.painel.rolagem);
    let lista = if blocos.is_empty() {
        lista.child(vazio("message-square-text", vec!["Nenhuma mensagem ainda.", "As mensagens ficam só nesta sala e somem quando ela acaba."], t))
    } else {
        lista.children(blocos.into_iter().enumerate().map(|(i, b)| {
            if b.de.is_none() {
                return div().flex().justify_center().py(px(4.)).text_center().text_size(px(12.)).line_height(px(18.)).text_color(t.text_muted).child(b.nome).into_any_element();
            }
            let id: SharedString = format!("msg-{i}-{:?}", primeira_hora.map(|h| h.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis()))).into();
            div()
                .flex()
                .gap(px(12.))
                .text_size(px(13.))
                .line_height(px(19.5))
                .child(div().mt(px(2.)).child(avatar(&b.avatar, 30., t)))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .flex()
                                .items_baseline()
                                .gap(px(8.))
                                .mb(px(1.))
                                .child(div().font_weight(FontWeight::SEMIBOLD).text_color(t.text).child(b.nome))
                                .child(div().text_size(px(11.)).line_height(px(16.5)).text_color(t.text_muted).child(hora(b.hora, fuso))),
                        )
                        .children(b.textos.iter().enumerate().map(|(j, tx)| texto_msg((id.clone(), j), tx, t))),
                )
                .into_any_element()
        }))
    };

    // A caixa (`.composer`, app.css:1403).
    let focada = c.entrada_chat.focus_handle(cx).is_focused(window);
    let (cor_cursor, cor_dica) = (t.accent, rgb(0x757575).into());
    c.entrada_chat.update(cx, |e, _| {
        e.cor_cursor = cor_cursor;
        e.cor_dica = cor_dica;
    });
    let id_anexo: SharedString = "anexar".into();
    let anexar = com_dica(
        fantasma(id_anexo.clone(), "hard-drive", t).on_click(cx.listener(|c, _, _, cx| c.avisar("Mandar arquivos ainda não chegou ao app nativo.", cx))),
        c,
        &id_anexo,
        "Anexar arquivo",
        false,
        t,
        cx,
    );
    let caixa = div()
        .flex_1()
        .min_w_0()
        // O anel de foco (0 0 0 3px accent-soft) por fora da borda.
        .m(px(-3.))
        .p(px(3.))
        .rounded(px(raio::MD + 3.))
        .when(focada, |d| d.bg(t.accent_soft))
        .child(
            div()
                .h(px(47.))
                .px(px(12.))
                .rounded(px(raio::MD))
                .bg(t.surface_2)
                .border_1()
                .border_color(if focada { t.accent } else { t.border })
                .text_size(px(15.))
                .line_height(px(21.))
                .text_color(t.text)
                .child(c.entrada_chat.clone()),
        );
    let enviar = div()
        .id("enviar")
        .size(px(40.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(raio::MD))
        .bg(t.accent)
        .cursor_pointer()
        .child(icone_traco("send", 16., 2.1, t.accent_text))
        .on_click(cx.listener(|c, _, _, cx| {
            let texto = c.entrada_chat.read(cx).texto().trim().to_string();
            if !texto.is_empty() {
                c.mandar_chat(&texto, cx);
                c.entrada_chat.update(cx, |e, cx| e.definir("", cx));
            }
        }));
    div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .child(lista)
        .child(div().p(px(12.)).border_t_1().border_color(t.border_subtle).child(div().flex().items_end().gap(px(8.)).child(anexar).child(caixa).child(enviar)))
        .into_any_element()
}

/* ------------------------------ pessoas ------------------------------ */

/// "Fulano quer entrar" com as duas respostas (main.js mostrarBatida, `.knock`).
/// No app é um cartão flutuante no canto (top 64, right 16, 360 px); aqui
/// ele vai no topo de Pessoas até o desenho geral (ui/mod.rs) chamar esta
/// função na camada de cima.
pub fn batidas(c: &mut Chamada, t: &Tema, cx: &mut Context<Chamada>) -> Option<AnyElement> {
    if c.sala.porta.is_empty() || !c.sou_anfitriao() {
        return None;
    }
    let cartoes = c.sala.porta.clone().into_iter().map(|(id, nome)| {
        let (a, r) = (id.clone(), id.clone());
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(12.))
            .rounded(px(raio::LG))
            .bg(t.bg_elevated)
            .border_1()
            .border_color(t.border)
            .shadow(sombra_lg(t))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(avatar(&Avatar::Nenhum, 40., t))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .text_size(px(13.))
                            .line_height(px(19.5))
                            .child(div().font_weight(FontWeight::BOLD).truncate().child(nome))
                            .child(div().text_size(px(12.)).line_height(px(18.)).text_color(t.text_muted).child("quer entrar na sala")),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(botao_texto(format!("recusar-{id}"), None, "Recusar", false, 40., 15., t).on_click(cx.listener(move |c, _, _, cx| {
                        c.moderar("deny", &r);
                        c.sala.porta.retain(|(i, _)| *i != r);
                        cx.notify();
                    })))
                    .child(botao_texto(format!("admitir-{id}"), None, "Deixar entrar", true, 40., 15., t).on_click(cx.listener(move |c, _, _, cx| {
                        c.moderar("admit", &a);
                        c.sala.porta.retain(|(i, _)| *i != a);
                        cx.notify();
                    }))),
            )
    });
    Some(div().flex().flex_col().gap(px(8.)).children(cartoes).into_any_element())
}

fn pessoas(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let _ = window;
    let anfitriao = c.sou_anfitriao();
    let eu = c.eu().map(str::to_string);
    let mut lista = rolagem("pessoas").children(batidas(c, t, cx));

    if anfitriao {
        let algum_mic = c.sala.pessoas.iter().any(|p| Some(&p.id) != eu.as_ref() && p.mic);
        let trancada = c.sala.trancada;
        let id_trancar: SharedString = "trancar".into();
        let trancar = botao_texto(id_trancar.clone(), Some(if trancada { "lock" } else { "lock-open" }), if trancada { "Sala trancada" } else { "Trancar sala" }, false, 32., 12., t)
            .when(trancada, |d| d.text_color(t.accent))
            .on_click(cx.listener(move |c, _, _, _| c.moderar(if trancada { "unlock" } else { "lock" }, "")));
        let trancar = com_dica(trancar, c, &id_trancar, if trancada { "Ninguém novo entra. Clique para destrancar." } else { "Impede que mais alguém entre" }, false, t, cx);
        let todos = botao_texto("silenciar-todos", Some("mic-off"), "Silenciar todos", false, 32., 12., t)
            .when(!algum_mic, |d| d.opacity(0.45).cursor_not_allowed())
            .when(algum_mic, |d| {
                d.on_click(cx.listener(|c, _, _, cx| {
                    c.moderar("mute-all", "");
                    c.avisar("Todos foram silenciados", cx);
                }))
            });
        lista = lista.child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .mb(px(8.))
                .p(px(12.))
                .rounded(px(raio::MD))
                .bg(t.accent_2_soft)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .text_size(px(12.))
                        .line_height(px(18.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(icone_traco("crown", 16., 2.1, t.accent_2))
                        .child("Você é o anfitrião"),
                )
                .child(div().flex().flex_wrap().gap(px(8.)).child(todos).child(trancar)),
        );
    }

    // Mãos levantadas primeiro (a fila da reunião), depois a ordem da sala.
    let mut ordem: Vec<usize> = (0..c.sala.pessoas.len()).collect();
    ordem.sort_by_key(|&i| !c.sala.pessoas[i].mao);
    let fila: Vec<String> = ordem.iter().map(|&i| &c.sala.pessoas[i]).filter(|p| p.mao).map(|p| p.id.clone()).collect();
    for i in ordem {
        let p = c.sala.pessoas[i].clone();
        let eu_mesmo = Some(&p.id) == eu.as_ref();
        let mut sub: Vec<&str> = Vec::new();
        if eu_mesmo {
            sub.push("Você");
        }
        if p.anfitriao {
            sub.push("Anfitrião");
        }
        if !eu_mesmo {
            // Sem as estatísticas ainda: conectado é "medindo" (stats.js QUALITY_LABEL.unknown).
            sub.push(if c.conexoes.get(&p.id).map(String::as_str) == Some("Connected") { "Medindo a conexão" } else { "conectando…" });
        }
        let estado = |ligado: bool, sim: &'static str, nao: &'static str| icone_traco(if ligado { sim } else { nao }, 16., 2.1, if ligado { t.text_muted } else { t.danger });
        let icones = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .ml_auto()
            .child(estado(p.mic, "mic", "mic-off"))
            .child(estado(p.cam, "video", "video-off"))
            .when(p.tela, |d| d.child(icone_traco("screen-share", 16., 2.1, t.text_muted)))
            .when(p.mao, |d| {
                let pos = fila.iter().position(|f| *f == p.id).unwrap_or(0) + 1;
                d.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(2.))
                        .pl(px(4.))
                        .pr(px(6.))
                        .py(px(1.))
                        .rounded_full()
                        .bg(t.accent_2_soft)
                        .text_color(t.accent_2)
                        .text_size(px(11.))
                        .line_height(px(16.5))
                        .child(icone_traco("hand", 16., 2.1, t.accent_2))
                        .child(div().font_weight(FontWeight::SEMIBOLD).child(format!("{pos}º"))),
                )
            });
        let id_linha: SharedString = format!("pessoa-{}", p.id).into();
        let id_principal: SharedString = format!("principal-{}", p.id).into();
        let alvo = p.id.clone();
        let principal = div()
            .id(id_principal.clone())
            .flex()
            .items_center()
            .gap(px(12.))
            .flex_1()
            .min_w_0()
            .cursor_pointer()
            .child(avatar(&p.avatar, 36., t))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .min_w_0()
                            .text_size(px(13.))
                            .line_height(px(19.5))
                            .font_weight(FontWeight::MEDIUM)
                            .child(div().truncate().child(p.nome.clone()))
                            .when(p.anfitriao, |d| d.child(icone_traco("crown", 13., 2.1, t.accent_2))),
                    )
                    .child(div().text_size(px(11.)).line_height(px(16.5)).text_color(t.text_muted).child(sub.join(" · "))),
            )
            // Clicar em alguém o põe em destaque (panel.js onPerson; o perfil próprio ainda não veio).
            .when(!eu_mesmo, |d| {
                d.on_click(cx.listener(move |c, _, _, cx| {
                    c.fixado = Some(alvo.clone());
                    cx.notify();
                }))
            });
        let principal = com_dica(principal, c, &id_principal, if eu_mesmo { "Editar perfil" } else { "Ver em destaque" }, false, t, cx);
        let mut linha = div()
            .id(id_linha.clone())
            .flex()
            .flex_wrap()
            .items_center()
            .gap_x(px(12.))
            .gap_y(px(2.))
            .p(px(8.))
            .rounded(px(raio::MD))
            .group(id_linha.clone())
            .hover(|s| s.bg(t.surface_2))
            .child(principal)
            .child(icones);
        if anfitriao && !eu_mesmo {
            let acao = |chave: &'static str, ic: &'static str, rotulo: &'static str, perigo: bool, desligado: bool| {
                let id: SharedString = format!("{chave}:{}", p.id).into();
                let (cor_hover, fundo_hover) = if perigo { (t.danger, t.danger.opacity(0.16)) } else { (t.text, t.surface_3) };
                let b = div()
                    .id(id.clone())
                    .group(id.clone())
                    .relative()
                    .size(px(28.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(raio::SM))
                    .when(desligado, |d| d.opacity(0.35))
                    .when(!desligado, |d| d.cursor_pointer().hover(move |s| s.bg(fundo_hover)))
                    .child(icone_traco(ic, 16., 2.1, t.text_muted).when(!desligado, |s| s.group_hover(id.clone(), move |s| s.text_color(cor_hover))));
                (id, b, rotulo)
            };
            let nome = p.nome.clone();
            // Meio apagados até o mouse chegar na linha (app.css .person__acoes).
            let mut acoes = div().flex().gap(px(2.)).flex_basis(relative(1.)).pl(px(48.)).opacity(0.6).group_hover(id_linha.clone(), |s| s.opacity(1.));
            let mut botoes = Vec::new();
            if p.mao {
                let alvo = p.id.clone();
                let (id, b, r) = acao("baixar-mao", "hand", "Baixar a mão", false, false);
                botoes.push((id, b.on_click(cx.listener(move |c, _, _, _| c.moderar("lower-hand", &alvo))), r));
            }
            let (alvo, n) = (p.id.clone(), nome.clone());
            let (id, b, r) = acao("silenciar", "mic-off", "Silenciar", false, !p.mic);
            let b = if p.mic {
                b.on_click(cx.listener(move |c, _, _, cx| {
                    c.moderar("mute", &alvo);
                    c.avisar(format!("Pedido enviado: {n} foi silenciado"), cx);
                }))
            } else {
                b
            };
            botoes.push((id, b, r));
            let (alvo, n) = (p.id.clone(), nome.clone());
            let (id, b, r) = acao("desligar-cam", "video-off", "Desligar câmera", false, !p.cam);
            let b = if p.cam {
                b.on_click(cx.listener(move |c, _, _, cx| {
                    c.moderar("cam-off", &alvo);
                    c.avisar(format!("Câmera de {n} desligada"), cx);
                }))
            } else {
                b
            };
            botoes.push((id, b, r));
            let (alvo, n) = (p.id.clone(), nome.clone());
            let (id, b, r) = acao("remover", "user-x", "Remover da sala", true, false);
            // Remover é definitivo nesta sala: pede confirmação (main.js confirmKick).
            botoes.push((
                id,
                b.on_click(cx.listener(move |_, _, w, cx| {
                    let resposta = w.prompt(
                        PromptLevel::Warning,
                        &format!("Remover {n}?"),
                        Some("A pessoa sai da chamada na hora e não consegue voltar pelo mesmo aparelho — até você deixar, em Pessoas → Removidos."),
                        &["Remover", "Cancelar"],
                        cx,
                    );
                    let alvo = alvo.clone();
                    cx.spawn(async move |c, cx| {
                        if resposta.await == Ok(0) {
                            let _ = c.update(cx, |c, _| c.moderar("kick", &alvo));
                        }
                    })
                    .detach();
                })),
                r,
            ));
            for (id, b, r) in botoes {
                acoes = acoes.child(com_dica(b, c, &id, r, false, t, cx));
            }
            linha = linha.child(acoes);
        }
        lista = lista.child(linha);
    }
    lista.into_any_element()
}

/* ------------------------------ transcrição ------------------------------ */

fn transcricao(c: &mut Chamada, t: &Tema, window: &mut Window, cx: &mut Context<Chamada>) -> AnyElement {
    let busca = c.ui.painel.busca.get_or_insert_with(|| cx.new(|cx| Entrada::nova("Buscar no que foi dito…", cx))).clone();
    let focada = busca.focus_handle(cx).is_focused(window);
    let buscando = !busca.read(cx).texto().trim().is_empty();
    let (dica_cor, cursor) = (t.text_muted, t.accent);
    busca.update(cx, |e, _| {
        e.cor_dica = dica_cor;
        e.cor_cursor = cursor;
    });
    let campo = div()
        .relative()
        .flex_1()
        .min_w_0()
        .m(px(-3.))
        .p(px(3.))
        .rounded(px(raio::MD + 3.))
        .when(focada, |d| d.bg(t.accent_soft))
        .child(
            div()
                .relative()
                .h(px(34.))
                .pl(px(32.))
                .pr(px(16.))
                .rounded(px(raio::MD))
                .bg(t.bg_elevated)
                .border_1()
                .border_color(if focada { t.accent } else { t.border })
                .when(!focada, |d| d.hover(|s| s.border_color(t.border_strong)))
                .text_size(px(13.))
                .text_color(t.text)
                .child(busca)
                .child(div().absolute().left(px(10.)).top_0().bottom_0().flex().items_center().child(icone_traco("search", 16., 2.1, t.text_muted))),
        );
    let mut acoes = div().flex().gap(px(2.));
    for (chave, ic, rotulo) in [("copiar", "copy", "Copiar tudo"), ("baixar-txt", "download", "Baixar (.txt)"), ("baixar-srt", "captions", "Baixar como legenda (.srt)")] {
        let id: SharedString = chave.into();
        let b = fantasma(id.clone(), ic, t).on_click(cx.listener(|c, _, _, cx| c.avisar("Nada foi legendado nesta chamada ainda.", cx)));
        acoes = acoes.child(com_dica(b, c, &id, rotulo, true, t, cx));
    }
    let texto = if buscando { "Nada encontrado com esse termo." } else { "Quando alguém ligar a legenda (tecla T), o que for dito aparece aqui, com nome e horário." };
    div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .child(div().flex().items_center().gap(px(8.)).py(px(8.)).px(px(12.)).border_b_1().border_color(t.border).child(campo).child(acoes))
        .child(
            div().id("transcricao").flex_1().min_h_0().overflow_y_scroll().p(px(12.)).flex().flex_col().gap(px(12.)).child(
                div()
                    .m_auto()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .py(px(24.))
                    .text_center()
                    .text_size(px(13.))
                    .line_height(px(19.5))
                    .text_color(t.text_muted)
                    .child(icone_traco("captions", 24., 2., t.text_muted))
                    .child(texto),
            ),
        )
        .into_any_element()
}

/* ------------------------------ qualidade ------------------------------ */

fn qualidade(c: &mut Chamada, t: &Tema) -> AnyElement {
    let mut ids: Vec<&String> = c.conexoes.keys().collect();
    ids.sort();
    if ids.is_empty() {
        return rolagem("qualidade").child(vazio("activity", vec!["Nenhuma conexão para medir ainda."], t)).into_any_element();
    }
    // Sem as estatísticas (ainda não vieram): o grupo de cada pessoa com o
    // estado da conexão e os valores que o app mostra antes da primeira medida.
    let grupos = ids.into_iter().map(|id| {
        let pessoa = c.sala.pessoas.iter().find(|p| &p.id == id);
        let conectado = c.conexoes.get(id).map(String::as_str) == Some("Connected");
        let linha = |k: &'static str, v: &'static str, primeira: bool, ultima: bool| {
            div()
                .flex()
                .justify_between()
                .gap(px(12.))
                .px(px(12.))
                .pt(px(if primeira { 8. } else { 4. }))
                .pb(px(if ultima { 8. } else { 4. }))
                .text_size(px(12.))
                .line_height(px(18.))
                .child(div().text_color(t.text_muted).child(k))
                .child(div().font_family("Cascadia Code").text_color(t.text).child(v))
        };
        div()
            .border_1()
            .border_color(t.border_subtle)
            .rounded(px(raio::MD))
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(8.))
                    .bg(t.surface_2)
                    .text_size(px(12.))
                    .line_height(px(18.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(avatar(&pessoa.map(|p| p.avatar.clone()).unwrap_or_default(), 20., t))
                    .child(pessoa.map(|p| p.nome.clone()).unwrap_or_else(|| "Participante".into()))
                    .child(div().flex_1())
                    .child(
                        div()
                            .px(px(8.))
                            .py(px(2.))
                            .rounded_full()
                            .border_1()
                            .border_color(t.border_subtle)
                            .bg(t.surface_2)
                            .text_size(px(11.))
                            .line_height(px(16.5))
                            .text_color(t.text_secondary)
                            .whitespace_nowrap()
                            .child(if conectado { "Medindo a conexão" } else { "—" }),
                    ),
            )
            .child(linha("Atraso", "—", true, false))
            .child(linha("Dados perdidos", "—", false, false))
            .child(linha("Internet disponível", "—", false, true))
    });
    rolagem("qualidade").children(grupos).into_any_element()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn links_como_o_linkify() {
        let t = "veja https://vcall.app/x?a=1 e HTTP://a.b, não xhttp://c nem http://";
        let v: Vec<&str> = links(t).into_iter().map(|r| &t[r]).collect();
        assert_eq!(v, ["https://vcall.app/x?a=1", "HTTP://a.b,"]);
    }

    #[test]
    fn hora_com_fuso() {
        let h = UNIX_EPOCH + std::time::Duration::from_secs(13 * 3600 + 5 * 60);
        assert_eq!(hora(h, -3 * 3600), "10:05");
        assert_eq!(hora(h, 12 * 3600), "01:05");
    }
}
