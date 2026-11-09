//! WebRTC com os navegadores, do jeito que o `public/js/core/peer.js` espera.
//!
//! Uma `PeerConnection` por pessoa, cada uma com a sua tarefa, que processa a
//! sinalização em ordem (uma resposta nunca passa na frente da oferta).
//! O contrato com o peer.js:
//!   - educado = o id maior (`String(meu) > String(outro)`); o impolido cria as
//!     linhas e oferta, o educado espera e responde;
//!   - quatro linhas fixas, nesta ordem: microfone, câmera, tela, som da tela,
//!     com o mapa `mid -> papel` junto da descrição (`roles`);
//!   - quatro canais de dados negociados, ids 0 a 3 (quadro, cursor, voz, blobs);
//!   - sinal = `{description: {type, sdp}, roles}` ou `{candidate}`.
//!
//! Mandar (G3): o que está ligado (local.rs) vai nos senders de cada par por
//! `set_track`, sem renegociar — como o `replaceTrack` do peer.js. Quem
//! responde não tem como trocar a direção da linha pelo crate; um `add_track`
//! provisório faz a linha da oferta virar `sendrecv` (`linhas_que_mandam`).
//! A linha da tela só negocia H.264: os quadros vêm prontos do vcall-midia.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::StreamExt;
use futures::channel::mpsc::{UnboundedReceiver, UnboundedSender, unbounded};
use futures::executor::ThreadPool;
use gpui::RenderImage;
use libwebrtc::MediaType;
use libwebrtc::audio_source::native::NativeAudioSource;
use libwebrtc::audio_stream::native::NativeAudioStream;
use libwebrtc::peer_connection::TrackEvent;
use libwebrtc::peer_connection_factory::native::PeerConnectionFactoryExt;
use libwebrtc::prelude::*;
use libwebrtc::video_source::native::NativeVideoSource;
use libwebrtc::video_stream::native::NativeVideoStream;
use serde_json::{Value, json};

use crate::sinalizacao::{Emissor, Evento};

/// As linhas fixas do peer.js, na ordem (ROLES em core/peer.js).
pub const PAPEIS: [(&str, MediaType); 4] = [("mic", MediaType::Audio), ("cam", MediaType::Video), ("screen", MediaType::Video), ("screenAudio", MediaType::Audio)];

/// Os canais negociados do peer.js: (rótulo, id, ordenado, retransmissões).
const CANAIS: [(&str, i32, bool, Option<i32>); 4] = [("canvas-sync", 0, true, None), ("cursor", 1, false, Some(0)), ("audio-control", 2, false, Some(0)), ("canvas-blob", 3, true, None)];

/// As opções da oferta. O `default()` do crate vem com `offer_to_receive_*:
/// Some(false)` (feito para quem só publica, como o LiveKit): isso tira o
/// "receber" de todas as linhas — a oferta saía `sendonly`, o navegador
/// respondia `recvonly` e não mandava nada. `None` deixa as direções pedidas.
pub fn opcoes_da_oferta() -> OfferOptions {
    OfferOptions { offer_to_receive_audio: None, offer_to_receive_video: None, ..Default::default() }
}

/// O educado da dupla (core/peer.js: `String(selfId) > String(id)`).
pub fn educado(eu: &str, outro: &str) -> bool {
    eu > outro
}

/// Um candidato ICE no formato do navegador (`RTCIceCandidate.toJSON()`).
pub fn candidato_json(c: &IceCandidate) -> Value {
    json!({ "candidate": c.candidate(), "sdpMid": c.sdp_mid(), "sdpMLineIndex": c.sdp_mline_index() })
}

/// Fila de amostras (i16 intercaladas) de uma fonte de som recebida.
pub type Fila = Arc<Mutex<VecDeque<i16>>>;

/// O que a malha precisa de quem a usa.
#[derive(Clone)]
pub struct Contexto {
    pub emissor: Emissor,
    pub ui: UnboundedSender<Evento>,
    /// Registra uma fonte de som nova e devolve a fila dela (som.rs).
    pub nova_fonte: Arc<dyn Fn() -> Fila + Send + Sync>,
    pub taxa: u32,
    pub canais: u32,
}

