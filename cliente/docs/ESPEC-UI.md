# Vcall web UI: spec sheet for the native GPUI client

Source: worktree `midia-nativa` (commit 64c7260 plus local changes). All paths are relative to
`public/` unless they start with `../`. `file:line` points to the **selector** that sets the value.
Viewport: 1280×800 CSS px. Root font size: **16px** (no `html { font-size }` anywhere), so `1rem = 16px`.

---

## 0. Which cascade actually renders (read this first)

**The default visual is "vcall", not "empresa".**

- `js/boot-tema.js:20`: `data-visual = ler("visual") === "empresa" ? "empresa" : "vcall"`. With no saved pref you get `vcall`.
- `js/ui/theme.js:39`: same default (`prefs.get("visual", "vcall")`).
- Empresa only turns on if the user picks it in Settings › Aparência › Visual (`js/main.js:1261-1284`). DESIGN.md:373 also calls it "um segundo visual".
- The reference screenshots were taken with a fresh Playwright context (`ref/fotos.mjs`), so they show **visual = vcall, palette = tinta, theme = system** (no `data-theme` attribute; light/dark come from `prefers-color-scheme`). The light call screen with a light background, the 46px rounded-square dock buttons, the floating dock island and the lobby "ingresso" ticket are all from the **Vcall visual**. In Empresa the call is always dark, the dock is a full-width strip of 44px round buttons, and the lobby is a plain card.

So sections 1 to 8 describe **Vcall visual + Tinta palette**, which matches the screenshots. **Section 9** lists every Empresa override for the same elements, so you can switch.

Cascade order (index.html:24-40): `tokens.css` → `paletas.css` → `base.css` → `app.css` → board/jogos/diversao/quizzv → `reacoes.css` → `dashboard.css` → `motion.css` → **`call.css`** (restyles the call on top of app.css) → `mobile.css` → `empresa.css` (only matches with `[data-visual="empresa"]`).

Theme attributes on `<html>`: `data-paleta="tinta"`, `data-visual="vcall"`, and `data-theme` is absent (system), `"light"` or `"dark"`.

---

## 1. Global

### 1.1 Resolved color tokens (Vcall + Tinta)

Light = `tokens.css:241-281` (`:root:not([data-theme])` inside `prefers-color-scheme: light`) overridden by `paletas.css:71-98`. Dark = `tokens.css:123-177` overridden by `paletas.css:14-40`. Palette values win (same specificity, loaded later; the light media rule in paletas has a higher specificity).

