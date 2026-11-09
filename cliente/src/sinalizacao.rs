//! A sinalização da sala por WebSocket, numa thread própria.
//!
//! Uma thread só lê e escreve: leitura com prazo curto (50 ms) e, entre uma
//! leitura e outra, o que a interface pediu para mandar. O servidor manda
//! "ping" do WebSocket a cada 25 s; o tungstenite responde sozinho.
//!
//! Ao sair, manda o fechamento 1000 ("saiu de propósito"): sem ele o servidor
//! segura a pessoa 20 s na sala esperando uma reconexão (GRACA_MS em
//! src/signaling.js), como se a rede tivesse caído.
//!
//! TLS: `wss://` (salas pelo túnel) com rustls e as raízes do sistema, mais
//! `VCALL_CA` (um .pem a mais em que confiar: servidor com CA própria, testes).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use futures::channel::mpsc::UnboundedSender;
use serde_json::Value;
use tungstenite::Message;
use tungstenite::protocol::CloseFrame;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Connector, WebSocket};

pub enum Evento {
    Conectado,
    Mensagem(Value),
    Caiu(String),
    /// Um quadro de vídeo recebido (rtc.rs), já pronto para o GPUI.
    Quadro { de: String, papel: String, imagem: std::sync::Arc<gpui::RenderImage> },
    /// O estado da conexão WebRTC com uma pessoa.
    Conexao { de: String, estado: String },
    /// Uma mensagem de chat pelo canal de dados (como o peer.js manda).
    Chat { de: String, texto: String },
    /// Uma linha do roteiro de teste (VCALL_NATIVO_ROTEIRO, main.rs).
    Comando(String),
    /// Operação de um recurso (quadro, jogos, festa, "ver"...) no canal do quadro.
    Dados { de: String, op: Value },
    /// Cursor do quadro de alguém.
    Cursor { de: String, op: Value },
    /// Indicador de voz de alguém (falando, nível 0..1).
    Fala { de: String, falando: bool, nivel: f32 },
    /// Pedaço binário (imagem do quadro, arquivo) no canal "canvas-blob".
    Blob { de: String, dados: Vec<u8>, binario: bool },
}

/// "ws://maquina:7718/" ou "wss://x.trycloudflare.com/" -> (tls, host, porta).
pub fn endereco(url: &str) -> Option<(bool, String, u16)> {
    let (tls, resto) = match url.strip_prefix("wss://") {
        Some(r) => (true, r),
        None => (false, url.strip_prefix("ws://")?),
    };
    let autoridade = resto.split('/').next().filter(|a| !a.is_empty())?;
    // ponytail: sem IPv6 literal ("[::1]"); os links do Vcall usam nome ou IPv4.
    match autoridade.rsplit_once(':') {
        Some((h, p)) => Some((tls, h.to_string(), p.parse().ok()?)),
        None => Some((tls, autoridade.to_string(), if tls { 443 } else { 80 })),
    }
}

/// A configuração TLS (uma para o processo): raízes do sistema + VCALL_CA.
pub fn tls() -> Arc<rustls::ClientConfig> {
    static CFG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    CFG.get_or_init(|| {
        let mut raizes = rustls::RootCertStore::empty();
        raizes.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
        if let Some(pem) = std::env::var_os("VCALL_CA").and_then(|p| std::fs::read(p).ok()) {
            use rustls::pki_types::CertificateDer;
            use rustls::pki_types::pem::PemObject;
            raizes.add_parsable_certificates(CertificateDer::pem_slice_iter(&pem).flatten());
        }
        Arc::new(rustls::ClientConfig::builder().with_root_certificates(raizes).with_no_client_auth())
    })
    .clone()
}

/// GET simples no mesmo servidor da sala (`/ice`), por http ou https.
pub fn buscar(url_ws: &str, caminho: &str) -> std::io::Result<String> {
    let (seguro, host, porta) = endereco(url_ws).ok_or_else(|| std::io::Error::other("endereço inválido"))?;
    let mut tcp = TcpStream::connect((host.as_str(), porta))?;
    tcp.set_read_timeout(Some(Duration::from_secs(3)))?;
    let pedido = format!("GET {caminho} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    let mut r = Vec::new();
    if seguro {
        let nome = rustls::pki_types::ServerName::try_from(host.clone()).map_err(std::io::Error::other)?;
        let conexao = rustls::ClientConnection::new(tls(), nome).map_err(std::io::Error::other)?;
        let mut s = rustls::StreamOwned::new(conexao, tcp);
        s.write_all(pedido.as_bytes())?;
        let _ = s.read_to_end(&mut r); // servidor que fecha sem close_notify: fica o que chegou
    } else {
        tcp.write_all(pedido.as_bytes())?;
        let _ = tcp.read_to_end(&mut r);
    }
    let texto = String::from_utf8_lossy(&r);
    Ok(texto.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default())
}

/// Abre o WebSocket (com TLS se for wss://). O aperto de mão precisa de
/// leitura bloqueante; o prazo curto (50 ms) vale só depois dele.
fn conectar(url: &str) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, String> {
    let (_, host, porta) = endereco(url).ok_or("endereço inválido")?;
    let tcp = TcpStream::connect((host.as_str(), porta)).map_err(|e| e.to_string())?;
    let _ = tcp.set_nodelay(true);
    let (mut ws, _) = tungstenite::client_tls_with_config(url, tcp, None, Some(Connector::Rustls(tls()))).map_err(|e| e.to_string())?;
    // No próprio socket: num `try_clone` o Windows não repassa o prazo, a
    // leitura ficava presa e o que a interface mandava só saía quando o
    // servidor escrevia alguma coisa (estado e reação chegavam atrasados).
    let socket = match ws.get_mut() {
        MaybeTlsStream::Plain(s) => s,
        MaybeTlsStream::Rustls(s) => s.get_mut(),
        _ => return Err("tipo de conexão inesperado".into()),
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(50)));
    Ok(ws)
}

