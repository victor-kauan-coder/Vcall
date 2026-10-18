/**
 * desktop/pacote.js — instalar a versão nova do .deb e do .rpm sem derrubar o app.
 *
 * ANTES (instalação do electron-updater): "Reiniciar e atualizar" chamava
 * `pkexec dnf install` (ou `apt-get`) de forma SÍNCRONA, com o Vcall aberto.
 * O processo principal congelava enquanto o sistema pedia a senha e o
 * gerenciador baixava metadados e instalava — no Fedora, um minuto ou mais.
 * O GNOME mostrava "O Vcall não está respondendo", e os arquivos de /opt/Vcall
 * eram trocados com o Chromium ainda rodando por cima deles. Para quem via,
 * o app travava e caía.
 *
 * AGORA: o Vcall fecha primeiro. Um processo à parte espera ele sair, pede a
 * senha pelo pkexec, instala com o gerenciador do sistema, anota o resultado
 * no registro do app e abre o Vcall de novo — na versão nova, ou na antiga se
 * a pessoa cancelou a senha (ninguém fica sem o app).
 *
 * A assinatura do pacote já foi conferida pelo Vcall antes de chegar aqui
 * (desktop/assinatura.js): por isso o --nogpgcheck do dnf/yum.
 */
import { spawn as spawnReal } from "node:child_process";
import { existsSync } from "node:fs";

import { interpretador } from "./appimage.js";

const ONDE = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** Caminho absoluto de um programa do sistema, ou null. */
export function acharComando(nome, existe = existsSync) {
  for (const d of ONDE) if (existe(`${d}/${nome}`)) return `${d}/${nome}`;
  return null;
}

/** O comando que instala `arquivo` (.deb ou .rpm) neste sistema, ou null. */
export function comandoDeInstalacao({ tipo, arquivo, achar = acharComando }) {
  if (tipo === "deb") {
    const apt = achar("apt-get");
    if (apt) return [apt, "install", "-y", "--allow-downgrades", arquivo];
    const dpkg = achar("dpkg");
    if (dpkg) return [dpkg, "-i", arquivo];
  }
  if (tipo === "rpm") {
    const dnf = achar("dnf");
    if (dnf) return [dnf, "install", "-y", "--nogpgcheck", arquivo];
    const zypper = achar("zypper");
    if (zypper) return [zypper, "--non-interactive", "install", "--allow-unsigned-rpm", "-f", arquivo];
    const yum = achar("yum");
    if (yum) return [yum, "install", "-y", "--nogpgcheck", arquivo];
    const rpm = achar("rpm");
    if (rpm) return [rpm, "-U", "--replacepkgs", arquivo];
  }
  return null;
}

/**
 * Agenda a instalação para depois que o processo `pid` sair. Lança erro (sem
 * fechar nada) se não houver gerenciador de pacotes ou pkexec.
 */
export function instalarPacoteDepois({
  pid = process.pid,
  tipo,
  arquivo,
  exe,
  reabrir = true,
  log,
  root = process.getuid?.() === 0,
  achar = acharComando,
  existe = existsSync,
  env = process.env,
  spawn = spawnReal,
}) {
  const cmd = comandoDeInstalacao({ tipo, arquivo, achar });
  if (!cmd) throw new Error(`nenhum gerenciador de pacotes para .${tipo} neste sistema`);
  let elevar = [];
  if (!root) {
    const pkexec = achar("pkexec");
    if (!pkexec) throw new Error("pkexec não encontrado (o sistema não tem como pedir a senha)");
    elevar = [pkexec];
  }
  const { sh, fechar } = interpretador(existe);
  const script =
    `${fechar}pid=$1; log=$2; exe=$3; reabrir=$4; shift 4; ` +
    'while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done; ' +
    '"$@"; c=$?; ' +
    `printf '{"t":"%s","evento":"atualizacao-pacote","codigo":%s}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$c" >> "$log"; ` +
    '[ "$reabrir" = 1 ] && exec "$exe"; exit $c';
  const filho = spawn(sh, ["-c", script, "vcall-atualizar", String(pid), log, exe, reabrir ? "1" : "0", ...elevar, ...cmd], {
    detached: true,
    stdio: "ignore",
    env,
  });
  filho.unref?.();
  return { comando: [...elevar, ...cmd], filho };
}
