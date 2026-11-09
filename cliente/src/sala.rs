//! O estado da sala a partir das mensagens do servidor (src/protocol.js).
//!
//! Sem GPUI e sem rede: entra uma mensagem JSON, muda a lista de pessoas.
//! Assim dá para testar com `cargo test` em qualquer sistema.

use serde_json::{Value, json};

/// O avatar como o servidor trafega (src/protocol.js `normalizeAvatar`): só a
/// receita, e o desenho acontece em quem mostra; ou uma foto (data URL).
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Avatar {
    #[default]
    Nenhum,
    Gerado { estilo: String, semente: String },
    Foto(String),
}

impl Avatar {
    pub fn de(v: &Value) -> Avatar {
        if let Some(f) = v["photo"].as_str() {
            return Avatar::Foto(f.to_string());
        }
        match v["style"].as_str() {
            Some(e) => Avatar::Gerado { estilo: e.to_string(), semente: v["seed"].as_str().unwrap_or("vcall").to_string() },
            None => Avatar::Nenhum,
        }
    }

    pub fn json(&self) -> Value {
        match self {
            Avatar::Nenhum => Value::Null,
            Avatar::Gerado { estilo, semente } => json!({ "style": estilo, "seed": semente }),
            Avatar::Foto(f) => json!({ "photo": f }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pessoa {
    pub id: String,
    pub nome: String,
    pub mic: bool,
    pub cam: bool,
    pub tela: bool,
    pub mao: bool,
    pub anfitriao: bool,
    pub avatar: Avatar,
}

impl Pessoa {
    /// A "publicView" de um participante (src/rooms.js).
    fn de(v: &Value) -> Option<Pessoa> {
        let mut p = Pessoa {
            id: v["id"].as_str()?.to_string(),
            nome: v["name"].as_str().unwrap_or("Convidado").to_string(),
            mic: false,
            cam: false,
            tela: false,
            mao: false,
            anfitriao: v["host"].as_bool().unwrap_or(false),
            avatar: Avatar::de(&v["avatar"]),
        };
        p.estado(&v["state"]);
        Some(p)
    }

    fn estado(&mut self, s: &Value) {
        let b = |k: &str| s[k].as_bool().unwrap_or(false);
        (self.mic, self.cam, self.tela, self.mao) = (b("mic"), b("cam"), b("screen"), b("hand"));
    }
}

#[derive(Default)]
pub struct Sala {
    pub eu: Option<String>,
    pub nome: String,
    pub pessoas: Vec<Pessoa>,
    /// Sala de espera, recusa do servidor: o que mostrar no lugar da lista.
    pub aviso: String,
    /// (Para o anfitrião) quem está na porta: (id, nome).
    pub porta: Vec<(String, String)>,
    pub trancada: bool,
}

impl Sala {
    /// Aplica uma mensagem do servidor; devolve se algo mudou.
    pub fn aplicar(&mut self, m: &Value) -> bool {
        let id = m["id"].as_str().unwrap_or("");
        match m["t"].as_str().unwrap_or("") {
            "welcome" => {
                self.eu = m["you"]["id"].as_str().map(str::to_string);
                self.nome = m["room"]["name"].as_str().unwrap_or("").to_string();
                self.pessoas = Pessoa::de(&m["you"]).into_iter().chain(m["peers"].as_array().into_iter().flatten().filter_map(Pessoa::de)).collect();
                self.aviso.clear();
            }
            "peer-join" => {
                let Some(p) = Pessoa::de(&m["peer"]) else { return false };
                // Reconexão: a conexão nova substitui a velha, sem aparecer duas vezes.
                let velho = m["replaces"].as_str().unwrap_or("");
                self.pessoas.retain(|x| x.id != p.id && x.id != velho);
                self.pessoas.push(p);
            }
            "peer-leave" => {
                self.pessoas.retain(|x| x.id != id);
                if let Some(h) = m["newHost"].as_str() {
                    for p in &mut self.pessoas {
                        p.anfitriao = p.id == h;
                    }
                }
            }
            "state" => match self.pessoas.iter_mut().find(|p| p.id == id) {
                Some(p) => p.estado(&m["state"]),
                None => return false,
            },
            "profile" => match self.pessoas.iter_mut().find(|p| p.id == id) {
                Some(p) => {
                    p.nome = m["name"].as_str().unwrap_or("Convidado").to_string();
                    p.avatar = Avatar::de(&m["avatar"]);
                }
                None => return false,
            },
            "host" => {
                for p in &mut self.pessoas {
                    p.anfitriao = p.id == id;
                }
            }
            "waiting" => self.aviso = "Na sala de espera: o anfitrião decide se você entra.".into(),
            "knock" => {
                self.porta.retain(|(i, _)| i != id);
                self.porta.push((id.to_string(), m["name"].as_str().unwrap_or("Convidado").to_string()));
            }
            "knock-gone" => self.porta.retain(|(i, _)| i != id),
            "room" => self.trancada = m["closed"].as_bool().unwrap_or(false),
            "error" => self.aviso = format!("O servidor recusou a entrada ({}).", m["error"].as_str().unwrap_or("?")),
            _ => return false,
        }
        true
    }
}

/// A mensagem de entrada na sala (C2S.JOIN). Ainda sem mídia: tudo desligado.
pub fn entrada(sala: &str, nome: &str, avatar: &Avatar, sessao: &str, aparelho: &str) -> Value {
    json!({
        "t": "join",
        "room": sala,
        "profile": { "name": nome, "avatar": avatar.json() },
        "state": { "mic": false, "cam": false, "screen": false, "hand": false, "board": false },
        "session": sessao,
        "device": aparelho,
    })
}

/// O link da sala, como os navegadores abrem: "http://maquina:7718/#sala"
/// vira ("ws://maquina:7718/", "sala"); "https://..." (túnel) vira "wss://...".
pub fn ler_link(link: &str) -> Option<(String, String)> {
    let (base, frag) = link.trim().split_once('#')?;
    let sala = frag.split(['?', '&', '/']).next()?;
    let valida = (16..=64).contains(&sala.len()) && sala.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valida {
        return None;
    }
    let (esquema, resto) = match base.strip_prefix("https://") {
        Some(r) => ("wss", r),
        None => ("ws", base.strip_prefix("http://")?),
    };
    let host = resto.split('/').next().filter(|h| !h.is_empty())?;
    Some((format!("{esquema}://{host}/"), sala.to_string()))
}

/// Sessão e aparelho: 32 letras e números (o servidor aceita 16 a 128).
pub fn token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    (0..32)
        .map(|i| {
            let mut h = RandomState::new().build_hasher();
            h.write_usize(i);
            ABC[(h.finish() % ABC.len() as u64) as usize] as char
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pessoa(id: &str, nome: &str) -> Value {
        json!({ "id": id, "name": nome, "state": { "mic": true, "cam": false, "screen": false, "hand": false }, "host": false })
    }

    #[test]
    fn links() {
        assert_eq!(ler_link("http://192.168.0.5:7718/#sala-de-teste-12345"), Some(("ws://192.168.0.5:7718/".into(), "sala-de-teste-12345".into())));
        assert_eq!(ler_link("http://localhost:7718#abcdefghijklmnop?x=1"), Some(("ws://localhost:7718/".into(), "abcdefghijklmnop".into())));
        assert_eq!(ler_link("http://localhost:7718/#curta"), None, "sala com menos de 16");
        assert_eq!(ler_link("http://localhost:7718/"), None, "sem sala");
        assert_eq!(ler_link("ftp://x/#abcdefghijklmnop"), None);
        assert_eq!(ler_link("https://abc.trycloudflare.com/#abcdefghijklmnop"), Some(("wss://abc.trycloudflare.com/".into(), "abcdefghijklmnop".into())), "pelo túnel: TLS");
    }

    #[test]
    fn tokens_validos() {
        let t = token();
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(t, token(), "cada um diferente");
    }

    #[test]
    fn sala_acompanha_o_servidor() {
        let mut s = Sala::default();
        assert!(s.aplicar(&json!({ "t": "welcome", "you": pessoa("eu", "Nativo"), "peers": [pessoa("a", "Ana")], "room": { "name": "Time" } })));
        assert_eq!((s.eu.as_deref(), s.nome.as_str(), s.pessoas.len()), (Some("eu"), "Time", 2));
        assert_eq!(s.pessoas[0].id, "eu", "você primeiro");

        s.aplicar(&json!({ "t": "peer-join", "peer": pessoa("b", "Bruno"), "replaces": null }));
        s.aplicar(&json!({ "t": "peer-join", "peer": pessoa("b2", "Bruno"), "replaces": "b" }));
        assert_eq!(s.pessoas.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["eu", "a", "b2"], "reconexão não duplica");

        s.aplicar(&json!({ "t": "state", "id": "a", "state": { "mic": false, "cam": true, "screen": true, "hand": true } }));
        let a = &s.pessoas[1];
        assert!(!a.mic && a.cam && a.tela && a.mao);

        s.aplicar(&json!({ "t": "profile", "id": "a", "name": "Ana Paula" }));
        assert_eq!(s.pessoas[1].nome, "Ana Paula");

        s.aplicar(&json!({ "t": "peer-leave", "id": "a", "newHost": "eu" }));
        assert_eq!(s.pessoas.len(), 2);
        assert!(s.pessoas[0].anfitriao);

        assert!(!s.aplicar(&json!({ "t": "state", "id": "ninguem", "state": {} })), "pessoa que não está aqui não muda nada");
        s.aplicar(&json!({ "t": "waiting", "name": "Time" }));
        assert!(s.aviso.contains("espera"));
    }

    #[test]
    fn entrada_valida_para_o_servidor() {
        let e = entrada("abcdefghijklmnop", "Nativo", &Avatar::Gerado { estilo: "paisagemMar".into(), semente: "x".into() }, &token(), &token());
        assert_eq!(e["t"], "join");
        assert_eq!(e["profile"]["name"], "Nativo");
        assert_eq!(e["state"]["mic"], false);
    }
}
