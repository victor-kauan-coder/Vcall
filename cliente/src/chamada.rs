//! A chamada: estado e lógica, sem desenho (o desenho é ui/).
//!
//! Recebe o que chega do servidor e da malha WebRTC (sinalizacao::Evento),
//! guarda o que a interface mostra e faz o que os botões pedem: ligar e
//! desligar mídia, chat, reações, mão, moderação.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use futures::StreamExt;
use futures::channel::mpsc::UnboundedSender;
use gpui::{AppContext, Context, Entity, RenderImage, SharedString, Subscription};
use libwebrtc::prelude::{IceServer, MediaStreamTrack};
use serde_json::{Value, json};

use crate::entrada::{self, Entrada};
use crate::local;
use crate::rtc::{self, Contexto, Malha};
use crate::sala::{Avatar, Sala};
use crate::sinalizacao::{self, Evento, Sinalizacao};
use crate::som::Som;

/// O que vem da linha de comando para as fontes.
pub struct Opcoes {
    pub teste: bool,
    /// Argumentos do vcall-midia: ["--tela", "0"] ou ["--janela", hwnd].
    pub alvo_tela: Vec<String>,
    /// Papéis a ligar assim que entrar na sala.
    pub ligar: Vec<String>,
}

/// As abas do painel lateral (ui/panel.js).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Painel {
    Conversa,
    Pessoas,
    Legendas,
    Qualidade,
}

pub struct Mensagem {
    /// None: mensagem do sistema ("Fulano entrou").
    pub de: Option<String>,
    pub nome: String,
    pub texto: String,
    pub minha: bool,
    pub hora: SystemTime,
}

/// Uma reação na tela (some sozinha depois de `DURACAO_REACAO`).
pub struct Reacao {
    pub id: u64,
    pub de: String,
    pub tipo: String,
    pub inicio: Instant,
}

pub struct Aviso {
    pub id: u64,
    pub texto: SharedString,
}

pub const DURACAO_REACAO: Duration = Duration::from_millis(3200);

/// O indicador de voz (core/vad.js): acima do limiar está falando, e só
/// "parou de falar" depois de 900 ms em silêncio.
const LIMIAR_VOZ: f32 = 0.055;
const SOLTAR_VOZ: Duration = Duration::from_millis(900);

#[derive(Clone, Copy, Default, Debug)]
pub struct Fala {
    pub falando: bool,
    pub nivel: f32,
}
const DURACAO_AVISO: Duration = Duration::from_millis(4000);

/// As reações que o servidor aceita (src/protocol.js REACTIONS).
pub const REACOES: [&str; 6] = ["like", "clap", "heart", "laugh", "wow", "question"];

pub struct Chamada {
    pub sala: Sala,
    pub conexao: SharedString,
    pub sinal: Sinalizacao,
    pub malha: Malha,
    /// (pessoa, papel) -> o último quadro recebido ("cam" ou "screen").
    pub quadros: HashMap<(String, String), Arc<RenderImage>>,
    /// pessoa -> estado da conexão WebRTC.
    pub conexoes: HashMap<String, String>,
    pub nome: String,
    pub avatar: Avatar,
    pub mic: Option<local::Microfone>,
    pub cam: Option<local::Camera>,
    pub tela: Option<local::Tela>,
    pub mao: bool,
    pub chat: Vec<Mensagem>,
    pub nao_lidas: usize,
    pub reacoes: Vec<Reacao>,
    pub avisos: Vec<Aviso>,
    pub painel: Option<Painel>,
    pub fixado: Option<String>,
    pub inicio: Instant,
    pub entrada_chat: Entity<Entrada>,
    pub saiu: bool,
    /// O estado só do desenho de cada parte (ui/).
    pub ui: crate::ui::EstadoUi,
    /// O estado de cada recurso (func/).
    pub func: crate::func::Estados,
    /// Quem está falando (inclusive eu), para o anel do ladrilho e a barrinha.
    pub falando: HashMap<String, Fala>,
    ultimo_alto: Option<Instant>,
    proximo_id: u64,
    eventos: UnboundedSender<Evento>,
    apm: local::ApmCompartilhado,
    opcoes: Opcoes,
    _som: Option<Som>,
    _assinaturas: Vec<Subscription>,
}

