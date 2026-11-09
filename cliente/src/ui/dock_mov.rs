//! O movimento do app (js/ui/motion.js e tokens.css): curvas, molas e
//! transições como as do CSS. O GPUI não tem `transition`: quem desenha guarda
//! uma `Trans` e pede o próximo quadro enquanto ela anda.

use std::cell::Cell;
use std::sync::LazyLock;
use std::time::Instant;

use gpui::{Hsla, Rgba};

/// `cubic-bezier(x1, y1, x2, y2)` do CSS, em x ∈ [0, 1].
pub fn bezier(x1: f32, y1: f32, x2: f32, y2: f32, x: f32) -> f32 {
    if x <= 0. {
        return 0.;
    }
    if x >= 1. {
        return 1.;
    }
    let c = |a: f32, b: f32, t: f32| 3. * a * (1. - t) * (1. - t) * t + 3. * b * (1. - t) * t * t + t * t * t;
    let (mut lo, mut hi) = (0f32, 1f32);
    for _ in 0..24 {
        let m = (lo + hi) / 2.;
        if c(x1, x2, m) < x { lo = m } else { hi = m }
    }
    c(y1, y2, (lo + hi) / 2.)
}

/// `--ease-out` (tokens.css:89).
pub fn ease_out(x: f32) -> f32 {
    bezier(0.22, 1., 0.36, 1., x)
}

/// `--ease-in-out` (tokens.css:90).
pub fn ease_in_out(x: f32) -> f32 {
    bezier(0.65, 0., 0.35, 1., x)
}

/// A palavra `ease-out` do CSS (o aperto do botão, motion.js:483).
pub fn ease_out_css(x: f32) -> f32 {
    bezier(0., 0., 0.58, 1., x)
}

/// Mola amortecida, resolvida como em motion.js `spring` (a mesma duração).
pub struct Mola {
    w0: f32,
    zeta: f32,
    /// Segundos até ficar a menos de 0,1% do fim.
    pub dur: f32,
}

impl Mola {
    fn nova(rigidez: f32, amortecimento: f32) -> Mola {
        let w0 = rigidez.sqrt();
        let zeta = amortecimento / (2. * rigidez.sqrt());
        let mut m = Mola { w0, zeta, dur: 3. };
        let mut fim = 0.;
        let mut t = 0.;
        while t < 3. {
            if (1. - m.x(t)).abs() > 0.001 {
                fim = t;
            }
            t += 1. / 120.;
        }
        m.dur = fim.max(0.12);
        m
    }

    fn x(&self, t: f32) -> f32 {
        let (w0, z) = (self.w0, self.zeta);
        if z < 1. {
            let wd = w0 * (1. - z * z).sqrt();
            1. - (-z * w0 * t).exp() * ((wd * t).cos() + (z * w0 / wd) * (wd * t).sin())
        } else {
            1. - (-w0 * t).exp() * (1. + w0 * t)
        }
    }

    /// O progresso (passa de 1 no balanço) depois de `s` segundos.
    pub fn em(&self, s: f32) -> f32 {
        if s >= self.dur { 1. } else { self.x(s.max(0.)) }
    }
}

/// motion.js SPRING.snappy (menus), .bouncy (entradas) e a volta do aperto.
pub static SNAPPY: LazyLock<Mola> = LazyLock::new(|| Mola::nova(520., 34.));
pub static BOUNCY: LazyLock<Mola> = LazyLock::new(|| Mola::nova(300., 17.));
pub static SOLTAR: LazyLock<Mola> = LazyLock::new(|| Mola::nova(500., 14.));

pub fn segundos(desde: Instant, agora: Instant) -> f32 {
    agora.saturating_duration_since(desde).as_secs_f32()
}

