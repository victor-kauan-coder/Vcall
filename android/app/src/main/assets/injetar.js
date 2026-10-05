/*
 * Roda em toda página de chamada aberta no app Android (MainActivity,
 * onPageFinished). A página vem do servidor de quem convidou e não sabe que
 * está num celular com app; isto liga as pontas que o WebView deixa soltas.
 * Só usa o que a interface tem desde a 3.x (#dock, meta theme-color), para
 * funcionar com o app de mesa de quem convidou mesmo se ele for mais antigo.
 */
(() => {
  if (window.__vcallAndroid) return;
  window.__vcallAndroid = true;
  const ponte = window.VcallAndroid;
  if (!ponte) return;
  document.documentElement.classList.add("vcall-android");

  /*
   * 1. Downloads. O WebView não baixa link blob: (arquivo da conversa,
   * gravação, transcrição, quadro). O arquivo vai para Downloads/Vcall pela
   * ponte, em pedaços. A página costuma revogar o blob logo depois do
   * clique; a revogação espera um minuto para a leitura terminar.
   */
  const revogar = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (u) => setTimeout(() => revogar(u), 60000);

  const lerPedaco = (blob) =>
    new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).slice(String(fr.result).indexOf(",") + 1));
      fr.onerror = () => erro(fr.error);
      fr.readAsDataURL(blob);
    });

  const salvar = async (href, nome) => {
    try {
      const blob = await (await fetch(href)).blob();
      const id = ponte.abrirArquivo(nome, blob.type || "");
      if (!id) return;
      const PEDACO = 768 * 1024;
      for (let i = 0; i < blob.size; i += PEDACO) {
        if (!ponte.escreverArquivo(id, await lerPedaco(blob.slice(i, i + PEDACO)))) return;
      }
      ponte.fecharArquivo(id);
    } catch (e) {
      console.warn("[vcall-android] download falhou", e);
    }
  };

  const baixavel = (a) => !!a && a.hasAttribute("download") && /^(blob|data):/.test(a.href);
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest && e.target.closest("a[download]");
      if (!baixavel(a)) return;
      e.preventDefault();
      salvar(a.href, a.getAttribute("download") || "");
    },
    true,
  );
  // Link criado só para o clique, fora da página: o evento não chega ao document.
  const clicar = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (baixavel(this) && !this.isConnected) return void salvar(this.href, this.getAttribute("download") || "");
    return clicar.call(this);
  };

  /*
   * 2. Em chamada ou não (a barra de controles aparece ao entrar na sala), e a
   * cor do fundo, para as barras do sistema acompanharem o tema.
   */
  let naSala = null;
  let cor = null;
  const conferir = () => {
    const dock = document.getElementById("dock");
    const agora = !!dock && !dock.hidden;
    if (agora !== naSala) {
      naSala = agora;
      ponte.chamada(agora);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    const nova = meta && meta.content;
    if (nova && nova !== cor) {
      cor = nova;
      ponte.corDaPagina(nova);
    }
  };
  conferir();
  setInterval(conferir, 1000);

  // 3. Mini-janela (picture-in-picture): só o palco, sem barra nem controles.
  window.__vcallMini = (ligada) => {
    let estilo = document.getElementById("vcall-android-mini");
    if (!ligada) {
      if (estilo) estilo.remove();
      return;
    }
    if (estilo) return;
    estilo = document.createElement("style");
    estilo.id = "vcall-android-mini";
    estilo.textContent = `
      #topbar, #dock, .panel, .toasts, [class*="toast"] { display: none !important; }
      #stage { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 4px !important; }
    `;
    document.head.append(estilo);
  };
})();
