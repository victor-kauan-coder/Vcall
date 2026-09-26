/**
 * desktop/guard.js — quem pode falar com o painel de controle do executável.
 *
 * Separado do launcher porque é a peça de segurança do aplicativo de mesa, e
 * peça de segurança precisa ser testável sem subir um túnel de verdade.
 *
 * A armadilha que este arquivo existe para evitar: o cloudflared roda na MESMA
 * máquina e reencaminha para 127.0.0.1. Uma requisição vinda da internet chega
 * aqui com endereço de origem local — então checar só o endereço deixa o painel
 * que liga e desliga o túnel aberto para qualquer pessoa que entre pelo link.
 * Isso não é teoria: aconteceu, e foi pego testando com o túnel no ar.
 */

/** Cabeçalhos que só existem quando alguém passou por um proxy. */
const MARCAS_DE_PROXY = [
  "cf-connecting-ip",
  "cf-ray",
  "cf-ipcountry",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
];

const NOMES_LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * A requisição veio mesmo desta máquina, e não de fora por um túnel?
 *
 * Três condições, todas necessárias: endereço de origem local, nenhuma marca
 * de proxy, e o `Host` pedido tem de ser o endereço local — quem veio pelo
 * túnel pediu pelo domínio do Cloudflare.
 */
export function isLocalRequest(req) {
  const ip = req?.socket?.remoteAddress || "";
  const daMaquina =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
  if (!daMaquina) return false;

  const headers = req.headers || {};
  for (const h of MARCAS_DE_PROXY) {
    if (headers[h]) return false;
  }

  const host = String(headers.host || "").toLowerCase();
  return NOMES_LOCAIS.has(host.replace(/:\d+$/, ""));
}

function responder(res, headers, code, body) {
  res.writeHead(code, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * Monta o tratador das rotas `/__host/`.
 *
 * @param {object} opts
 * @param {string} opts.token segredo desta execução
 * @param {Record<string, (url) => Promise<object>>} opts.acoes
 * @returns {(req, res, headers) => Promise<boolean>} true se já respondeu
 */
export function hostControl({ token, acoes, abertas = {} }) {
  return async (req, res, headers) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/__host/")) return false;

    if (!isLocalRequest(req)) {
      // 404, e não 403: para quem está fora, este painel simplesmente não
      // existe. Um 403 confirmaria que há algo ali para ser atacado.
      responder(res, headers, 404, { erro: "não encontrado" });
      return true;
    }

    const nome = url.pathname.slice("/__host/".length);

    /*
     * Ações sem token, mas ainda só para a própria máquina.
     *
     * Serve para a página descobrir que ESTÁ rodando dentro do aplicativo e
     * pegar o token. Sem isso, uma janela aberta por um caminho que não passou
     * o token na URL — um link `vcall://`, um recarregar depois de limpar a
     * sessão — perdia o painel do túnel sem nenhuma explicação.
     *
     * A checagem que protege de verdade continua sendo a de cima: quem vem
     * pelo túnel recebe 404 e nunca chega aqui. O token segue guardando as
     * ações que MUDAM alguma coisa.
     */
    if (abertas[nome]) {
      const { code = 200, ...corpo } = (await abertas[nome](url)) || {};
      responder(res, headers, code, corpo);
      return true;
    }

    if (url.searchParams.get("t") !== token) {
      responder(res, headers, 403, { erro: "token inválido" });
      return true;
    }

    const acao = acoes[nome];
    if (!acao) {
      responder(res, headers, 404, { erro: "ação desconhecida" });
      return true;
    }

    try {
      const { code = 200, ...corpo } = (await acao(url)) || {};
      responder(res, headers, code, corpo);
    } catch (err) {
      responder(res, headers, 502, { estado: "erro", erro: err.message });
    }
    return true;
  };
}
