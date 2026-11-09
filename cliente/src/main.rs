//! vcall-nativo: o cliente do Vcall em GPUI, sem navegador dentro.
//!
//! Fases (cliente/README.md):
//!   G1  abre o link de uma sala, entra pelo mesmo protocolo dos navegadores
//!       (src/protocol.js) e mostra quem está lá, ao vivo;
//!   G2  WebRTC com cada pessoa (rtc.rs): ouve o som e mostra câmera e tela;
//!   G3  manda microfone, câmera e tela (local.rs; a tela pelo vcall-midia);
//!   G4  a chamada inteira, com a mesma cara do app (chamada.rs + ui/).
//!
//!   vcall-nativo http://maquina:7718/#nome-da-sala [--nome "Seu nome"]
//!       [--ligar mic,cam,tela] [--tela-janela HWND] [--teste]
//!
//!   --nome         entra direto, sem o saguão
//!   --ligar        já entra com estes ligados
//!   --tela-janela  transmite esta janela no lugar da tela inteira
//!   --teste        fontes sintéticas (um tom e um padrão) no lugar do
//!                  microfone e da câmera de verdade — para os testes
//!
//! Variáveis: VCALL_NATIVO_LOG (log para os testes), VCALL_NATIVO_ROTEIRO
//! (comandos pela entrada padrão), VCALL_NATIVO_FUNDO (teste em segundo
//! plano: sem janela à vista e sem som), VCALL_RTC_LOG (log do libwebrtc),
//! VCALL_CA (um .pem a mais em que confiar), VCALL_MIDIA (o motor).

mod chamada;
mod entrada;
mod func;
mod local;
mod recursos;
mod rtc;
mod sala;
mod sinalizacao;
mod som;
mod ui;

use gpui::{App, Application, Bounds, TitlebarOptions, WindowBounds, WindowOptions, prelude::*, px, size};

use chamada::{Chamada, Opcoes};
use sala::Avatar;
use ui::saguao::{Destino, Saguao};

/// VCALL_RTC_LOG=1: o log do libwebrtc na saída de erro (diagnóstico).
struct LogDoRtc;
impl log::Log for LogDoRtc {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, r: &log::Record) {
        eprintln!("[{}] {}", r.target(), r.args());
    }
    fn flush(&self) {}
}

/// Põe a janela fora da tela e a mostra sem foco (fotos de comparação).
/// `SetWindowPos`, e não a posição da criação: o Windows puxa de volta para o
/// monitor uma janela criada fora dele.
fn fora_da_tela(janela: gpui::AnyWindowHandle, cx: &mut App) {
    let _ = janela.update(cx, |_, window, _| {
        #[cfg(windows)]
        {
            use raw_window_handle::{HasWindowHandle, RawWindowHandle};
            #[link(name = "user32")]
            unsafe extern "system" {
                fn SetWindowPos(hwnd: isize, depois: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
                fn ShowWindow(hwnd: isize, modo: i32) -> i32;
            }
            if let Ok(h) = window.window_handle()
                && let RawWindowHandle::Win32(w) = h.as_raw()
            {
                let hwnd = w.hwnd.get();
                // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE; SW_SHOWNOACTIVATE.
                unsafe {
                    SetWindowPos(hwnd, 0, -4000, 0, 0, 0, 0x0001 | 0x0004 | 0x0010);
                    ShowWindow(hwnd, 4);
                }
                eprintln!("hwnd {hwnd}");
            }
        }
    });
}

fn main() {
    if std::env::var_os("VCALL_RTC_LOG").is_some() {
        let _ = log::set_logger(&LogDoRtc).map(|()| log::set_max_level(log::LevelFilter::Debug));
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let valor = |nome: &str| args.iter().position(|a| a == nome).and_then(|i| args.get(i + 1)).cloned();
    let nome = valor("--nome");
    let opcoes = Opcoes {
        teste: args.iter().any(|a| a == "--teste"),
        alvo_tela: match valor("--tela-janela") {
            Some(h) => vec!["--janela".into(), h],
            None => vec!["--tela".into(), "0".into()],
        },
        ligar: valor("--ligar").map(|l| l.split(',').map(str::to_string).collect()).unwrap_or_default(),
    };
    let Some((ws, sala_id)) = args.first().and_then(|l| sala::ler_link(l)) else {
        eprintln!("uso: vcall-nativo http://maquina:7718/#nome-da-sala [--nome \"Seu nome\"]");
        std::process::exit(2);
    };
    // STUN/TURN da sala antes da janela: o primeiro par nasce logo depois do welcome.
    let ice = rtc::ice_da_sala(&ws);
    Application::new().with_assets(recursos::Recursos).run(move |cx: &mut App| {
        recursos::carregar_fontes(cx);
        cx.bind_keys(entrada::teclas());
        // O tamanho e o mínimo da janela do app de mesa (desktop/main.js).
        // VCALL_NATIVO_FUNDO: teste em segundo plano. A janela nem aparece (fora
        // da tela não basta: o Windows a puxa de volta para o monitor) e não toca
        // som; quem testa fecha a entrada padrão para o cliente sair.
        let fundo = chamada::em_segundo_plano();
        // VCALL_NATIVO_FOTO: a janela existe e desenha (o motor captura só ela),
        // mas fora da tela e sem foco: quem usa o computador não a vê.
        let foto = std::env::var_os("VCALL_NATIVO_FOTO").is_some();
        let bounds = Bounds::centered(None, size(px(1360.), px(860.)), cx);
        let janela = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            focus: !fundo && !foto,
            show: !fundo && !foto,
            window_min_size: Some(size(px(900.), px(600.))),
            // Barra de título desenhada pelo app, como o Electron (titleBarStyle "hidden").
            titlebar: Some(TitlebarOptions { title: Some("Vcall".into()), appears_transparent: true, ..Default::default() }),
            ..Default::default()
        };
        let destino = Destino { ws, sala_id, ice, opcoes };
        let aberta = match nome {
            // --nome: direto para a chamada (testes, atalhos).
            Some(nome) => {
                let avatar = Avatar::Gerado { estilo: "paisagemMontanha".into(), semente: sala::token() };
                cx.open_window(janela, |_, cx| cx.new(|cx| Chamada::nova(destino.ws, destino.sala_id, nome, avatar, destino.ice, destino.opcoes, cx))).map(gpui::AnyWindowHandle::from)
            }
            None => cx.open_window(janela, |window, cx| cx.new(|cx| Saguao::novo(destino, window, cx))).map(gpui::AnyWindowHandle::from),
        };
        let aberta = aberta.expect("abrir a janela");
        if foto {
            fora_da_tela(aberta, cx);
        }
        // Fechar a janela fecha o app (no Windows e no Linux ele seguiria vivo).
        cx.on_window_closed(|cx| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        if !fundo && !foto {
            cx.activate(true);
        }
    });
}
