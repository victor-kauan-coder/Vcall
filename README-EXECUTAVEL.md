# Vcall — o executável

Este arquivo é para **você**, que tem o código. Quem recebe o programa lê o
[LEIA-ME.txt](LEIA-ME.txt), que vai junto com o executável.

## Gerar

```bash
npm install --include=dev
npm run icons
npm run build:setup        # instalador (recomendado)
npm run build:exe          # so o executavel portatil, Windows
npm run build:exe:linux    # portatil, Windows + Linux
```

Sai em duas pastas:

```
dist-setup/
  VcallSetup.exe   ~147 MB - o instalador, para mandar as pessoas

dist-exe/
  Vcall.exe        ~100 MB - versao portatil, roda de qualquer pasta
  vcall            ~118 MB - portatil, Linux x86-64
  LEIA-ME.txt
```

### O instalador

Mande so o `VcallSetup.exe`. Ele:

- extrai para `%LOCALAPPDATA%ProgramsVcall` (sem pedir administrador)
- coloca o `cloudflared` ao lado do programa
- cria atalho no menu iniciar e na area de trabalho
- registra os links `vcall://`
- aparece em Configuracoes -> Aplicativos, com desinstalador
- abre o Vcall no fim

**Nada e baixado durante a instalacao.** O programa e o cloudflared viajam
comprimidos dentro do arquivo. Um instalador que precisa de internet para
instalar e o que falha justamente na maquina onde a internet e o problema.

Ao instalar por cima de uma versao antiga empacotada com Electron, ele limpa
os ~50 MB de arquivos do Chromium que sobraram e nao sao mais usados.

A desinstalacao mantem a pasta `~/.vcall`: ela guarda o perfil de navegador
com as permissoes ja concedidas, e apaga-la sem perguntar seria jogar fora
configuracao que a pessoa pode querer de volta.

Mande **só essa pasta**. Nada de `src/`, `public/`, `node_modules/` nem
`package.json`.

## O que tem dentro do executável

| Parte | De onde vem |
|---|---|
| Servidor de sinalização e HTTP | `src/` |
| Interface (HTML, CSS, JS, ícones) | `public/`, embutida como dado |
| Controle do túnel | `desktop/` |
| Motor JavaScript | uma cópia do `node.exe` |

Não precisa de Node instalado na máquina de destino. Não precisa de
instalador. Não escreve no registro do Windows.

## Como ele roda

1. Sobe o servidor em `127.0.0.1` numa porta livre.
2. Abre uma **janela de aplicativo** (Edge, Chrome ou Brave com `--app=`),
   sem abas e sem barra de endereço. Sem navegador baseado em Chromium, cai
   para o navegador padrão.
3. O botão "Gerar link" em *Convidar* liga o túnel do Cloudflare.

## Permissões sem a janela do navegador

Nenhuma página consegue se autoconceder câmera ou microfone — e ainda bem,
senão qualquer site faria isso. Mas quem **abre** o navegador pode preparar o
terreno, e é o que o executável faz.

O Vcall usa um perfil de navegador próprio, em `~/.vcall/navegador`. Antes de
abrir a janela, ele escreve a permissão direto no arquivo `Preferences` desse
perfil, para o endereço do próprio servidor local:

```json
"media_stream_mic": { "http://127.0.0.1:7717,*": { "setting": 1 } }
```

Quando a página pede a câmera, a resposta já está dada e nenhuma janela cinza
aparece. Verificado: o Chromium reescreveu o arquivo ao subir (250 → 19 kB,
mesclando os padrões dele) e **manteve** as entradas — se as tivesse rejeitado,
teria apagado.

Duas condições para isso funcionar, e as duas estão no código:

- **Perfil próprio.** Mexer no perfil pessoal por fora é invasivo, e o Chromium
  desfaz ao perceber.
- **Porta fixa.** A permissão é gravada por origem, e a origem inclui a porta.
  Com porta sorteada a cada execução, a concessão de ontem não valeria hoje.
  Daí a porta 7717, lembrada em `~/.vcall/porta.json`.

A liberação é estreita: um endereço, dentro de um perfil que só o Vcall usa. A
captura de tela continua perguntando de propósito — escolher qual janela
compartilhar *é* a permissão.

A tela de permissões continua aparecendo na primeira abertura, agora mostrando
câmera e microfone como "Liberado". Os avisos do sistema ficam desligados por
padrão; ligar o interruptor é o único caso que ainda gera uma pergunta.

## Links `vcall://`

