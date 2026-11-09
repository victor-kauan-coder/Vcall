//! O que este cliente manda (fase G3): microfone, câmera e tela.
//!
//! Cada fonte vira uma trilha do libwebrtc que a malha (rtc.rs) põe nos
//! senders de cada pessoa:
//!   - microfone: cpal -> processamento de áudio do libwebrtc (cancelamento
//!     do eco do som que o próprio cliente toca, supressão de ruído, ganho)
//!     -> NativeAudioSource;
//!   - câmera: nokhwa (Media Foundation, V4L2, AVFoundation) -> NV12;
//!   - tela: o vcall-midia captura e codifica H.264 na placa e os quadros
//!     entram prontos (NativeVideoSource codificado); o libwebrtc devolve os
//!     pedidos de quadro-chave e de banda, que voltam ao motor.
//!
//! Para os testes há fontes sintéticas (um tom e um padrão animado): nenhum
//! teste liga a webcam ou o microfone de verdade de quem roda.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::channel::mpsc::UnboundedSender;
use libwebrtc::audio_source::native::NativeAudioSource;
use libwebrtc::native::apm::AudioProcessingModule;
use libwebrtc::native::yuv_helper;
use libwebrtc::peer_connection_factory::native::PeerConnectionFactoryExt;
use libwebrtc::prelude::*;
use libwebrtc::video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame};
use libwebrtc::video_source::native::NativeVideoSource;

use crate::sinalizacao::Evento;

/// O processamento de áudio é compartilhado entre o microfone (process_stream)
/// e a saída de som (process_reverse_stream, em som.rs): é o som que sai que
/// ele tira do microfone.
pub struct Apm(pub AudioProcessingModule);
// O AudioProcessingModule do libwebrtc é seguro entre threads; o crate só não diz.
unsafe impl Send for Apm {}
pub type ApmCompartilhado = Arc<Mutex<Apm>>;

pub fn novo_apm() -> ApmCompartilhado {
    Arc::new(Mutex::new(Apm(AudioProcessingModule::new(true, true, true, true))))
}

/// O crate põe uma tarefa Tokio em cada fonte de vídeo crua (quadros pretos
/// até o primeiro de verdade): um runtime pequeno só para isso.
fn tokio() -> &'static tokio::runtime::Runtime {
    static RT: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_time().build().expect("runtime do tokio"))
}

