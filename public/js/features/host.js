/**
 * features/host.js — o painel de quem hospeda, no aplicativo de mesa.
 *
 * Só existe quando a página foi aberta pelo executável do Vcall. No navegador
 * comum, `disponivel` é falso e nada disto aparece — o app web continua sendo
 * exatamente o que era.
 *
 * O segredo chega uma única vez, no endereço que o executável abre
 * (`?host=...`), e é imediatamente tirado da barra de endereços e guardado em
 * `sessionStorage`. Duas razões para não deixá-lo na URL: ela é copiada por
 * engano com facilidade — é justamente o que se faz nesta tela, copiar
 * endereços — e fica no histórico do navegador. Em `sessionStorage` ele morre
 * quando a aba fecha, que é exatamente o tempo de vida do servidor.
 */
import { Emitter } from "../lib/emitter.js";

const CHAVE = "vcall:host-token";

function capturarToken() {
  const url = new URL(location.href);
  const vindo = url.searchParams.get("host");
  if (vindo) {
    try {
      sessionStorage.setItem(CHAVE, vindo);
    } catch {
      /* sessão sem armazenamento: o token vale só para esta carga da página */
    }
    url.searchParams.delete("host");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    return vindo;
  }
  try {
    return sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export class HostPanel extends Emitter {
  token = capturarToken();
  estado = "parado";
  url = null;

  /** Período entre batimentos; o servidor informa no aperto de mão. */
  batimentoMs = 4000;
  #batida = 0;

  /** Estamos rodando dentro do executável? */
  get disponivel() {
    return !!this.token;
  }

  /**
   * Avisa o aplicativo, a cada poucos segundos, que a janela continua aberta.
   *
   * É o que permite ao executável se desligar sozinho quando a pessoa fecha a
   * janela. Sem isso o servidor ficava rodando para sempre, e — pior — com o
   * túnel no ar: o endereço público continuava aceitando quem tivesse o link,
   * depois de a pessoa achar que tinha fechado tudo.
   *
   * O aviso de saída usa `sendBeacon`, e não `fetch`: ao fechar a aba o
   * navegador cancela requisições pendentes, e um `fetch` disparado nesse
   * instante quase nunca chega. O beacon é entregue pelo navegador depois,
   * justamente para este caso.
   */
  manterVivo() {
    if (!this.token || this.#batida) return;

    const bater = () => {
      // `keepalive` para o aviso sobreviver a uma navegação no meio do caminho.
      fetch("/__host/vivo", { cache: "no-store", keepalive: true }).catch(() => {});
    };
    bater();
    this.#batida = setInterval(bater, this.batimentoMs);

    const despedir = () => {
      clearInterval(this.#batida);
      this.#batida = 0;
      try {
        navigator.sendBeacon("/__host/tchau");
      } catch {
        /* sem beacon: o silêncio do batimento resolve em alguns segundos */
      }
    };

    // `pagehide` é o único que dispara de forma confiável ao fechar a janela;
    // `beforeunload` não vale em celular e `unload` foi descontinuado.
    addEventListener("pagehide", (e) => {
      // Uma página que vai para o cache de voltar/avançar não fechou de fato.
      if (!e.persisted) despedir();
    });
  }

  /**
   * Descobre o token perguntando ao servidor local, quando ele não veio na URL.
   *
   * Uma janela pode ser aberta por caminhos que não passam o token: um link
   * `vcall://`, um recarregar depois da sessão ser limpa, um endereço digitado
   * à mão. Nesses casos o painel do túnel sumia do "Convidar" sem explicação —
   * a pessoa via o botão num dia e não via no outro.
   *
   * A pergunta só é respondida para quem está na própria máquina; de fora, o
   * servidor responde 404 e este método simplesmente conclui que não é o app.
   */
  async descobrir() {
    if (this.token) return true;
    try {
      const res = await fetch("/__host/hello", { cache: "no-store" });
      if (!res.ok) return false;
      const corpo = await res.json();
      if (!corpo?.app || !corpo?.token) return false;
      this.token = corpo.token;
      this.batimentoMs = corpo.batimento || 4000;
      try {
        sessionStorage.setItem(CHAVE, corpo.token);
      } catch {
        /* vale para esta carga da página */
      }
      this.emit("disponivel", true);
      this.manterVivo();
      return true;
    } catch {
      // Servidor web comum: a rota não existe. É o caso normal fora do app.
      return false;
    }
  }

  async #chamar(acao, { params = null, ...opts } = {}) {
    if (!this.token) throw new Error("sem token de anfitrião");
    const busca = new URLSearchParams({ t: this.token, ...(params || {}) });
    const res = await fetch(`/__host/${acao}?${busca}`, {
      cache: "no-store",
      ...opts,
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.erro || `falha (${res.status})`);
    return corpo;
  }

  async status() {
    const r = await this.#chamar("status");
    this.estado = r.estado;
    this.url = r.url;
    this.emit("status", r);
    return r;
  }

  /**
   * Liga o túnel e devolve o endereço público. Pode demorar: na primeira vez
   * o cloudflared ainda é baixado.
   */
  async abrirTunel() {
    this.estado = "abrindo";
    this.emit("status", { estado: this.estado, url: null });
    try {
      const r = await this.#chamar("tunnel/abrir");
      this.estado = r.estado;
      this.url = r.url;
      this.emit("status", r);
      return r.url;
    } catch (err) {
      this.estado = "erro";
      this.emit("status", { estado: "erro", erro: err.message });
      throw err;
    }
  }

  /**
   * Existe versão nova publicada no GitHub?
   *
   * Quem confere é o executável, não a página: a página está dentro de um
   * navegador e uma consulta a github.com daqui esbarraria na política de
   * origem. E mais importante — a resposta diz qual versão esta máquina está
   * rodando, então ela passa pelo caminho com token, que só responde a quem
   * está na própria máquina.
   */
  async atualizacao({ forcar = false } = {}) {
    return this.#chamar("atualizacao", { params: forcar ? { forcar: "1" } : null });
  }

  async fecharTunel() {
    const r = await this.#chamar("tunnel/fechar");
    this.estado = r.estado;
    this.url = null;
    this.emit("status", r);
    return r;
  }

  /**
   * O link `vcall://` que abre a sala no aplicativo de quem receber.
   *
   * Ele carrega o ENDEREÇO COMPLETO do servidor, não só o id da sala. Um
   * `vcall://ID` sozinho não funcionaria: a sala existe na máquina de quem
   * hospeda, e o aplicativo de quem recebe abriria o servidor local dele —
   * criando uma sala vazia de mesmo nome, em que ninguém se encontra.
   *
   * Sem túnel aberto, o endereço é o da rede local e o link só vale para quem
   * está na mesma rede. É a mesma limitação do link comum, e por isso a
   * interface mostra os dois lado a lado.
   */
  linkDoApp(linkDaSala) {
    const base = this.linkPublico(linkDaSala) || linkDaSala;
    if (!base) return null;
    return `vcall://join?u=${encodeURIComponent(base)}`;
  }

  /**
   * Converte o endereço local da sala no endereço público equivalente.
   * O id da sala vive no fragmento, que o túnel não toca — só a origem muda.
   */
  linkPublico(linkLocal) {
    if (!this.url) return null;
    try {
      const local = new URL(linkLocal);
      const publico = new URL(this.url);
      publico.pathname = local.pathname;
      publico.hash = local.hash;
      return publico.toString();
    } catch {
      return null;
    }
  }
}
