//! O som recebido: cada fonte (microfone, som da tela de cada pessoa) tem uma
//! fila, e a saída do sistema (cpal) soma as filas. O que sai também vai ao
//! cancelamento de eco do microfone (local.rs): é esse som que ele tira.
//!
//! ponytail: trava (Mutex) dentro do callback de áudio; fila sem trava
//! (rtrb) se aparecer estalo com muita gente na sala.

use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::local::ApmCompartilhado;
use crate::rtc::Fila;

pub struct Som {
    fontes: Arc<Mutex<Vec<Fila>>>,
    _saida: cpal::Stream,
    pub taxa: u32,
    pub canais: u32,
}

impl Som {
    /// A saída padrão do sistema. `None`: sem saída de som utilizável.
    pub fn novo(apm: ApmCompartilhado) -> Option<Som> {
        let disp = cpal::default_host().default_output_device()?;
        let cfg = disp.default_output_config().ok()?;
        if cfg.sample_format() != cpal::SampleFormat::F32 {
            eprintln!("[som] saída em {:?}: por enquanto só f32", cfg.sample_format());
            return None;
        }
        let (taxa, canais) = (cfg.sample_rate(), cfg.channels() as u32);
        let fontes: Arc<Mutex<Vec<Fila>>> = Arc::default();
        let f = fontes.clone();
        let dez_ms = (taxa / 100 * canais) as usize;
        let mut eco: Vec<i16> = Vec::new();
        let saida = disp
            .build_output_stream(
                cfg.config(),
                move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    misturar(&f, out);
                    // O cancelamento de eco quer pedaços de 10 ms.
                    eco.extend(out.iter().map(|s| (s * 32767.0) as i16));
                    let inteiros = eco.len() / dez_ms * dez_ms;
                    if inteiros > 0 {
                        let _ = apm.lock().unwrap().0.process_reverse_stream(&mut eco[..inteiros], taxa as i32, canais as i32);
                        eco.drain(..inteiros);
                    }
                },
                |e| eprintln!("[som] {e}"),
                None,
            )
            .ok()?;
        saida.play().ok()?;
        Some(Som { fontes, _saida: saida, taxa, canais })
    }

    /// Para a malha: registra uma fonte nova e devolve a fila dela.
    pub fn registrador(&self) -> Arc<dyn Fn() -> Fila + Send + Sync> {
        let f = self.fontes.clone();
        Arc::new(move || {
            let q: Fila = Arc::default();
            f.lock().unwrap().push(q.clone());
            q
        })
    }
}

/// Soma as filas na saída (i16 -> f32), tirando as fontes que acabaram.
pub fn misturar(fontes: &Mutex<Vec<Fila>>, out: &mut [f32]) {
    out.fill(0.0);
    let mut fontes = fontes.lock().unwrap();
    fontes.retain(|f| Arc::strong_count(f) > 1); // a tarefa da fonte terminou
    for f in fontes.iter() {
        let mut q = f.lock().unwrap();
        for s in out.iter_mut() {
            match q.pop_front() {
                Some(v) => *s += v as f32 / 32768.0,
                None => break,
            }
        }
    }
    for s in out.iter_mut() {
        *s = s.clamp(-1.0, 1.0);
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn soma_e_tira_quem_acabou() {
        let a: Fila = Arc::new(Mutex::new([16384i16, 16384, 16384].into_iter().collect()));
        let b: Fila = Arc::new(Mutex::new([16384i16, -32768].into_iter().collect()));
        let fontes = Mutex::new(vec![a.clone(), b.clone()]);
        let mut out = [0f32; 4];
        misturar(&fontes, &mut out);
        assert_eq!(out, [1.0, -0.5, 0.5, 0.0], "soma, limita em 1 e cala quando a fila acaba");
        drop(b);
        misturar(&fontes, &mut out);
        assert_eq!(fontes.lock().unwrap().len(), 1, "a fonte cuja tarefa terminou sai da mistura");
    }
}
