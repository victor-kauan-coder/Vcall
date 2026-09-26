#!/usr/bin/env node
/**
 * scripts/doctor.mjs — diagnóstico.
 *
 * Responde a pergunta "por que não abre?" verificando, em ordem, tudo o que
 * precisa estar certo para o `npm start` funcionar. Roda em qualquer Node 14+
 * de propósito: ele tem de conseguir rodar justamente quando o servidor não
 * consegue.
 *
 * Use: npm run doctor
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[90m", X = "\x1b[0m", B = "\x1b[1m";
let problems = 0;

const ok = (m, d = "") => console.log(`  ${G}✓${X} ${m}${d ? ` ${D}${d}${X}` : ""}`);
const bad = (m, fix) => {
  problems += 1;
  console.log(`  ${R}✗${X} ${B}${m}${X}`);
  if (fix) console.log(`    ${Y}→ ${fix}${X}`);
};
const info = (m, d = "") => console.log(`  ${D}·${X} ${m}${d ? ` ${D}${d}${X}` : ""}`);

let versionInfo = null;
try {
  const { VERSION, versionLabel } = await import("../src/version.js");
  versionInfo = { ...VERSION, label: versionLabel() };
} catch {
  /* arquivos incompletos; os testes abaixo vão apontar */
}

console.log(`\n${B}Diagnóstico do Vcall${X}${versionInfo ? ` ${D}${versionInfo.label}${X}` : ""}\n`);

/* 1. Node ---------------------------------------------------------- */

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  bad(
    `Node ${process.version} — muito antigo`,
    "Instale o Node 18 ou mais novo em https://nodejs.org e tente de novo.",
  );
} else {
  ok(`Node ${process.version}`);
}

/* 2. Pasta certa --------------------------------------------------- */

const need = ["package.json", "server.js", "src", "public"];
const missing = need.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  bad(
    `Arquivos do projeto faltando: ${missing.join(", ")}`,
    "Descompacte o zip de novo e rode os comandos de dentro da pasta do projeto.",
  );
} else {
  ok("Arquivos do projeto no lugar", root);
}

/* 3. Dependências -------------------------------------------------- */

if (!fs.existsSync(path.join(root, "node_modules", "ws", "package.json"))) {
  bad("Dependências não instaladas", 'Rode: npm install');
} else {
  ok("Dependências instaladas");
}

/* 4. Arquivos gerados ---------------------------------------------- */

const vendor = ["public/vendor/icons.svg", "public/vendor/avatars.js", "public/index.html"];
const vmissing = vendor.filter((f) => !fs.existsSync(path.join(root, f)));
if (vmissing.length) {
  bad(
    `Arquivos da interface faltando: ${vmissing.join(", ")}`,
    "Rode: npm install --include=dev && npm run vendor",
  );
} else {
  ok("Ícones e avatares presentes");
}

/* 4b. versão dos arquivos ------------------------------------------ */

if (versionInfo) {
  ok(
    `Versão dos arquivos: ${versionInfo.label}`,
    `${versionInfo.files} arquivos`,
  );
  info("Compare com a versão que o app mostra em Configurações → Sobre");
}

/* 5. .env ---------------------------------------------------------- */

const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"));
  ok(`.env encontrado`, `${lines.length} variáveis`);
  const turn = lines.find((l) => /^TURN_|^CF_TURN_/.test(l.trim()));
  info(turn ? "TURN configurado no .env" : "sem TURN no .env (opcional)");
} else {
  info("sem .env — tudo bem, ele é opcional");
}

/* 6. Porta --------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 3000;

function probePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e) => resolve(e.code));
    srv.once("listening", () => srv.close(() => resolve(null)));
    srv.listen(port, "0.0.0.0");
  });
}

function probeHttp(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/healthz", timeout: 2500 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => (req.destroy(), resolve(null)));
  });
}

const portState = await probePort(PORT);

if (portState === null) {
  info(`Porta ${PORT} livre — o servidor não está rodando agora`);
  console.log(`\n${B}Próximo passo${X}\n`);
  console.log(`  npm start`);
  console.log(`\n  Depois abra ${B}http://localhost:${PORT}${X}\n`);
} else if (portState === "EADDRINUSE") {
  const [v4, v6] = await Promise.all([probeHttp(PORT, "127.0.0.1"), probeHttp(PORT, "::1")]);
  const up = (r) => r && r.status === 200 && r.body.includes("ok");
  if (up(v4) || up(v6)) {
    ok(`O Vcall já está rodando na porta ${PORT}`);
    // É aqui que aparece a causa de "localhost não abre": o servidor responde
    // num dos protocolos e não no outro.
    if (up(v4) && up(v6)) {
      ok("Responde em IPv4 e IPv6 — localhost vai funcionar");
      console.log(`\n  Abra ${B}http://localhost:${PORT}${X}\n`);
    } else if (up(v4)) {
      bad(
        "Responde só em IPv4 — no Windows, localhost costuma ir por IPv6 e falha",
        `Use ${B}http://127.0.0.1:${PORT}${X}, ou tire a variável HOST do .env para o servidor atender os dois.`,
      );
    } else {
      bad(
        "Responde só em IPv6",
        `Use ${B}http://[::1]:${PORT}${X}, ou tire a variável HOST do .env.`,
      );
    }
  } else {
    bad(
      `A porta ${PORT} está ocupada por outro programa`,
      `Use outra porta:  PORT=3001 npm start   (Windows: $env:PORT=3001; npm start)`,
    );
  }
} else {
  bad(`Não foi possível testar a porta ${PORT} (${portState})`, "Tente outra porta com PORT=3001");
}

/* ------------------------------------------------------------------ */

if (problems) {
  console.log(`${R}${problems} problema(s) encontrado(s).${X} Resolva os itens marcados acima.\n`);
  process.exit(1);
}
process.exit(0);
