//! A prévia da antessala (lobby.js #startPreview, #medirSom, #renderDevices):
//! câmera, nível do microfone e a lista de aparelhos; e a foto de perfil
//! (photo.js). Com --teste tudo é sintético: nenhum teste liga a webcam ou o
//! microfone de verdade, nem lista os aparelhos de quem roda.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use futures::channel::mpsc::UnboundedSender;
use gpui::RenderImage;

/// A câmera da prévia. Os quadros chegam já recortados na proporção da
/// caixa (`proporcao`, largura/altura) e espelhados, como o `scaleX(-1)` do app.
pub struct Camera {
    parar: Arc<AtomicBool>,
    pub proporcao: Arc<AtomicU32>,
}

impl Drop for Camera {
    fn drop(&mut self) {
        self.parar.store(true, Ordering::Relaxed);
    }
}

pub fn camera(teste: bool, indice: usize, tx: UnboundedSender<Arc<RenderImage>>) -> Camera {
    let parar = Arc::new(AtomicBool::new(false));
    let proporcao = Arc::new(AtomicU32::new(1f32.to_bits()));
    let (p, prop) = (parar.clone(), proporcao.clone());
    std::thread::spawn(move || {
        let enviar = |w: u32, h: u32, rgba: &[u8]| tx.unbounded_send(Arc::new(recortar(w, h, rgba, f32::from_bits(prop.load(Ordering::Relaxed))))).is_ok();
        if teste {
            // O mesmo desenho da câmera falsa do Chromium (a do app web nos
            // testes): fundo verde e uma pizza que cresce a partir das 3 h.
            let (w, h) = (640u32, 480u32);
            let inicio = Instant::now();
            let mut buf = vec![0u8; (w * h * 4) as usize];
            while !p.load(Ordering::Relaxed) {
                let varre = (inicio.elapsed().as_secs_f32() % 2.) / 2. * std::f32::consts::TAU;
                for y in 0..h {
                    for x in 0..w {
                        let (dx, dy) = (x as f32 - w as f32 / 2., y as f32 - h as f32 / 2.);
                        let dentro = dx * dx + dy * dy <= (h as f32 / 4.).powi(2) && dy.atan2(dx).rem_euclid(std::f32::consts::TAU) <= varre;
                        let i = ((y * w + x) * 4) as usize;
                        buf[i..i + 4].copy_from_slice(if dentro { &[74, 255, 22, 255] } else { &[0, 135, 0, 255] });
                    }
                }
                if !enviar(w, h, &buf) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(33));
            }
        } else {
            use nokhwa::pixel_format::RgbAFormat;
            use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
            let pedido = RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
            let mut cam = match nokhwa::Camera::new(CameraIndex::Index(indice as u32), pedido) {
                Ok(c) => c,
                Err(e) => return eprintln!("[prévia] {e}"),
            };
            if let Err(e) = cam.open_stream() {
                return eprintln!("[prévia] {e}");
            }
            while !p.load(Ordering::Relaxed) {
                let Ok(q) = cam.frame() else { continue };
                let Ok(rgba) = q.decode_image::<RgbAFormat>() else { continue };
                if !enviar(rgba.width(), rgba.height(), rgba.as_raw()) {
                    break;
                }
            }
            let _ = cam.stop_stream();
        }
    });
    Camera { parar, proporcao }
}

/// Recorta pelo centro na proporção `a` (object-fit: cover), espelha e passa a BGRA.
fn recortar(w: u32, h: u32, rgba: &[u8], a: f32) -> RenderImage {
    let a = if a.is_finite() && a > 0. { a } else { w as f32 / h as f32 };
    let (cw, ch) = if w as f32 / h as f32 > a { (((h as f32 * a).round() as u32).clamp(1, w), h) } else { (w, ((w as f32 / a).round() as u32).clamp(1, h)) };
    let (x0, y0) = ((w - cw) / 2, (h - ch) / 2);
    let mut out = vec![0u8; (cw * ch * 4) as usize];
    for y in 0..ch {
        for x in 0..cw {
            let s = (((y0 + y) * w + (x0 + cw - 1 - x)) * 4) as usize;
            let d = ((y * cw + x) * 4) as usize;
            out[d..d + 4].copy_from_slice(&[rgba[s + 2], rgba[s + 1], rgba[s], 255]);
        }
    }
    RenderImage::new(vec![image::Frame::new(image::RgbaImage::from_raw(cw, ch, out).expect("tamanho"))])
}

/// O microfone da prévia: só o nível (RMS da onda, como o VoiceActivity).
pub struct Microfone {
    nivel: Arc<AtomicU32>,
    teste: Option<Instant>,
    _fluxo: Option<cpal::Stream>,
}

impl Microfone {
    pub fn nivel(&self) -> f32 {
        match self.teste {
            // A falsa do Chromium apita baixinho: uns poucos segmentos acesos.
            Some(t) => 0.022 + 0.008 * (t.elapsed().as_secs_f32() * 2.1).sin(),
            None => f32::from_bits(self.nivel.load(Ordering::Relaxed)),
        }
    }
}

