/**
 * desktop/setup.js — o que o VcallSetup.exe faz ao ser aberto.
 *
 * Instala, desinstala, e conversa em português no caminho.
 *
 * Ao contrário do aplicativo, este executável MANTÉM a janela de console. Um
 * instalador que não mostra nada parece travado — e é exatamente aqui que a
 * pessoa precisa ver o que está acontecendo, e qual foi o erro quando dá
 * errado. A janela fecha sozinha ao final.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import { desinstalar, instalar, pastaDeInstalacao } from "./instalador.js";

const VERSAO = process.env.VCALL_VERSAO || "3.6.0";

const linha = (t = "") => process.stdout.write(`${t}\n`);

function cabecalho() {
  linha();
  linha("  ╔═══════════════════════════════════════════╗");
  linha("  ║   VCALL — instalação                      ║");
  linha("  ╚═══════════════════════════════════════════╝");
  linha();
  linha(`  Versão ${VERSAO}`);
  linha("  Chamadas de vídeo diretas, sem intermediário.");
  linha();
}

/** Espera uma tecla, para a janela não sumir antes de a pessoa ler. */
function esperarTecla(texto = "  Aperte Enter para fechar.") {
  return new Promise((resolve) => {
    linha();
    linha(texto);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
    // Sem console interativo (rodado por script), não trava esperando.
    setTimeout(() => {
      rl.close();
      resolve();
    }, 120_000).unref?.();
  });
}

async function fluxoInstalar() {
  cabecalho();
  linha(`  Pasta: ${pastaDeInstalacao()}`);
  linha("  Nada é baixado da internet: tudo já está neste arquivo.");
  linha();

  let exe;
  try {
    exe = await instalar((t) => linha(`  ${t}`));
  } catch (err) {
    linha();
    linha(`  NÃO DEU CERTO: ${err.message}`);
    await esperarTecla();
    process.exit(1);
  }

  linha();
  linha("  Instalado.");
  linha();
  linha("  O Vcall está no menu iniciar e na área de trabalho.");
  linha("  Para remover: Configurações → Aplicativos → Vcall.");
  linha();
  linha("  Abrindo…");

  /*
   * Solto do processo do instalador: se o aplicativo ficasse preso a ele,
   * fechar a janela do console derrubaria a chamada junto.
   */
  try {
    spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  } catch {
    linha(`  (abra manualmente: ${exe})`);
  }

  // Uma pausa curta para a mensagem ser lida antes de a janela sumir.
  await new Promise((r) => setTimeout(r, 2500));
  process.exit(0);
}

async function fluxoDesinstalar() {
  cabecalho();
  linha("  Removendo o Vcall…");
  linha();
  try {
    await desinstalar((t) => linha(`  ${t}`));
  } catch (err) {
    linha(`  Erro: ${err.message}`);
  }
  linha();
  linha("  Removido.");
  linha();
  linha("  A pasta .vcall na sua pasta de usuário foi mantida: ela guarda");
  linha("  as permissões já concedidas. Apague-a à mão se quiser.");
  await new Promise((r) => setTimeout(r, 3000));
  process.exit(0);
}

export function main() {
  const args = process.argv.slice(1);
  if (args.some((a) => a === "--desinstalar" || a === "/uninstall")) {
    return fluxoDesinstalar();
  }
  return fluxoInstalar();
}
