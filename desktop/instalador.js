/**
 * desktop/instalador.js — instala o Vcall na máquina.
 *
 * Um instalador de verdade, e não um arquivo solto na pasta de downloads:
 * atalho no menu iniciar, entrada em "Aplicativos instalados", links
 * `vcall://` registrados e um desinstalador que desfaz tudo.
 *
 * TUDO VEM DENTRO. Nada é baixado durante a instalação — o programa e o
 * cloudflared viajam comprimidos dentro deste arquivo. Um instalador que
 * precisa de internet para instalar é o que falha justamente na máquina onde
 * a internet é o problema.
 *
 * Instala na pasta do usuário (`%LOCALAPPDATA%\\Programs\\Vcall`) de propósito:
 * não pede permissão de administrador, não mexe em Arquivos de Programas e não
 * afeta as outras contas do computador.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const NOME = "Vcall";
const CHAVE_DESINSTALAR = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NOME}`;

export function pastaDeInstalacao() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Programs", NOME);
  }
  return path.join(os.homedir(), ".local", "share", NOME.toLowerCase());
}

/** Já estamos rodando de dentro da pasta instalada? */
export function jaInstalado() {
  return path.dirname(process.execPath).toLowerCase() === pastaDeInstalacao().toLowerCase();
}

function rodar(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { stdio: "ignore", windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Cria um atalho do Windows.
 *
 * O formato .lnk é binário e documentado de forma incompleta; escrevê-lo à mão
 * é um caminho cheio de detalhes que quebram em silêncio. O Windows já traz o
 * objeto que faz isso corretamente, e chamá-lo pelo PowerShell é uma linha.
 */
function criarAtalho({ destino, alvo, descricao, argumentos = "" }) {
  const script = [
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:VC_LNK)",
    "$s.TargetPath = $env:VC_ALVO",
    "$s.Arguments = $env:VC_ARGS",
    "$s.WorkingDirectory = Split-Path $env:VC_ALVO",
    "$s.IconLocation = $env:VC_ALVO",
    "$s.Description = $env:VC_DESC",
    "$s.Save()",
  ].join("; ");

  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          VC_LNK: destino,
          VC_ALVO: alvo,
          VC_ARGS: argumentos,
          VC_DESC: descricao,
        },
      },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Onde fica a área de trabalho de verdade.
 *
 * `~/Desktop` está errado em muitos computadores: com o OneDrive ligado —
 * padrão em máquinas novas — a pasta é redirecionada para
 * `~/OneDrive/Desktop`, e o atalho criado no caminho antigo simplesmente não
 * aparece para a pessoa. O Windows guarda o caminho certo no registro.
 */
async function areaDeTrabalho() {
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"],
      { encoding: "utf8", windowsHide: true },
    );
    const caminho = String(r.stdout || "").trim();
    if (caminho) {
      await stat(caminho);
      return caminho;
    }
  } catch {
    /* cai no palpite abaixo */
  }
  const palpite = path.join(os.homedir(), "Desktop");
  try {
    await stat(palpite);
    return palpite;
  } catch {
    return null;
  }
}

/**
 * Restos de instalações anteriores feitas com Electron.
 *
 * O aplicativo já foi empacotado com Electron, e quem instalou aquela versão
 * tem cerca de 50 MB de arquivos do Chromium na pasta — que a versão atual
 * não usa para nada. Instalar por cima sem limpar deixaria os dois mundos
 * misturados, com um desinstalador antigo que remove metade das coisas.
 *
 * A lista é fechada de propósito: só nomes que sabidamente vieram daquele
 * empacotamento. Nada de apagar por padrão de nome.
 */
const RESTOS_ANTIGOS = [
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "resources.pak",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
  "Uninstall Vcall.exe",
  "locales",
  "resources",
];

async function limparInstalacaoAntiga(pasta, aviso) {
  let removidos = 0;
  for (const nome of RESTOS_ANTIGOS) {
    const alvo = path.join(pasta, nome);
    try {
      await stat(alvo);
    } catch {
      continue;
    }
    try {
      await rm(alvo, { recursive: true, force: true });
      removidos += 1;
    } catch {
      /* em uso: fica para a próxima */
    }
  }
  if (removidos) aviso(`Removendo ${removidos} arquivos de uma versão antiga…`);
}

/** Entrada em "Aplicativos instalados" do Windows. */
function registrarDesinstalacao(pasta, exe, versao) {
  const tamanhoKb = 130_000; // aproximado; o Windows só usa para exibir
  const campos = [
    ["DisplayName", "REG_SZ", NOME],
    ["DisplayVersion", "REG_SZ", versao],
    ["Publisher", "REG_SZ", "Victor Kauan"],
    ["DisplayIcon", "REG_SZ", exe],
    ["InstallLocation", "REG_SZ", pasta],
    ["UninstallString", "REG_SZ", `"${exe}" --desinstalar`],
    ["QuietUninstallString", "REG_SZ", `"${exe}" --desinstalar`],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
    ["EstimatedSize", "REG_DWORD", String(tamanhoKb)],
  ];
  let ok = true;
  for (const [nome, tipo, valor] of campos) {
    ok = rodar("reg", ["add", CHAVE_DESINSTALAR, "/v", nome, "/t", tipo, "/d", valor, "/f"]) && ok;
  }
  return ok;
}

