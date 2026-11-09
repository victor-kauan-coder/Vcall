//! Avatares SVG do Vcall idênticos aos do web.
//!
//! Não há reimplementação: o próprio JavaScript do web (public/js/ui/avatars.js
//! e o que ele importa) roda num QuickJS embutido. Os arquivos entram no
//! binário por `include_str!`, então o app nativo usa sempre os mesmos
//! arquivos do web.
//!
//! O que [`Avatares::svg`] devolve é o `avatarSvg({style, seed})` do web: a
//! string antes de `setAvatar` pô-la no DOM. Ficam de fora só os enfeites do
//! DOM: o `<span class="avatar">` em volta (tamanho vem do CSS) e o sufixo
//! `-vN` que `uniquifyIds` põe nos `id` a cada inserção (evita colisão de
//! `id` entre SVGs inline na mesma página; o N é um contador global, então
//! nem é determinístico). No nativo cada SVG é lido sozinho, sem colisão.

use rquickjs::loader::{BuiltinLoader, BuiltinResolver};
use rquickjs::{CatchResultExt, Context, Ctx, Function, Module, Object, Runtime};
use std::cell::RefCell;
use std::collections::HashMap;

/// Os módulos do web, com os caminhos relativos a public/ (os `import`
/// relativos entre eles se resolvem sobre esses nomes).
macro_rules! modulo {
    ($caminho:literal) => {
        (
            $caminho,
            include_str!(concat!("../../../public/", $caminho)),
        )
    };
}
const MODULOS: [(&str, &str); 6] = [
    modulo!("js/ui/avatars.js"),
    modulo!("js/ui/avatar-vcall.js"),
    modulo!("js/ui/avatar-paisagem.js"),
    modulo!("js/lib/dom.js"),
    modulo!("js/lib/util.js"),
    modulo!("vendor/avatars.js"),
];

/// O QuickJS não tem Intl e o util.js cria dois `Intl.NumberFormat` ao
/// carregar (só usados para formatar números na tela, nunca nos avatares).
const PRELUDIO: &str =
    "globalThis.Intl ??= { NumberFormat: class { format(v) { return String(v); } } };";

/// Ponte para o Rust: as funções do web, sem mudar nada no caminho.
const COLA: &str = r#"
import { avatarSvg, AVATAR_STYLES, semCartum } from "js/ui/avatars.js";
globalThis.vcallAvatares = {
  svg: (style, seed) => avatarSvg({ style, seed }),
  estilos: () => AVATAR_STYLES,
  // semCartum troca o estilo antigo pela paisagem da semente: a mesma
  // paisagemDaSemente que defaultAvatar() usa para quem chega.
  estiloPadrao: (seed) => semCartum({ style: "vcall", seed }).style,
};
"#;

/// O runtime QuickJS com os módulos do web já carregados.
///
/// Não é `Send`: crie um por thread (o carregamento leva alguns ms).
pub struct Avatares {
    ctx: Context,
    estilos: Vec<String>,
    // ponytail: cache sem limite; uma sala tem poucas dezenas de avatares.
    cache: RefCell<HashMap<(String, String), Option<String>>>,
}

impl Avatares {
    pub fn novo() -> Result<Self, String> {
        let rt = Runtime::new().map_err(|e| e.to_string())?;
        let mut resolvedor = BuiltinResolver::default();
        let mut carregador = BuiltinLoader::default();
        for (nome, fonte) in MODULOS {
            resolvedor.add_module(nome);
            carregador.add_module(nome, fonte);
        }
        rt.set_loader(resolvedor, carregador);
        let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
        let estilos = ctx.with(|ctx| {
            ctx.eval::<(), _>(PRELUDIO)
                .and_then(|_| Module::evaluate(ctx.clone(), "vcall-avatares", COLA)?.finish::<()>())
                .and_then(|_| ponte(&ctx, "estilos")?.call::<_, Vec<String>>(()))
                .catch(&ctx)
                .map_err(|e| format!("avatares do web não carregaram: {e}"))
        })?;
        Ok(Self {
            ctx,
            estilos,
            cache: RefCell::default(),
        })
    }

    /// O SVG do avatar, igual ao do web. Estilo desconhecido vira o padrão do
    /// web ("notionistsNeutral") e semente vazia vira "vcall", como lá.
    /// `None` só se a geração falhar (o web mostraria o avatar vazio).
    pub fn svg(&self, estilo: &str, semente: &str) -> Option<String> {
        let chave = (estilo.to_owned(), semente.to_owned());
        if let Some(svg) = self.cache.borrow().get(&chave) {
            return svg.clone();
        }
        let svg = self
            .ctx
            .with(|ctx| ponte(&ctx, "svg")?.call::<_, String>((estilo, semente)))
            .ok()
            .filter(|s| !s.is_empty());
        self.cache.borrow_mut().insert(chave, svg.clone());
        svg
    }

    /// Os estilos da escolha de avatar, na ordem do web: paisagens primeiro.
    pub fn estilos(&self) -> Vec<String> {
        self.estilos.clone()
    }

    /// O estilo que o web dá a quem chega com esta semente (uma paisagem).
    /// Avatar de quem chega: `let s = semente_aleatoria(); (av.estilo_padrao(&s), s)`.
    pub fn estilo_padrao(&self, semente: &str) -> String {
        self.ctx
            .with(|ctx| ponte(&ctx, "estiloPadrao")?.call::<_, String>((semente,)))
            .unwrap_or_else(|_| self.estilos[0].clone())
    }
}

fn ponte<'js>(ctx: &Ctx<'js>, nome: &str) -> rquickjs::Result<Function<'js>> {
    ctx.globals().get::<_, Object>("vcallAvatares")?.get(nome)
}

/// Semente nova no formato do `randomSeed()` do web: 8 caracteres de 0-9a-z.
pub fn semente_aleatoria() -> String {
    use std::hash::{BuildHasher, RandomState};
    let mut n = RandomState::new().hash_one(std::time::SystemTime::now());
    (0..8)
        .map(|_| {
            let d = (n % 36) as u32;
            n /= 36;
            char::from_digit(d, 36).unwrap()
        })
        .collect()
}