/// O que vai em cada papel agora: a trilha ligada ou a vazia (`vazias`).
type Locais = Arc<Mutex<HashMap<String, MediaStreamTrack>>>;
/// Os senders de um par, por papel.
type Senders = Arc<Mutex<HashMap<String, RtpSender>>>;

/// Os quatro canais de dados de um par, pelo rótulo (CANAIS).
type Canais = Arc<Mutex<HashMap<&'static str, DataChannel>>>;

struct Par {
    sinais: UnboundedSender<Value>,
    senders: Senders,
    canais: Canais,
}

/// Mensagens do canal do quadro que são da própria malha do navegador (relé,
/// SFU, mapa de repasses): não são de nenhum recurso.
const INTERNAS: [&str; 4] = ["rede", "sfu", "sfu-ok", "slots"];

/// O texto de um chat recebido, com as regras do servidor (src/protocol.js):
/// sem caracteres de controle, até 2000, sem espaço nas pontas.
pub fn limpar_chat(texto: &str) -> String {
    texto.chars().filter(|c| !c.is_control()).take(2000).collect::<String>().trim().to_string()
}

pub struct Malha {
    fabrica: Arc<PeerConnectionFactory>,
    pool: ThreadPool,
    config: Arc<Mutex<RtcConfiguration>>,
    ctx: Contexto,
    eu: Option<String>,
    pares: HashMap<String, Par>,
    locais: Locais,
    vazias: HashMap<String, MediaStreamTrack>,
}

/// "Nada" num papel: uma trilha que nunca recebe quadro (não manda nada).
/// O `set_track(None)` do crate derruba o processo: o C++ dele desreferencia
/// o ponteiro nulo (`track->rtc_track()` em rtp_sender.cpp).
fn vazias(fabrica: &PeerConnectionFactory) -> HashMap<String, MediaStreamTrack> {
    let som = NativeAudioSource::new(AudioSourceOptions::default(), 48_000, 1, 10);
    // "encoded": sem os quadros pretos de espera (e sem precisar do Tokio).
    let video = NativeVideoSource::new_encoded(VideoResolution::default());
    PAPEIS
        .iter()
        .map(|&(papel, tipo)| {
            let nome = format!("vazio-{papel}");
            let trilha = match tipo {
                MediaType::Audio => MediaStreamTrack::Audio(fabrica.create_audio_track(&nome, som.clone())),
                _ => MediaStreamTrack::Video(fabrica.create_video_track(&nome, video.clone())),
            };
            (papel.to_string(), trilha)
        })
        .collect()
}

fn config_padrao() -> RtcConfiguration {
    let mut c = RtcConfiguration::default();
    c.continual_gathering_policy = ContinualGatheringPolicy::GatherOnce;
    c
}

impl Malha {
    pub fn nova(ctx: Contexto) -> Malha {
        // Sem atraso de reprodução: o quadro aparece assim que chega.
        let fabrica = Arc::new(PeerConnectionFactory::with_zero_playout_delay());
        let vazias = vazias(&fabrica);
        Malha {
            pool: ThreadPool::new().expect("threads da malha"),
            // Coleta de candidatos uma vez só, como o navegador. O padrão do crate
            // (coleta contínua, feita para o LiveKit) manda candidato sem parar e
            // estoura o limite do servidor (240 por 10 s): ele passa a descartar
            // calado o resto (estado, reação, a despedida).
            config: Arc::new(Mutex::new(config_padrao())),
            ctx,
            eu: None,
            pares: HashMap::new(),
            locais: Arc::new(Mutex::new(vazias.clone())),
            vazias,
            fabrica,
        }
    }

    /// As trilhas locais (local.rs) têm de nascer da mesma fábrica das conexões.
    pub fn fabrica(&self) -> &PeerConnectionFactory {
        &self.fabrica
    }

    /// Liga (`Some`) ou desliga (`None`) o que vai num papel, em todos os
    /// pares e nos que vierem, sem renegociar.
    pub fn definir(&self, papel: &str, track: Option<MediaStreamTrack>) {
        let Some(trilha) = track.or_else(|| self.vazias.get(papel).cloned()) else { return };
        self.locais.lock().unwrap().insert(papel.to_string(), trilha.clone());
        for p in self.pares.values() {
            if let Some(s) = p.senders.lock().unwrap().get(papel) {
                let _ = s.set_track(Some(trilha.clone()));
            }
        }
    }

