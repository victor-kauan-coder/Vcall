# Hyperframes Composition Brief: Vcall

## Objective
Vídeo curto de lançamento do Vcall, chamativo e animado, mostrando TODAS as
telas do produto e deixando claro que usar é fácil.

## Output
- Diretório da composição: `brag-output/composition/`
- Vídeo: `brag-output/brag.mp4`
- Formato: landscape — 1920×1080, 30 fps
- Duração: 52,8 s (16 cenas)

## Source Material
- Raiz do projeto: `/home/user/Vcall`
- Lidos: `public/index.html`, `public/css/tokens.css`, `public/css/motion.css`,
  `public/js/main.js`, `public/js/ui/dashboard.js`, `public/js/ui/dock.js`,
  `public/js/features/canvas.js`, `PRODUCT.md`, `README.md`, `package.json`
- Produto: **Vcall**
- Afirmação mais forte: *"Chame quem importa, direto de um computador para o
  outro."* e *"O servidor só apresenta os participantes — ele não vê nem guarda
  nada da conversa."*
- Momento visual a recriar: a intro animada do app (duas figuras do "V" se
  alcançando, degradê rosa → laranja sobre azul-tinta), reconstruída com os
  MESMOS caminhos SVG de `public/index.html`.
- Texto que aparece literal:
  - "Chame quem importa, direto de um computador para o outro." (na captura)
  - "Até 16 pessoas. Sem conta. Sem instalar."
  - "Nitidez ou fluidez"
  - "Código P2P · 8PTJ37 · Seis caracteres para ditar por telefone." (captura)
  - "Enviar pelo WhatsApp" (captura)

## Creative Direction
- Preset: `chaotic` só nas entradas; a direção é **anúncio brasileiro colorido
  que respira**
- Interpretação: 16 cenas em 52,8 s, nenhuma abaixo de 3,1 s, nenhum corte
  interno abaixo de 1,2 s. A primeira versão tinha 24 s e cortes de 0,55 s —
  informação demais ao mesmo tempo. Energia vem do movimento e da música, não
  da velocidade do corte.
- **Tema escuro em tudo**, como o produto roda; as capturas foram refeitas com
  `vcall:theme = "dark"`.
- **Para que serve, mostrado e não afirmado**: as salas existem com os nomes
  `Reunião de equipe · Q3`, `Grupo de estudos · Cálculo II` e
  `Aula de violão · iniciantes`, são públicas, e a tela inicial as lista em
  "Ao vivo agora". O quadro branco acontece dentro do grupo de estudos.
- **O seletor de cor é uma cena**: as cinco paletas do produto no painel de
  ajustes, e a mesma chamada trocando de cor de verdade.
- Ângulo: o Vcall vende o mecanismo. A chamada vai direto de uma máquina para a
  outra, e é por isso que não existe conta, mensalidade nem gravação na nuvem.
  O vídeo mostra isso acontecendo: três cliques até a sala no ar, o código de
  seis letras para ditar, a sala enchendo, e o mesmo desenho aparecendo na tela
  de outra pessoa.
- Gancho: a marca se montando, como no próprio app.
- Fecho: "Abra o navegador e chame."
- Evitar: linguagem genérica de SaaS, imagem abstrata de enfeite, redesenho da
  interface.

## Visual Identity
- Fundo (escuro): `#110c3a` / intro `#0c0e13`
- Fundo (claro): `#f4f6fb`
- Acento: `#fd4d87` (rosa) e `#fe9c5f` (laranja); degradê `135deg`
- Pílulas com texto branco usam `#d12c5e → #c0611c` — os tons profundos dos
  botões primários do app, que passam em contraste AA (o degradê claro dava
  2,5:1 e o `check` reprovou)
- Fonte de título: **Bricolage Grotesque**, servida de
  `assets/fonts/bricolage-latin.woff2`, a mesma fonte do produto
- Fonte de texto: pilha do sistema, como no app
- Referências visuais: a intro animada, o mosaico de avatares, o quadro branco,
  o diálogo de compartilhar tela

## Storyboard
O contrato criativo é a tabela de 16 cenas em `brag-plan.md`.

## Audio
- Papel: cama rítmica densa, alegre, que puxa o corte
- Arco: entra baixa (0,18), sobe em 0,9 s, segura, some em 1,5 s no fim
- Música: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (109,96 BPM)
- Tratamento: `data-automation` na pista de volume, com fade de entrada e de
  saída; SFX por baixo da música, nunca por cima
- Cues: preset de
  `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-12-*.music-cues.md`
  - **beat-locked**: 17,47 (o código salta) · 24,56 (a pílula do chat pulsa) ·
    32,74 (o quadro abre em dois lados) · 50,20 e 50,74 (o fecho)
  - **beat-grid**: o giro das paletas em 45,84 · 46,93 · 47,75 · 48,55
- Reatividade: **sutil**. O halo da abertura e o brilho do fecho respiram com o
  grave (escala 0,94–1,10); o "Vcall" do fecho ganha um brilho leve no agudo.
  Amostragem quadro a quadro via `tl.call`, com dados pré-extraídos por
  `hyperframes-creative/scripts/extract-audio-data.py` em `assets/audio-data.js`.
  Sem barra de equalizador, sem onda, sem partícula.
- SFX (todos de baixo/médio risco de agudo, pelo `sfx-analysis.md`): um por
  virada de cena, 15 no total — `impactSoft_medium_001` nos cortes de assunto,
  `click_002`/`click_003` nos gestos de interface, `switch_007` no quadro e na
  tela, e `impactBell_heavy_000` no logotipo do fecho (49,56).
- Arquivos em `composition/assets/music/` e `composition/assets/sfx/`

## Leitura e verdade
- Toda linha fica na tela pelo menos 0,3 s por palavra depois de assentar.
- Nenhuma afirmação inventada: tudo o que o vídeo diz sobre o produto está no
  código, na interface ou no `PRODUCT.md`. O que é invenção é só enquadramento
  ("Abra o navegador e chame").
- Nenhum endereço de máquina em quadro: o convite entra recortado no código P2P
  e no botão do WhatsApp; o `localhost:3977` das capturas ficou de fora.

## Gate
`npx hyperframes check` — 0 erros, 11/11 textos passam em AA, 0 achados de
runtime e movimento. Restam avisos de ergonomia do Studio
(`nested_structure_needs_subcomposition`, arquivo longo), que não afetam o
render.

Correções que o gate pegou nesta versão: os três véus de passagem nasciam
visíveis (`gsap_fullscreen_overlay_starts_visible`) e cobririam todo quadro
anterior ao primeiro tween — resolvido com `opacity: 0` em linha; e as palavras
apagadas da cena 12 estavam a 2,58:1 — subiram para 52% de branco.
