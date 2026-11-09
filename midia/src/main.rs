//! vcall-midia: o motor de mídia nativo do Vcall.
//!
//! Captura a tela (ou uma janela) e codifica H.264 na placa de vídeo, sem o
//! quadro passar pela memória do processador. O app de mesa sobe este
//! programa e põe os quadros prontos no WebRTC do Chromium (fase 2).
//!
//!   vcall-midia codificadores           lista os codificadores H.264 da máquina
//!   vcall-midia medir      [opções]     roda e imprime um relatório JSON no fim
//!   vcall-midia transmitir [opções]     quadros na saída padrão, comandos na entrada
//!
//! Opções: --tela N (0 = principal) | --janela HWND | --ponto X,Y (a tela que
//!         contém o ponto, em pixels físicos), --qps 60, --kbps 8000,
//!         --altura 1080 (teto; nunca aumenta), --segundos S (0 = sem fim),
//!         --saida arquivo.h264, --software, --sob-demanda (só no `transmitir`)
//!
//! Saída do `transmitir`, para cada quadro: 16 bytes de cabeçalho
//!   u32 LE tamanho | u8 flags (bit 0 = quadro-chave) | 3 bytes zero | u64 LE captura (µs, relógio QPC)
//! e o quadro H.264 (Annex-B, SPS/PPS antes de todo quadro-chave).
//! Comandos, um por linha: `chave`, `kbps N`, `quadro`, `parar`. Fechar a entrada também para.
//!
//! `--sob-demanda`: só codifica quando recebe `quadro` (a captura mais nova
//! naquele instante), sem passar do `--qps`. Quem injeta os quadros no WebRTC do Chromium pede um a
//! cada quadro que consome; assim cada quadro codificado sai uma vez só, em
//! ordem, e o ritmo e a adaptação do Chromium valem para o motor.
//! Uma linha JSON por segundo na saída de erro com as estatísticas.

#[cfg(windows)]
mod captura;
#[cfg(windows)]
mod codificador;

#[derive(Debug, PartialEq)]
pub enum Comando {
    Chave,
    Kbps(u32),
    Quadro,
    Parar,
}

/// Uma linha da entrada padrão. Linha desconhecida é ignorada.
pub fn ler_comando(linha: &str) -> Option<Comando> {
    let mut p = linha.split_whitespace();
    match (p.next()?, p.next()) {
        ("chave", None) => Some(Comando::Chave),
        ("quadro", None) => Some(Comando::Quadro),
        ("parar", None) => Some(Comando::Parar),
        ("kbps", Some(n)) => n.parse().ok().filter(|&k| k >= 100).map(Comando::Kbps),
        _ => None,
    }
}

/// Tamanho codificado: cabe na altura máxima, mantém a proporção e é par
/// (NV12 e os codificadores da placa recusam medida ímpar).
pub fn tamanho_saida((w, h): (u32, u32), altura_max: u32) -> (u32, u32) {
    let (w, h) = if h > altura_max { ((w as u64 * altura_max as u64 / h as u64) as u32, altura_max) } else { (w, h) };
    ((w & !1).max(2), (h & !1).max(2))
}

/// Cabeçalho de 16 bytes de cada quadro do `transmitir`.
pub fn cabecalho(tamanho: u32, chave: bool, captura_us: u64) -> [u8; 16] {
    let mut c = [0u8; 16];
    c[..4].copy_from_slice(&tamanho.to_le_bytes());
    c[4] = chave as u8;
    c[8..].copy_from_slice(&captura_us.to_le_bytes());
    c
}

struct Opcoes {
    tela: usize,
    janela: Option<isize>,
    ponto: Option<(i32, i32)>,
    qps: u32,
    kbps: u32,
    altura: u32,
    segundos: f64,
    saida: Option<String>,
    software: bool,
    sob_demanda: bool,
}

