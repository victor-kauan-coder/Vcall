/**
 * desktop/encurtador.js — encurta o convite público.
 *
 * O endereço do túnel (palavra-palavra-palavra.trycloudflare.com) é comprido,
 * e o WhatsApp mostra o link escrito na mensagem. Um encurtador grátis troca
 * isso por `is.gd/AbC123`: a pessoa toca, o encurtador manda para o convite
 * de verdade, e o cartão da chamada aparece igual (o WhatsApp segue o
 * redirecionamento para montar a prévia).
 *
 * Só encurta o próprio convite (https://<túnel>/c/CODIGO): não é um
 * encurtador aberto para quem quiser. Se os serviços falharem, o convite
 * segue com o link do túnel, como antes.
 */

/** Serviços sem cadastro que devolvem só o link curto em texto. */
export const SERVICOS = [
  { nome: "is.gd", api: (u) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`, valido: /^https:\/\/is\.gd\/[A-Za-z0-9_]{3,30}$/ },
  { nome: "tinyurl", api: (u) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(u)}`, valido: /^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]{3,40}$/ },
];

/** O convite do túnel: https://<algo>.trycloudflare.com/c/CODIGO. */
export const CONVITE_DO_TUNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/c\/[A-Za-z0-9]{4,12}$/;

export function criarEncurtador({ fetch = globalThis.fetch, servicos = SERVICOS, tempo = 6000 } = {}) {
  const cache = new Map();

  async function tentar(servico, url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), tempo);
    try {
      const res = await fetch(servico.api(url), { signal: ctl.signal, headers: { "User-Agent": "Vcall" } });
      if (!res.ok) return null;
      const curto = (await res.text()).trim();
      return servico.valido.test(curto) ? curto : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  /** Devolve o link curto, ou null (fica o do túnel). */
  return async function encurtar(url) {
    if (!CONVITE_DO_TUNEL.test(url || "")) return null;
    if (cache.has(url)) return cache.get(url);
    const pedido = (async () => {
      for (const s of servicos) {
        const curto = await tentar(s, url);
        if (curto) return curto;
      }
      cache.delete(url); // falhou: tenta de novo na próxima vez
      return null;
    })();
    cache.set(url, pedido);
    return pedido;
  };
}
