//! "Janela flutuante" (o picture-in-picture do ladrilho): uma janelinha por
//! cima dos outros programas com o vídeo daquele ladrilho.

use gpui::{
    Bounds, Context, Entity, ImageSource, ObjectFit, Subscription, TitlebarOptions, Window, WindowBounds, WindowOptions, div, img, prelude::*, px, size,
};

use crate::chamada::Chamada;

pub struct Flutuante {
    chamada: Entity<Chamada>,
    chave: String,
    _obs: Subscription,
}

/// "eu:cam" / "<id>:tela" -> a chave de `Chamada::quadros`.
fn quadro_de(c: &Chamada, chave: &str) -> Option<std::sync::Arc<gpui::RenderImage>> {
    let (quem, tipo) = chave.split_once(':')?;
    let id = if quem == "eu" { c.eu().unwrap_or("").to_string() } else { quem.to_string() };
    c.quadros.get(&(id, if tipo == "tela" { "screen" } else { "cam" }.to_string())).cloned()
}

pub fn abrir(chave: &str, cx: &mut Context<Chamada>) {
    let chamada = cx.entity();
    let chave = chave.to_string();
    let titulo = format!("Vcall · {}", chave.split_once(':').map_or("", |(q, _)| q));
    let opcoes = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(480.), px(270.)), cx))),
        titlebar: Some(TitlebarOptions { title: Some(titulo.into()), ..Default::default() }),
        window_min_size: Some(size(px(160.), px(90.))),
        ..Default::default()
    };
    let _ = cx.open_window(opcoes, move |window, cx| {
        por_cima(window);
        cx.new(|cx: &mut Context<Flutuante>| Flutuante { _obs: cx.observe(&chamada, |_, _, cx| cx.notify()), chamada, chave })
    });
}

/// Sempre por cima, como o picture-in-picture do navegador.
fn por_cima(window: &Window) {
    #[cfg(windows)]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        #[link(name = "user32")]
        unsafe extern "system" {
            fn SetWindowPos(hwnd: isize, depois: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        }
        if let Ok(h) = HasWindowHandle::window_handle(window)
            && let RawWindowHandle::Win32(w) = h.as_raw()
        {
            // HWND_TOPMOST; SWP_NOMOVE | SWP_NOSIZE.
            unsafe { SetWindowPos(w.hwnd.get(), -1, 0, 0, 0, 0, 0x0002 | 0x0001) };
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

impl Render for Flutuante {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let quadro = quadro_de(self.chamada.read(cx), &self.chave);
        div().size_full().bg(gpui::black()).children(quadro.map(|q| img(ImageSource::Render(q)).size_full().object_fit(ObjectFit::Contain)))
    }
}

