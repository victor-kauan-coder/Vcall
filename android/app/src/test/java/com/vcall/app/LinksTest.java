package com.vcall.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class LinksTest {
    private static final String SALA = "Ab3_dE-fGh1JkLmN0pQr";
    private static final String CERTO = "https://rio-azul-casa.trycloudflare.com/#" + SALA;

    @Test
    public void linkDaSala() {
        assertEquals(CERTO, Links.paraSala(CERTO));
    }

    @Test
    public void conviteAbrirViraLinkDaSala() {
        assertEquals(CERTO, Links.paraSala("https://rio-azul-casa.trycloudflare.com/abrir#" + SALA));
    }

    @Test
    public void mensagemDoWhatsApp() {
        String msg = "Entra na minha chamada no Vcall:\n" + CERTO + ".";
        assertEquals(CERTO, Links.paraSala(msg));
    }

    @Test
    public void semHttpsNaFrente() {
        assertEquals(CERTO, Links.paraSala("rio-azul-casa.trycloudflare.com/#" + SALA));
    }

    @Test
    public void linkDoAppDeMesa() {
        String vcall = "vcall://join?u=https%3A%2F%2Frio-azul-casa.trycloudflare.com%2F%23" + SALA;
        assertEquals(CERTO, Links.paraSala(vcall));
    }

    @Test
    public void servidorSemSalaAbreOInicioDele() {
        assertEquals("https://rio-azul-casa.trycloudflare.com/", Links.paraSala("https://rio-azul-casa.trycloudflare.com"));
    }

    @Test
    public void localhostDeTesteComPorta() {
        assertEquals("http://localhost:3000/#" + SALA, Links.paraSala("http://localhost:3000/#" + SALA));
    }

    @Test
    public void recusaHttpForaDoAparelho() {
        assertNull("câmera não abre sem HTTPS", Links.paraSala("http://192.168.0.10:3000/#" + SALA));
        assertNull(Links.paraSala("http://exemplo.com/#" + SALA));
    }

    @Test
    public void recusaOQueNaoELink() {
        assertNull(Links.paraSala("bom dia"));
        assertNull(Links.paraSala(""));
        assertNull(Links.paraSala(null));
        assertNull(Links.paraSala("javascript:alert(1)"));
        assertNull(Links.paraSala("vcall://join?u=javascript%3Aalert(1)"));
    }

    @Test
    public void fragmentoQueNaoESalaFicaDeFora() {
        assertEquals("https://x.trycloudflare.com/", Links.paraSala("https://x.trycloudflare.com/#curto"));
    }
}