fn ler_opcoes(args: &[String]) -> Result<Opcoes, String> {
    let mut o = Opcoes { tela: 0, janela: None, ponto: None, qps: 60, kbps: 8000, altura: 1080, segundos: 0.0, saida: None, software: false, sob_demanda: false };
    let mut i = 0;
    while i < args.len() {
        let valor = |i: usize| args.get(i + 1).ok_or_else(|| format!("{} sem valor", args[i]));
        let num = |i: usize| valor(i)?.parse::<f64>().map_err(|_| format!("{} inválido", args[i]));
        match args[i].as_str() {
            "--tela" => o.tela = num(i)? as usize,
            "--janela" => o.janela = Some(num(i)? as isize),
            "--ponto" => o.ponto = Some(ler_ponto(valor(i)?).ok_or_else(|| format!("{} inválido", args[i]))?),
            "--qps" => o.qps = (num(i)? as u32).clamp(1, 240),
            "--kbps" => o.kbps = (num(i)? as u32).max(100),
            "--altura" => o.altura = (num(i)? as u32).max(2),
            "--segundos" => o.segundos = num(i)?.max(0.0),
            "--saida" => o.saida = Some(valor(i)?.clone()),
            "--software" | "--sob-demanda" => {
                if args[i] == "--software" {
                    o.software = true;
                } else {
                    o.sob_demanda = true;
                }
                i += 1;
                continue;
            }
            outro => return Err(format!("opção desconhecida: {outro}")),
        }
        i += 2;
    }
    Ok(o)
}

/// "X,Y" em pixels (pode ser negativo: tela à esquerda da principal).
pub fn ler_ponto(s: &str) -> Option<(i32, i32)> {
    let (x, y) = s.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// Texto JSON entre aspas (nomes de placa e de codificador têm ® e afins).
fn json(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let comando = args.first().map(String::as_str).unwrap_or("");
    let resto = if args.is_empty() { &[][..] } else { &args[1..] };
    let codigo = match comando {
        "codificadores" | "medir" | "transmitir" => match ler_opcoes(resto) {
            Ok(o) => executar(comando, &o),
            Err(e) => {
                eprintln!("{e}");
                2
            }
        },
        _ => {
            eprintln!("uso: vcall-midia codificadores | medir [opções] | transmitir [opções]");
            2
        }
    };
    std::process::exit(codigo);
}

#[cfg(not(windows))]
fn executar(_: &str, _: &Opcoes) -> i32 {
    eprintln!("vcall-midia: por enquanto só no Windows");
    3
}

#[cfg(windows)]
fn executar(comando: &str, o: &Opcoes) -> i32 {
    match windows_::executar(comando, o) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{{\"erro\":{}}}", json(&e));
            1
        }
    }
}

/// Prioridade de multimídia do Windows (MMCSS) para a thread que chama.
#[cfg(windows)]
pub fn mmcss() {
    let mut tarefa = 0u32;
    let _ = unsafe { windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(windows::core::w!("Capture"), &mut tarefa) };
}

#[cfg(windows)]
mod windows_ {
    use std::io::{BufRead, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{RecvTimeoutError, channel};
    use std::sync::{Arc, OnceLock};
    use std::time::{Duration, Instant};

    use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
    use windows::Win32::Media::MediaFoundation::{MFSTARTUP_LITE, MFStartup};
    use windows::Win32::Media::timeBeginPeriod;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
    use windows::Win32::System::Threading::{GetCurrentProcess, HIGH_PRIORITY_CLASS, SetPriorityClass};

    use super::{Comando, Opcoes, cabecalho, json, ler_comando, tamanho_saida};
    use crate::captura::{Alvo, Captura};
    use crate::codificador::{self, Codificado, Codificador, Conversor, Evento};

    const MF_VERSION: u32 = 0x0002_0070;

    /// Relógio QPC em unidades de 100 ns (o mesmo do SystemRelativeTime do WGC).
    fn qpc() -> i64 {
        static FREQ: OnceLock<i64> = OnceLock::new();
        let f = *FREQ.get_or_init(|| {
            let mut f = 0;
            let _ = unsafe { QueryPerformanceFrequency(&mut f) };
            f.max(1)
        });
        let mut c = 0;
        let _ = unsafe { QueryPerformanceCounter(&mut c) };
        (c as i128 * 10_000_000 / f as i128) as i64
    }

    #[derive(Default)]
    struct Estatisticas {
        capturados: u64,
        enviados: u64,
        /// Quadro capturado que outro mais novo substituiu antes de sair:
        /// o codificador ainda não tinha pedido outro, ou era cedo para o qps.
        substituidos_ocupado: u64,
        substituidos_cedo: u64,
        codificados: u64,
        chaves: u64,
        bytes: u64,
        latencias: Vec<f64>,
        /// Da entrega ao codificador até o quadro pronto (o `totalEncodeTime` do WebRTC).
        codificar: Vec<f64>,
    }

    impl Estatisticas {
        fn registrar(&mut self, c: &Codificado, entregue: Option<i64>) {
            if let Some(e) = entregue {
                self.codificar.push((qpc() - e) as f64 / 10_000.0);
            }
            self.codificados += 1;
            self.chaves += c.chave as u64;
            self.bytes += c.dados.len() as u64;
            self.latencias.push((qpc() - c.tempo) as f64 / 10_000.0);
        }

        fn json(&self, segundos: f64) -> String {
            let ordenar = |v: &Vec<f64>| {
                let mut l = v.clone();
                l.sort_by(|a, b| a.total_cmp(b));
                l
            };
            let (l, cod) = (ordenar(&self.latencias), ordenar(&self.codificar));
            let em = |l: &Vec<f64>, q: f64| if l.is_empty() { 0.0 } else { l[((l.len() - 1) as f64 * q).round() as usize] };
            let p = |q: f64| em(&l, q);
            format!(
                "{{\"segundos\":{:.2},\"capturados\":{},\"enviados\":{},\"substituidos\":[{},{}],\"codificados\":{},\"chaves\":{},\"qps\":{:.1},\"kbps\":{:.0},\"latencia_ms\":{{\"p50\":{:.2},\"p95\":{:.2},\"p99\":{:.2},\"max\":{:.2}}},\"codificar_ms\":{{\"p50\":{:.2},\"p95\":{:.2}}}}}",
                segundos,
                self.capturados,
                self.enviados,
                self.substituidos_ocupado,
                self.substituidos_cedo,
                self.codificados,
                self.chaves,
                self.codificados as f64 / segundos.max(0.001),
                self.bytes as f64 * 8.0 / 1000.0 / segundos.max(0.001),
                p(0.5),
                p(0.95),
                p(0.99),
                p(1.0),
                em(&cod, 0.5),
                em(&cod, 0.95)
            )
        }
    }

    pub fn executar(comando: &str, o: &Opcoes) -> Result<(), String> {
        let e = |e: windows::core::Error| e.message();
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(e)?;
            MFStartup(MF_VERSION, MFSTARTUP_LITE).map_err(e)?;
        }
        if comando == "codificadores" {
            let lista = codificador::todos().map_err(e)?;
            let itens: Vec<String> = lista.iter().map(|(n, h)| format!("{{\"nome\":{},\"hardware\":{h}}}", json(n))).collect();
            println!("[{}]", itens.join(","));
            return Ok(());
        }
        rodar(o, comando == "transmitir").map_err(e)
    }

