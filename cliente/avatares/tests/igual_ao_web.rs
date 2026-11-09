//! O SVG do QuickJS tem de ser byte a byte o do web (o mesmo JS no Node).

use serde_json::Value;
use std::process::Command;
use std::time::Instant;
use vcall_avatares::{Avatares, semente_aleatoria};

fn referencia() -> Value {
    let harness = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/web.mjs");
    let saida = Command::new("node")
        .arg(harness)
        .output()
        .expect("node não encontrado");
    assert!(
        saida.status.success(),
        "{}",
        String::from_utf8_lossy(&saida.stderr)
    );
    serde_json::from_slice(&saida.stdout).unwrap()
}

#[test]
fn igual_ao_web() {
    let web = referencia();
    let av = Avatares::novo().unwrap();

    let estilos = av.estilos();
    let esperado: Vec<String> = serde_json::from_value(web["estilos"].clone()).unwrap();
    assert_eq!(estilos, esperado);

    let avatares = web["avatares"].as_array().unwrap();
    let mut diferentes = Vec::new();
    for a in avatares {
        let (estilo, semente) = (a["style"].as_str().unwrap(), a["seed"].as_str().unwrap());
        let svg = av.svg(estilo, semente).unwrap_or_default();
        if svg != a["svg"].as_str().unwrap() {
            diferentes.push(format!("{estilo} / {semente:?}"));
        }
        // Do cache tem de sair o mesmo.
        assert_eq!(av.svg(estilo, semente).unwrap_or_default(), svg);
    }
    for e in &estilos {
        let n = avatares.iter().filter(|a| a["style"] == e.as_str()).count();
        assert!(n >= 5, "{e}: só {n} sementes");
    }
    assert!(
        diferentes.is_empty(),
        "{} de {} diferentes: {diferentes:#?}",
        diferentes.len(),
        avatares.len()
    );

    for p in web["padrao"].as_array().unwrap() {
        assert_eq!(
            av.estilo_padrao(p["seed"].as_str().unwrap()),
            p["style"].as_str().unwrap()
        );
    }
    eprintln!(
        "{} avatares iguais ao web ({} estilos)",
        avatares.len(),
        estilos.len()
    );
}

#[test]
fn semente_no_formato_do_web() {
    let s = semente_aleatoria();
    assert_eq!(s.len(), 8);
    assert!(
        s.chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase())
    );
    assert_ne!(s, semente_aleatoria());
}

#[test]
fn rapido() {
    let t = Instant::now();
    let av = Avatares::novo().unwrap();
    let carga = t.elapsed();
    let estilos = av.estilos();
    for e in &estilos {
        av.svg(e, "aquecimento").unwrap();
    }

    // Sementes novas: o cache (do Rust e do JS) não ajuda.
    const N: usize = 20;
    let mut pior = (String::new(), 0.0);
    let t = Instant::now();
    for e in &estilos {
        let te = Instant::now();
        for i in 0..N {
            av.svg(e, &format!("medida-{i}")).unwrap();
        }
        let ms = te.elapsed().as_secs_f64() * 1e3 / N as f64;
        if ms > pior.1 {
            pior = (e.clone(), ms);
        }
    }
    let media = t.elapsed().as_secs_f64() * 1e3 / (N * estilos.len()) as f64;

    let t = Instant::now();
    for e in &estilos {
        av.svg(e, "medida-0").unwrap();
    }
    let cache = t.elapsed().as_secs_f64() * 1e6 / estilos.len() as f64;

    eprintln!(
        "carga {:.0} ms; {media:.2} ms/avatar (pior: {} {:.2} ms); do cache {cache:.1} µs",
        carga.as_secs_f64() * 1e3,
        pior.0,
        pior.1
    );
    assert!(media < 50.0, "{media:.1} ms por avatar");
}