enum Pedido {
    Enviar(Value),
    Sair,
}

pub struct Sinalizacao {
    saida: mpsc::Sender<Pedido>,
    fim: mpsc::Receiver<()>,
}

/// Quem manda mensagens ao servidor de outras threads (a malha WebRTC).
#[derive(Clone)]
pub struct Emissor(mpsc::Sender<Pedido>);

impl Emissor {
    pub fn enviar(&self, m: Value) {
        let _ = self.0.send(Pedido::Enviar(m));
    }
}

impl Sinalizacao {
    pub fn emissor(&self) -> Emissor {
        Emissor(self.saida.clone())
    }

    /// Sai da sala avisando o servidor; espera até meio segundo pelo aviso.
    pub fn sair(&self) {
        if self.saida.send(Pedido::Sair).is_ok() {
            let _ = self.fim.recv_timeout(Duration::from_millis(500));
        }
    }
}

impl Drop for Sinalizacao {
    fn drop(&mut self) {
        self.sair();
    }
}

/// Conecta em `url`, manda `entrada` (o join) e repassa o que chegar.
pub fn ligar(url: String, entrada: Value, eventos: UnboundedSender<Evento>) -> Sinalizacao {
    let (saida, pedidos) = mpsc::channel::<Pedido>();
    let (avisar_fim, fim) = mpsc::channel::<()>();
    std::thread::Builder::new()
        .name("sinalizacao".into())
        .spawn(move || {
            let caiu = |e: String| {
                let _ = eventos.unbounded_send(Evento::Caiu(e));
            };
            let mut ws = match conectar(&url) {
                Ok(ws) => ws,
                Err(e) => return caiu(e),
            };
            let _ = eventos.unbounded_send(Evento::Conectado);
            if let Err(e) = ws.send(Message::text(entrada.to_string())) {
                return caiu(e.to_string());
            }
            let mut enviadas = 0u32;
            loop {
                match ws.read() {
                    Ok(Message::Text(t)) => {
                        if let Ok(v) = serde_json::from_str(t.as_str()) {
                            let _ = eventos.unbounded_send(Evento::Mensagem(v));
                        }
                    }
                    Ok(Message::Close(_)) => return caiu("o servidor fechou a conexão".into()),
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                    Err(e) => return caiu(e.to_string()),
                }
                while let Ok(p) = pedidos.try_recv() {
                    match p {
                        Pedido::Enviar(m) => {
                            enviadas += 1;
                            if m["t"] != "signal" && std::env::var_os("VCALL_NATIVO_LOG").is_some() {
                                eprintln!("enviado {}", m);
                            }
                            if let Err(e) = ws.send(Message::text(m.to_string())) {
                                return caiu(e.to_string());
                            }
                        }
                        Pedido::Sair => {
                            if std::env::var_os("VCALL_NATIVO_LOG").is_some() {
                                eprintln!("mensagens enviadas ao servidor: {enviadas}");
                            }
                            let _ = ws.close(Some(CloseFrame { code: CloseCode::Normal, reason: "".into() }));
                            // Espera o servidor confirmar (ou desiste em 400 ms).
                            let prazo = Instant::now() + Duration::from_millis(400);
                            while Instant::now() < prazo {
                                match ws.read() {
                                    Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                                    Err(_) => break,
                                    Ok(_) => {}
                                }
                            }
                            let _ = avisar_fim.send(());
                            return;
                        }
                    }
                }
            }
        })
        .expect("thread da sinalização");
    Sinalizacao { saida, fim }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn enderecos_da_sala() {
        assert_eq!(endereco("ws://192.168.0.5:7718/"), Some((false, "192.168.0.5".into(), 7718)));
        assert_eq!(endereco("wss://abc.trycloudflare.com/"), Some((true, "abc.trycloudflare.com".into(), 443)));
        assert_eq!(endereco("ws://maquina/"), Some((false, "maquina".into(), 80)));
        assert_eq!(endereco("wss://localhost:8443/"), Some((true, "localhost".into(), 8443)));
        assert_eq!(endereco("http://maquina/"), None);
        assert_eq!(endereco("ws:///"), None);
    }
}
