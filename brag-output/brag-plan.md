# brag-plan.md — Vcall

Vídeo de lançamento do Vcall. Tom pedido: **chamativo, dinâmico, animado,
mostrando TODAS as telas e convencendo que é fácil de usar**.

- Preset: `chaotic` (ritmo e número de cenas), com direção criativa própria:
  **anúncio brasileiro rápido e colorido, sem perder o capricho da marca.**
  O `chaotic` cru é CAIXA ALTA e barulho; o Vcall é caprichado. O que fica do
  preset é o ritmo (cortes curtos, muitas cenas, entradas no tempo da música);
  o que fica da marca é a elegância do rosa-laranja sobre o azul-tinta.
- Formato: `landscape` 1920×1080, 30 fps.
- Duração: **~24 s** — o limite de cima dos 15–25 s. São muitas telas, e o
  pedido foi mostrar todas; o ritmo resolve, não o alongamento.

---

## Rubrica

**1. O que é?**
Salas de vídeo que vão direto de um navegador ao outro, criptografadas ponta a
ponta. Até 16 pessoas, quadro branco infinito, compartilhamento de tela, chat,
legendas ao vivo e gravação local. Sem conta, sem instalar.

**2. A afirmação mais forte**
Do próprio produto: *"O servidor só apresenta os participantes — ele não vê nem
guarda nada da conversa."* E a manchete: *"Chame quem importa, direto de um
computador para o outro."* Não é marketing: é o mecanismo.

**3. O gancho visual**
A intro animada do próprio app — as duas figuras do "V" se alcançando, em
degradê rosa → laranja sobre o azul-tinta, com o halo pulsando. Ela já existe
no produto e já é o melhor plano de abertura possível. Capturada em 10 quadros.

**4. O que mostrar da interface real**
Tudo foi capturado do app rodando, com Playwright, em 1920×1080:
tela inicial (escura e clara), diálogo de criar sala, antessala, sala
aguardando com o código, convite, grades de 2/4/6 pessoas, chat, lista de
pessoas, estatísticas, configurações, reações, layout, quadro branco (vazio,
desenhado, e o mesmo desenho na tela de outra pessoa), legendas, escolha do que
compartilhar, tela compartilhada dos dois lados, gravação, saída e celular.

**5. O vídeo mais curto que satisfaz**
24 s. Abaixo disso não cabem as telas que o pedido exige; acima disso o ritmo
cai.

**6. Tom**
Preset `chaotic`, direção "anúncio brasileiro rápido e colorido, sem perder o
capricho da marca". Cortes de 1,5–3,5 s, entradas no tempo do beat, montagem
rápida no meio, respiro no fim.

**7. Áudio**
`happy-beats-business-moves-vol-12` (110 BPM, grade de beats a cada ~0,545 s) —
alegre, rápido, combina com o tom. SFX de interface (`switch`, `click`) por
baixo, suaves, só onde há um gesto de verdade na tela: um clique, um painel que
abre, um traço no quadro. Nada estridente. Fade de 1,2 s no fim.

**8. Legenda para publicar**
"O Vcall é uma sala de vídeo que vai direto do seu navegador para o de quem
você chamou — criptografada, sem conta e sem instalar nada. Manda o link e
pronto."

**9. O fluxo que vale mostrar**
`Criar nova call` → copiar o link / ditar o código de 6 letras → as pessoas
entram pelo navegador → todo mundo junto, desenhando no mesmo quadro.
Entrada → ação → resultado, três cliques.

---

## Identidade visual (extraída de `public/css/tokens.css`)

| Papel | Valor |
|---|---|
| Rosa da marca | `#fd4d87` (profundo `#e0356e`) |
| Laranja da marca | `#fe9c5f` (profundo `#e07b32`) |
| Azul-tinta | `#110c3a` |
| Degradê | `linear-gradient(135deg, #fd4d87, #fe9c5f)` |
| Fonte de título | Bricolage Grotesque (200–800) — a do próprio app |
| Fonte de texto | pilha do sistema |

O vídeo usa a fonte e as cores do app, servidas do próprio projeto. Nada de
CDN — a mesma restrição que o produto se impõe.

---

## Storyboard (24,0 s · 30 fps · 720 quadros)

