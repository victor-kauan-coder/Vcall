/**
 * desktop/appimage.js — instalar a versão nova do AppImage sem quebrar nada.
 *
 * ANTES (instalação do electron-updater): apagava o AppImage antigo, salvava
 * o novo com OUTRO nome (Vcall-3.11.0-x86_64.AppImage) e abria a versão nova
 * na hora, com a antiga ainda fechando. Dois problemas, sempre:
 *   1. o atalho do menu (o nosso e o do AppImageLauncher) apontava para o
 *      arquivo apagado: o Vcall não abria mais pelo menu;
 *   2. a versão nova nascia com a antiga viva, achava "já tem um Vcall
 *      aberto" (trava de instância única) e se fechava.
 * Resultado: clicar em Atualizar fechava o app, e a pessoa ia ao GitHub
 * baixar de novo.
 *
 * AGORA:
 *   1. o arquivo novo é copiado para a MESMA pasta e troca de lugar com o
 *      antigo num `rename` (atômico): mesmo caminho, mesmo nome, atalhos
 *      continuam valendo. O processo em execução não sente: ele roda do
 *      arquivo antigo, que continua aberto até ele sair;
 *   2. quem reabre é um `sh` à parte, que espera o processo antigo terminar
 *      de verdade (a trava some junto) e só então abre o AppImage.
 */
import { spawn as spawnReal } from "node:child_process";
import { accessSync, chmodSync, constants, copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/*
 * O processo que espera o Vcall sair nasce dele, e herda os arquivos que o
 * Chromium deixou abertos sem fechar-ao-executar: app.asar, os .pak, o
 * icudtl.dat, o snapshot do V8 — todos de dentro da montagem do AppImage
 * ANTIGO. Passados adiante para a versão nova, eles seguravam aquela
 * montagem para sempre: o processo FUSE da versão velha não saía e os 160 MB
 * do arquivo já trocado continuavam ocupando o disco. Visto num teste com o
 * AppImage montado de verdade (/proc/<pid>/fd da versão nova apontando para
 * /tmp/.mount_Vcall.<velho>/).
 *
 * Fechar fd acima de 9 precisa do bash (no dash, `exec 34>&-` vira "rode o
 * programa 34" e mata o script). Sem bash, segue sem fechar — como antes.
 */
const FECHAR_HERDADOS = 'for f in /proc/$$/fd/*; do n=${f##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-" 2>/dev/null; done; ';

/** O shell do processo de espera, e o trecho que fecha o que veio herdado. */
export function interpretador(existe = existsSync) {
  return existe("/bin/bash") ? { sh: "/bin/bash", fechar: FECHAR_HERDADOS } : { sh: "/bin/sh", fechar: "" };
}

/** Variáveis que o AppImage em execução põe no ambiente e que a cópia nova define sozinha. */
const DO_APPIMAGE = ["APPIMAGE", "APPDIR", "ARGV0", "OWD"];

/**
 * Troca o AppImage `atual` pelo `novo` no mesmo lugar. Lança erro (sem mexer
 * no atual) se a pasta não aceitar escrita.
 */
export function trocarAppImage({ novo, atual, fs = { accessSync, chmodSync, copyFileSync, renameSync, rmSync, statSync } }) {
  if (!path.isAbsolute(atual) || atual.includes("\0")) throw new Error("caminho do AppImage inválido");
  if (!fs.statSync(novo).isFile()) throw new Error("download não encontrado");
  const pasta = path.dirname(atual);
  fs.accessSync(pasta, constants.W_OK);
  const temp = path.join(pasta, `.${path.basename(atual)}.novo`);
  try {
    fs.copyFileSync(novo, temp);
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, atual);
  } catch (err) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* sem resto para limpar */
    }
    throw err;
  }
  return atual;
}

/**
 * Abre `exe` assim que o processo `pid` terminar. O `sh` fica solto (não é
 * filho de quem está fechando), então sobrevive à saída do Vcall.
 */
export function reabrirDepois({ pid = process.pid, exe, env = process.env, spawn = spawnReal, existe = existsSync }) {
  const limpo = { ...env };
  for (const k of DO_APPIMAGE) delete limpo[k];
  const { sh, fechar } = interpretador(existe);
  const filho = spawn(sh, ["-c", `${fechar}while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; exec "$2"`, "vcall-reabrir", String(pid), exe], {
    detached: true,
    stdio: "ignore",
    env: limpo,
  });
  filho.unref?.();
  return filho;
}