pub fn microfone(teste: bool, indice: usize) -> Microfone {
    let nivel = Arc::new(AtomicU32::new(0));
    let fluxo = if teste { None } else { abrir_mic(indice, nivel.clone()).map_err(|e| eprintln!("[prévia] microfone: {e}")).ok() };
    Microfone { nivel, teste: teste.then(Instant::now), _fluxo: fluxo }
}

fn abrir_mic(indice: usize, nivel: Arc<AtomicU32>) -> Result<cpal::Stream, String> {
    use cpal::traits::{DeviceTrait, StreamTrait};
    let host = cpal::default_host();
    let disp = microfones(&host).into_iter().nth(indice).ok_or("nenhum microfone")?;
    let cfg = disp.default_input_config().map_err(|e| e.to_string())?;
    let rms = move |s: &mut dyn Iterator<Item = f32>| {
        let (mut soma, mut n) = (0f32, 0usize);
        for v in s {
            soma += v * v;
            n += 1;
        }
        if n > 0 {
            nivel.store((soma / n as f32).sqrt().to_bits(), Ordering::Relaxed);
        }
    };
    let erro = |e| eprintln!("[prévia] microfone: {e}");
    let fluxo = match cfg.sample_format() {
        cpal::SampleFormat::F32 => disp.build_input_stream(cfg.config(), move |d: &[f32], _: &cpal::InputCallbackInfo| rms(&mut d.iter().copied()), erro, None),
        cpal::SampleFormat::I16 => disp.build_input_stream(cfg.config(), move |d: &[i16], _: &cpal::InputCallbackInfo| rms(&mut d.iter().map(|v| *v as f32 / 32768.)), erro, None),
        f => return Err(format!("formato {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    fluxo.play().map_err(|e| e.to_string())?;
    Ok(fluxo)
}

/// Os microfones com o padrão do sistema primeiro (o "Padrão" do navegador).
fn microfones(host: &cpal::Host) -> Vec<cpal::Device> {
    use cpal::traits::HostTrait;
    let padrao = host.default_input_device().map(|d| d.to_string());
    let mut todos: Vec<cpal::Device> = host.input_devices().map(|i| i.collect()).unwrap_or_default();
    todos.sort_by_key(|d| Some(d.to_string()) != padrao);
    todos
}

/// (microfones, câmeras) pelo nome. No teste, os aparelhos falsos do Chromium.
pub fn aparelhos(teste: bool) -> (Vec<String>, Vec<String>) {
    if teste {
        return (vec!["Fake Default Audio Input".into(), "Fake Audio Input 1".into(), "Fake Audio Input 2".into()], vec!["fake_device_0".into()]);
    }
    let mics = microfones(&cpal::default_host()).iter().map(|d| d.to_string()).collect();
    let cams = nokhwa::query(nokhwa::utils::ApiBackend::Auto).map(|v| v.iter().map(|c| c.human_name()).collect()).unwrap_or_default();
    (mics, cams)
}

/// A foto como o app manda (photo.js): quadrada pelo centro, 256×256, JPEG
/// até caber em 48 kB. Devolve (data URL, bytes).
pub fn foto(caminho: &std::path::Path) -> Result<(String, usize), String> {
    use base64::Engine;
    let bytes = std::fs::read(caminho).map_err(|_| "Não foi possível ler a imagem.".to_string())?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("Imagem grande demais. Use uma foto de até 25 MB.".into());
    }
    let img = image::load_from_memory(&bytes).map_err(|_| "Selecione um arquivo de imagem.".to_string())?;
    let lado = img.width().min(img.height());
    let img = img.crop_imm((img.width() - lado) / 2, (img.height() - lado) / 2, lado, lado).resize_exact(256, 256, image::imageops::FilterType::Triangle).to_rgb8();
    for q in [82u8, 70, 60, 50, 40] {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, q).encode_image(&img).map_err(|e| e.to_string())?;
        if jpeg.len() <= 48 * 1024 {
            return Ok((format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&jpeg)), jpeg.len()));
        }
    }
    Err("Não foi possível reduzir essa imagem.".into())
}

#[cfg(test)]
mod testes {
    #[test]
    fn recorte_espelhado_na_proporcao() {
        // 4x2, pede quadrado: fica o miolo 2x2, espelhado, em BGRA.
        let mut rgba = Vec::new();
        for y in 0..2u8 {
            for x in 0..4u8 {
                rgba.extend_from_slice(&[x, y, 9, 255]);
            }
        }
        let img = super::recortar(4, 2, &rgba, 1.);
        let b = img.as_bytes(0).unwrap();
        assert_eq!(img.size(0).width.0, 2);
        // primeiro pixel = x=2 do original (espelho de 1..=2), em BGRA: [9, y, x, 255]
        assert_eq!(&b[..4], &[9, 0, 2, 255]);
    }
}
