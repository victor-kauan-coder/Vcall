//! Avatares exatamente como o app desenha: o crate `vcall-avatares` roda o
//! próprio JS do app (DiceBear + paisagens) e devolve o SVG; aqui ele vira uma
//! imagem do GPUI. Fotos (data URL) também.
//!
//! O gerador é da thread da interface (o QuickJS não muda de thread) e cada
//! {estilo, semente} é desenhado uma vez só.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use gpui::{Image, ImageFormat};

use crate::sala::Avatar;

thread_local! {
    static GERADOR: RefCell<Option<vcall_avatares::Avatares>> = const { RefCell::new(None) };
    static PRONTOS: RefCell<HashMap<String, Option<Arc<Image>>>> = RefCell::new(HashMap::new());
}

fn com_gerador<T>(f: impl FnOnce(&vcall_avatares::Avatares) -> T) -> Option<T> {
    GERADOR.with(|g| {
        let mut g = g.borrow_mut();
        if g.is_none() {
            match vcall_avatares::Avatares::novo() {
                Ok(a) => *g = Some(a),
                Err(e) => {
                    eprintln!("[avatares] {e}");
                    return None;
                }
            }
        }
        g.as_ref().map(f)
    })
}

/// A imagem do avatar (None: sem avatar; quem desenha põe a inicial).
pub fn imagem(avatar: &Avatar) -> Option<Arc<Image>> {
    let chave = match avatar {
        Avatar::Nenhum => return None,
        Avatar::Gerado { estilo, semente } => format!("g:{estilo}:{semente}"),
        Avatar::Foto(f) => format!("f:{}", f.len()) + &f[f.len().saturating_sub(64)..],
    };
    PRONTOS.with(|p| {
        if let Some(i) = p.borrow().get(&chave) {
            return i.clone();
        }
        let img = match avatar {
            Avatar::Gerado { estilo, semente } => com_gerador(|g| g.svg(estilo, semente)).flatten().map(|s| Arc::new(Image::from_bytes(ImageFormat::Svg, s.into_bytes()))),
            Avatar::Foto(f) => foto(f),
            Avatar::Nenhum => None,
        };
        p.borrow_mut().insert(chave, img.clone());
        img
    })
}

/// "data:image/png;base64,...." -> imagem.
fn foto(data_url: &str) -> Option<Arc<Image>> {
    use base64::Engine;
    let (cab, dados) = data_url.strip_prefix("data:")?.split_once(";base64,")?;
    let formato = match cab {
        "image/png" => ImageFormat::Png,
        "image/jpeg" | "image/jpg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::Webp,
        "image/gif" => ImageFormat::Gif,
        _ => return None,
    };
    let bytes = base64::engine::general_purpose::STANDARD.decode(dados).ok()?;
    Some(Arc::new(Image::from_bytes(formato, bytes)))
}

/// O avatar que o app dá a quem chega pela primeira vez (uma paisagem).
pub fn padrao() -> Avatar {
    let semente = vcall_avatares::semente_aleatoria();
    let estilo = com_gerador(|g| g.estilo_padrao(&semente)).unwrap_or_else(|| "paisagemMontanha".into());
    Avatar::Gerado { estilo, semente }
}

/// Os estilos da grade de escolha, na ordem do app (paisagens primeiro).
pub fn estilos() -> Vec<String> {
    com_gerador(|g| g.estilos()).unwrap_or_default()
}

/// A inicial do nome (quando não há avatar), como o app.
pub fn inicial(nome: &str) -> String {
    nome.trim().chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_else(|| "?".into())
}