    fn rodar(o: &Opcoes, transmitir: bool) -> windows::core::Result<()> {
        unsafe {
            timeBeginPeriod(1);
            let _ = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
        }
        crate::mmcss();

        let (tx, rx) = channel::<Evento>();
        let marcado = Arc::new(AtomicBool::new(false));
        let alvo = match (o.janela, o.ponto) {
            (Some(h), _) => Alvo::Janela(h),
            (None, Some((x, y))) => Alvo::Ponto(x, y),
            (None, None) => Alvo::Tela(o.tela),
        };
        let (m, t) = (marcado.clone(), tx.clone());
        let mut cap = Captura::abrir(&alvo, move || {
            // Um aviso por vez na fila: quem acorda pega o quadro mais novo.
            if !m.swap(true, Ordering::AcqRel) {
                let _ = t.send(Evento::Capturou);
            }
        })?;
        let saida = tamanho_saida(cap.tamanho, o.altura);
        let mut conv = Conversor::novo(&cap.placa, cap.tamanho, saida, o.qps)?;
        let mut cod = Codificador::novo(&cap.placa, saida, o.qps, o.kbps * 1000, o.software, tx.clone())?;
        let mut bps = o.kbps * 1000;
        let mut recriado = 0u32;

        if transmitir {
            let t = tx.clone();
            std::thread::spawn(move || {
                for linha in std::io::stdin().lock().lines() {
                    let Ok(linha) = linha else { break };
                    if let Some(c) = ler_comando(&linha) {
                        let parar = c == Comando::Parar;
                        let _ = t.send(Evento::Comando(c));
                        if parar {
                            return;
                        }
                    }
                }
                // Entrada fechada: quem subiu este processo foi embora. Pede para
                // parar e, se o laço estiver preso (janela capturada que sumiu e
                // não manda mais quadro), sai de qualquer jeito.
                let _ = t.send(Evento::Comando(Comando::Parar));
                std::thread::sleep(std::time::Duration::from_millis(500));
                std::process::exit(0);
            });
        }

        let ajustes: Vec<String> = cod.ajustes.iter().map(|a| json(a)).collect();
        eprintln!(
            "{{\"pronto\":true,\"codificador\":{},\"hardware\":{},\"placa\":{},\"captura\":[{},{}],\"saida\":[{},{}],\"intervalo_minimo\":{},\"ajustes\":[{}]}}",
            json(&cod.nome),
            cod.hardware,
            json(&cap.placa.nome),
            cap.tamanho.0,
            cap.tamanho.1,
            cod.tamanho().0,
            cod.tamanho().1,
            cap.intervalo_minimo,
            ajustes.join(",")
        );

        let intervalo = 10_000_000 / o.qps as i64;
        // O quadro mais novo ainda não entregue ao codificador: quem chega
        // depois toma o lugar. Assim o último estado da tela sempre sai.
        let mut pendente: Option<(ID3D11Texture2D, i64)> = None;
        let mut ultimo: Option<ID3D11Texture2D> = None;
        let mut ultimo_tempo = i64::MIN / 2;
        // Balde de fichas do qps: uma ficha por intervalo, guarda até 1,5. O
        // horário de captura do WGC oscila (quadros a 14 e a 19 ms); comparar
        // com o quadro anterior descartava 1 em cada 4 a 60 qps.
        let mut fichas = 1.0f64;
        let mut fichas_em = qpc();
        // --sob-demanda: além da ficha do qps, um pedido da página por quadro.
        let mut pedidos = 0u32;
        let mut pedir_chave = false;
        let mut prontos: Vec<Codificado> = Vec::new();
        // Tempo da amostra -> instante da entrega ao codificador.
        let mut entregues: std::collections::VecDeque<(i64, i64)> = std::collections::VecDeque::new();
        let mut est = Estatisticas::default();
        let mut parcial = Estatisticas::default();
        let inicio = Instant::now();
        let mut proximo_relatorio = inicio + Duration::from_secs(1);
        let fim = (o.segundos > 0.0).then(|| inicio + Duration::from_secs_f64(o.segundos));
        let mut arquivo = match &o.saida {
            Some(c) => Some(std::io::BufWriter::new(std::fs::File::create(c).map_err(|e| windows::core::Error::new(windows::Win32::Foundation::E_FAIL, e.to_string()))?)),
            None => None,
        };
        let mut stdout = std::io::stdout().lock();

        loop {
            let espera = match &pendente {
                Some(_) if cod.pronto() && (!o.sob_demanda || pedidos > 0) => Duration::from_micros(((1.0 - fichas).max(0.0) * intervalo as f64 / 10.0) as u64),
                _ => Duration::from_millis(50),
            };
            match rx.recv_timeout(espera) {
                Ok(Evento::Capturou) => {
                    marcado.store(false, Ordering::Release);
                    if let Some(q) = cap.proximo()? {
                        est.capturados += 1;
                        let nv12 = conv.converter(&q.textura)?;
                        if pendente.is_some() {
                            if cod.pronto() {
                                est.substituidos_cedo += 1;
                            } else {
                                est.substituidos_ocupado += 1;
                            }
                        }
                        pendente = Some((nv12, q.tempo));
                    }
                }
                Ok(Evento::Precisa) => cod.precisa(),
                Ok(Evento::Saiu(c)) => {
                    recriado = 0;
                    prontos.push(c);
                }
                Ok(Evento::Comando(Comando::Chave)) => {
                    pedir_chave = true;
                    // Tela parada não gera quadro novo: refaz o último como chave.
                    if pendente.is_none() {
                        pendente = ultimo.clone().map(|t| (t, qpc()));
                    }
                }
                Ok(Evento::Comando(Comando::Kbps(k))) => {
                    bps = k * 1000;
                    cod.mudar_bitrate(bps);
                }
                Ok(Evento::Comando(Comando::Quadro)) => pedidos = (pedidos + 1).min(2),
                Ok(Evento::Comando(Comando::Parar)) => break,
                Ok(Evento::Falhou(m)) => {
                    // Codificador que morre é recriado, e a transmissão segue
                    // (o primeiro quadro do novo é IDR). Dez seguidas: desiste.
                    recriado += 1;
                    eprintln!("{{\"aviso\":{},\"recriado\":{recriado}}}", json(&m));
                    if recriado > 10 {
                        return Err(windows::core::Error::new(windows::Win32::Foundation::E_FAIL, m));
                    }
                    drop(cod);
                    cod = Codificador::novo(&cap.placa, saida, o.qps, bps, o.software, tx.clone())?;
                    if pendente.is_none() {
                        pendente = ultimo.clone().map(|t| (t, qpc()));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }

            // Entrega o pendente quando o codificador aceita e há ficha.
            let agora = qpc();
            fichas = (fichas + (agora - fichas_em) as f64 / intervalo as f64).min(1.5);
            fichas_em = agora;
            if let Some((tex, tempo)) = &pendente {
                if cod.pronto() && fichas >= 1.0 && (!o.sob_demanda || pedidos > 0) {
                    fichas -= 1.0;
                    pedidos = pedidos.saturating_sub(1);
                    let t = (*tempo).max(ultimo_tempo + 1);
                    let aceito = if cod.hardware {
                        cod.enviar_textura(tex, t, pedir_chave, &mut prontos)?
                    } else {
                        let bytes = conv.ler_nv12(tex)?;
                        cod.enviar_memoria(&bytes, t, pedir_chave, &mut prontos)?
                    };
                    if !aceito {
                        fichas += 1.0; // devolve a ficha e o pedido; o quadro continua pendente
                        if o.sob_demanda {
                            pedidos += 1;
                        }
                        continue;
                    }
                    est.enviados += 1;
                    entregues.push_back((t, qpc()));
                    if entregues.len() > 64 {
                        entregues.pop_front();
                    }
                    pedir_chave = false;
                    ultimo = Some(tex.clone());
                    ultimo_tempo = t;
                    pendente = None;
                }
            }

            for c in prontos.drain(..) {
                let entregue = entregues.iter().position(|e| e.0 == c.tempo).map(|i| entregues.remove(i).unwrap().1);
                est.registrar(&c, entregue);
                parcial.registrar(&c, entregue);
                if let Some(a) = &mut arquivo {
                    let _ = a.write_all(&c.dados);
                }
                if transmitir {
                    let ok = stdout.write_all(&cabecalho(c.dados.len() as u32, c.chave, (c.tempo / 10) as u64)).and_then(|_| stdout.write_all(&c.dados)).and_then(|_| stdout.flush());
                    if ok.is_err() {
                        return Ok(()); // quem lia foi embora
                    }
                }
            }

            let agora = Instant::now();
            if transmitir && agora >= proximo_relatorio {
                eprintln!("{}", parcial.json(1.0));
                parcial = Estatisticas::default();
                proximo_relatorio = agora + Duration::from_secs(1);
            }
            if fim.is_some_and(|f| agora >= f) {
                break;
            }
        }

        if let Some(a) = &mut arquivo {
            let _ = a.flush();
        }
        let relatorio = est.json(inicio.elapsed().as_secs_f64());
        if transmitir {
            eprintln!("{relatorio}");
        } else {
            println!("{relatorio}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn comandos() {
        assert_eq!(ler_comando("chave"), Some(Comando::Chave));
        assert_eq!(ler_comando("  kbps 4500 "), Some(Comando::Kbps(4500)));
        assert_eq!(ler_comando("kbps 10"), None); // abaixo de 100 kbps é engano
        assert_eq!(ler_comando("kbps"), None);
        assert_eq!(ler_comando("parar"), Some(Comando::Parar));
        assert_eq!(ler_comando("quadro"), Some(Comando::Quadro));
        assert_eq!(ler_comando("chave agora"), None);
        assert_eq!(ler_comando(""), None);
    }

    #[test]
    fn tamanhos() {
        assert_eq!(tamanho_saida((1920, 1080), 1080), (1920, 1080));
        assert_eq!(tamanho_saida((2560, 1440), 1080), (1920, 1080));
        assert_eq!(tamanho_saida((3840, 2160), 720), (1280, 720));
        // Janela de medida ímpar: vira par, sem aumentar.
        assert_eq!(tamanho_saida((1365, 767), 1080), (1364, 766));
        assert_eq!(tamanho_saida((1926, 1094), 1080), (1900, 1080));
        assert_eq!(tamanho_saida((1, 1), 1080), (2, 2));
    }

    #[test]
    fn pontos() {
        assert_eq!(ler_ponto("960,540"), Some((960, 540)));
        assert_eq!(ler_ponto("-1920, 0"), Some((-1920, 0)));
        assert_eq!(ler_ponto("960"), None);
        assert_eq!(ler_ponto("a,b"), None);
    }

    #[test]
    fn cabecalho_do_quadro() {
        let c = cabecalho(0x0102_0304, true, 0x1122_3344_5566_7788);
        assert_eq!(&c[..4], &[4, 3, 2, 1]);
        assert_eq!(c[4], 1);
        assert_eq!(&c[5..8], &[0, 0, 0]);
        assert_eq!(u64::from_le_bytes(c[8..].try_into().unwrap()), 0x1122_3344_5566_7788);
        assert_eq!(cabecalho(5, false, 0)[4], 0);
    }
}
