#!/usr/bin/env node
/**
 * scripts/fixtures/tailscale-falso.mjs — um `tailscale` de mentira, para teste.
 *
 * O desktop-test não tem uma rede Tailscale de verdade (nem conta, nem
 * servidor de controle). Este script responde como o CLI real responde
 * (textos e JSON copiados do tailscale v1.104, cmd/tailscale/cli e
 * ipn/ipnlocal/serve.go) e faz o que o `tailscale serve` faz de importante:
 * HTTPS na porta pedida, repassando para o servidor local com o Host
 * original, X-Forwarded-For/Host/Proto e a identidade Tailscale-User-*,
 * inclusive o WebSocket da sinalização.
 *
 * Ambiente:
 *   VCALL_TS_FALSO_CERT / _KEY   certificado e chave do HTTPS (gerados pelo teste)
 *   VCALL_TS_FALSO_HABILITAR=1   imita a rede sem HTTPS ligado: imprime a
 *                                página para ligar e espera 3 s antes de servir
 *   VCALL_TS_FALSO_443=1         a 443 já está em uso (força a 8443)
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const NOME = "maquina.tail1234.ts.net";
const args = process.argv.slice(2);

if (args[0] === "status" && args.includes("--json")) {
  process.stdout.write(
    JSON.stringify({
      Version: "1.104.1-t0000000-g0000000",
      BackendState: "Running",
      TailscaleIPs: ["127.0.0.1"],
      Self: { DNSName: `${NOME}.`, HostName: "maquina", TailscaleIPs: ["127.0.0.1", "fd7a:115c:a1e0::1"], Online: true },
      Health: [],
      MagicDNSSuffix: "tail1234.ts.net",
      CurrentTailnet: { Name: "teste@example.com", MagicDNSSuffix: "tail1234.ts.net", MagicDNSEnabled: true },
      CertDomains: [NOME],
    }),
  );
  process.exit(0);
}

if (args[0] === "serve" && args[1] === "status") {
  process.stdout.write(process.env.VCALL_TS_FALSO_443 ? JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NOME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } }) : "{}");
  process.exit(0);
}

if (args[0] !== "serve") {
  process.stderr.write(`tailscale-falso: comando não imitado: ${args.join(" ")}\n`);
  process.exit(2);
}

const porta = Number(/^--https=(\d+)$/.exec(args.find((a) => a.startsWith("--https=")) || "")?.[1] || 443);
const alvo = new URL(args[args.length - 1]);
// Quem chama pelo link é sempre "da tailnet": o real põe o IP 100.x de quem chamou.
const IP_DO_CONVIDADO = "100.101.102.103";

function cabecalhos(req) {
  const h = { ...req.headers };
  for (const k of Object.keys(h)) if (k.startsWith("tailscale-user-")) delete h[k];
  h["x-forwarded-host"] = req.headers.host;
  h["x-forwarded-proto"] = "https";
  h["x-forwarded-for"] = IP_DO_CONVIDADO;
  h["tailscale-user-login"] = "convidado@example.com";
  h["tailscale-user-name"] = "Convidado";
  return h;
}

function servir() {
  const servidor = https.createServer(
    { cert: readFileSync(process.env.VCALL_TS_FALSO_CERT), key: readFileSync(process.env.VCALL_TS_FALSO_KEY) },
    (req, res) => {
      const ida = http.request(
        { host: alvo.hostname, port: alvo.port, method: req.method, path: req.url, headers: cabecalhos(req) },
        (volta) => {
          res.writeHead(volta.statusCode || 502, volta.headers);
          volta.pipe(res);
        },
      );
      ida.on("error", () => (res.writeHead(502), res.end()));
      req.pipe(ida);
    },
  );
  // WebSocket: repassa o pedido de upgrade e emenda os dois sockets.
  servidor.on("upgrade", (req, socket, cabeca) => {
    const ida = net.connect(Number(alvo.port), alvo.hostname, () => {
      const linhas = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(cabecalhos(req))) linhas.push(`${k}: ${v}`);
      ida.write(`${linhas.join("\r\n")}\r\n\r\n`);
      if (cabeca?.length) ida.write(cabeca);
      ida.pipe(socket);
      socket.pipe(ida);
    });
    const fechar = () => (ida.destroy(), socket.destroy());
    ida.on("error", fechar);
    socket.on("error", fechar);
  });
  servidor.listen(porta, "127.0.0.1", () => {
    const portaTxt = porta === 443 ? "" : `:${porta}`;
    process.stdout.write(`Available within your tailnet:\n\nhttps://${NOME}${portaTxt}/\n|-- proxy ${alvo.href}\n\nPress Ctrl+C to exit.\n`);
  });
  servidor.on("error", (err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}

if (process.env.VCALL_TS_FALSO_HABILITAR) {
  process.stdout.write(
    "\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nTESTE123\n\n",
  );
  setTimeout(servir, 3000);
} else {
  servir();
}

// Em primeiro plano, como o real: vive até ser encerrado.
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