/// Para todas as fontes: o laço que gera ou lê os quadros olha este sinal.
#[derive(Clone, Default)]
pub struct Parar(Arc<AtomicBool>);
impl Parar {
    pub fn agora(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    fn pediu(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/* ------------------------------------------------------------------ *
 * Microfone
 * ------------------------------------------------------------------ */

pub struct Microfone {
    pub track: RtcAudioTrack,
    pub parar: Parar,
    /// Nível de voz (RMS 0..1, depois do processamento), em bits de f32: o
    /// mesmo número que o analisador do navegador dá (core/vad.js).
    pub nivel: Arc<std::sync::atomic::AtomicU32>,
    _entrada: Option<cpal::Stream>,
}

impl Drop for Microfone {
    fn drop(&mut self) {
        self.parar.agora();
    }
}

/// O microfone (ou, com `teste`, um tom de 440 Hz) já processado.
pub fn microfone(fabrica: &PeerConnectionFactory, apm: ApmCompartilhado, teste: bool) -> Result<Microfone, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let parar = Parar::default();
    let (tx, rx) = mpsc::channel::<Vec<i16>>();
    let (entrada, taxa, canais) = if teste {
        let (p, tx) = (parar.clone(), tx.clone());
        std::thread::spawn(move || {
            // Rajadas de 250 ms com pausas e altura variando, como sílabas: um
            // tom parado a supressão de ruído trata como ruído e abafa.
            let (mut fase, mut n) = (0f32, 0u64);
            while !p.pediu() {
                let bloco: Vec<i16> = (0..480)
                    .map(|_| {
                        n += 1;
                        let silaba = n / 19_200; // 400 ms: 250 de som, 150 de pausa
                        let tocando = n % 19_200 < 12_000;
                        let freq = [220.0, 330.0, 277.0, 440.0][(silaba % 4) as usize];
                        fase += 2.0 * std::f32::consts::PI * freq / 48_000.0;
                        if tocando { (fase.sin() * 0.4 * 32767.0) as i16 } else { 0 }
                    })
                    .collect();
                if tx.send(bloco).is_err() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        (None, 48_000u32, 1u32)
    } else {
        let disp = cpal::default_host().default_input_device().ok_or("nenhum microfone")?;
        let cfg = disp.default_input_config().map_err(|e| e.to_string())?;
        if cfg.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!("microfone em {:?}: por enquanto só f32", cfg.sample_format()));
        }
        let (taxa, canais) = (cfg.sample_rate(), cfg.channels() as u32);
        let stream = disp
            .build_input_stream(
                cfg.config(),
                move |dados: &[f32], _: &cpal::InputCallbackInfo| {
                    let _ = tx.send(dados.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16).collect());
                },
                |e| eprintln!("[microfone] {e}"),
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        (Some(stream), taxa, canais)
    };

    // O processamento é nosso (APM acima): a fonte do libwebrtc não refaz.
    let sem = AudioSourceOptions { echo_cancellation: false, noise_suppression: false, auto_gain_control: false };
    let fonte = NativeAudioSource::new(sem, taxa, canais, 100);
    let track = fabrica.create_audio_track("mic", fonte.clone());
    let p = parar.clone();
    let nivel = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let n = nivel.clone();
    std::thread::Builder::new()
        .name("microfone".into())
        .spawn(move || {
            let dez_ms = (taxa / 100 * canais) as usize;
            let mut acumulado: Vec<i16> = Vec::new();
            while let Ok(bloco) = rx.recv() {
                if p.pediu() {
                    return;
                }
                acumulado.extend(bloco);
                while acumulado.len() >= dez_ms {
                    let mut chunk: Vec<i16> = acumulado.drain(..dez_ms).collect();
                    let _ = apm.lock().unwrap().0.process_stream(&mut chunk, taxa as i32, canais as i32);
                    let rms = (chunk.iter().map(|&s| (s as f32 / 32768.).powi(2)).sum::<f32>() / chunk.len() as f32).sqrt();
                    n.store(rms.to_bits(), Ordering::Relaxed);
                    let quadro = AudioFrame { data: chunk.into(), sample_rate: taxa, num_channels: canais, samples_per_channel: taxa / 100 };
                    let _ = futures::executor::block_on(fonte.capture_frame(&quadro));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Microfone { track, parar, nivel, _entrada: entrada })
}

/* ------------------------------------------------------------------ *
 * Câmera
 * ------------------------------------------------------------------ */

pub struct Camera {
    pub track: RtcVideoTrack,
    pub parar: Parar,
}

impl Drop for Camera {
    fn drop(&mut self) {
        self.parar.agora();
    }
}

/// A câmera (ou, com `teste`, um padrão animado 640x480). A prévia vai para a
/// própria janela como um quadro de `eu`.
pub fn camera(fabrica: &PeerConnectionFactory, teste: bool, eu: String, ui: UnboundedSender<Evento>) -> Result<Camera, String> {
    let parar = Parar::default();
    let fonte = {
        let _rt = tokio().enter();
        NativeVideoSource::new(VideoResolution { width: 1280, height: 720 }, false)
    };
    let track = fabrica.create_video_track("cam", fonte.clone());
    let p = parar.clone();
    if teste {
        std::thread::spawn(move || {
            let (w, h) = (640u32, 480u32);
            let inicio = Instant::now();
            let mut n = 0u32;
            while !p.pediu() {
                let mut buf = I420Buffer::new(w, h);
                {
                    let (y, u, v) = buf.data_mut();
                    let barra = (n * 8) % w;
                    for (i, px) in y.iter_mut().enumerate() {
                        let x = i as u32 % w;
                        *px = if x >= barra && x < barra + 60 { 235 } else { 60 + (x * 120 / w) as u8 };
                    }
                    u.fill(90);
                    v.fill(160);
                }
                enviar_quadro(&fonte, buf, inicio, n, &eu, &ui);
                n += 1;
                std::thread::sleep(Duration::from_millis(33));
            }
        });
    } else {
        use nokhwa::pixel_format::RgbAFormat;
        use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
        std::thread::spawn(move || {
            let pedido = RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
            let mut cam = match nokhwa::Camera::new(CameraIndex::Index(0), pedido) {
                Ok(c) => c,
                Err(e) => return eprintln!("[câmera] {e}"),
            };
            if let Err(e) = cam.open_stream() {
                return eprintln!("[câmera] {e}");
            }
            let inicio = Instant::now();
            let mut n = 0u32;
            while !p.pediu() {
                let Ok(quadro) = cam.frame() else { continue };
                let Ok(rgba) = quadro.decode_image::<RgbAFormat>() else { continue };
                let (w, h) = (rgba.width(), rgba.height());
                let mut nv12 = NV12Buffer::new(w, h);
                {
                    let (sy, suv) = nv12.strides();
                    let (y, uv) = nv12.data_mut();
                    // "ABGR" da libyuv = R,G,B,A na memória (o RGBA do nokhwa).
                    yuv_helper::abgr_to_nv12(rgba.as_raw(), w * 4, y, sy, uv, suv, w as i32, h as i32);
                }
                enviar_quadro(&fonte, nv12, inicio, n, &eu, &ui);
                n += 1;
            }
            let _ = cam.stop_stream();
        });
    }
    Ok(Camera { track, parar })
}

/// Entrega o quadro ao libwebrtc e, a cada 2 quadros, uma prévia à janela.
fn enviar_quadro<B: AsRef<dyn VideoBuffer>>(fonte: &NativeVideoSource, buf: B, inicio: Instant, n: u32, eu: &str, ui: &UnboundedSender<Evento>) {
    let quadro = VideoFrame { rotation: VideoRotation::VideoRotation0, timestamp_us: inicio.elapsed().as_micros() as i64 + 1, frame_metadata: None, buffer: buf };
    if n % 2 == 0 {
        let b = quadro.buffer.as_ref();
        let (w, h) = (b.width(), b.height());
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        b.to_argb(VideoFormatType::ARGB, &mut bgra, w * 4, w as i32, h as i32);
        if let Some(img) = image::RgbaImage::from_raw(w, h, bgra) {
            let imagem = Arc::new(gpui::RenderImage::new(vec![image::Frame::new(img)]));
            let _ = ui.unbounded_send(Evento::Quadro { de: eu.to_string(), papel: "cam".into(), imagem });
        }
    }
    fonte.capture_frame(&quadro);
}

/* ------------------------------------------------------------------ *
 * Tela: o vcall-midia, com os quadros já codificados
 * ------------------------------------------------------------------ */

pub struct Tela {
    pub track: RtcVideoTrack,
    filho: Child,
}

impl Drop for Tela {
    fn drop(&mut self) {
        let _ = self.filho.kill();
    }
}

/// O vcall-midia: VCALL_MIDIA, ao lado deste executável, ou o compilado no repositório.
pub fn caminho_do_motor() -> Option<std::path::PathBuf> {
    let exe = if cfg!(windows) { "vcall-midia.exe" } else { "vcall-midia" };
    let candidatos = [
        std::env::var_os("VCALL_MIDIA").map(Into::into),
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(exe))),
        Some(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("midia").join("target").join("release").join(exe)),
    ];
    candidatos.into_iter().flatten().find(|p| p.is_file())
}

/// Liga o motor para `alvo` (["--tela", "0"] ou ["--janela", hwnd]).
pub fn tela(fabrica: &PeerConnectionFactory, alvo: &[String]) -> Result<Tela, String> {
    let exe = caminho_do_motor().ok_or("o motor vcall-midia não foi encontrado")?;
    let mut filho = Command::new(exe)
        .args(["transmitir", "--qps", "60", "--kbps", "2500"])
        .args(alvo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // A primeira linha diz o tamanho que o motor codifica (ou o erro).
    let mut erros = BufReader::new(filho.stderr.take().unwrap());
    let mut linha = String::new();
    erros.read_line(&mut linha).map_err(|e| e.to_string())?;
    let pronto: serde_json::Value = serde_json::from_str(&linha).map_err(|_| format!("o motor não ligou: {}", linha.trim()))?;
    if let Some(e) = pronto["erro"].as_str() {
        return Err(format!("o motor não ligou: {e}"));
    }
    let tam = |i: usize| pronto["saida"][i].as_u64().unwrap_or(0) as u32;
    let resolucao = VideoResolution { width: tam(0), height: tam(1) };
    let fonte = NativeVideoSource::new_encoded(resolucao.clone());
    let track = fabrica.create_video_track("screen", fonte.clone());
    std::thread::spawn(move || for _ in erros.lines() {}); // estatísticas do motor
    let mut saida = filho.stdout.take().unwrap();
    let mut comandos = filho.stdin.take().unwrap();
    std::thread::Builder::new()
        .name("tela".into())
        .spawn(move || {
            let mut cab = [0u8; 16];
            loop {
                if saida.read_exact(&mut cab).is_err() {
                    return; // o motor saiu
                }
                let n = u32::from_le_bytes(cab[..4].try_into().unwrap()) as usize;
                let mut dados = vec![0u8; n];
                if saida.read_exact(&mut dados).is_err() {
                    return;
                }
                let chave = cab[4] & 1 == 1;
                let tempo = u64::from_le_bytes(cab[8..].try_into().unwrap()) as i64;
                fonte.capture_encoded_frame(&EncodedVideoFrame {
                    codec: EncodedVideoCodec::H264,
                    payload: &dados,
                    timestamp_us: tempo,
                    frame_type: if chave { EncodedFrameType::Key } else { EncodedFrameType::Delta },
                    resolution: resolucao.clone(),
                    frame_metadata: None,
                });
                // Quem recebe pediu quadro-chave ou a banda mudou: o motor atende.
                if fonte.take_keyframe_request() {
                    let _ = comandos.write_all(b"chave\n");
                }
                if let Some(rc) = fonte.take_rate_control_request() {
                    let kbps = (rc.target_bitrate_bps / 1000).clamp(300, 50_000);
                    let _ = writeln!(comandos, "kbps {kbps}");
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Tela { track, filho })
}