    /// Os servidores STUN/TURN da sala (GET /ice), antes dos pares.
    pub fn usar_ice(&self, servidores: Vec<IceServer>) {
        self.config.lock().unwrap().ice_servers = servidores;
    }

    /// Entrei na sala: conecta com quem já está lá.
    pub fn comecar(&mut self, eu: String, outros: Vec<String>) {
        self.eu = Some(eu);
        for o in outros {
            self.entrou(o);
        }
    }

    pub fn entrou(&mut self, outro: String) {
        let Some(eu) = self.eu.clone() else { return };
        if outro == eu || self.pares.contains_key(&outro) {
            return;
        }
        let (tx, rx) = unbounded();
        let senders = Senders::default();
        let canais = Canais::default();
        self.pares.insert(outro.clone(), Par { sinais: tx, senders: senders.clone(), canais: canais.clone() });
        let (fabrica, config, ctx, pool) = (self.fabrica.clone(), self.config.lock().unwrap().clone(), self.ctx.clone(), self.pool.clone());
        let locais = self.locais.clone();
        self.pool.spawn_ok(async move {
            if let Err(e) = par(eu, outro.clone(), fabrica, config, ctx.clone(), pool, rx, senders, locais, canais).await {
                let _ = ctx.ui.unbounded_send(Evento::Conexao { de: outro, estado: format!("falhou: {e}") });
            }
        });
    }

    pub fn saiu(&mut self, outro: &str) {
        // Fechar o canal encerra a tarefa do par, que fecha a conexão.
        self.pares.remove(outro);
    }

    /// Chat como o navegador manda (core/mesh.js `sendChat`): pelo canal de
    /// dados de cada par, sem passar pelo servidor. Devolve a quantos chegou.
    /// ponytail: par com o canal ainda fechado perde a mensagem; o navegador
    /// guarda numa fila até abrir — fazer igual se aparecer na prática.
    pub fn chat(&self, texto: &str) -> usize {
        self.difundir(&json!({ "type": "chat", "text": texto }))
    }

    /// Manda pelo canal `rotulo` a todos (`para` None) ou a uma pessoa.
    /// Devolve a quantos o canal estava aberto.
    pub fn enviar_canal(&self, rotulo: &str, para: Option<&str>, dados: &[u8], binario: bool) -> usize {
        self.pares
            .iter()
            .filter(|(id, _)| para.is_none_or(|p| p == id.as_str()))
            .filter(|(_, p)| p.canais.lock().unwrap().get(rotulo).is_some_and(|c| c.state() == DataChannelState::Open && c.send(dados, binario).is_ok()))
            .count()
    }

    /// Uma operação de recurso (quadro, jogos, festa...) a todos, como o
    /// `mesh.sendBoard` do navegador: JSON no canal "canvas-sync".
    pub fn difundir(&self, op: &Value) -> usize {
        self.enviar_canal("canvas-sync", None, op.to_string().as_bytes(), false)
    }

    pub fn enviar_a(&self, para: &str, op: &Value) -> usize {
        self.enviar_canal("canvas-sync", Some(para), op.to_string().as_bytes(), false)
    }

    /// Cursor do quadro (canal sem retransmissão, como o navegador).
    pub fn cursor(&self, op: &Value) -> usize {
        self.enviar_canal("cursor", None, op.to_string().as_bytes(), false)
    }

    /// Indicador de voz (core/mesh.js: `{speaking, level}` no canal "audio-control").
    pub fn fala(&self, falando: bool, nivel: f32) -> usize {
        let nivel = (nivel * 1000.).round() / 1000.;
        self.enviar_canal("audio-control", None, json!({ "speaking": falando, "level": nivel }).to_string().as_bytes(), false)
    }

    /// Pedaços binários (imagens do quadro, arquivos) no canal "canvas-blob".
    pub fn blob(&self, para: Option<&str>, dados: &[u8]) -> usize {
        self.enviar_canal("canvas-blob", para, dados, true)
    }