| # | t | dur | Cena | O que acontece | Texto na tela |
|---|---|---|---|---|---|
| 1 | 0,00 | 2,6 | **Gancho — a marca se monta** | A intro real do app, quadro a quadro: o halo pulsa, o "V" se desenha, as letras caem. Zoom lento de 1,06 → 1,00. | `Vcall` · `conversas que chegam direto` |
| 2 | 2,60 | 2,6 | **A promessa** | A tela inicial entra com um empurrão de baixo; a manchete do próprio site aparece palavra por palavra. | "Chame quem importa, **direto** de um computador para o outro." |
| 3 | 5,20 | 2,7 | **Dois cliques e acabou** | Diálogo "Criar nova call" → antessala → sala no ar, três telas em corte seco, com o cursor caindo no botão. | `Criar nova call` → `Entrar` → **no ar** |
| 4 | 7,90 | 2,5 | **Manda o link** | O código de 6 letras salta do convite (recorte limpo, sem endereço de máquina) e o botão do WhatsApp pulsa. | "Manda o link. Ou dita seis letras." |
| 5 | 10,40 | 2,7 | **A sala enche** | 2 → 4 → 6 pessoas; cada avatar entra no beat, com um salto curto. | "Até 16 pessoas. Sem conta. Sem instalar." |
| 6 | 13,10 | 3,3 | **Mosaico de recursos** | Montagem rápida, 6 telas em ~0,55 s cada, no beat: chat, pessoas, estatísticas, reações, legendas, gravação. | `chat` `pessoas` `rede` `reações` `legendas` `gravação` |
| 7 | 16,40 | 2,8 | **O quadro é de todo mundo** | O desenho aparece traço a traço; corte para a MESMA tela do outro lado, lado a lado. | "O que você desenha aparece lá. Na hora." |
| 8 | 19,20 | 2,2 | **Tela e celular** | Compartilhamento de tela com "Nitidez / Fluidez", e o retrato do celular deslizando por cima. | "Tela nítida. E no celular também." |
| 9 | 21,40 | 2,6 | **Fecho** | Fundo azul-tinta, o logotipo monta de novo, assinatura e chamada. Último quadro parado e postável. | `Vcall` · "Abra o navegador e chame." |

Somatório: 2,6 + 2,6 + 2,7 + 2,5 + 2,7 + 3,3 + 2,8 + 2,2 + 2,6 = **24,0 s**.

### Transições
- Cenas 1→2 e 8→9: escurece passando pelo azul-tinta (nunca um crossfade
  direto entre dois layouts cheios — vira dupla exposição).
- Dentro das cenas 3, 5 e 6: corte seco no beat, sem transição.
- Cena 7: o corte para o outro lado é um *whip* horizontal curto (0,18 s).

### Guia de cues da música
Trilha: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, 109,96 BPM.
Beats fortes úteis na janela: 8,74 · 9,29 · 10,93 · 13,11 · 17,47 · 18,56 ·
19,66 · 22,37 · 22,93 · 24,56 s.
As entradas grandes (a sala enchendo em 10,40; o mosaico em 13,10; o fecho em
21,40) ficam encostadas nesses cues. Cue é dica de tempo, não ordem: onde
atrapalhar a leitura, a leitura ganha.

### Leitura
Toda linha que o espectador precisa ler fica inteira na tela por pelo menos
0,3 s por palavra, contados de quando a última palavra assentou. A manchete da
cena 2 (11 palavras) é a mais longa: entra em 0,5 s e fica parada 1,9 s.

---

## Material

- Capturas: `work/shots/*.png` — 38 PNGs, produto real, servidor local.
- Nomes nas telas são fictícios (Alice, Bruno, Carla, Diego, Elisa, Fábio,
  Victor) e os avatares são os sorteados pelo próprio app.
- As câmeras entram fechadas de propósito: a câmera falsa do Chromium é um
  pacman verde, e o avatar do Vcall é o que a interface mostra de verdade
  quando alguém entra sem vídeo.
- **Nada de endereço de máquina no vídeo.** O convite aparece recortado no
  código P2P e no botão do WhatsApp; o `localhost:3977` das capturas fica
  fora de quadro.