pub fn misturar(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Cor no meio do caminho (o CSS mistura em sRGB).
pub fn misturar_cor(a: Hsla, b: Hsla, t: f32) -> Hsla {
    let (a, b) = (Rgba::from(a), Rgba::from(b));
    Rgba { r: misturar(a.r, b.r, t), g: misturar(a.g, b.g, t), b: misturar(a.b, b.b, t), a: misturar(a.a, b.a, t) }.into()
}

pub trait Mistura: Copy + PartialEq {
    fn mistura(a: Self, b: Self, t: f32) -> Self;
}
impl Mistura for f32 {
    fn mistura(a: f32, b: f32, t: f32) -> f32 {
        misturar(a, b, t)
    }
}
impl Mistura for Hsla {
    fn mistura(a: Hsla, b: Hsla, t: f32) -> Hsla {
        misturar_cor(a, b, t)
    }
}

/// Uma `transition` do CSS: mudou o alvo, parte do valor de agora.
#[derive(Clone, Copy)]
pub struct Trans<T> {
    de: T,
    para: T,
    t0: Option<Instant>,
    dur: f32,
    curva: fn(f32) -> f32,
}

impl<T: Mistura> Trans<T> {
    pub fn new(v: T, ms: f32, curva: fn(f32) -> f32) -> Self {
        Trans { de: v, para: v, t0: None, dur: ms / 1000., curva }
    }

    pub fn valor(&self, agora: Instant) -> T {
        match self.t0 {
            Some(t0) if segundos(t0, agora) < self.dur => T::mistura(self.de, self.para, (self.curva)(segundos(t0, agora) / self.dur)),
            _ => self.para,
        }
    }

    pub fn ir(&mut self, alvo: T, agora: Instant) {
        if alvo != self.para {
            self.de = self.valor(agora);
            self.para = alvo;
            self.t0 = Some(agora);
        }
    }

    pub fn andando(&self, agora: Instant) -> bool {
        self.t0.is_some_and(|t0| segundos(t0, agora) < self.dur)
    }
}

/// Keyframes do CSS: (posição 0..1, valor), com a curva aplicada em cada trecho.
pub fn quadros(q: &[(f32, f32)], p: f32, curva: fn(f32) -> f32) -> f32 {
    let p = p.clamp(0., 1.);
    for par in q.windows(2) {
        let ((a, va), (b, vb)) = (par[0], par[1]);
        if p <= b {
            return misturar(va, vb, curva(if b > a { (p - a) / (b - a) } else { 1. }));
        }
    }
    q.last().map_or(0., |u| u.1)
}

thread_local!(static SEMENTE: Cell<u64> = Cell::new(
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(7, |d| d.as_nanos() as u64) ^ 0x9e37_79b9_7f4a_7c15
));

/// Math.random() entre a e b (xorshift; é só para espalhar emoji).
pub fn aleatorio(a: f32, b: f32) -> f32 {
    SEMENTE.with(|s| {
        let mut x = s.get() | 1;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.set(x);
        a + (x >> 40) as f32 / (1u64 << 24) as f32 * (b - a)
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn molas_com_as_duracoes_do_app() {
        // ESPEC 8.3: snappy 342 ms, bouncy 725 ms, a volta do aperto 933 ms.
        for (m, ms) in [(&*SNAPPY, 342.), (&*BOUNCY, 725.), (&*SOLTAR, 933.)] {
            assert!((m.dur * 1000. - ms).abs() < 10., "{} != {ms}", m.dur * 1000.);
            assert_eq!(m.em(10.), 1.);
        }
        assert!(BOUNCY.em(0.2) > 1.05, "bouncy passa do fim");
    }

    #[test]
    fn curvas_e_quadros() {
        assert!((ease_out(0.5) - 0.9614).abs() < 0.002);
        assert_eq!(bezier(0.2, 0.6, 0.3, 1., 1.2), 1.);
        let q = [(0., 0.), (0.5, 10.), (1., 0.)];
        assert_eq!(quadros(&q, 0.5, |x| x), 10.);
        assert_eq!(quadros(&q, 0.75, |x| x), 5.);
        for _ in 0..100 {
            let v = aleatorio(-70., 70.);
            assert!((-70. ..70.).contains(&v));
        }
    }
}