    pub fn conectados(&self) -> usize {
        self.pares.len()
    }

    pub fn sinal(&mut self, de: &str, d: Value) {
        if d["rebuild"].as_bool() == Some(true) {
            // O navegador recomeçou a conexão dele: recomeça a nossa também.
            self.saiu(de);
            self.entrou(de.to_string());
            return;
        }
        if let Some(p) = self.pares.get(de) {
            let _ = p.sinais.unbounded_send(d);
        }
    }
}

/// Põe em cada sender o que vai no papel dele agora (a ligada ou a vazia).
fn aplicar(senders: &Senders, locais: &Locais) {
    let l = locais.lock().unwrap();
    for (papel, s) in senders.lock().unwrap().iter() {
        if let Some(t) = l.get(papel) {
            let _ = s.set_track(Some(t.clone()));
        }
    }
}

/// A linha da tela só com H.264 (o de "packetization-mode=1" primeiro, que
/// divide quadro grande em vários pacotes): os quadros chegam codificados do
/// vcall-midia, e o codificador de passagem do crate casa o codec pelo nome.
/// Sem H.264 nesta máquina, a linha fica como está.
fn linha_da_tela(fabrica: &PeerConnectionFactory, t: &RtpTransceiver) {
    let h264 = |c: &RtpCodecCapability| c.mime_type.eq_ignore_ascii_case("video/H264");
    let mut codecs = fabrica.get_rtp_receiver_capabilities(MediaType::Video).codecs;
    if !codecs.iter().any(h264) {
        return;
    }
    codecs.retain(|c| h264(c) || ["video/rtx", "video/red", "video/ulpfec", "video/flexfec-03"].iter().any(|m| c.mime_type.eq_ignore_ascii_case(m)));
    codecs.sort_by_key(|c| !(h264(c) && c.sdp_fmtp_line.as_deref().unwrap_or("").contains("packetization-mode=1")));
    if let Err(e) = t.set_codec_preferences(codecs) {
        eprintln!("[rtc] codecs da tela: {e}");
    }
    t.sender().set_video_encoder_backend(VideoEncoderBackend::PreEncoded);
}

/// Quem responde manda com o primeiro codec da *oferta* (é o que o libwebrtc
/// faz; a ordem da resposta não conta). O navegador oferta a tela com VP9 e
/// VP8 na frente, e o codificador de passagem recusa ("frame codec does not
/// match sender codec"). Antes de aplicar a oferta, o H.264 de
/// "packetization-mode=1" passa para a frente na linha `mid`.
pub fn h264_primeiro(sdp: &str, mid: &str) -> String {
    let linhas: Vec<&str> = sdp.split("\r\n").collect();
    let secoes: Vec<usize> = linhas.iter().enumerate().filter(|(_, l)| l.starts_with("m=")).map(|(i, _)| i).collect();
    let mut saida: Vec<String> = linhas.iter().map(|l| l.to_string()).collect();
    for (k, &ini) in secoes.iter().enumerate() {
        let fim = secoes.get(k + 1).copied().unwrap_or(linhas.len());
        let secao = &linhas[ini..fim];
        if !secao.contains(&format!("a=mid:{mid}").as_str()) {
            continue;
        }
        // Os PTs de H.264, os de packetization-mode=1 primeiro.
        let pt_de = |l: &str, prefixo: &str| l.strip_prefix(prefixo).and_then(|r| r.split_once(' ')).map(|(pt, resto)| (pt.to_string(), resto.to_string()));
        let mut h264: Vec<String> = secao.iter().filter_map(|l| pt_de(l, "a=rtpmap:")).filter(|(_, r)| r.to_ascii_uppercase().starts_with("H264/")).map(|(pt, _)| pt).collect();
        let modo1 = |pt: &String| secao.iter().filter_map(|l| pt_de(l, "a=fmtp:")).any(|(p, r)| &p == pt && r.contains("packetization-mode=1"));
        h264.sort_by_key(|pt| !modo1(pt));
        let campos: Vec<&str> = linhas[ini].split(' ').collect();
        if campos.len() < 4 || h264.is_empty() {
            break;
        }
        let resto = campos[3..].iter().filter(|pt| !h264.iter().any(|h| h == *pt)).map(|s| s.to_string());
        saida[ini] = campos[..3].iter().map(|s| s.to_string()).chain(h264.iter().cloned()).chain(resto).collect::<Vec<_>>().join(" ");
        break;
    }
    saida.join("\r\n")
}