fn log() -> bool {
    std::env::var_os("VCALL_NATIVO_LOG").is_some()
}

/// Teste em segundo plano (VCALL_NATIVO_FUNDO): sem janela à vista e sem som.
pub fn em_segundo_plano() -> bool {
    std::env::var_os("VCALL_NATIVO_FUNDO").is_some()
}

impl Chamada {
    pub fn nova(ws: String, sala_id: String, nome: String, avatar: Avatar, ice: Vec<IceServer>, opcoes: Opcoes, cx: &mut Context<Self>) -> Self {
        let (tx, mut rx) = futures::channel::mpsc::unbounded();
        let sinal = sinalizacao::ligar(ws, crate::sala::entrada(&sala_id, &nome, &avatar, &crate::sala::token(), &crate::sala::token()), tx.clone());
        let apm = local::novo_apm();
        // Em segundo plano o som recebido não vai ao alto-falante de quem testa.
        let quieto = em_segundo_plano() || std::env::var_os("VCALL_NATIVO_FOTO").is_some();
        let som = if quieto { None } else { Som::novo(apm.clone()) };
        let ctx = Contexto {
            emissor: sinal.emissor(),
            ui: tx.clone(),
            nova_fonte: som.as_ref().map(Som::registrador).unwrap_or_else(|| Arc::new(rtc::Fila::default)),
            taxa: som.as_ref().map_or(48_000, |s| s.taxa),
            canais: som.as_ref().map_or(2, |s| s.canais),
        };
        let malha = Malha::nova(ctx);
        malha.usar_ice(ice);
        cx.spawn(async move |este, cx| {
            while let Some(ev) = rx.next().await {
                if este.update(cx, |c, cx| c.receber(ev, cx)).is_err() {
                    break; // a janela fechou
                }
            }
        })
        .detach();
        // Roteiro de teste: comandos pela entrada padrão (scripts/nativo-test.mjs).
        if std::env::var_os("VCALL_NATIVO_ROTEIRO").is_some() {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for linha in std::io::stdin().lines().map_while(Result::ok) {
                    let _ = tx.unbounded_send(Evento::Comando(linha));
                }
                // Entrada fechada: quem testa terminou.
                let _ = tx.unbounded_send(Evento::Comando("sair".into()));
            });
        }
        // A própria voz, como o navegador publica (core/mesh.js: a cada 120 ms).
        cx.spawn(async move |este, cx| {
            loop {
                cx.background_executor().timer(Duration::from_millis(120)).await;
                if este.update(cx, |c, cx| c.medir_voz(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        let entrada_chat = cx.new(|cx| Entrada::nova("Escreva uma mensagem…", cx));
        let assinaturas = vec![
            // Fechar o app avisa o servidor (sem isso a pessoa fica 20 s na sala).
            cx.on_app_quit(|c: &mut Chamada, _| {
                c.sinal.sair();
                async {}
            }),
            cx.subscribe(&entrada_chat, |c, e, ev: &entrada::Enviado, cx| {
                c.mandar_chat(&ev.0, cx);
                e.update(cx, |e, cx| e.definir("", cx));
            }),
        ];
        Chamada {
            sala: Sala::default(),
            conexao: "Conectando…".into(),
            sinal,
            malha,
            quadros: HashMap::new(),
            conexoes: HashMap::new(),
            nome,
            avatar,
            mic: None,
            cam: None,
            tela: None,
            mao: false,
            chat: Vec::new(),
            nao_lidas: 0,
            reacoes: Vec::new(),
            avisos: Vec::new(),
            painel: None,
            fixado: None,
            inicio: Instant::now(),
            entrada_chat,
            saiu: false,
            ui: Default::default(),
            func: Default::default(),
            falando: HashMap::new(),
            ultimo_alto: None,
            proximo_id: 1,
            eventos: tx,
            apm,
            opcoes,
            _som: som,
            _assinaturas: assinaturas,
        }
    }

    fn novo_id(&mut self) -> u64 {
        self.proximo_id += 1;
        self.proximo_id
    }

    pub fn eu(&self) -> Option<&str> {
        self.sala.eu.as_deref()
    }

    pub fn sou_anfitriao(&self) -> bool {
        self.sala.pessoas.iter().any(|p| Some(p.id.as_str()) == self.eu() && p.anfitriao)
    }

    pub fn nome_de(&self, id: &str) -> String {
        self.sala.pessoas.iter().find(|p| p.id == id).map(|p| p.nome.clone()).unwrap_or_else(|| "Convidado".into())
    }

    /* -------------------------- mídia -------------------------- */

    /// Liga ou desliga o microfone, a câmera ou a tela ("mic", "cam", "tela").
    pub fn alternar(&mut self, papel: &str, cx: &mut Context<Self>) {
        let trilha_papel = if papel == "tela" { "screen" } else { papel };
        let ligado = match papel {
            "mic" => self.mic.take().is_some(),
            "cam" => self.cam.take().is_some(),
            _ => self.tela.take().is_some(),
        };
        if ligado {
            self.malha.definir(trilha_papel, None);
            if papel == "cam" {
                let eu = self.sala.eu.clone().unwrap_or_default();
                if let Some(velha) = self.quadros.remove(&(eu, "cam".to_string())) {
                    cx.drop_image(velha, None);
                }
            }
        } else {
            let fabrica = self.malha.fabrica();
            let trilha = match papel {
                "mic" => local::microfone(fabrica, self.apm.clone(), self.opcoes.teste).map(|m| {
                    let t = MediaStreamTrack::Audio(m.track.clone());
                    self.mic = Some(m);
                    t
                }),
                "cam" => local::camera(fabrica, self.opcoes.teste, self.sala.eu.clone().unwrap_or_default(), self.eventos.clone()).map(|c| {
                    let t = MediaStreamTrack::Video(c.track.clone());
                    self.cam = Some(c);
                    t
                }),
                _ => local::tela(fabrica, &self.opcoes.alvo_tela).map(|c| {
                    let t = MediaStreamTrack::Video(c.track.clone());
                    self.tela = Some(c);
                    t
                }),
            };
            match trilha {
                Ok(t) => self.malha.definir(trilha_papel, Some(t)),
                Err(e) => {
                    eprintln!("[{papel}] {e}");
                    self.avisar(e, cx);
                }
            }
        }
        self.publicar_estado();
        cx.notify();
    }

    /// Conta à sala o que está ligado (o servidor repassa aos outros, não a mim).
    pub fn publicar_estado(&mut self) {
        let (mic, cam, tela, mao) = (self.mic.is_some(), self.cam.is_some(), self.tela.is_some(), self.mao);
        if log() {
            eprintln!("estado mic={mic} cam={cam} tela={tela} mao={mao}");
        }
        self.sinal.emissor().enviar(json!({ "t": "state", "state": { "mic": mic, "cam": cam, "screen": tela, "hand": mao, "board": false } }));
        if let Some(eu) = self.sala.eu.clone()
            && let Some(p) = self.sala.pessoas.iter_mut().find(|p| p.id == eu)
        {
            (p.mic, p.cam, p.tela, p.mao) = (mic, cam, tela, mao);
        }
    }

    pub fn alternar_mao(&mut self, cx: &mut Context<Self>) {
        self.mao = !self.mao;
        self.publicar_estado();
        cx.notify();
    }

    /// O indicador da própria voz: muda de "falando" para "calado" com a mesma
    /// regra do navegador e manda aos outros pelo canal de voz.
    fn medir_voz(&mut self, cx: &mut Context<Self>) {
        let Some(eu) = self.sala.eu.clone() else { return };
        let nivel = self.mic.as_ref().map_or(0., |m| f32::from_bits(m.nivel.load(std::sync::atomic::Ordering::Relaxed)));
        if nivel > LIMIAR_VOZ {
            self.ultimo_alto = Some(Instant::now());
        }
        let falando = self.mic.is_some() && self.ultimo_alto.is_some_and(|t| t.elapsed() < SOLTAR_VOZ);
        let antes = self.falando.get(&eu).copied().unwrap_or_default();
        if falando != antes.falando {
            if log() {
                eprintln!("voz falando={falando} nivel={nivel:.3}");
            }
            // A transição vai a todos; quem ainda não abriu o canal recebe pelo servidor.
            if self.malha.fala(falando, nivel) < self.malha.conectados() {
                self.sinal.emissor().enviar(json!({ "t": "audio", "speaking": falando, "level": (nivel * 1000.).round() / 1000. }));
            }
        } else if nivel >= 0.004 || falando {
            self.malha.fala(falando, nivel);
        }
        self.falando.insert(eu, Fala { falando, nivel });
        if falando != antes.falando || (antes.nivel - nivel).abs() > 0.01 {
            cx.notify();
        }
    }

    /* -------------------------- conversa e reações -------------------------- */

    /// Chat como o navegador manda: pelo canal de dados de cada par.
    pub fn mandar_chat(&mut self, texto: &str, cx: &mut Context<Self>) {
        let texto = rtc::limpar_chat(texto);
        if texto.is_empty() {
            return;
        }
        let chegou = self.malha.chat(&texto);
        if log() {
            eprintln!("chat enviado a {chegou}: {texto}");
        }
        self.chat.push(Mensagem { de: self.sala.eu.clone(), nome: self.nome.clone(), texto, minha: true, hora: SystemTime::now() });
        cx.notify();
    }

    fn chat_recebido(&mut self, de: Option<String>, nome: String, texto: String, cx: &mut Context<Self>) {
        if log() {
            eprintln!("chat de {nome}: {texto}");
        }
        self.chat.push(Mensagem { de, nome, texto, minha: false, hora: SystemTime::now() });
        if self.painel != Some(Painel::Conversa) {
            self.nao_lidas += 1;
        }
        cx.notify();
    }

    fn sistema(&mut self, texto: String) {
        self.chat.push(Mensagem { de: None, nome: String::new(), texto, minha: false, hora: SystemTime::now() });
    }

    pub fn reagir(&mut self, tipo: &str, cx: &mut Context<Self>) {
        if !REACOES.contains(&tipo) {
            return;
        }
        self.sinal.emissor().enviar(json!({ "t": "reaction", "kind": tipo }));
        let eu = self.sala.eu.clone().unwrap_or_default();
        self.mostrar_reacao(eu, tipo.to_string(), cx);
    }

    fn mostrar_reacao(&mut self, de: String, tipo: String, cx: &mut Context<Self>) {
        if log() {
            eprintln!("reacao {de} {tipo}");
        }
        let id = self.novo_id();
        self.reacoes.push(Reacao { id, de, tipo, inicio: Instant::now() });
        cx.spawn(async move |este, cx| {
            cx.background_executor().timer(DURACAO_REACAO).await;
            let _ = este.update(cx, |c, cx| {
                c.reacoes.retain(|r| r.id != id);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub fn avisar(&mut self, texto: impl Into<SharedString>, cx: &mut Context<Self>) {
        let id = self.novo_id();
        self.avisos.push(Aviso { id, texto: texto.into() });
        cx.spawn(async move |este, cx| {
            cx.background_executor().timer(DURACAO_AVISO).await;
            let _ = este.update(cx, |c, cx| {
                c.avisos.retain(|a| a.id != id);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub fn abrir_painel(&mut self, p: Painel, cx: &mut Context<Self>) {
        self.painel = if self.painel == Some(p) { None } else { Some(p) };
        if self.painel == Some(Painel::Conversa) {
            self.nao_lidas = 0;
        }
        cx.notify();
    }

    /* -------------------------- anfitrião -------------------------- */

    /// Ação do anfitrião (src/protocol.js MOD_ACTIONS): silenciar, desligar
    /// câmera, remover, baixar a mão, admitir, recusar, trancar.
    pub fn moderar(&mut self, acao: &str, alvo: &str) {
        self.sinal.emissor().enviar(json!({ "t": "moderate", "action": acao, "target": alvo }));
    }

    fn moderado(&mut self, m: &Value, cx: &mut Context<Self>) {
        let por = m["by"].as_str().unwrap_or("O anfitrião").to_string();
        if log() {
            eprintln!("moderado {}", m["action"].as_str().unwrap_or("?"));
        }
        match m["action"].as_str().unwrap_or("") {
            "mute" => {
                if self.mic.is_some() {
                    self.alternar("mic", cx);
                }
                self.avisar(format!("{por} silenciou seu microfone"), cx);
            }
            "cam-off" => {
                if self.cam.is_some() {
                    self.alternar("cam", cx);
                }
                self.avisar(format!("{por} desligou sua câmera"), cx);
            }
            "lower-hand" => {
                self.mao = false;
                self.publicar_estado();
                self.avisar(format!("{por} baixou sua mão"), cx);
            }
            "kick" => {
                self.saiu = true;
                self.sala.aviso = format!("{por} removeu você da chamada.");
            }
            "kicked" => self.sistema(format!("{} foi removido da chamada", m["name"].as_str().unwrap_or("Alguém"))),
            _ => {}
        }
    }

    /// Sai da chamada (o botão vermelho).
    pub fn sair(&mut self, cx: &mut Context<Self>) {
        self.sinal.sair();
        self.saiu = true;
        self.mic = None;
        self.cam = None;
        self.tela = None;
        cx.notify();
    }

    /* -------------------------- eventos -------------------------- */

    fn receber(&mut self, ev: Evento, cx: &mut Context<Self>) {
        match ev {
            Evento::Conectado => self.conexao = "Conectado".into(),
            Evento::Caiu(e) => self.conexao = format!("Sem conexão: {e}").into(),
            Evento::Mensagem(m) => {
                // Para os testes (scripts/nativo-test.mjs): o que chegou, em uma linha.
                if log() {
                    let nomes: Vec<&str> = m["peers"].as_array().into_iter().flatten().filter_map(|p| p["name"].as_str()).collect();
                    eprintln!("{} {}", m["t"].as_str().unwrap_or("?"), nomes.join(","));
                }
                // Quem saiu: o nome ainda está na sala antes de aplicar.
                if m["t"] == "peer-leave" {
                    let nome = self.nome_de(m["id"].as_str().unwrap_or(""));
                    self.sistema(format!("{nome} saiu"));
                }
                self.sala.aplicar(&m);
                self.encaminhar(&m, cx);
            }
            Evento::Quadro { de, papel, imagem } => {
                // A imagem anterior sai da placa; sem isso a memória de vídeo só cresce.
                if let Some(velha) = self.quadros.insert((de, papel), imagem) {
                    cx.drop_image(velha, None);
                }
            }
            Evento::Chat { de, texto } => {
                let nome = self.nome_de(&de);
                self.chat_recebido(Some(de), nome, texto, cx);
            }
            Evento::Comando(linha) => self.comando(&linha, cx),
            Evento::Fala { de, falando, nivel } => {
                self.falando.insert(de, Fala { falando, nivel });
            }
            Evento::Dados { de, op } => crate::func::receber(self, &de, &op, cx),
            Evento::Cursor { de, op } => crate::func::cursor(self, &de, &op, cx),
            Evento::Blob { de, dados, .. } => crate::func::blob(self, &de, &dados, cx),
            Evento::Conexao { de, estado } => {
                if log() {
                    eprintln!("conexao {de} {estado}");
                }
                self.conexoes.insert(de, estado);
            }
        }
        cx.notify();
    }

    /// Roteiro de teste: "chat <texto>", "reagir <tipo>", "mao", "alternar <papel>".
    fn comando(&mut self, linha: &str, cx: &mut Context<Self>) {
        let (cmd, resto) = linha.trim().split_once(' ').unwrap_or((linha.trim(), ""));
        match cmd {
            "chat" => self.mandar_chat(resto, cx),
            "reagir" => self.reagir(resto, cx),
            "mao" => self.alternar_mao(cx),
            "alternar" => self.alternar(resto, cx),
            "sair" => {
                self.sinal.sair();
                cx.quit();
            }
            "painel" => self.abrir_painel(if resto == "pessoas" { Painel::Pessoas } else { Painel::Conversa }, cx),
            _ => eprintln!("roteiro: comando desconhecido: {linha}"),
        }
    }

    /// O que interessa à malha e à conversa nas mensagens do servidor.
    fn encaminhar(&mut self, m: &Value, cx: &mut Context<Self>) {
        let id = |v: &Value| v.as_str().map(str::to_string);
        match m["t"].as_str().unwrap_or("") {
            "welcome" => {
                if let Some(eu) = id(&m["you"]["id"]) {
                    let outros = m["peers"].as_array().into_iter().flatten().filter_map(|p| id(&p["id"])).collect();
                    self.malha.comecar(eu, outros);
                    self.inicio = Instant::now();
                    for papel in std::mem::take(&mut self.opcoes.ligar) {
                        self.alternar(&papel, cx);
                    }
                }
            }
            "peer-join" => {
                if let Some(velho) = id(&m["replaces"]) {
                    self.malha.saiu(&velho);
                } else {
                    self.sistema(format!("{} entrou", m["peer"]["name"].as_str().unwrap_or("Convidado")));
                }
                if let Some(novo) = id(&m["peer"]["id"]) {
                    self.malha.entrou(novo);
                }
            }
            "peer-leave" => {
                if let Some(quem) = id(&m["id"]) {
                    self.malha.saiu(&quem);
                    self.conexoes.remove(&quem);
                    if self.fixado.as_deref() == Some(quem.as_str()) {
                        self.fixado = None;
                    }
                    for papel in ["cam", "screen"] {
                        if let Some(velha) = self.quadros.remove(&(quem.clone(), papel.to_string())) {
                            cx.drop_image(velha, None);
                        }
                    }
                }
            }
            "signal" => {
                if let Some(de) = id(&m["from"]) {
                    self.malha.sinal(&de, m["d"].clone());
                }
            }
            // Chat pelo servidor (quem ainda manda por ele): {id, name, text}.
            "chat" => {
                let texto = rtc::limpar_chat(m["text"].as_str().unwrap_or(""));
                if !texto.is_empty() {
                    self.chat_recebido(id(&m["id"]), m["name"].as_str().unwrap_or("Convidado").to_string(), texto, cx);
                }
            }
            "reaction" => {
                if let (Some(de), Some(tipo)) = (id(&m["id"]), id(&m["kind"])) {
                    self.mostrar_reacao(de, tipo, cx);
                }
            }
            "moderated" => self.moderado(m, cx),
            // Planos B pelo servidor, de quem ainda não abriu o canal de dados.
            "audio" => {
                if let Some(de) = id(&m["id"]) {
                    self.falando.insert(de, Fala { falando: m["speaking"].as_bool().unwrap_or(false), nivel: m["level"].as_f64().unwrap_or(0.) as f32 });
                }
            }
            "board" => {
                if let Some(de) = id(&m["id"]) {
                    crate::func::receber(self, &de, &m["op"], cx);
                }
            }
            "knock" => self.avisar(format!("{} quer entrar", m["name"].as_str().unwrap_or("Alguém")), cx),
            _ => {}
        }
    }

    /// Tempo de chamada como o app mostra ("00:13", "1:02:03").
    pub fn cronometro(&self) -> String {
        let s = self.inicio.elapsed().as_secs();
        if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
    }
}

#[cfg(test)]
mod testes {
    #[test]
    fn reacoes_iguais_as_do_servidor() {
        // src/protocol.js: const REACTIONS = new Set(["like", "clap", "heart", "laugh", "wow", "question"]);
        let protocolo = include_str!("../../src/protocol.js");
        let linha = protocolo.lines().find(|l| l.contains("const REACTIONS")).expect("REACTIONS no protocolo");
        for r in super::REACOES {
            assert!(linha.contains(&format!("\"{r}\"")), "{r} fora do protocolo");
        }
    }
}