O programa se registra como dono do esquema `vcall://` toda vez que abre:

- **Windows** — quatro chaves no registro do usuario, em
  `HKCU > Software > Classes > vcall`. Sem permissao de administrador.
- **Linux** — `~/.local/share/applications/vcall.desktop` mais
  `update-desktop-database`.

Clicar em `vcall://ID_DA_SALA` abre direto no aplicativo. Com o app já aberto,
a segunda execução **não** sobe outro servidor: ela encontra a primeira pela
marca em `~/.vcall/instancia.json`, confirma que responde com o token daquela
execução, entrega a sala e encerra. Sem isso haveria duas salas, dois túneis e
duas janelas, com a pessoa sozinha na errada.

## Sem janela de console

O executável é uma cópia do `node.exe`, que é um programa de **console** — ao
abrir com dois cliques, o Windows cria a janela preta antes mesmo de o programa
rodar. Não há opção de linha de comando para isso: o subsistema é um campo no
cabeçalho do arquivo, e o build troca de `3` (console) para `2` (janela).

O preço é que nada mais aparece no console, nem erros. Por isso o programa
grava `~/.vcall/vcall.log` com o endereço de abertura e qualquer falha — sem
ele, um problema na partida seria invisível.

## Ícone

`npm run icons` gera, além dos PNGs da interface, um `vcall.ico` com seis
tamanhos (16 a 256). O build o aplica com `rcedit`, junto com a ficha do
Windows (nome, empresa, versão).

A ordem importa: o ícone entra **antes** da injeção do programa. Depois de
injetado, o arquivo tem 82 MB com uma seção extra no fim, e o `rcedit` entra
num laço que consome minutos de CPU sem terminar. No `node.exe` limpo, a mesma
operação leva 2 segundos.

O `cloudflared` **não** vai dentro do executável: são 30 MB para um recurso
que nem toda chamada usa. Ele é procurado na máquina e baixado do site oficial
do Cloudflare na primeira vez que alguém pede um link público — e fica em
`%USERPROFILE%\.vcall\`.

## Consumo

Medido nesta máquina, em repouso, logo após abrir:

| | Memória privada |
|---|---|
| `Vcall.exe` | ~60 MB |
| Janela (11 processos do Chromium) | ~470 MB |

O programa em si é o número da primeira linha. A renderização custa o mesmo
que custaria numa aba comum — e é o mesmo custo que **cada convidado** paga ao
entrar pelo link, em qualquer aplicativo de chamada que exista.

A escolha de não embutir um navegador é o que mantém esse número baixo: um
aplicativo tipo Electron carregaria um Chromium próprio, somando o seu peso ao
do navegador que a pessoa já tem aberto.

## Sobre "o código fica secreto"

O que o executável realmente protege e o que não protege — sem meio-termo:

**Protegido de forma razoável.** A lógica do servidor (`src/`, `desktop/`)
está minificada e empacotada dentro do binário. Não é uma pasta de arquivos
`.js` que qualquer um abre no bloco de notas. Quem souber mexer consegue
extrair; isso não é criptografia, é uma barreira prática.

**Não protegido, e não tem como ser.** A interface (`public/`) é enviada para
o navegador de **todo mundo** que entra na sala — é assim que qualquer
aplicativo web funciona, sem exceção. Quem abrir as ferramentas de
desenvolvedor vê o HTML, o CSS e o JavaScript da tela.

Se o objetivo é que ninguém veja a lógica de negócio, ela precisa ficar no
servidor, não na tela. Hoje o Vcall é o contrário disso de propósito: a
criptografia ponta a ponta exige que os navegadores conversem direto, sem
servidor no meio que pudesse esconder alguma coisa.

## Publicar num domínio seu

Para uma sala permanente, sem depender do executável ligado:

```bash
cloudflared tunnel route dns vcall vcall.seudominio.com.br
```

Detalhes em [TUNEL.md](TUNEL.md). Nesse caso rode `npm start` num servidor e
configure `ALLOWED_ORIGINS` (veja `.env.example`).

## Avisos do Windows

O executável não é assinado digitalmente. Na primeira execução aparece o
SmartScreen ("O Windows protegeu o computador"); o caminho é *Mais
informações → Executar assim mesmo*. Assinar exige um certificado de
autoridade certificadora, que é pago e emitido para pessoa física ou empresa.

---

Desenvolvido por Victor Kauan — [github.com/victor-kauan-coder](https://github.com/victor-kauan-coder)