/** Lê um arquivo embutido no executável e descomprime. */
async function assetDescomprimido(nome) {
  const sea = await import("node:sea");
  if (!sea.isSea?.()) throw new Error("não é um executável empacotado");
  const bruto = sea.getRawAsset(nome);
  if (!bruto) throw new Error(`falta ${nome} dentro do instalador`);
  return zlib.gunzipSync(Buffer.from(bruto));
}

/**
 * Instala. Devolve o caminho do executável instalado.
 *
 * @param {(texto:string)=>void} aviso para mostrar o andamento
 */
export async function instalar(aviso = () => {}) {
  const pasta = pastaDeInstalacao();
  const exe = path.join(pasta, process.platform === "win32" ? "Vcall.exe" : "vcall");

  aviso(`Instalando em ${pasta}`);
  await mkdir(pasta, { recursive: true });
  await limparInstalacaoAntiga(pasta, aviso);

  /*
   * O programa em si. Se já existe uma cópia rodando, a gravação falha com
   * arquivo em uso — daí a mensagem clara em vez de um erro de sistema.
   */
  aviso("Extraindo o programa…");
  const app = await assetDescomprimido("app.gz");
  try {
    await writeFile(exe, app);
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      throw new Error("o Vcall está aberto. Feche-o e rode o instalador de novo.");
    }
    throw err;
  }
  if (process.platform !== "win32") await chmod(exe, 0o755);

  // O cloudflared fica ao lado: é o primeiro lugar onde o app procura.
  aviso("Extraindo o componente de link público…");
  try {
    const cf = await assetDescomprimido("cloudflared.gz");
    const destinoCf = path.join(pasta, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    await writeFile(destinoCf, cf);
    if (process.platform !== "win32") await chmod(destinoCf, 0o755);
  } catch {
    aviso("  (sem o componente de link público; ele será baixado quando precisar)");
  }

  try {
    const leiame = await assetDescomprimido("leiame.gz");
    await writeFile(path.join(pasta, "LEIA-ME.txt"), leiame);
  } catch {
    /* opcional */
  }

  if (process.platform === "win32") {
    aviso("Criando atalhos…");
    const menu = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    );
    await mkdir(menu, { recursive: true });
    criarAtalho({
      destino: path.join(menu, `${NOME}.lnk`),
      alvo: exe,
      descricao: "Chamadas de vídeo diretas, sem intermediário",
    });

    const area = await areaDeTrabalho();
    if (area) {
      criarAtalho({
        destino: path.join(area, `${NOME}.lnk`),
        alvo: exe,
        descricao: "Chamadas de vídeo diretas, sem intermediário",
      });
    }

    aviso("Registrando no sistema…");
    registrarDesinstalacao(pasta, exe, process.env.VCALL_VERSAO || "3.0.0");
  }

  return exe;
}

/** Desfaz a instalação. */
export async function desinstalar(aviso = () => {}) {
  const pasta = pastaDeInstalacao();

  if (process.platform === "win32") {
    aviso("Removendo atalhos…");
    const menu = path.join(
      process.env.APPDATA || "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      `${NOME}.lnk`,
    );
    await rm(menu, { force: true }).catch(() => {});
    const area = await areaDeTrabalho();
    if (area) await rm(path.join(area, `${NOME}.lnk`), { force: true }).catch(() => {});

    aviso("Removendo registros…");
    rodar("reg", ["delete", CHAVE_DESINSTALAR, "/f"]);
    rodar("reg", ["delete", "HKCU\\Software\\Classes\\vcall", "/f"]);
  }

  aviso("Removendo os arquivos…");
  /*
   * A pasta de dados (`~/.vcall`) fica. Ela guarda o perfil do navegador com as
   * permissões concedidas e o registro de diagnóstico; apagá-la sem perguntar
   * seria jogar fora configuração que a pessoa pode querer de volta ao
   * reinstalar. Quem quiser some com ela à mão.
   */
  const meuExe = process.execPath;
  if (path.dirname(meuExe).toLowerCase() === pasta.toLowerCase()) {
    /*
     * O executável não consegue se apagar enquanto roda: quem remove a pasta
     * precisa ser outro processo, depois que este sair.
     *
     * Vai num arquivo de lote, e não numa linha de comando montada aqui. Uma
     * string com `&` e `>` passada ao cmd pelo Node é reescrita pelas regras de
     * aspas do Windows e chega quebrada — foi assim que a pasta continuou lá
     * depois de a desinstalação dizer que tinha terminado. O arquivo de lote
     * cuida da própria pontuação, e some no fim.
     */
    const lote = path.join(os.tmpdir(), `vcall-remover-${process.pid}.cmd`);
    const script = [
      "@echo off",
      // Espera o processo que chamou realmente sair.
      "ping 127.0.0.1 -n 4 > nul",
      `rmdir /s /q "${pasta}"`,
      // O lote se apaga: nada fica para trás na pasta temporária.
      'del "%~f0"',
      "",
    ].join(String.fromCharCode(13, 10));

    try {
      await writeFile(lote, script);
      spawn("cmd", ["/c", lote], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      aviso("Os arquivos serão removidos em alguns segundos.");
      return;
    } catch {
      aviso(`Não consegui agendar a remoção. Apague à mão: ${pasta}`);
      return;
    }
  }
  await rm(pasta, { recursive: true, force: true }).catch(() => {});
}