/// Quem responde: as linhas da oferta nascem `recvonly` e o crate não troca a
/// direção. O `add_track` reaproveita a primeira linha do mesmo tipo que ainda
/// não mandou nada e a faz `sendrecv`; uma trilha provisória (sem quadros) em
/// cada uma, que o `aplicar` troca pela do papel.
fn linhas_que_mandam(pc: &PeerConnection, fabrica: &PeerConnectionFactory) {
    let som = NativeAudioSource::new(AudioSourceOptions::default(), 48_000, 1, 10);
    let video = NativeVideoSource::new_encoded(VideoResolution::default());
    for t in pc.transceivers() {
        if t.sender().track().is_some() || t.direction() != RtpTransceiverDirection::RecvOnly {
            continue;
        }
        let nome = format!("vazio-{}", t.mid().unwrap_or_default());
        let trilha = match t.receiver().track() {
            Some(MediaStreamTrack::Audio(_)) => MediaStreamTrack::Audio(fabrica.create_audio_track(&nome, som.clone())),
            Some(MediaStreamTrack::Video(_)) => MediaStreamTrack::Video(fabrica.create_video_track(&nome, video.clone())),
            None => continue,
        };
        if let Err(e) = pc.add_track(trilha, &["vcall"]) {
            eprintln!("[rtc] linha {nome}: {e}");
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn par(eu: String, outro: String, fabrica: Arc<PeerConnectionFactory>, config: RtcConfiguration, ctx: Contexto, pool: ThreadPool, mut sinais: UnboundedReceiver<Value>, senders: Senders, locais: Locais, canais_par: Canais) -> Result<(), String> {
    let e = |e: RtcError| e.to_string();
    let impolido = !educado(&eu, &outro);
    if std::env::var_os("VCALL_NATIVO_LOG").is_some() {
        eprintln!("par {outro} {}", if impolido { "oferta" } else { "responde" });
    }
    let pc = fabrica.create_peer_connection(config).map_err(e)?;
    let papeis: Arc<Mutex<HashMap<String, String>>> = Arc::default();

    let (emissor, para) = (ctx.emissor.clone(), outro.clone());
    pc.on_ice_candidate(Some(Box::new(move |c: IceCandidate| {
        emissor.enviar(json!({ "t": "signal", "to": para, "d": { "candidate": candidato_json(&c) } }));
    })));
    let (ui, de) = (ctx.ui.clone(), outro.clone());
    pc.on_connection_state_change(Some(Box::new(move |s: PeerConnectionState| {
        let _ = ui.unbounded_send(Evento::Conexao { de: de.clone(), estado: format!("{s:?}") });
    })));
    let (ctx2, de, mapa) = (ctx.clone(), outro.clone(), papeis.clone());
    pc.on_track(Some(Box::new(move |ev: TrackEvent| {
        let papel = ev.transceiver.mid().and_then(|m| mapa.lock().unwrap().get(&m).cloned()).unwrap_or_default();
        match ev.track {
            MediaStreamTrack::Video(t) => pool.spawn_ok(ver(t, de.clone(), papel, ctx2.ui.clone())),
            MediaStreamTrack::Audio(t) => pool.spawn_ok(ouvir(t, (ctx2.nova_fonte)(), ctx2.taxa, ctx2.canais, format!("{de} {papel}"))),
        }
    })));

    // Os canais existem dos dois lados desde o começo, como no peer.js.
    // O que chega em cada canal vira um evento (core/mesh.js `#onPeerData`).
    for &(rotulo, id, ordered, max_retransmits) in &CANAIS {
        let Ok(c) = pc.create_data_channel(rotulo, DataChannelInit { negotiated: true, id, ordered, max_retransmits, ..Default::default() }) else { continue };
        let (ui, de) = (ctx.ui.clone(), outro.clone());
        c.on_message(Some(Box::new(move |b: DataBuffer| {
            let ev = if rotulo == "canvas-blob" {
                Evento::Blob { de: de.clone(), dados: b.data.to_vec(), binario: b.binary }
            } else {
                let Ok(v) = serde_json::from_slice::<Value>(b.data) else { return };
                match rotulo {
                    "cursor" => Evento::Cursor { de: de.clone(), op: v },
                    "audio-control" => Evento::Fala { de: de.clone(), falando: v["speaking"].as_bool().unwrap_or(false), nivel: v["level"].as_f64().unwrap_or(0.) as f32 },
                    _ if v["type"] == "chat" => {
                        let texto = limpar_chat(v["text"].as_str().unwrap_or(""));
                        if texto.is_empty() {
                            return;
                        }
                        Evento::Chat { de: de.clone(), texto }
                    }
                    _ if v["type"].as_str().is_some_and(|t| INTERNAS.contains(&t)) => return,
                    _ => Evento::Dados { de: de.clone(), op: v },
                }
            };
            let _ = ui.unbounded_send(ev);
        })));
        canais_par.lock().unwrap().insert(rotulo, c);
    }

    let roles = |mapa: &HashMap<String, String>| Value::Object(mapa.iter().map(|(m, p)| (m.clone(), Value::from(p.clone()))).collect());
    let enviar_descricao = |desc: &SessionDescription, tipo: &str, mapa: &HashMap<String, String>| {
        ctx.emissor.enviar(json!({ "t": "signal", "to": outro, "d": { "description": { "type": tipo, "sdp": desc.to_string() }, "roles": roles(mapa) } }));
    };

    if impolido {
        let mut linhas = Vec::new();
        for (papel, tipo) in PAPEIS {
            let init = RtpTransceiverInit { direction: RtpTransceiverDirection::SendRecv, stream_ids: vec![], send_encodings: vec![] };
            let t = pc.add_transceiver_for_media(tipo, init).map_err(e)?;
            if papel == "screen" {
                linha_da_tela(&fabrica, &t);
            }
            senders.lock().unwrap().insert(papel.to_string(), t.sender());
            linhas.push((papel, t));
        }
        aplicar(&senders, &locais);
        let oferta = pc.create_offer(opcoes_da_oferta()).await.map_err(e)?;
        pc.set_local_description(oferta.clone()).await.map_err(e)?;
        let mut mapa = papeis.lock().unwrap();
        for (papel, t) in &linhas {
            if let Some(mid) = t.mid() {
                mapa.insert(mid, papel.to_string());
            }
        }
        enviar_descricao(&oferta, "offer", &mapa);
    }

    let mut pendentes: Vec<IceCandidate> = Vec::new();
    let mut tem_remota = false;
    while let Some(d) = sinais.next().await {
        if let Some(r) = d["roles"].as_object() {
            let mut mapa = papeis.lock().unwrap();
            for (mid, papel) in r {
                if let Some(p) = papel.as_str() {
                    mapa.insert(mid.clone(), p.to_string());
                }
            }
        }
        if let Some(desc) = d.get("description").filter(|v| v.is_object()) {
            let sdp = desc["sdp"].as_str().unwrap_or("");
            match desc["type"].as_str() {
                Some("offer") => {
                    // Colisão: o impolido fica com a própria oferta (negociação perfeita).
                    if impolido && pc.signaling_state() != SignalingState::Stable {
                        continue;
                    }
                    let mid_da_tela = papeis.lock().unwrap().iter().find(|(_, p)| *p == "screen").map(|(m, _)| m.clone());
                    let sdp = mid_da_tela.map_or_else(|| sdp.to_string(), |m| h264_primeiro(sdp, &m));
                    let oferta = SessionDescription::parse(&sdp, SdpType::Offer).map_err(|e| e.to_string())?;
                    pc.set_remote_description(oferta).await.map_err(e)?;
                    tem_remota = true;
                    if !impolido {
                        linhas_que_mandam(&pc, &fabrica);
                        let mapa = papeis.lock().unwrap().clone();
                        for t in pc.transceivers() {
                            let Some(papel) = t.mid().and_then(|m| mapa.get(&m).cloned()) else { continue };
                            if papel == "screen" {
                                linha_da_tela(&fabrica, &t);
                            }
                            senders.lock().unwrap().insert(papel, t.sender());
                        }
                        aplicar(&senders, &locais);
                    }
                    for c in pendentes.drain(..) {
                        let _ = pc.add_ice_candidate(c).await;
                    }
                    let resposta = pc.create_answer(AnswerOptions::default()).await.map_err(e)?;
                    pc.set_local_description(resposta.clone()).await.map_err(e)?;
                    let mapa = papeis.lock().unwrap().clone();
                    enviar_descricao(&resposta, "answer", &mapa);
                }
                Some("answer") => {
                    let resposta = SessionDescription::parse(sdp, SdpType::Answer).map_err(|e| e.to_string())?;
                    pc.set_remote_description(resposta).await.map_err(e)?;
                    tem_remota = true;
                    for c in pendentes.drain(..) {
                        let _ = pc.add_ice_candidate(c).await;
                    }
                }
                _ => {}
            }
        } else if let Some(c) = d.get("candidate").filter(|v| v.is_object()) {
            let texto = c["candidate"].as_str().unwrap_or("");
            if texto.is_empty() {
                continue; // fim dos candidatos
            }
            let Ok(cand) = IceCandidate::parse(c["sdpMid"].as_str().unwrap_or("0"), c["sdpMLineIndex"].as_i64().unwrap_or(0) as i32, texto) else { continue };
            if tem_remota {
                let _ = pc.add_ice_candidate(cand).await;
            } else {
                pendentes.push(cand);
            }
        }
    }
    pc.close();
    Ok(())
}

/// Vídeo recebido -> imagens BGRA para o GPUI (no máximo ~30 por segundo:
/// cada uma vira uma textura nova na placa).
async fn ver(track: RtcVideoTrack, de: String, papel: String, ui: UnboundedSender<Evento>) {
    let mut fluxo = NativeVideoStream::new(track);
    let mut ultimo = Instant::now() - Duration::from_secs(1);
    let mut primeiro = true;
    while let Some(quadro) = fluxo.next().await {
        if ultimo.elapsed() < Duration::from_millis(33) {
            continue;
        }
        ultimo = Instant::now();
        let (w, h) = (quadro.buffer.width(), quadro.buffer.height());
        // Para os testes (scripts/nativo-test.mjs).
        if std::mem::take(&mut primeiro) && std::env::var_os("VCALL_NATIVO_LOG").is_some() {
            eprintln!("quadro {de} {papel} {w}x{h}");
        }
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        // "ARGB" da libyuv = B,G,R,A na memória, que é o que o GPUI espera. O
        // "BGRA" dela põe o alfa primeiro: amarelo virava transparente (preto).
        quadro.buffer.to_argb(VideoFormatType::ARGB, &mut bgra, w * 4, w as i32, h as i32);
        let Some(img) = image::RgbaImage::from_raw(w, h, bgra) else { continue };
        let imagem = Arc::new(RenderImage::new(vec![image::Frame::new(img)]));
        if ui.unbounded_send(Evento::Quadro { de: de.clone(), papel: papel.clone(), imagem }).is_err() {
            return;
        }
    }
}

/// Som recebido -> fila da mistura (som.rs). Guarda no máximo 200 ms.
async fn ouvir(track: RtcAudioTrack, fila: Fila, taxa: u32, canais: u32, quem: String) {
    let mut fluxo = NativeAudioStream::new(track, taxa as i32, canais as i32);
    let teto = (taxa * canais / 5) as usize;
    let mut primeiro = true;
    while let Some(q) = fluxo.next().await {
        if std::mem::take(&mut primeiro) && std::env::var_os("VCALL_NATIVO_LOG").is_some() {
            eprintln!("som {quem}");
        }
        let mut f = fila.lock().unwrap();
        f.extend(q.data.iter().copied());
        let sobra = f.len().saturating_sub(teto);
        f.drain(..sobra);
    }
}

/// Os servidores STUN/TURN que a sala usa (o `/ice` do servidor, que os
/// navegadores também pedem). Sem resposta, só os candidatos locais.
pub fn ice_da_sala(ws: &str) -> Vec<IceServer> {
    servidores_de(&crate::sinalizacao::buscar(ws, "/ice").unwrap_or_default())
}

/// `{"iceServers": [{"urls": "..." | [...], "username"?, "credential"?}]}`
pub fn servidores_de(corpo: &str) -> Vec<IceServer> {
    let v: Value = serde_json::from_str(corpo).unwrap_or_default();
    v["iceServers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let urls: Vec<String> = match &s["urls"] {
                Value::String(u) => vec![u.clone()],
                Value::Array(a) => a.iter().filter_map(|u| u.as_str().map(str::to_string)).collect(),
                _ => return None,
            };
            Some(IceServer { urls, username: s["username"].as_str().unwrap_or("").into(), password: s["credential"].as_str().unwrap_or("").into() })
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn h264_vai_para_a_frente_so_na_linha_da_tela() {
        let sdp = [
            "v=0",
            "m=video 9 UDP/TLS/RTP/SAVPF 96 98 102 104",
            "a=mid:1",
            "a=rtpmap:102 H264/90000",
            "m=video 9 UDP/TLS/RTP/SAVPF 98 96 104 102 103",
            "a=mid:2",
            "a=rtpmap:98 VP9/90000",
            "a=rtpmap:96 VP8/90000",
            "a=rtpmap:104 H264/90000",
            "a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
            "a=rtpmap:102 H264/90000",
            "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
            "a=rtpmap:103 rtx/90000",
            "",
        ]
        .join("\r\n");
        let novo = h264_primeiro(&sdp, "2");
        let m: Vec<&str> = novo.split("\r\n").filter(|l| l.starts_with("m=")).collect();
        assert_eq!(m[0], "m=video 9 UDP/TLS/RTP/SAVPF 96 98 102 104", "a câmera fica como veio");
        assert_eq!(m[1], "m=video 9 UDP/TLS/RTP/SAVPF 102 104 98 96 103", "H.264 modo 1, H.264 modo 0, depois o resto na ordem");
        assert_eq!(novo.split("\r\n").count(), sdp.split("\r\n").count());
        assert_eq!(h264_primeiro(&sdp, "9"), sdp, "sem a linha: igual");
    }

    #[test]
    fn papel_de_educado_igual_ao_peer_js() {
        // String(a) > String(b) no JavaScript compara por código, como o Rust.
        assert!(educado("b", "a"));
        assert!(!educado("a", "b"));
        assert!(educado("ab70e14e", "4abb7e7e"));
    }

    /// Que direção sai na oferta para cada direção pedida ao crate.
    fn direcoes_na_oferta(pedida: RtpTransceiverDirection) -> Vec<String> {
        let f = PeerConnectionFactory::with_zero_playout_delay();
        let pc = f.create_peer_connection(RtcConfiguration::default()).unwrap();
        for (_, tipo) in PAPEIS {
            pc.add_transceiver_for_media(tipo, RtpTransceiverInit { direction: pedida, stream_ids: vec![], send_encodings: vec![] }).unwrap();
        }
        let oferta = futures::executor::block_on(pc.create_offer(opcoes_da_oferta())).unwrap().to_string();
        let d = oferta.lines().filter(|l| matches!(*l, "a=sendrecv" | "a=sendonly" | "a=recvonly" | "a=inactive")).map(|l| l[2..].to_string()).collect();
        pc.close();
        d
    }

    #[test]
    fn a_oferta_manda_e_recebe() {
        // Com OfferOptions::default() saía ["sendonly"; 4] (medido): o navegador não mandava nada.
        assert_eq!(direcoes_na_oferta(RtpTransceiverDirection::SendRecv), ["sendrecv"; 4]);
    }

    #[test]
    fn ice_do_servidor() {
        let s = servidores_de(r#"{"iceServers":[{"urls":["stun:a:3478"]},{"urls":"turn:b:3478","username":"u","credential":"c"}]}"#);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].urls, vec!["stun:a:3478"]);
        assert_eq!((s[1].username.as_str(), s[1].password.as_str()), ("u", "c"));
        assert!(servidores_de("lixo").is_empty());
    }
}
