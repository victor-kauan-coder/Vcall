# Legendas e transcrição

O botão de legenda (`T`) transcreve **a sua fala** e mostra o texto para todos
na sala. Cada pessoa legenda a própria voz; o texto viaja como texto (alguns
bytes), nunca como áudio.

![Legendas na chamada](imagens/legendas.png)

Cada fala aparece com a **foto e a cor da pessoa**, em no máximo duas linhas.
Frases longas rolam como na TV: o começo sai por cima. Enquanto a frase ainda
está sendo dita, um cursor pisca no fim. O tamanho (pequena, média ou grande)
fica em Configurações → Legendas e avisos.

## No aplicativo: Whisper, no seu computador

O app reconhece a fala com o **Whisper**, **no seu computador**: nenhum áudio
sai daqui, só o texto vai para a sala. Na primeira vez o modelo é baixado (uma
vez só), com o progresso na tela.

### Precisão (medida com voz humana)

Em Configurações → Legendas e avisos → **Precisão das legendas**. Os números
são de 40 frases gravadas por 10 brasileiros (corpus LapsBM, UFPA), medidos
pelo `scripts/bench-fala.mjs` em 2 núcleos:

| Nível | Palavras erradas | Tempo por frase | Download |
| --- | ---: | ---: | ---: |
| Rápida (Whisper base) | 22,6% | ~0,5 s | ~80 MB |
| **Equilibrada** (Whisper small, padrão) | **14,3%** | ~0,85 s | ~250 MB |
| Máxima (Whisper small, janela completa) | 12,5% | ~2,4 s | o mesmo da Equilibrada |

Até a 3.3 o padrão errava 24,3% das palavras e levava ~0,9 s. Parte dos
"erros" restantes nem são erros de verdade: números saem em algarismos
("170" no lugar de "cento e setenta").

### Como ficou rápido e leve

- **O modelo lê só o tamanho da sua fala.** O Whisper foi feito para ler
  janelas de 30 s: uma frase de 3 s era completada com 27 s de silêncio, e
  tudo era processado. Ao baixar o modelo, o app o adapta para ler só o trecho
  falado (mais uma pequena folga) — o resultado numérico é idêntico, e uma
  frase custa até 29× menos. É isso que torna o modelo mais preciso (small)
  viável no padrão.
- **Detector de voz de verdade (Silero).** Só a fala vai para o reconhecedor.
  Teclado, mouse e ventilador não abrem frases, e as frases não grudam umas
  nas outras.
- **Menos trabalho à toa.** Legendas parciais só enquanto você fala, espaçadas
  pelo custo real no seu computador (máquina mais lenta = menos parciais, sem
  fila). Metade dos núcleos no máximo, o resto fica para o jogo e a chamada.
  Com o microfone mudo, nada é processado. Legenda desligada por 5 minutos: o
  modelo sai da memória.
- **Palavras confirmadas não mudam.** Uma palavra só fica firme quando duas
  leituras seguidas concordam nela; o fim da frase, que ainda pode mudar,
  aparece mais claro. Acabou o texto que pisca e se reescreve.
- **O áudio não passa pela tela.** Vai do microfone direto ao processo do
  reconhecedor, sem pesar no vídeo nem nas animações.

## No navegador

Usa o reconhecimento do Chrome ou do Edge. Se o Chrome já tiver o pacote do
idioma instalado no aparelho, o reconhecimento roda **localmente** (mais
rápido, sem internet para isso, e o áudio não vai para o Google). Em outros navegadores o botão avisa
que não há reconhecimento — mas você continua **lendo** as legendas de quem
estiver legendando.

## Transcrição ao vivo

Menu **⋯ → Transcrição ao vivo**, ou a aba **Transcrição** do painel lateral:
tudo o que foi dito na chamada, com nome e horário, atualizado ao vivo.

![Transcrição com busca](imagens/transcricao.png)

- **Buscar**: digite uma palavra e as falas que a contêm aparecem com o termo
  destacado.
- **Copiar tudo**, **Baixar (.txt)** e **Baixar como legenda (.srt)** — o .srt
  abre em qualquer player junto com a gravação da reunião.

## Idioma

Configurações → Legendas e avisos → **Idioma das legendas**. O padrão é
**português (Brasil)**.

## Privacidade

Com o **microfone mudo, a legenda para**. Nada do que você diz com o
microfone desligado é transcrito nem enviado.
