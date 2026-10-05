package com.vcall.app;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Acha a chamada no que a pessoa colou ou no que chegou por convite.
 *
 * Aceita o link da sala (https://…/#sala), o /abrir do convite, o vcall://
 * do app de mesa e o endereço sem "https://" — inclusive no meio de uma
 * mensagem do WhatsApp ("Entra na minha chamada no Vcall: https://…").
 * Devolve sempre https://servidor/#sala (ou só https://servidor/), ou null.
 *
 * Só HTTPS: câmera e microfone não abrem em página sem criptografia. A
 * exceção é o servidor de teste no próprio aparelho (localhost).
 */
final class Links {
    private Links() {}

    /** Mesma regra de public/js/lib/invite.js (ID_SALA). */
    private static final Pattern SALA = Pattern.compile("^[A-Za-z0-9_-]{16,64}$");
    private static final Pattern CANDIDATO = Pattern.compile(
            "(vcall://\\S+|https?://\\S+|[A-Za-z0-9.-]+\\.trycloudflare\\.com\\S*)", Pattern.CASE_INSENSITIVE);

    static String paraSala(String texto) {
        if (texto == null) return null;
        Matcher m = CANDIDATO.matcher(texto);
        while (m.find()) {
            String achado = normalizar(limparFim(m.group(1)), 0);
            if (achado != null) return achado;
        }
        return null;
    }

    /** Pontuação colada no fim do link numa frase: "…/#abc." ou "(…/#abc)". */
    private static String limparFim(String s) {
        int fim = s.length();
        while (fim > 0 && ".,;:!?)]}>\"'”’".indexOf(s.charAt(fim - 1)) >= 0) fim--;
        return s.substring(0, fim);
    }

    private static String normalizar(String bruto, int nivel) {
        if (nivel > 1) return null; // vcall:// dentro de vcall://: não
        String s = bruto.trim();
        if (s.regionMatches(true, 0, "vcall://", 0, 8)) {
            int q = s.indexOf("u=");
            if (q < 0) return null;
            int e = s.indexOf('&', q);
            String u = s.substring(q + 2, e < 0 ? s.length() : e);
            try {
                return normalizar(URLDecoder.decode(u, StandardCharsets.UTF_8.name()), nivel + 1);
            } catch (Exception ex) {
                return null;
            }
        }
        if (!s.regionMatches(true, 0, "http", 0, 4)) s = "https://" + s;

        URI uri;
        try {
            uri = new URI(s);
        } catch (Exception ex) {
            return null;
        }
        String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return null;
        host = host.toLowerCase();
        boolean local = host.equals("localhost") || host.equals("127.0.0.1");
        if (!esquema.equals("https") && !(esquema.equals("http") && local)) return null;

        String porta = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        String base = esquema + "://" + host + porta + "/";
        String fragmento = uri.getRawFragment();
        if (fragmento != null && SALA.matcher(fragmento).matches()) return base + "#" + fragmento;
        return base;
    }
}