| Token | Light | Dark | Where it is set |
|---|---|---|---|
| `--bg` (page) | `#f2f6fa` | `#0d1218` | paletas |
| `--bg-elevated` | `#ffffff` | `#161b21` | paletas |
| `--surface` | `#ffffff` | `#1e2329` | paletas |
| `--surface-2` (button bg) | `#edf1f6` | `#262b32` | paletas |
| `--surface-3` | `#e1e7ed` | `#31373e` | paletas |
| `--surface-hover` | `#e7ecf1` | `#2c3138` | paletas |
| `--border` | `#d4dae0` | `#31373e` | paletas |
| `--border-strong` | `#b8bec6` | `#474e55` | paletas |
| `--border-subtle` | `#e3e8ed` | `#1f242a` | paletas |
| `--text` | `#1b1e22` | `#eef0f3` | paletas |
| `--text-secondary` | `#4c5055` | `#b2b6ba` | paletas |
| `--text-muted` | `#5c6267` | `#9fa3a8` | paletas |
| `--text-inverse` | `#ffffff` | `#0d1218` | paletas |
| `--tile-bg` | `#1f2328` | `#11171c` | paletas |
| `--tile-glow` | `#31363b` | `#1f252b` | paletas |
| `--accent` = `--brand-pink` = `--accent-hover` | `#c21f55` | `#fd4d87` | paletas (hover is the same as rest, so primary buttons do not change color on hover) |
| `--accent-soft` | `#c21f5529` = rgba(194,31,85,0.161) | `#fd4d8729` = rgba(253,77,135,0.161) | paletas |
| `--accent-text` | `#ffffff` | `#ffffff` | tokens.css:147 / 207 (DESIGN.md:307 flags white on #fd4d87 as a known defect, but it is what renders) |
| `--accent-2` = `--brand-orange` | `#9c5212` | `#fe9c5f` | paletas |
| `--accent-2-soft` | rgba(156,82,18,0.161) | rgba(254,156,95,0.161) | paletas |
| `--ok` / `--ok-soft` | `#0f8f63` / rgba(15,143,99,.12) | `#37d399` / rgba(55,211,153,.15) | tokens |
| `--warn` / `--warn-soft` | `#a96a05` / rgba(169,106,5,.12) | `#ffb648` / rgba(255,182,72,.15) | tokens |
| `--danger` / `--danger-hover` / `--danger-soft` | `#d32848` / `#b81f3c` / rgba(211,40,72,.10) | `#ff5470` / `#ff6d85` / rgba(255,84,112,.16) | tokens |
| `--brand-ink` (tooltip bg) | `#110c3a` | `#110c3a` | tokens.css:40 |
| `--brand-gradient` | `linear-gradient(135deg, #c21f55 0%, #9c5212 100%)` | `linear-gradient(135deg, #fd4d87 0%, #fe9c5f 100%)` | tokens.css:41. It is resolved at `:root`, so it picks up the palette's pink and orange. |
| `--scrim` | `#2a2e33` | `#050a0f` | paletas |
| `--glow-opacity` | `0.13` | `0.22` | tokens.css:280 / 176 |
| `--focus-ring` | `0 0 0 2px #f2f6fa, 0 0 0 4px #c21f55` | `0 0 0 2px #0d1218, 0 0 0 4px #fd4d87` | tokens.css:160/220 |

Measured in the screenshots: page `#f2f6fa`/`#0d1218`, dock `#ffffff`/`#161b21`, buttons `#edf1f6`/`#262b32`, panel border `#d4dae0`/`#31373e`. All match.

### 1.2 Typography

- Body (base.css:19): `font-family: var(--font-sans)` = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif` (tokens.css:44). On Windows Chromium this renders as **Segoe UI**. Size **15px** (`--text-base` 0.9375rem), line-height **1.5** (22.5px), color `--text`, `text-rendering: optimizeLegibility`.
- Mono (tokens.css:48): `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace`. On Windows this is Cascadia Code if installed, otherwise Consolas.
- Display (tokens.css:47): `"Bricolage Grotesque", var(--font-sans)`. The files are `fonts/bricolage-latin.woff2` and `bricolage-latin-ext.woff2`. The woff2 has **one axis, `wght` 200–800 (default 800)**. Its name table says *"Bricolage Grotesque 96pt ExtraBold"*: the `opsz` axis was frozen at the 96pt cut, so `font-optical-sizing: auto` has no effect. For GPUI, decompress the woff2 to TTF and instance it at the weights below.
  - Weights in use: **800** (lobby headline, "Tudo certo?", "Entrar na sala", "Só você por aqui" title, "Vcall" wordmark), **700** (name input text), **600** (name placeholder).
- Type scale (tokens.css:50-58): 2xs 11px · xs 12px · sm 13px · base 15px · md 16px · lg 18px · xl 22px · 2xl 28px · 3xl 36px. Weights: 400/500/600/700. Line-height: tight 1.2, normal 1.5.
- h1–h3 default (base.css:41): weight 600, line-height 1.2, letter-spacing −0.02em.

### 1.3 Radii (tokens.css:81-86)

xs 6 · sm 9 · md 13 · lg 18 · xl 24 · full 999. Overrides in call.css: tile **22px** (call.css:60), ctrl **16px** (call.css:160), dock **26px** (call.css:138). Lobby: paper/stub corner 22px, preview 16px, notch 14px.

### 1.4 Shadows

| Name | Light | Dark |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(22,16,63,.08)` | `0 1px 2px rgba(0,0,0,.5)` |
| `--shadow-md` (tooltip) | `0 8px 24px -10px rgba(22,16,63,.2)` | `0 8px 24px -8px rgba(0,0,0,.65)` |
| `--shadow-lg` (popover, toast, modal) | `0 24px 56px -18px rgba(22,16,63,.26)` | `0 24px 56px -16px rgba(0,0,0,.75)` |
| Tile (call.css:60), both themes | `inset 0 1px 0 rgba(255,255,255,.04), 0 16px 36px -22px rgba(0,0,0,.7)` | same |
| Dock (call.css:138), both themes | `0 22px 48px -22px rgba(0,0,0,.65), 0 2px 6px -2px rgba(0,0,0,.3)` | same |

### 1.5 Accent (pink) usage map

The pink (`--accent`/`--brand-pink`) appears only in these places: the primary button bg (send, "Copiar link da sala", "Assistir"), the active tab pill (accent-soft bg plus accent text), active dock toggles (accent-soft bg plus accent icon), tile hover-action hover and pressed bg, the speaking ring (conic pink → orange → `#ffd1e1`), the mic dock button voice halo, the textarea focus border and halo, the caret, the chat unread dot, the "Assistir" invite icon, and the "Entrar na sala" gradient. Orange alone means *role*: pinned tile border (`--accent-2`).

### 1.6 Lobby backdrop (the blobs), `.ambient`

app.css:22-61 and motion.css:108-113. Fixed full-viewport layer, `z-index:-1`, behind `.app`. **Hidden in the call** (`body.na-chamada .ambient {display:none}`, app.css:48). Page bg underneath is `--bg`.

- Two circles, each `52vmax` = **665.6px** wide, `border-radius:50%`, `filter: blur(120px)`, `opacity: var(--glow-opacity)` (**0.13 light / 0.22 dark**).
- `::before`: bg `--brand-pink` (light `#c21f55`, dark `#fd4d87`), `top:-22vmax` (−281.6px), `left:-16vmax` (−204.8px). This is the top-left pink glow.
- `::after`: bg `--brand-orange` (light `#9c5212`, dark `#fe9c5f`), `bottom:-26vmax` (−332.8px), `right:-18vmax` (−230.4px). This is the bottom-right glow.
- Parallax (motion.css:108, js/ui/motion.js:528 `wireAmbient`): `--mx`,`--my` ∈ [−0.5, 0.5] = pointer position / viewport − 0.5, eased each frame with `x += (target−x)*0.06`. `::before translate: mx*6vmax, my*6vmax` (±38.4px). `::after translate: mx*−5vmax, my*−5vmax` (±32px).
- Measured corners: light TL `#ecdbe5`, BR `#e6e1dc`. Dark TL `#3e1e2f`, BR `#402f26`.

### 1.7 Focus (keyboard) and selection

- Generic `:focus-visible` (base.css:75): `outline:none; box-shadow: var(--focus-ring); border-radius: 9px`.
- `::selection` (call.css:16): bg = accent at 32% alpha, text `--text`. Caret `--accent` (call.css:20).

---

## 2. Antessala (lobby "credencial")

DOM: index.html:78-175. CSS: app.css:71-541. JS: js/ui/lobby.js. In the guest variant the texts are "Te chamaram para uma call." / "Tudo certo?" / "Entrar na sala". In the host variant they are "Sua call está pronta." / "Pode chamar." / "Começar a call" (lobby.js:46-52).

### 2.1 Layout at 1280×800

- `.lobby` (app.css:71): `display:grid; place-items:center; padding: clamp(16px, 4vh, 48px) 16px` → **32px 16px**.
- `.lobby__card` (app.css:79): `grid-template-columns: minmax(0,1fr) clamp(220px, 18vw, 252px)` → stub **230.4px**. `width: min(1120px,100%)` → **1120px**. Centered at **x=80..1200**. Height comes from content (**606px** at 1280×800, y=97..703).
- Card shadow is a `filter` on the whole masked card:
  - Dark: `drop-shadow(0 30px 34px rgb(4 2 18/.55)) drop-shadow(0 2px 3px rgb(4 2 18/.4))` (app.css:79)
  - Light: `drop-shadow(0 26px 30px rgb(22 16 63/.2)) drop-shadow(0 2px 3px rgb(22 16 63/.16))` (app.css:482). Light also adds an inner hairline on the paper: `box-shadow: inset 0 0 0 1px rgb(29 10 31/.07)` (app.css:486).
- Card-local vars (app.css:79): `--papel #fff6ec`, `--tinta #1d0a1f`, `--tinta-2 #554150`, `--fio rgb(29 10 31/.16)`, `--foco` = color-mix(oklab, pink 72%, #1d0a1f) → **light `#8f1d46` / dark `#b73a68`**, `--cta-texto` **dark `#1a0a1e` / light `#ffffff`** (app.css:482), `--canhoto-texto #f4f0ff`, `--canhoto-calado rgb(244 240 255/.74)`, `--r 14px`.
- **The paper is identical in both themes** (cream `#fff6ec` with `color-scheme: light`). Only the backdrop, shadow, stub, CTA text color, preview buttons and the brand gradient change.

### 2.2 Paper (left), `.lobby__papel` (app.css:96)

- bg `#fff6ec`, text `#1d0a1f`, `padding: 22px 30px 30px`, flex column `gap:18px`, `border-radius: 22px 0 0 22px`.
- Notches: a CSS mask cuts **semicircles of radius 14px** centered on the right edge at the top (y=0) and bottom. The stub cuts matching ones on its left edge, so together they form a 14px-radius half-circle bite at the top and bottom of the seam. Mask edge: transparent below r−0.5px, opaque at r.
- **Top row** `.lobby__topo` (app.css:114): flex, `gap:12px`, `padding-bottom:12px`, `border-bottom: 1px dashed rgb(29 10 31/.16)` (the dashed separator; content width 829.6px). Height = 40 (theme button) + 12 + 1 = 53px.
  - Logo `.lobby__marca` (app.css:121): `img /assets/logo-mark.png` 22×22, `border-radius:6px`, `gap:8px`, then "Vcall" in Bricolage **16px / 800 / letter-spacing −0.02em**, color `#1d0a1f`.
  - Theme button (`.btn.btn--icon.btn--ghost`, app.css:133): 40×40, radius 13, transparent, icon 20px `laptop` (system) / `sun` / `moon`, color `#554150`. Hover: color `#1d0a1f`, bg `rgb(29 10 31/.07)`. Cycles system → light → dark (theme.js:27-29).
- **Body** `.lobby__miolo` (app.css:141): grid `minmax(0,1.25fr) minmax(0,1fr)`, `gap:30px`, `align-items:stretch`. At 1280: preview **444.2px** (x=110..554.2), form **355.4px** (x=584.2..939.6). Both are as tall as the form (**483px**, y=190..673).

### 2.3 Video preview, `.lobby__preview` (app.css:149)

- `border-radius:16px`, `overflow:hidden`, bg `--tile-bg` (light `#1f2328`, dark `#11171c`), `min-height:300px`. Video `object-fit:cover`, mirrored `scaleX(-1)` (app.css:160-170).
- Camera off (`.lobby__placeholder`, app.css:172): `radial-gradient(circle at 50% 40%, var(--tile-glow), var(--tile-bg) 70%)`, avatar **112px** circle, then "Câmera desligada" with color `rgb(244 240 255/.72)`. Gap 12, `padding-bottom:64px` (keeps it above the bar).
- **Bottom gradient bar** `.lobby__previewBar` (app.css:191): `margin-top:auto; padding:16px; gap:12px; justify-content:center; background: linear-gradient(to top, rgb(7 4 22/.8), transparent)`. Its height is 16+46+16 = **78px**.
- **Mic and cam buttons** (`button.ctrl`, the call.css:160 version): **46×46, radius 16px** (rounded squares in Vcall, not circles), bg `--surface-2` (**light `#edf1f6`, dark `#262b32`**), border 1px transparent, icon **24px** (`icon--lg`, stroke 2), color `--text` (light `#1b1e22`, dark `#eef0f3`). Icons: `mic`/`mic-off`, `video`/`video-off`.
  - Off (`aria-pressed="false"`, app.css:1143): bg `--danger-soft`, icon `--danger`.
  - Hover (app.css:1137): bg `--surface-hover`, 1px border `--border`.

### 2.4 Form column, `.lobby__form` (app.css:201): flex column `gap:18px`

- **Headline** `.lobby__titulo` (app.css:207): Bricolage **800**, `font-size: clamp(1.9rem, 1.1rem + 1.4vw, 2.7rem)` → **35.52px**, `line-height:1`, `letter-spacing:-0.04em` (−1.42px), `text-wrap:balance`, color `#1d0a1f`. It breaks as "Te chamaram / para uma call.".
- **Labels** `.lobby__rotulo` (app.css:226): **12px / 600**, color `#554150`. Used for "Como você quer aparecer", "Microfone e câmera" and "Avatar". `.lobby__campo` label-to-input gap is **6px** (app.css:222).
- **Name input** `.lobby__nome` (app.css:233):
  - Size and spacing: height **46px**, `padding:0 2px`, no box, `border-bottom: 1.5px solid rgb(29 10 31/.3)`, transparent bg.
  - Text: Bricolage **24px / 700 / −0.02em**, color `#1d0a1f`.
  - Placeholder "Seu nome": color **`#74606e`**, weight 600.
  - Hover: underline `rgb(29 10 31/.5)`. Focus: underline `--foco` plus `box-shadow: 0 1.5px 0 --foco`, which makes a 3px line. Caret `--foco`.
- **Devices** `.lobby__aparelhos` (app.css:322): grid `gap:8px`. It contains the label, then a row per device.
  - Row `.lobby__aparelhoLinha` (app.css:329): flex, `gap:10px`, color `#554150`, icon **16px** (`mic` / `video`, stroke 2.1).
  - Device with 2 or more options: `select.lobby__select` (app.css:348). Height **32px**, `padding:0 2px`, `border-bottom:1.5px solid rgb(29 10 31/.25)`, transparent, **14px / 500**, color `#1d0a1f`, native chevron. Focus: underline `--foco`.
  - Device with a single option: `span.lobby__aparelho` (app.css:341). **14px**, `#1d0a1f`, ellipsis.
  - Mic info stack `.lobby__aparelhoInfo` (app.css:335): grid `gap:6px` (select, then meter).
- **Mic level meter** `.lobby__nivel` (app.css:367):
  - Bar: height **10px**, radius 3px. Segments come from `repeating-linear-gradient(90deg, …)`: **8px on, 3px gap** (11px period).
  - Off color `rgb(29 10 31/.14)` (renders `#dfd5cf` on the paper). On color **`#1f9d6f`**.
  - Width = 355.4 − 16 − 10 = **329.4px**, which is about **30 segments** (29 full, the 30th cut). The lit part is the same pattern clipped by `clip-path: inset(0 calc((1 - var(--nivel)) * 100%) 0 0)`. This is a continuous cut, so a segment can be half lit.
  - `--nivel` (lobby.js:269-286) = smoothed `min(1, vadLevel*5)`: it rises instantly and decays at `*0.9` per frame. It is 0 when the mic is off.
- **Avatar block** `.avatarPicker` (app.css:569 + lobby overrides app.css:296-320): column `gap:8px`.
  - Header row `.lobby__linha` (app.css:264): flex, `gap:4px`: "Avatar", spacer, "Usar foto", "Sortear".
  - Mini buttons `.lobby__mini` (app.css:269): height **28px**, `padding:0 10px`, radius 999, transparent, **12.5px / 600**, color `#554150`, `gap:6px`, icon 16px (`image`, `shuffle`). Hover: color `#1d0a1f`, bg `rgb(29 10 31/.07)`. Focus: 2px outline `--foco`, offset 2.
  - Grid (app.css:299): `repeat(auto-fill, minmax(42px,1fr))`, `gap:6px`. At 355.4px that gives **7 columns of 45.63px**. Options are square (`aspect-ratio:1`), `border-radius:50%`, `border:2px solid transparent`, `padding:2px`, so the avatar is about **37.6px**.
  - **Selected**: `border-color:#1d0a1f` (ink ring 2px), bg transparent (app.css:313). Hover: bg `rgb(29 10 31/.07)`, no lift (app.css:309).
  - 20 options = landscape scenes + DiceBear styles (`AVATAR_STYLES`, js/ui/avatars.js:42).

### 2.5 Stub (right), `.lobby__canhoto` (app.css:393)

- Flex column, `justify-content:center`, `gap:16px`, `padding:30px 24px 26px` (content width **182.4px**), `border-radius:0 22px 22px 0`, text `#f4f0ff`.
- Background (top layer first):
  1. `radial-gradient(120% 70% at 100% 0%, <pink @30% alpha>, transparent 62%)`. Light rgba(194,31,85,.30), dark rgba(253,77,135,.30).
  2. `radial-gradient(90% 60% at 0% 100%, <orange @20%>, transparent 60%)`. Light rgba(156,82,18,.20), dark rgba(254,156,95,.20).
  3. `--tile-bg` (light **`#1f2328`**, dark **`#11171c`**).
- Perforation `::before` (app.css:414): vertical line at `left:0`, from `top:18px` to `bottom:18px` (r+4), `border-left: 2px dashed rgb(255 255 255/.3)`. Chromium draws it as about **6px dash / 4px gap** (measured).
- Title "Tudo certo?" `.lobby__canhotoTitulo` (app.css:422): Bricolage **26px / 800**, line-height 1.05, −0.03em, `#f4f0ff`.
- **"Entrar na sala"** `.lobby__entrar` (app.css:430):
  - Size and shape: width 100% (182.4px), height **56px**, `padding:0 18px`, radius 999.
  - Content: `gap:10px`, icon `video` 20px. Text Bricolage **18px / 800 / −0.02em**, color `--cta-texto` (**dark `#1a0a1e`, light `#ffffff`**).
  - bg `--brand-gradient` (light `135deg #c21f55→#9c5212`, dark `135deg #fd4d87→#fe9c5f`) with `background-size:170% 100%` at position 0 0. At rest you see the left 59% of the ramp, so mostly pink.
  - Shadow: `inset 0 1px 0 rgb(255 255 255/.35), 0 14px 26px -14px <mix(oklab, pink 85%, #000)>`. That color is light `#9c1743`, dark `#cc3c6c`.
  - **Hover**: `background-position:100% 0` (slides toward orange) over **500ms** `--ease-out`.
  - **Disabled** (empty name, lobby.js:79): `opacity:.45`, `cursor:not-allowed`. Nothing else changes. Both screenshots show the disabled state.
  - Focus: `outline: 2px solid <mix(oklab, pink 70%, #fff)>` (light `#dc6f85`, dark `#ff8aaa`), offset 3px.
- Paragraph `.lobby__letras` (app.css:467): **12px**, line-height 1.5, color `rgb(244 240 255/.74)`.

### 2.6 Lobby entrance

`stagger([.lobby__papel, .lobby__canhoto], {delay:60, gap:90})` (main.js:218). See §8 for `rise`.

---

## 3. Call screen

DOM: index.html:183-212 plus js/main.js `buildStage/buildPanel/buildDock`. `.app` is a flex column, `height:100dvh`: topbar, then `.stage` (flex 1, a flex row containing `stage__main` and optionally the panel), then the dock. Page bg `--bg`. The topbar and stage have no background of their own.

### 3.1 Top bar `.topbar` (app.css:626 + call.css:31)

- Flex, `gap:12px`, `padding: 12px 16px 0` (call.css sets `padding-block:12px 0`), transparent, no border.
- Height = 12 + 40 (button) = **52px**. The stage starts at y=52.
- Order: `.topbar__meta`, spacer, "Convidar" button, theme button.
- `.topbar__meta` (app.css:645): flex, `gap:12px`, **12px** text, color `--text-muted` (light `#5c6267`, dark `#9fa3a8`). Timer and count use `tabular-nums` (call.css:53).
  - Shield `.topbar__selo` (app.css:674): `gap:4px`, icon **`shield-check` 16px** (stroke 2.1), color `--ok` (light `#0f8f63`, dark `#37d399`) at `opacity:.85`. Text "Criptografada ponta a ponta" in `--text-muted`. Warning variant: `--warn`. Error variant: `--danger` + 600.
  - Separators `.dot-sep::before` (app.css:700): content "·" + `margin-right:8px`, same color. So the spacing reads `item ⟨12px gap⟩ · ⟨8px⟩ next`.
  - Timer `mm:ss` (`h:mm:ss` after 1h; util.js:65). Count: "só você" for 1, "N pessoas" otherwise (main.js:3344).
  - Room name `.topbar__room` (hidden for unnamed rooms; call.css:46): 16px / 600, `--text`, `padding-left:12px; margin-left:4px; border-left:1px solid --border`, max 34ch with ellipsis.
- **"Convidar"** (`.btn`, base.css:177):
  - Size: min-height **40px**, `padding:0 16px`, radius **13px**, border **1px `--border`**.
  - Content: `gap:8px`, icon `user-plus` 16px. Text **15px / 500**, color `--text`.
  - bg `--surface-2` (light `#edf1f6`, dark `#262b32`). Hover: bg `--surface-hover`, border `--border-strong`. Active: `translateY(1px)`. Measured width 119px.
- **Device/theme button** `#themeBtn2` (`.btn--icon.btn--ghost`): 40×40, radius 13, transparent, icon 20px `laptop`/`sun`/`moon`, color `--text-secondary`. Hover: bg `--surface-2`, color `--text`. Tooltip placement bottom.

### 3.2 Stage and grid

- `.stage__main` (app.css:716): `padding:12px; gap:12px`. The usable area at 1280×800 with no panel is **1256×636** (stage = 800 − 52 topbar − 88 dock block = 660 tall).
- `.grid` (app.css:727): CSS grid, `gap:12px`, `grid-auto-rows:minmax(0,1fr)` (rows split the height equally, tiles stretch, they do not keep a fixed aspect), `grid-template-columns: repeat(var(--cols), minmax(var(--tile-min)=220px, 1fr))`.
- **Columns by count** (app.css:744-752 override the JS):
  - `data-count=1`: 1 column.
  - `data-count=2|3|4`: **2 equal columns**. With 3 tiles the third sits at **bottom-left** with an empty cell to its right (see light-3). Tile size: 3/4 tiles → **622×312**. With the chat panel open → **448×312**.
  - 5 or more: `--cols = bestColumns(count, gridW, gridH)` (js/ui/stage.js:897). It tries cols = 1..count, rows = ceil(count/cols), error = `|ln((W/cols)/(H/rows)/(16/9))| + (cols*rows − count)*0.03`, and keeps the minimum. At 1256×636 it gives 5–9 → 3 columns, 10–16 → 4 columns.
  - Size steps (stage.js:851, app.css:759-779): >4 → `md` (tile-min 168), >8 → `lg` (132, gap 8, volume hidden), >12 → `xl` (104, gap 4, label 11px).
- **Layout modes** (stage.js:813 `#relayout`, priority order):
  1. **Alone** (1 tile, `.stage--alone`, call.css:198):
     - `stage__main` becomes a 2-column grid `minmax(0,.9fr) minmax(0,1.1fr)`, `align-items:center`.
     - `gap: clamp(24px,4vw,48px)` → 48px. `padding-inline: clamp(24px,5vw,64px)` → 64px.
     - Left column: the waiting card (§3.8). Right column: your tile at `aspect-ratio:16/10` → **607×380** at x=609, y=192.
  2. **Duo** (exactly you + 1 other, auto layout, no screen/pin/board):
     - The other person fills the stage (`.spotlight`, grid hidden).
     - **You become a floating bubble** `.floatSelf` (app.css:3505): `width: clamp(132px, 22%, 280px)` → 280px, `aspect-ratio:16/10` (175px), radius **24px**, shadow `0 18px 40px -12px rgba(8,4,30,.55), 0 0 0 1px rgba(255,255,255,.08)`, default corner bottom-right with **16px** inset.
     - Draggable. It snaps to the nearest corner using velocity projection (`v*180ms`) with the bouncy spring (stage.js:550-610). Dragging: `scale 1.04`, ring `0 0 0 2px --accent`. Inside the bubble the actions, volume and net chip are hidden, and the label is 11px.
  3. **Grid** (3 or more, nothing featured).
  4. **Spotlight** (`.stage--spotlight`, app.css:782-810). Triggered by a pinned tile, a **watched** screen share, or more than 4 tiles with an active speaker (stage.js:778).
     - `stage__main` becomes a **row**: `.spotlight` (flex 1) on the left, then the grid as a **168px-wide vertical strip** on the right.
     - In the strip: `display:flex; flex-direction:column; gap:12px; overflow-y:auto`, each tile **168×108**, volume hidden, equalizer 10px tall.
     - A screen tile video uses `object-fit:contain` on `#000` (app.css:851).
- Order (stage.js:833): screen tiles first, own tile last.
- A screen share that you are **not watching** (3.24 "Assistir", screenshot 5-tela) stays in the grid as an invite tile (§3.7). It only moves to the spotlight after you click Assistir.

### 3.3 Tile `.tile` (app.css:812 + call.css:60)

- `border-radius:22px`, bg `--tile-bg` (light `#1f2328`, dark `#11171c`), `border:1px solid transparent` (the tile bg shows through that 1px edge), `overflow:hidden`. Shadow as in §1.4.
- Video: `object-fit:cover` (`contain` when cropping would hide more than 30% of the frame, stage.js:105). Your own camera is mirrored.
- **Pinned**: `border-color: --accent-2` (light `#9c5212`, dark `#fe9c5f`), app.css:828.
- **Speaking ring** (`.is-speaking`). Two pseudo-elements, both clipped by the tile's `overflow:hidden`:
  - `::before` (call.css:70/96): inset 0 (padding box), a **2.5px** ring drawn with a mask. Fill: `conic-gradient(from var(--spin), --brand-pink, --brand-orange, #ffd1e1, --brand-pink)`. That is light `#c21f55 → #9c5212 → #ffd1e1`, dark `#fd4d87 → #fe9c5f → #ffd1e1`. Opacity `0.6 + lv*0.4`, transition 220ms.
  - `::after` (app.css:2045, opacity overridden by call.css:101): inset −1px, **2px** ring, `conic-gradient(from var(--spin), #fd4d87, #fe9c5f, #fd4d87 60%, #fe9c5f, #fd4d87)` (hard-coded colors). Opacity **`lv`**. Only its inner 1px is visible because it is clipped.
  - Its `box-shadow: 0 0 36px -8px rgba(pink,.8)` (the "voice glow" in DESIGN.md:281) is **clipped by `overflow:hidden` and never visible**. Measured: the page pixel right outside a speaking tile is plain bg.
  - So the visible result is: 1px tile-bg edge, then a 2.5px conic ring at 0.6–1.0 opacity, plus a 1px brighter inner line that fades with volume.
  - `--lv` = `min(1, level*3.2)`. `--spin` += `1.5 + v*9` degrees per frame while v > 0.05 (stage.js:378-390). The border color stays transparent (call.css:93 beats app.css:2034).
- **Camera off / no video** (`.tile__avatar`, app.css:869):
  - Base layer: `radial-gradient(circle at 50% 42%, --tile-glow, --tile-bg 70%)`.
  - Avatar circle size: `clamp(32px, min(26cqw, 46cqh), 128px)` of the tile's padding box. That is **128px** for a 622×312 tile and **116px** for a 448×312 tile.
  - With relative-color support (app.css:898-935; `--amb` = the avatar's main color, from `corDoAvatar`):
    - `::before`: fine noise (white, 6% alpha) over `radial-gradient(ellipse 75% 85% at 50% 50%, oklch(0.25, min(c,.05), h of amb), oklch(0.15, min(c,.025), h))`.
    - `::after`: a glow behind the avatar, `radial-gradient(circle 1.1×avatarSize, oklch(.45, min(c,.09), h / .45), transparent)`. While speaking it scales by `1 + lv*0.12`.
    - Avatar shadow: `0 18px 36px -18px oklch(.1 .03 h / .9)`. Fade-in 700ms.
- **Connecting** `.tile__status` (app.css:1029): inset 0, bg `rgba(7,4,22,.66)` + `backdrop-filter: blur(3px)`, white **13px**, gap 8, icon `spinner` (alias of `loader-2`) 24px spinning 900ms linear. Texts from stage.js:22: "Conectando…", "Reconectando…", "Sinal instável…" (icon `wifi-off`), and others.
- **Waiting for the first frame** `.tile__espera` (app.css:3770): ring 28px `conic(transparent 0 30%, pink, orange)` masked to a ring (55–57%), spinning 900ms, text "Carregando o vídeo…" 13.12px `rgb(255 255 255/.78)`, gap 10.

### 3.4 Name pill `.tile__label` (app.css:936 + call.css:109)

- Position: `left:12px; bottom:12px`, `max-width: calc(100% - 24px)`.
- Box: `padding: 5px 10px 5px 8px`, radius **999**, bg **`rgba(7,4,22,.72)`** (no blur in Vcall).
- Text: **12px / 500**, `#fff`, `gap:8px`. Height **28px**.
- Content order: mic icon **14px** (`mic`; `mic-off` colored `--danger` when muted, app.css:959), then the **voice equalizer** `.tile__eq` (always takes space, invisible when quiet), then the name (ellipsis). Your own name is suffixed " (você)".
- Equalizer (app.css:2100-2145): 3 bars, each **3px** wide with a **2px** gap (13px total), height 12px, radius 999, bg `--accent`. `scaleY` from the center: bar 1 `.18+.62lv` (110ms), bar 2 `.22+.78lv` (70ms), bar 3 `.18+.5lv` (130ms). Opacity is 1 when v > 0.05, otherwise 0 (120ms). This is why there is an empty gap between the mic icon and the name in the screenshots.

### 3.5 Signal chip (top-left) `.tile__net` (app.css:998)

- `top:8px; left:8px`, **26×26**, radius 9, bg `rgba(7,4,22,.55)` + `blur(6px)`.
- Icon **15px**, colored by quality: good `--ok`, fair `--warn`, poor `--danger`, unknown `--text-muted`.
- Icons (core/stats.js:892): `network-4/2/1/0`, which are aliases in the sprite for `signal`, `signal-medium`, `signal-low`, `signal-zero` (see §7).

### 3.6 Hover buttons (top-right) `.tile__actions` (app.css:963)

- `top:8px; right:8px`, flex `gap:4px`. `opacity:0`, becomes 1 on tile hover or focus-within (120ms).
- Each `.tile__action` (app.css:979): **32×32**, radius **9px**, bg `rgba(7,4,22,.65)` + `blur(6px)`, color `#fff`, icon **16px** (stroke 2.1). Hover or `aria-pressed=true`: bg `--accent` (120ms).
- Order (stage.js:620-650):
  1. `pin` "Fixar na tela" (becomes `pin-off` "Desafixar" when pinned)
  2. `maximize-2` "Tela cheia"
  3. `panel-right-open` "Janela flutuante" (picture-in-picture)
  - A watched screen tile also gets `eye-off` "Parar de assistir".
- Tooltips appear below. Double-clicking a tile toggles pin.

### 3.7 Volume pill `.vol` (app.css:1829). Remote tiles only.

- Position: `left:8px; bottom:38px` (just above the name pill).
- Box: `padding: 4px 8px 4px 4px`, radius 999, bg `rgba(7,4,22,.66)` + `blur(8px)`, `gap:8px`.
- Visibility: hidden (`opacity 0, translateY 4px`) until tile hover. Always visible when the level is not 100%.
- Contents:
  1. `.vol__btn`: **26×26** circle, icon `volume-2` 16px white (`volume-x` in `--danger` when muted). Hover bg `rgba(255,255,255,.16)`.
  2. `.vol__trilho`: **92×22** ramp of **10 bars**, `gap:3px`, so each bar is 6.5px wide, radius 2. Bar *i* height = `28% + i*8%` of 22px (6.2px … 22px).
     - Color: a slice of the hard-coded `#fd4d87 → #fe9c5f` ramp; bar *i* takes the color at t ≈ (i+0.5)/10.
     - Lit bars = `round(pct/15)` (100% → 7 lit). Lit opacity 1. Unlit `opacity .22` + `saturate(0)`.
     - Bars 8–10 = boost (>100%): `box-shadow 0 0 9px -1px #fe9c5f`.
     - A transparent `<input range 0–150 step 5>` sits on top.
  3. `.vol__pct`: **11px / 600**, white @ .85 opacity, min-width 3.4ch, "100%" or "mudo". Boost color `#fe9c5f`.

**Screen-share invite tile** (3.24, screenshot dark-5-tela, app.css:3412/3459, stage.js:437):

- `.tile__present`: inset 0, column, centered, `gap:8px`, `padding:16px`, white text.
- bg `radial-gradient(circle at 50% 35%, <accent @30%>, transparent 60%), #120c33`.
- Contents:
  1. Icon `screen-share` **30px** (stroke 1.8), color `--accent`.
  2. `<strong>` "Bruno Lima está transmitindo" **16px** (ellipsis).
  3. **"Assistir"** = `.btn.btn--primary` (40px tall, radius 13, bg `--accent`, text `#fff` 15px / 600, `eye` icon 16px, gap 8).
- Tile label "Tela de Bruno Lima". Actions, net chip and volume are hidden.

### 3.8 "Alone" waiting card (screenshot 2-sozinha; main.js:324, call.css:185-293)

- `.waiting`: flex column, `align-items:flex-start`, `gap:16px`, `max-width:460px`, `padding:24px`.
- Contents in order:
  1. Illustration `sala-vazia` 300×225 (inline SVG from `/assets/illustrations/sala-vazia.svg`; its theme colors come from `var(--surface)` etc.).
  2. Title "Só você por aqui, por enquanto": Bricolage **800**, `clamp(1.6rem, 1rem+1.6vw, 2.3rem)` → **36.48px**, line-height 1.1, **−0.03em** (call.css:466 overrides −0.035), balanced.
  3. Lead text: 15px, `--text-secondary` (light `#4c5055`, dark `#b2b6ba`), line-height 1.55, max 40ch.
  4. Code button `.waiting__codeBtn`:
     - Box: `padding:10px 16px 10px 18px`, **1px dashed `--border-strong`**, radius 18, bg `--surface` (light `#fff`, dark `#1e2329`), `gap:12px`.
     - Code: mono **25.6px / 700**, letter-spacing **.22em**, `--text`. Then a `copy` icon 16px in `--text-muted`.
     - Hover: border and color become `--accent`.
  5. Actions (`gap:8px`, wrap):
     - "Copiar link da sala" = `.btn--primary.btn--lg`: **48px** tall, radius **18**, `padding:0 24px`, 16px / 600, bg `--accent`, text `#fff`, icon `link` 20px.
     - "Mais formas de convidar" = `.btn.btn--lg`: same size, surface-2 + 1px border, icon `user-plus`.

---

## 4. Dock (bottom control bar) `nav.dock` (app.css:1094 + call.css:138)

### 4.1 Container

- A floating island centered horizontally: `.app` is a flex column and the dock has `align-self:center`.
- `margin: 8px auto 16px`, so the **bottom offset is 16px**.
- `padding: 8px 10px`, **border 1px `--border`** (light `#d4dae0`, dark `#31373e`), radius **26px**.
- bg `--bg-elevated` (light **`#ffffff`**, dark **`#161b21`**), no blur. Shadow: `0 22px 48px -22px rgba(0,0,0,.65), 0 2px 6px -2px rgba(0,0,0,.3)`.
- Gap between groups: **4px**.
- Size at desktop width: **≈1006–1008 × 64px** (x=137..1143, y=720..784). The `--dock-height:76px` token is no longer the real height.
- Groups `.dock__group`: flex, `gap:6px`.
- **Dividers** (app.css:1115 + call.css:155): every group after the first gets `margin-left:8px; padding-left:8px; border-left:1px solid --border-subtle` (light `#e3e8ed`, dark `#1f242a`). Each divider is 46px tall.

### 4.2 Buttons `.ctrl` (app.css:1121 + call.css:160)

- **46×46**, radius **16px**, bg `--surface-2` (light `#edf1f6`, dark `#262b32`), border 1px transparent, color `--text`.
- Icon **24px** (`icon--lg`), stroke **2**, round caps and joins.
- `transform-origin: 50% 100%`.

### 4.3 Ordered list (main.js:848-1036)

Tooltip text = `label · shortcut`.

| # | group | data-id | icon (default → alt) | aria-label (default / alt) | kind |
|---|---|---|---|---|---|
| 1 | g1 | `mic` | `mic` → `mic-off` | "Microfone" at build. syncDockMedia sets it immediately to "Microfone ligado" / "Microfone mudo" · M | toggle |
| 2 | g1 | `cam` | `video` → `video-off` | "Câmera ligada" / "Câmera desligada" · V | toggle |
| 3 | g1 | `deafen` | `volume-2` → `volume-x` | "Silenciar tudo" / "Voltar a ouvir" · D | toggle |
| 4 | g2 | `screen` | `screen-share` → `screen-share-off` | "Compartilhar tela" / "Parar de compartilhar" · S | action, active while sharing |
| 5 | g2 | `screenOpts` (`.ctrl--slim`) | `chevron-down` | "Opções de compartilhamento" | **30×46** (inline `width:30px`) |
| 6 | g2 | `board` | `pencil` | "Quadro branco" · Q | active while open |
| 7 | g2 | `jogos` | `dices` | "Jogos" · K | active while open, can show a badge |
| 8 | g3 | `hand` | `hand` | "Levantar a mão" / "Baixar a mão" · H | active while raised |
| 9 | g3 | `react` | `smile` | "Reagir" · R | opens the reactions popover |
| 10 | g3 | `captions` | `eye-off` → `eye` | "Legendar minha fala" / "Parar de legendar minha fala" · T | active while on |
| 11 | g3 | `record` (only if recording is supported) | `radio` | "Gravar a chamada" / "Parar a gravação" | active while recording |
| 12 | g4 | `chat` | `message-square` | "Conversa" · C | active while the chat tab is open, unread badge |
| 13 | g4 | `people` | `users` | "Pessoas" · P | active while open |
| 14 | g4 | `stats` | `activity` | "Qualidade da chamada" | active while open |
| 15 | g4 | `layout` | `layout-grid` ↔ `presentation` | "Alternar layout" · L, then "Grade igualitária" / "Destaque automático" | |
| 16 | g4 | `settings` | `settings` | "Configurações" | |
| – | g4 | `more` | `more-vertical` | "Mais opções" | **hidden on desktop** (`display:none`, app.css:1156). Shown at ≤820px. |
| 17 | g5 | `mini` (if Document PiP is supported) | `picture-in-picture-2` | "Mini-janela flutuante" · J | active while open |
| 18 | g5 | `leave` (`.ctrl--hangup`) | `phone-off` | "Sair da chamada" | **58×46** |

The screenshot shows 18 buttons, matching this list (record and mini present).

### 4.4 States (resolved cascade)

- **Off** (`aria-pressed="false"`, mic or cam off; app.css:1143): bg `--danger-soft` (light rgba(211,40,72,.10), dark rgba(255,84,112,.16)), icon `--danger` (light `#d32848`, dark `#ff5470`), icon swaps to `mic-off`/`video-off`.
- **Active** (`data-active="true"`, e.g. chat open; app.css:1149): bg `--accent-soft` (light rgba(194,31,85,.161), dark rgba(253,77,135,.161)), icon `--accent`. "Deafened" sets both `aria-pressed=false` and `data-active=true`; active comes later in the CSS, so the deafen button shows the **pink** style with `volume-x`.
- **Hover** (app.css:1137, specificity 0,3,0, which beats both states above): bg `--surface-hover` (light `#e7ecf1`, dark `#2c3138`) and a **1px `--border`** outline appears. The icon color keeps the state color: a hovered active chat button is grey-bg with a pink icon (light-4 screenshot).
- **Mic voice halo** (call.css:179, mic on): `box-shadow: 0 0 0 (lv*6px) <pink @40%>`.
- **Unread badge** `.ctrl__dot` (app.css:1171): `top:6px; right:6px`, min-width 17px, height 17px, `padding:0 4px`, radius 999, bg `--accent`, `#fff`, **10px / 700**, "9+" cap.
- **Hangup "Sair da chamada"**: app.css:1160 sets `background:--danger; color:#fff`. However, **call.css:160 `.ctrl { background: var(--surface-2) }` has the same specificity and loads later, so it wins**. Only `width:58px` survives from call.css:174, and `color:#fff` from app.css. Hover also loses to `.ctrl:hover:not(:disabled)`, which gives surface-hover. **The hangup button therefore renders with the plain button bg and a white icon** (light: `#edf1f6` with a white icon that is barely visible; dark: `#262b32` with a white icon). This is confirmed by pixel samples in every screenshot. It is a cascade bug in the web app, but it is what "identical" means. DESIGN.md:326 intended red.
- **Dock magnification** (js/ui/motion.js:606 `magnifyDock`, only for fine pointers, disabled under reduced motion):
  - On `pointermove` over the dock, each `.ctrl` gets `d = |pointerX − buttonCenterX|`, `k = max(0, 1 − d/120)`, `e = k²(3−2k)`.
  - It then applies `scale = 1 + 0.26e` and `translate = 0, −10e px`, with transitions `scale/translate 160ms --ease-out` (call.css:160).
  - Everything resets on `pointerleave`. The tooltip is a child of the button, so it scales too.
- **Press**: scale 1 → 0.93 (110ms ease-out, `composite:add`), then release with spring(500,14) ≈ 933ms. Ripple: a circle in `currentColor`, diameter 2× the button diagonal, scale 0 → 1, opacity .35 → 0, 650ms `cubic-bezier(.2,.6,.3,1)` (motion.js:472-526).

### 4.5 Tooltip `[data-tip]::after` (base.css:351)

- Position: `bottom: calc(100% + 10px)`, centered.
- Box: `padding:4px 12px`, radius **9px**, bg **`#110c3a`** (`--brand-ink`, same in both themes), shadow `--shadow-md`.
- Text: `#fff`, **12px / 500**, line-height inherited 1.5 = 18px. Box height 26px.
- Hidden: `opacity 0, translate(-50%, 4px)`. Shown: `opacity 1, translate(-50%, 0)`, 120ms `--ease-out`.
- Text example: "Conversa · C" (U+00B7 with spaces).
- `data-tip-placement="bottom"` puts it at `top: calc(100% + 10px)`. Hidden on coarse pointers.
- On a magnified dock button it appears scaled ×1.26 (measured box about 32px tall, text about 15px).

### 4.6 Popover (menus above the dock; app.css:1189)

- Anchored to the button's group: `bottom: calc(100% + 8px)`, horizontally centered on the button.
- Box: min-width 220, `padding:8px`, radius **18**, bg `--bg-elevated`, 1px `--border`, `--shadow-lg`, `gap:2px`.
- Items (`.popover__item`): `padding:8px 12px`, radius 9, 13px, `gap:12px`, icon 16px `--text-secondary`. Hover bg `--surface-2`. Checked: `--accent`.
- Section label: 11px / 600, +0.04em, UPPERCASE, `--text-muted`, `padding:8px 12px 4px`. Separator: 1px `--border-subtle`, margin 4px 0.

---

## 5. Side panel (chat), `aside.panel` (app.css:1261; js/ui/panel.js)

### 5.1 Container

- Mounted as the second child of `#stage` (main.js:409), so it sits right of `stage__main` and is as tall as the stage (y=52..712, it does **not** cover the dock).
- **Width 348px**, bg `--bg-elevated` (light `#ffffff`, dark `#161b21`), `border-left:1px solid --border` (light `#d4dae0`, dark `#31373e`).

### 5.2 Tab row `.panel__tabs` (app.css:1271)

- `padding:8px`, `gap:4px`, `border-bottom:1px solid --border-subtle` (light `#e3e8ed`, dark `#1f242a`). Row height 40 + 16 + 1 = 57px.
- Tabs (panel.js:16): `message-square` "Conversa", `users` "Pessoas", `captions` "Transcrição", `activity` "Qualidade". After them comes the close button.
- Each tab (app.css:1278): `padding:8px`, radius 9, 13px / 500, color `--text-muted`, `gap:8px`, icon 16px. They stretch to 40px tall.
- **Active tab**: flex 1, bg `--accent-soft` (renders light `#f5dbe4`, dark `#3b2231`), color `--accent` (icon and label). Width at 348px: **167×40**.
- **Inactive tabs**: `flex:none; padding-inline:10px`, so they are **36×40**, icon only (the label is visually hidden). Tooltip below with the label. Hover: bg `--surface-2`, color `--text`.
- Close button: `.btn--icon.btn--ghost` 40×40, radius 13, icon `x` **16px**, color `--text-secondary`. Hover: bg surface-2.

### 5.3 Messages (`.panel__scroll`, app.css:1325)

- Container: `padding:16px`, column, `gap:12px`, scrolls.
- **System message** `.msg--system` (app.css:1395): centered, **12px**, `--text-muted`, `padding:4px 0`. Examples: "Bruno Lima entrou", "Carla Dias entrou". Consecutive ones are 38px apart.
- **Chat message** `.msg` (app.css:1353-1393; panel.js:323-357):
  - **No bubbles, and no own-vs-others styling at all.** Every message uses the same row; your own message only differs by showing the name **"Você"**. Consecutive messages from the same author within 120s are appended into the same body.
  - Row: flex, `gap:12px`, 13px. Avatar circle **30px** with `margin-top:2px`.
  - Head: flex baseline, `gap:8px`, `margin-bottom:1px`. Name 13px / 600 in `--text`. Time (`HH:MM`) 11px in `--text-muted`.
  - Text: `--text-secondary`, `white-space:pre-wrap`, `overflow-wrap:anywhere`. Links in `--accent`.
- Empty state `.panel__empty` (app.css:1340): centered, `padding:32px 16px`, gap 8, icon `message-square-text` 30px, "Nenhuma mensagem ainda." 13px `--text-muted`.

### 5.4 Input area `.panel__foot` (app.css:1335)

- `padding:12px`, `border-top:1px solid --border-subtle`.
- `.composer` (app.css:1403): flex, `gap:8px`, `align-items:flex-end`. Children:
  1. Attach button `.btn--icon.btn--ghost`: 40×40, transparent, icon **`hard-drive` 16px**, color `--text-secondary`, tooltip "Anexar arquivo" above.
  2. Textarea `.composer__input` (app.css:1409):
     - Size: flex 1, min-height 42, rows 1. It renders **47px** tall (padding 12 + 21 line + 12 + 2 border), max 140 (JS autogrow).
     - Box: `padding:12px`, radius **13px**, bg `--surface-2` (light `#edf1f6`, dark `#262b32`), 1px `--border`.
     - Text: 15px, line-height 1.4.
     - Placeholder "Escreva uma mensagem…" uses the UA default color, measured **`#757575`** in both themes.
     - **Focus** (app.css:1420): border `--accent` + `box-shadow: 0 0 0 3px --accent-soft`. Opening the chat auto-focuses it, so the screenshot shows the focus ring.
  3. **Send** `.btn.btn--primary.btn--icon`: **40×40, radius 13px (a rounded square, not round)**, bg `--accent` (light `#c21f55`, dark `#fd4d87`), icon `send` 16px in `#fff`. Hover is the same color (accent-hover = accent in Tinta).
- Panel open and close: on desktop it appears instantly; only the tiles FLIP-animate to their new size (§8). At ≤820px it becomes a bottom sheet.

---

## 6. Reactions, signals and the raised hand

There are **two systems in the code**. Only the second is wired up.

- **Dead code**: `Tile.react()` (stage.js:500), `.reaction-float` (app.css:1066) and `burst()` sparks (motion.js:567, call.css:121). Nothing calls `tile.react()` (grep). Do not port these.
- **Live system** (js/ui/reacoes.js, css/reacoes.css, features/reacoes.js). The 18 reactions are Fluent Emoji Flat sprites from `/vendor/emoji.svg` (`#e-<name>`, viewBox 0 0 32 32, full color): thumbs-up, red-heart, face-with-tears-of-joy, face-with-open-mouth, clapping-hands, party-popper, fire, thinking-face, crying-face, folded-hands, hundred-points, rocket, star-struck, raising-hands, eyes, smiling-face-with-heart-eyes, skull, exploding-head (features/reacoes.js:20-39).
  1. **Flying emoji** (`.reacaoVoo`):
     - Drawn on a fixed full-viewport overlay `.reacoes` (z 60, no pointer events).
     - Origin: x = tile center, y = tile top + **78%** of its height.
     - Size **40px**, growing +4px per combo step, max 64. `min(n,5)` copies, staggered 90ms.
     - Per particle (random): dx ±70px, rise 200–320px, spin ±28°, duration **1700–2300ms**.
     - Keyframes `reacaoSobe` (reacoes.css:30): 0% scale .2 / opacity 0 → 12% scale 1.18 / opacity 1 → 22% scale .96 → 50% scale 1 (rotate +giro, x −.35dx) → 80% scale .92 / opacity .85 → 100% (dx, rise) scale .8 / opacity 0.
     - Easing `cubic-bezier(.22,.61,.36,1)`, `drop-shadow(0 6px 12px rgb(0 0 0/.25))`. At most 48 in the air.
  2. **Combo chip "×N"** (`.reacaoCombo`, reacoes.css:57):
     - Position: (x+22, y−46).
     - Box: `padding:2px 10px`, radius 999, bg `--brand-gradient`, shadow `0 6px 16px -6px rgb(0 0 0/.45)`.
     - Text: `#fff` 16px / 700.
     - Animation `comboPula` 900ms (scale .3 → 1.25f → f → rise 26px and fade), with `f = min(1.6, 1+N/12)`.
     - Combo window: 250ms local batching, combo 1200ms.
  3. **Badge on the tile** `.tile__reacao` (reacoes.css:87):
     - Position: top-left `10px/10px` (it overlaps the signal chip), **42×42** circle.
     - bg = `--surface` @85% alpha (light rgba(255,255,255,.85), dark rgba(30,35,41,.85)), shadow `0 4px 14px -4px rgb(0 0 0/.4)`, emoji 30px.
     - Enter: opacity 220ms + scale .4 → 1 260ms + `seloPulo` 420ms (scale 1.25, rotate −8° at 40%). It stays for **2.5s**.
  4. **Rain**: when 3 people send the same reaction within 4s (6s cooldown), 18 particles rise from the stage bottom across its width. Size 40–72px, delay 0–1100ms, rise 45–85% of the stage height, 2200–3000ms.
  5. **Signals** (sticky pills top-right of the tile, `.tile__sinais`, reacoes.css:118):
     - Container: `top/right 10px`, column, `gap:6px`.
     - Each pill: `padding:4px 10px 4px 6px`, radius 999, bg `--surface` @90%, `--text` 12px / 600, icon 16px in `--accent`.
     - Variants: Sim (`check`, ok ring 2px), Não (`x`, danger ring), Mais devagar (`turtle`), Mais rápido (`rabbit`), Pode repetir? (`repeat`), Não estou ouvindo (`volume-x`, danger), Já volto (`coffee`, which greys the tile with `grayscale(.7) brightness(.7)`).
     - Enter `sinalEntra` 320ms. On tiles narrower than 300px the pills show the icon only.
- **Raised hand on a tile** `.tile__hand` (app.css:1045):
  - Position: `top:8px`, centered horizontally. **34×34** circle.
  - bg `--warn` (light `#a96a05`, dark `#ffb648`), icon `hand` **16px** in **`#1a1000`**.
  - Animation `hand-bob` 1.6s ease-in-out infinite: translateY −4px at 50%.
  - The dock `hand` button becomes active (pink).

---

## 7. Icon sprite `vendor/icons.svg`

- Lucide (ISC), a subset generated by `scripts/vendor.mjs`. The root `<svg>` sets `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`.
- **186 `<symbol id="i-NAME" viewBox="0 0 24 24">`** with stroke paths (`<path>`, `<circle>`, `<rect>`, `<line>`, `<polyline>`). There are also 8 GitHub glyphs with `viewBox="0 0 16 16"` that use `fill="currentColor"` and `stroke="none"`.
- **Aliases**: lines 673-683 are `<use id="i-ALIAS" href="#i-TARGET"/>`:
  - `network-0`→`signal-zero`, `network-1`→`signal-low`, `network-2`→`signal-medium`, `network-3`→`signal-high`, `network-4`→`signal`
  - `spinner`→`loader-2`
  - also `mirror`, `pointer`, `arrow`, `line`, `host`→`crown`
- Usage: `<svg class="icon"><use href="/vendor/icons.svg#i-NAME"/></svg>`. CSS (base.css:136):

  | Class | Size | Stroke |
  |---|---|---|
  | `.icon` | 20px | 2 |
  | `--sm` | 16px | **2.1** |
  | `--lg` | 24px | 2 |
  | `--xl` | 30px | **1.8** |

  Other sizes are set ad hoc: label mic 14px, net 15px. All use `fill:none; stroke:currentColor`. Stroke width is in viewBox units (24), so it scales with the icon.
- `icons.json` maps name to viewBox.

**Icons used by the elements above:**
- Lobby: `laptop` `sun` `moon` `mic` `mic-off` `video` `video-off` `image` `shuffle` `alert-triangle`
- Topbar: `shield-check` `user-plus` (and the theme icons)
- Tiles: `mic` `mic-off` `network-0..4` (signal*) `pin` `pin-off` `maximize-2` `panel-right-open` `eye-off` `spinner` (loader-2) `wifi-off` `screen-share` `eye` `volume-2` `volume-x` `hand`
- Waiting card: `copy` `link` `user-plus`
- Dock: `mic` `mic-off` `video` `video-off` `volume-2` `volume-x` `screen-share` `screen-share-off` `chevron-down` `pencil` `dices` `hand` `smile` `eye-off` `eye` `radio` `message-square` `users` `activity` `layout-grid` `presentation` `settings` `more-vertical` `picture-in-picture-2` `phone-off`
- Panel: `message-square` `users` `captions` `activity` `x` `hard-drive` `send` `message-square-text`
- Signals: `check` `x` `turtle` `rabbit` `repeat` `volume-x` `coffee`

---

## 8. Motion

### 8.1 Tokens (tokens.css:89-93)

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` |
| `--dur-fast` | 120ms |
| `--dur-base` | 200ms |
| `--dur-slow` | 340ms |

### 8.2 Hover and state

| What | Duration / easing | Where |
|---|---|---|
| Button and ctrl bg, color, border | 120ms ease-out | base.css:194, call.css:167 |
| Dock magnify `scale`/`translate` | 160ms ease-out | call.css:167 |
| Mic voice halo `box-shadow` | 90ms linear | call.css:167 |
| Tooltip opacity + 4px slide | 120ms ease-out | base.css:370 |
| Tile actions fade in | 120ms | app.css:963 |
| Volume pill fade + 4px slide | 120ms | app.css:1829 |
| Tile border / box-shadow | 200ms | app.css:812 |
| Speaking ring `::before` opacity | 220ms ease-out | call.css:90 |
| Equalizer bars | 70 / 110 / 130ms ease-out | app.css:2132-2145 |
| Avatar ambient fade | 700ms; glow scale 240ms | app.css:898 |
| Lobby CTA gradient slide | 500ms ease-out | app.css:430 |

### 8.3 Springs (js/ui/motion.js:33-59)

A damped spring sampled into a CSS `linear()` curve. Durations computed here with the same code:

| Name | Stiffness / damping | Duration | Overshoot | Used for |
|---|---|---|---|---|
| `snappy` | 520 / 34 | **342ms** | 3% | menus |
| `bouncy` | 300 / 17 | **725ms** | 17% | entries |
| `soft` | 190 / 25 | **583ms** | ~0% | grid reflow |
| press release | 500 / 14 | 933ms | 35% | button release |

### 8.4 Entries and changes

- **`rise(el)`** (motion.js:75), the standard entry: opacity 0 → 1 and blur 6px → 0 over **380ms** `cubic-bezier(.22,1,.36,1)`, plus translateY 14px → 0 and scale .97 → 1 on **bouncy**.
  - Lobby: paper and stub staggered 90ms (delay 60).
  - Dock buttons on joining: `stagger(.ctrl, {gap:22ms, y:18px, blur:0})` (main.js:268).
  - Waiting card children: delay 120, gap 60.
- **Tile enter**: two effects run together.
  - CSS `ladrilhoEntra` **200ms ease-out** from `opacity 0, scale(.92)` (mobile.css:464; unconditional).
  - The FLIP "new node" entry: opacity 0 → 1, scale .86 → 1 on **bouncy** (motion.js:117).
- **Tile exit**: 220ms `cubic-bezier(.4,0,1,1)` to opacity 0, scale .82, blur 4px, then the grid reflows (stage.js:672).
- **Grid reflow** (someone joins or leaves, panel opens or closes, layout changes): FLIP, where every tile slides from its old rect on **soft (583ms)**.
  - Uniform scale is used only if the aspect ratio is unchanged (sx≈sy within 0.04). Otherwise the tile translates from its old center without scaling.
- **Panel open**: there is no slide on desktop. The panel toggles `hidden` inside `stage.animateChange`, so only the tiles animate (soft spring). Mobile: `sheet-up` 200ms.
- **Popover**: CSS `pop-in` 120ms (from opacity 0, +6px) plus WAAPI scale .9 → 1 and translateY 8 → 0 on **snappy** (origin bottom center). Items are staggered 18ms (y 6px, no blur).
- **Toast**: scale .9 → 1, translateY 16 → 0, bouncy.
- **Screen swap** (lobby → call, alone ↔ grid) uses View Transitions (motion.css:124):
  - Old: 260ms `cubic-bezier(.4,0,1,1)` to opacity 0, scale .97, blur 6px.
  - New: 520ms `cubic-bezier(.22,1,.36,1)` from opacity 0, scale 1.03, blur 8px.
- **Intro** (first load per session, Vcall visual only; motion.js:186): animated logo on `#0c0e13`. Then the logo flies 620ms `cubic-bezier(.7,0,.2,1)` to `.lobby__marca img` (the light lobby screenshot caught it mid-flight).
- **Reduced motion**: all animations and transitions become 0.01ms (base.css:121). Magnify, ripple and the intro are skipped.

---

## 9. If you want the Empresa visual instead (`data-visual="empresa"`)

Only the deltas are listed; everything else stays as above. Sources are empresa.css and paletas.css:452-585.

### 9.1 Tokens (empresa.css:24-55, paletas.css)

- Radii: xs 4, sm 4, md 6, lg 8, xl 10.
- `--font-display` = system sans, so Bricolage is never used.
- Motion: `--ease-out: cubic-bezier(0.1,0.9,0.2,1)`; durations 100 / 150 / 250ms.
- Shadows:
  - Dark: sm `0 1px 2px rgb(0 0 0/.28), 0 0 1px rgb(0 0 0/.24)`; md `0 4px 8px …/.28, 0 0 2px …/.24`; lg `0 14px 28px …/.36, 0 0 8px …/.24`.
  - Light: the same with alphas .08/.1, .1/.1, .14/.1.
- `.ambient` is hidden (no blobs). The intro is skipped. Dock magnification is off (motion.js:616).

Outside the call (lobby, dialogs):

| Token | Light | Dark |
|---|---|---|
| bg | `#f3f4f6` | `#1a1c1e` |
| bg-elevated | `#ffffff` | `#232527` |
| surface-2 | `#f0f1f3` | `#2c2e30` |
| surface-3 | `#e6e7e9` | `#37393c` |
| surface-hover | `#ebedee` | `#323436` |
| border | `#dcdee0` | `#353739` |
| border-strong | `#c1c3c4` | `#515355` |
| text | `#222324` | `#f3f3f4` |
| text-secondary | `#48494a` | `#c3c4c5` |
| text-muted | `#5f6162` | `#adaeaf` |
| accent | `#c21f55` | `#fd4d87` |
| accent-hover | `#aa264e` | `#ff6a96` |
| accent-text | `#ffffff` | `#161719` |
| ok / warn | `#0b6e4c` / `#8a5300` | from tokens |

Inside the call, the **palco** is dark in both themes (empresa.css:946):

| Token | Value |
|---|---|
| bg | `#161719` |
| bg-elevated | `#212325` |
| surface, surface-2 | `#303234` |
| surface-3 | `#3b3d40` |
| hover / border-strong | `#46484a` |
| border | `#404345` |
| border-subtle | `#212325` |
| text | `#f4f5f6` |
| text-secondary | `#c6c7c8` |
| text-muted | `#b0b1b2` |
| accent (also in light theme) | `#fd4d87` |
| accent-hover | `#ff6c97` |
| accent-soft | rgba(253,77,135,.18) |
| accent-text | **`#161719`** |
| ok | `#3ccf91` |
| warn | `#f5b546` |
| danger | `#e5484d` |
| danger-hover | `#ef5d62` |
| danger-soft | rgb(229 72 77/.18) |
| tile-bg | `#282a2c` |
| tile-glow | `#353739` |

### 9.2 Lobby (empresa.css:687-931)

- **Card**: one card instead of the ticket. Grid `minmax(0,1.4fr) minmax(300px,1fr)` with areas `topo topo / preview form / preview canhoto`. `width:min(1080px,100%)`, bg bg-elevated, 1px border, radius 10, `--shadow-md`. No masks, notches or perforation. The stub title is hidden.
- **Top row**: `padding:12px 12px 12px 20px`, solid 1px bottom border. Wordmark 15px / 600 sans.
- **Preview**: `margin:20px`, min-height 340, radius 8. Bar gradient `rgb(0 0 0/.55)`.
  - Buttons: **44px circles**, 1px `rgb(255 255 255/.55)` border, bg `rgb(0 0 0/.28)`, white icon. Hover: bg .16 white, border .8. **Off: bg `#d93a3f`**, no border.
- **Form**:
  - `padding:24px 24px 8px 4px`, gap 16.
  - Title: 22px / 600 / line-height 1.25 / −0.01em sans ("Pronto para entrar?").
  - Labels: 13px / 600 in `--text`.
  - Inputs and select: **36px**, `padding:0 12px`, 1px border with the bottom in border-strong, radius 6, bg bg-elevated, 14px / 400. Focus: bottom border accent + `inset 0 -1px 0 accent`.
  - Meter: **solid** 6px bar, radius 3, track surface-3, fill `--ok` (no segments).
  - Selected avatar ring: `--accent`. Mini buttons radius 6.
- **CTA**: `justify-content:flex-end`, `padding:8px 24px 24px 4px`. Button **40px**, radius 6, bg accent, text accent-text, 600 15px sans, no shadow. Hover: accent-hover. Fine print 12px muted.

### 9.3 Call

- **Topbar** (empresa.css:977): `padding:12px 16px 4px`, bg `#161719`. Room 15px / 600. "Convidar": 36px, radius 6, 14px / 600, bg `#303234`, no border, hover `#46484a`. **The theme button is hidden.**
- **Tiles**:
  - Radius 8, no shadow.
  - Speaking ring: solid `--accent` **3px**, opacity `.8 + .2lv`, no spin. The app.css conic `::after` still adds a 1px line at opacity lv; its glow is removed.
  - Name pill: `left/bottom 8px`, `padding:4px 8px`, **radius 4**, bg `rgb(0 0 0/.56)`, 12.5px.
  - Net chip and actions: radius 4, bg `rgb(0 0 0/.5)`. Action hover: accent bg with text `#161719`.
  - **3 tiles: the third is centered** on the bottom row, half width (empresa.css:1040).
- **Dock** (empresa.css:1048):
  - Container: a full-width strip, `padding:12px 16px`, bg `#161719`, no border, radius or shadow. Height 68px. Groups gap 8. Dividers: `margin-left:12px; padding-left:12px; 1px #404345`.
  - **Buttons: 44×44 circles**, bg `#303234`, icon `#f4f5f6`, hover `#46484a`.
  - Off: **solid `#e5484d`** with a white icon. Active: solid `#fd4d87` with a `#161719` icon.
  - **Hangup 64×44 pill, solid `#e5484d`**, white icon (here it really is red). Slim chevron is a pill.
  - Mic halo: `lv*4px` at accent 45%.
  - Hidden unless active: screenOpts, jogos, captions, record, stats, layout, settings. "more" is shown. Resulting order: mic, cam, deafen | screen, board | hand, react | chat, people, more | mini, leave.
- **Panel** (empresa.css:1140):
  - Container: `margin:12px 12px 12px 0`, 1px `#404345`, radius 10, bg `#212325`.
  - Tabs: `padding:0 8px`, gap 0, bottom border `#404345`. Each tab is 46px tall with no pill, color `#c6c7c8`.
  - **Active tab**: text `#f4f5f6` / 600, icon accent, **3px accent underline** (`inset 0 -3px 0`).
  - Textarea: 36px min, 14px, radius 6, bottom border `#46484a` (accent on focus).
  - Send: 36×36, radius 6, `#fd4d87` with a `#161719` icon.
- **Waiting card**:
  - Box: max-width 420, padding 24, 1px `#404345`, radius 10, bg `#212325`. No illustration.
  - Title: `clamp(1.4rem,1rem+1vw,1.875rem)` → **28.8px**, weight 600, −0.015em, line-height 1.2.
  - Code button: solid border, radius 8. Code: weight 600, letter-spacing .16em.
  - Layout: columns `minmax(320px,420px) 1fr`, gap 24, `padding-inline: clamp(16px,3vw,40px)` → 38.4px.
- Tooltip, volume pill and reactions are unchanged except for radii (tooltip radius 4).

---

## 10. Gotchas checklist

1. The default visual is **Vcall**, not Empresa (§0).
2. The hangup button is **not red** in Vcall: the call.css `.ctrl` background overrides app.css `.ctrl--hangup` (§4.4).
3. The speaking "glow" is clipped by the tile's `overflow:hidden`; only the rings show (§3.3).
4. Chat has **no bubbles** and no own/other distinction except the name "Você" (§5.3).
5. The lobby mic/cam and dock buttons are **46px rounded squares (r16)**. The send button is a 40px r13 square. They are round only in Empresa.
6. Hover beats the active and off states for the background, but the icon keeps the state color (§4.4).
7. Old reaction code (`.reaction-float`, `burst`) is dead. Port `reacoes.js` (§6).
8. The real dock height is 64px plus margins 8/16. The `--dock-height:76px` token is stale.
9. Bricolage ships as a single 96pt optical cut with only a `wght` axis (§1.2).
10. The grid uses CSS columns of 1 for 1 tile and 2 for 2–4 tiles; JS 16:9 fitting applies only to 5 or more. A 2-person call is "duo" mode with a floating self bubble, not a 2-column grid.
