# Hyperframes Composition Brief: Vcall

## Objective
Vídeo curto de lançamento do Vcall, chamativo e animado, mostrando TODAS as
telas do produto e deixando claro que usar é fácil.

## Output
- Diretório da composição: `brag-output/composition/`
- Vídeo: `brag-output/brag.mp4`
- Formato: landscape — 1920×1080, 30 fps
- Duração: 24,0 s

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
- Preset: `chaotic`
- Direção: anúncio brasileiro rápido e colorido, sem perder o capricho da marca
- Interpretação: do preset fica o ritmo (9 cenas, cortes de 0,55–3,3 s,
  entradas no beat); da marca fica a elegância — nada de CAIXA ALTA gritada nem
  de estroboscopia. Energia por movimento e corte, não por barulho.
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
O contrato criativo é o storyboard de `brag-plan.md`. Resumo:

1. Abertura, a marca se monta — 2,6 s — logo em SVG, "Vcall", a assinatura
2. A promessa — 2,6 s — a manchete real do site, abrindo do detalhe à tela toda
3. Três passos — 2,7 s — criar, nome, no ar; cursor e clique de verdade
4. Manda o link — 2,5 s — o código P2P e o botão do WhatsApp
5. A sala enche — 2,7 s — 2 → 4 → 6 pessoas, "Até 16 pessoas"
6. Mosaico — 3,3 s — chat, pessoas, rede, reações, legendas, gravação
7. O quadro é de todo mundo — 2,8 s — o desenho, e o mesmo desenho do outro lado
8. Tela e celular — 2,2 s — "Nitidez ou fluidez", depois o celular
9. Fecho — 2,6 s — logo, "Abra o navegador e chame."

## Audio
- Papel: cama rítmica densa, alegre, que puxa o corte
- Arco: entra baixa (0,18), sobe em 0,9 s, segura, some em 1,5 s no fim
- Música: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (109,96 BPM)
- Tratamento: `data-automation` na pista de volume, com fade de entrada e de
  saída; SFX por baixo da música, nunca por cima
- Cues: preset de
  `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-12-*.music-cues.md`
  - **beat-locked** (3): 8,74 s o código salta · 17,47 s o quadro abre em dois
    lados · 22,37 s a chamada final
  - **beat-grid**: o mosaico em 13,11 · 13,64 · 14,20 · 14,73 · 15,29 · 15,84;
    a sala enchendo em 11,46 e 12,55
- Reatividade: **sutil**. O halo da abertura e o brilho do fecho respiram com o
  grave (escala 0,94–1,10); o "Vcall" do fecho ganha um brilho leve no agudo.
  Amostragem quadro a quadro via `tl.call`, com dados pré-extraídos por
  `hyperframes-creative/scripts/extract-audio-data.py` em `assets/audio-data.js`.
  Sem barra de equalizador, sem onda, sem partícula.
- SFX escolhidos (todos de baixo/médio risco de agudo, pelo `sfx-analysis.md`):
  - `impact/impactSoft_medium_001.ogg` — cortes duros (0,12 · 2,60 · 10,40 ·
    13,10 · 17,47)
  - `interface/click_003.ogg` — o clique em "Criar e entrar" (6,02)
  - `interface/click_002.ogg` — o código saltando (8,74)
  - `interface/switch_007.ogg` — quadro e compartilhar tela (16,40 · 19,20)
  - `impact/impactBell_heavy_000.ogg` — o logotipo do fecho (21,46)
- Arquivos em `composition/assets/music/` e `composition/assets/sfx/`

## Leitura e verdade
- Toda linha fica na tela pelo menos 0,3 s por palavra depois de assentar.
- Nenhuma afirmação inventada: tudo o que o vídeo diz sobre o produto está no
  código, na interface ou no `PRODUCT.md`. O que é invenção é só enquadramento
  ("Abra o navegador e chame").
- Nenhum endereço de máquina em quadro: o convite entra recortado no código P2P
  e no botão do WhatsApp; o `localhost:3977` das capturas ficou de fora.

## Gate
`npx hyperframes check` — 0 erros, 0 avisos de contraste (10/10 passam em AA),
0 achados de runtime e movimento. Restam avisos de ergonomia do Studio
(`nested_structure_needs_subcomposition`), que não afetam o render.
